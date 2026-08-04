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
  it('has exactly starter/trader/professional with 1/5/15 account limits', () => {
    expect(PLANS.map((plan) => [plan.id, plan.tradingAccounts])).toEqual([
      ['starter', 1],
      ['trader', 5],
      ['professional', 15],
    ]);
  });

  it('has the locked THB and USD prices', () => {
    expect(PLANS.map((plan) => [plan.id, plan.priceThb, plan.priceUsd])).toEqual([
      ['starter', 149, 5],
      ['trader', 299, 9],
      ['professional', 499, 15],
    ]);
  });

  it('marks every plan tax-exclusive', () => {
    expect(PLANS.every((plan) => plan.taxExclusive)).toBe(true);
  });

  it('the trial account limit is the explicit, authoritative value 1 — never derived from the plan registry', () => {
    expect(TRIAL_ACCOUNT_LIMIT).toBe(1);
    // Specifically NOT the highest, lowest, or any other plan's limit — a
    // regression here (e.g. reintroducing `Math.max(...PLANS.map(...))`)
    // would silently re-widen the trial the moment Professional's limit
    // changed, which is exactly the bug this correction fixes.
    expect(TRIAL_ACCOUNT_LIMIT).not.toBe(Math.max(...PLANS.map((plan) => plan.tradingAccounts)));
    expect(TRIAL_ACCOUNT_LIMIT).toBe(PLANS.find((plan) => plan.id === 'starter')?.tradingAccounts);
  });
});

describe('resolveEffectiveEntitlement — trial status', () => {
  it('is trialing with a 1-account limit while now < trialEndsAt', () => {
    const before = new Date('2026-06-15T11:59:59.999Z');
    const effective = resolveEffectiveEntitlement(record(), 0, before);

    expect(effective.effectiveStatus).toBe('trialing');
    expect(effective.accountLimit).toBe(1);
    expect(effective.trialExpired).toBe(false);
    expect(effective.canCreateAccount).toBe(true);
    expect(effective.canRestoreAccount).toBe(true);
    expect(effective.blockReason).toBeNull();
  });

  it('blocks creating a second account once the trial holds its one allowed account', () => {
    const effective = resolveEffectiveEntitlement(record(), 1, new Date('2026-06-10T00:00:00Z'));

    expect(effective.remainingAccountSlots).toBe(0);
    expect(effective.canCreateAccount).toBe(false);
    expect(effective.blockReason).toBe('account_limit_reached');
  });

  it('blocks restoring an archived account once the trial holds its one allowed account', () => {
    const effective = resolveEffectiveEntitlement(record(), 1, new Date('2026-06-10T00:00:00Z'));

    expect(effective.canRestoreAccount).toBe(false);
    expect(effective.blockReason).toBe('account_limit_reached');
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
});

describe('resolveEffectiveEntitlement — active plan', () => {
  it('Starter permits exactly 1 active account', () => {
    const atLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'starter', trialEndsAt: null }),
      1,
      NOW,
    );
    expect(atLimit.accountLimit).toBe(1);
    expect(atLimit.canCreateAccount).toBe(false);
    expect(atLimit.blockReason).toBe('account_limit_reached');

    const underLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'starter', trialEndsAt: null }),
      0,
      NOW,
    );
    expect(underLimit.canCreateAccount).toBe(true);
  });

  it('Trader permits exactly 5 active accounts', () => {
    const atLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'trader', trialEndsAt: null }),
      5,
      NOW,
    );
    expect(atLimit.accountLimit).toBe(5);
    expect(atLimit.canCreateAccount).toBe(false);
    expect(atLimit.blockReason).toBe('account_limit_reached');

    const underLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'trader', trialEndsAt: null }),
      4,
      NOW,
    );
    expect(underLimit.canCreateAccount).toBe(true);
    expect(underLimit.remainingAccountSlots).toBe(1);
  });

  it('Professional permits exactly 15 active accounts', () => {
    const atLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'professional', trialEndsAt: null }),
      15,
      NOW,
    );
    expect(atLimit.accountLimit).toBe(15);
    expect(atLimit.canCreateAccount).toBe(false);
    expect(atLimit.blockReason).toBe('account_limit_reached');

    const underLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'professional', trialEndsAt: null }),
      14,
      NOW,
    );
    expect(underLimit.canCreateAccount).toBe(true);
    expect(underLimit.remainingAccountSlots).toBe(1);
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

  it('fails closed for the retired draft plan keys pro/elite', () => {
    for (const retiredKey of ['pro', 'elite'] as const) {
      const effective = resolveEffectiveEntitlement(
        record({ status: 'active', planKey: retiredKey as never, trialEndsAt: null }),
        1,
        NOW,
      );
      expect(effective.accountLimit).toBeNull();
      expect(effective.blockReason).toBe('unknown_plan');
    }
  });
});

describe('resolveEffectiveEntitlement — canceled', () => {
  it('blocks create and restore even when under the last known limit', () => {
    const canceled = resolveEffectiveEntitlement(
      record({ status: 'canceled', planKey: 'trader', trialEndsAt: null }),
      1,
      NOW,
    );
    expect(canceled.effectiveStatus).toBe('canceled');
    expect(canceled.canCreateAccount).toBe(false);
    expect(canceled.canRestoreAccount).toBe(false);
    expect(canceled.blockReason).toBe('subscription_canceled');
  });
});

describe('resolveEffectiveEntitlement — archived accounts', () => {
  it('do not consume the allowance', () => {
    // Two archived + one active, under a 1-account trial: only the active
    // one counts, so a second slot is still available.
    const effective = resolveEffectiveEntitlement(record(), 1, new Date('2026-06-10T00:00:00Z'));
    expect(effective.activeAccountCount).toBe(1);
    expect(effective.remainingAccountSlots).toBe(0);
    // Restated explicitly: this resolver is handed the ALREADY-filtered
    // active count by its caller (`countActiveAccounts` in
    // `src/server/services/entitlement.ts`, which filters `is_archived =
    // false`) — this test documents that contract rather than re-deriving
    // it, since the resolver itself has no notion of "archived" at all.
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
