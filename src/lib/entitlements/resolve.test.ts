import { describe, expect, it } from 'vitest';

import { PLANS } from '@/config/plans';

import {
  computeTrialRemaining,
  resolveEffectiveEntitlement,
  TRIAL_ACCOUNT_LIMIT,
  type EntitlementRecord,
} from './resolve';

const NOW = new Date('2026-06-15T12:00:00Z');

function record(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
  return {
    workspaceId: 'workspace-1',
    status: 'trialing',
    planKey: null,
    trialStartedAt: new Date('2026-06-08T12:00:00Z'),
    trialEndsAt: new Date('2026-06-15T12:00:00Z'),
    currentPeriodEndsAt: null,
    ...overrides,
  };
}

describe('plan registry', () => {
  it('has exactly starter/pro/elite with 1/3/10 account limits', () => {
    expect(PLANS.map((plan) => [plan.id, plan.tradingAccounts])).toEqual([
      ['starter', 1],
      ['pro', 3],
      ['elite', 10],
    ]);
  });

  it('the trial account limit equals the highest configured plan limit', () => {
    expect(TRIAL_ACCOUNT_LIMIT).toBe(10);
    expect(TRIAL_ACCOUNT_LIMIT).toBe(Math.max(...PLANS.map((plan) => plan.tradingAccounts)));
  });
});

describe('resolveEffectiveEntitlement — trial status', () => {
  it('is trialing with the full trial limit while now < trialEndsAt', () => {
    const before = new Date('2026-06-15T11:59:59.999Z');
    const effective = resolveEffectiveEntitlement(record(), 1, before);

    expect(effective.effectiveStatus).toBe('trialing');
    expect(effective.accountLimit).toBe(10);
    expect(effective.trialExpired).toBe(false);
    expect(effective.canCreateAccount).toBe(true);
    expect(effective.canRestoreAccount).toBe(true);
    expect(effective.blockReason).toBeNull();
  });

  it('is expired exactly at trialEndsAt, with no grace period', () => {
    const effective = resolveEffectiveEntitlement(record(), 1, NOW);

    expect(effective.effectiveStatus).toBe('expired');
    expect(effective.trialExpired).toBe(true);
    expect(effective.canCreateAccount).toBe(false);
    expect(effective.canRestoreAccount).toBe(false);
    expect(effective.blockReason).toBe('trial_expired');
  });

  it('is expired after trialEndsAt even with no persisted status transition', () => {
    const after = new Date('2026-06-16T00:00:00Z');
    const effective = resolveEffectiveEntitlement(record({ status: 'trialing' }), 1, after);

    expect(effective.persistedStatus).toBe('trialing');
    expect(effective.effectiveStatus).toBe('expired');
  });

  it('reports remaining slots and blocks creation once at the trial limit', () => {
    const atLimit = resolveEffectiveEntitlement(record(), 10, new Date('2026-06-10T00:00:00Z'));
    expect(atLimit.remainingAccountSlots).toBe(0);
    expect(atLimit.canCreateAccount).toBe(false);
    expect(atLimit.blockReason).toBe('account_limit_reached');
    expect(atLimit.overLimit).toBe(false);

    const underLimit = resolveEffectiveEntitlement(record(), 9, new Date('2026-06-10T00:00:00Z'));
    expect(underLimit.remainingAccountSlots).toBe(1);
    expect(underLimit.canCreateAccount).toBe(true);
  });
});

describe('resolveEffectiveEntitlement — active plan', () => {
  it('uses the plan registry limit, not the trial limit', () => {
    const active = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'pro', trialEndsAt: null }),
      2,
      NOW,
    );
    expect(active.accountLimit).toBe(3);
    expect(active.remainingAccountSlots).toBe(1);
    expect(active.canCreateAccount).toBe(true);
  });

  it('reports over-limit when a downgrade leaves more accounts than the new plan allows', () => {
    const overLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'starter', trialEndsAt: null }),
      3,
      NOW,
    );
    expect(overLimit.overLimit).toBe(true);
    expect(overLimit.canCreateAccount).toBe(false);
    expect(overLimit.canRestoreAccount).toBe(false);
    expect(overLimit.blockReason).toBe('workspace_over_limit');
  });

  it('fails closed for an unrecognized plan key', () => {
    const unknown = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'enterprise' as never, trialEndsAt: null }),
      1,
      NOW,
    );
    expect(unknown.accountLimit).toBeNull();
    expect(unknown.canCreateAccount).toBe(false);
    expect(unknown.canRestoreAccount).toBe(false);
    expect(unknown.blockReason).toBe('unknown_plan');
  });
});

describe('resolveEffectiveEntitlement — canceled', () => {
  it('blocks create and restore even when under the last known limit', () => {
    const canceled = resolveEffectiveEntitlement(
      record({ status: 'canceled', planKey: 'pro', trialEndsAt: null }),
      1,
      NOW,
    );
    expect(canceled.effectiveStatus).toBe('canceled');
    expect(canceled.canCreateAccount).toBe(false);
    expect(canceled.canRestoreAccount).toBe(false);
    expect(canceled.blockReason).toBe('subscription_canceled');
  });
});

describe('computeTrialRemaining', () => {
  it('reports whole days remaining, floored', () => {
    const trialEndsAt = new Date('2026-06-15T12:00:00Z');
    const now = new Date('2026-06-10T13:00:00Z');
    const remaining = computeTrialRemaining(trialEndsAt, now);
    expect(remaining.expired).toBe(false);
    expect(remaining.days).toBe(4);
    expect(remaining.lessThanOneDay).toBe(false);
  });

  it('flags less-than-one-day separately from zero days remaining while still active', () => {
    const trialEndsAt = new Date('2026-06-15T12:00:00Z');
    const now = new Date('2026-06-15T00:00:01Z');
    const remaining = computeTrialRemaining(trialEndsAt, now);
    expect(remaining.expired).toBe(false);
    expect(remaining.days).toBe(0);
    expect(remaining.lessThanOneDay).toBe(true);
  });

  it('reports expired at and after the exact end instant', () => {
    const trialEndsAt = new Date('2026-06-15T12:00:00Z');
    expect(computeTrialRemaining(trialEndsAt, trialEndsAt).expired).toBe(true);
    expect(computeTrialRemaining(trialEndsAt, new Date('2026-06-16T00:00:00Z')).expired).toBe(true);
  });
});
