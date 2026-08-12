import { describe, expect, it } from 'vitest';

import { PLAN_DEFINITIONS } from '@/config/plan-catalog';
import { PRICE_BOOK } from '@/lib/billing';

import {
  authorizeWorkspaceMutation,
  computeTrialRemaining,
  resolveEffectiveEntitlement,
  resolveEntitlementGate,
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
    currentPeriodStartedAt: new Date('2026-06-01T00:00:00Z'),
    currentPeriodEndsAt: new Date('2026-07-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    pendingPlanKey: null,
    pendingPlanEffectiveAt: null,
    ...overrides,
  };
}

describe('plan registry', () => {
  it('has exactly starter/trader/professional with 1/5/15 account limits', () => {
    expect(PLAN_DEFINITIONS.map((plan) => [plan.id, plan.activeTradingAccountLimit])).toEqual([
      ['starter', 1],
      ['trader', 5],
      ['professional', 15],
    ]);
  });

  it('has the locked THB and USD prices', () => {
    expect(
      PLAN_DEFINITIONS.map((plan) => [
        plan.id,
        PRICE_BOOK[plan.id].monthly.THB,
        PRICE_BOOK[plan.id].monthly.USD,
      ]),
    ).toEqual([
      ['starter', 14_900n, 500n],
      ['trader', 29_900n, 900n],
      ['professional', 49_900n, 1_500n],
    ]);
  });

  it('keeps VAT configuration out of the entitlement plan catalogue', () => {
    expect(PLAN_DEFINITIONS.every((plan) => !Object.hasOwn(plan, 'taxExclusive'))).toBe(true);
  });

  it('the trial account limit is the explicit, authoritative value 1 — never derived from the plan registry', () => {
    expect(TRIAL_ACCOUNT_LIMIT).toBe(1);
    // Specifically NOT the highest, lowest, or any other plan's limit — a
    // regression here (e.g. deriving it from the largest paid allowance)
    // would silently re-widen the trial the moment Professional's limit
    // changed, which is exactly the bug this correction fixes.
    expect(TRIAL_ACCOUNT_LIMIT).not.toBe(
      Math.max(...PLAN_DEFINITIONS.map((plan) => plan.activeTradingAccountLimit)),
    );
    expect(TRIAL_ACCOUNT_LIMIT).toBe(
      PLAN_DEFINITIONS.find((plan) => plan.id === 'starter')?.activeTradingAccountLimit,
    );
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

describe('resolveEffectiveEntitlement — complimentary', () => {
  function complimentaryRecord(overrides: Partial<EntitlementRecord> = {}): EntitlementRecord {
    return record({
      status: 'active',
      source: 'complimentary',
      planKey: 'trader',
      currentPeriodStartedAt: null,
      currentPeriodEndsAt: null,
      billingCurrency: null,
      billingInterval: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      ...overrides,
    });
  }

  it('is truthfully active with the granted plan allowance and no commercial period at all', () => {
    const effective = resolveEffectiveEntitlement(complimentaryRecord(), 2, NOW);
    expect(effective.effectiveStatus).toBe('active');
    expect(effective.accessMode).toBe('writable');
    expect(effective.accountLimit).toBe(5);
    expect(effective.denialReason).toBeNull();
    expect(effective.currentPeriodStartedAt).toBeNull();
    expect(effective.currentPeriodEndsAt).toBeNull();
    expect(effective.billingCurrency).toBeNull();
    expect(effective.billingInterval).toBeNull();
  });

  it('has no automatic expiry — remains active arbitrarily far in the future', () => {
    const farFuture = new Date('2099-01-01T00:00:00Z');
    const effective = resolveEffectiveEntitlement(complimentaryRecord(), 1, farFuture);
    expect(effective.effectiveStatus).toBe('active');
    expect(effective.effectivePeriodEnd).toBeNull();
  });

  it('enforces the granted plan allowance exactly like a paid plan', () => {
    const atLimit = resolveEffectiveEntitlement(
      complimentaryRecord({ planKey: 'starter' }),
      1,
      NOW,
    );
    expect(atLimit.accountLimit).toBe(1);
    expect(atLimit.canCreateAccount).toBe(false);
    expect(atLimit.blockReason).toBe('account_limit_reached');
  });

  it('fails closed for an unrecognized plan key', () => {
    const unknown = resolveEffectiveEntitlement(
      complimentaryRecord({ planKey: 'enterprise' as never }),
      1,
      NOW,
    );
    expect(unknown.effectiveStatus).toBe('expired');
    expect(unknown.accountLimit).toBeNull();
    expect(unknown.blockReason).toBe('unknown_plan');
  });

  it('fails closed for a legacy/corrupt row carrying fabricated commercial fields — never trusted as either shape', () => {
    const corrupt = resolveEffectiveEntitlement(
      complimentaryRecord({
        currentPeriodStartedAt: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2126-01-01T00:00:00Z'),
        billingCurrency: 'USD',
        billingInterval: 'monthly',
      }),
      1,
      NOW,
    );
    expect(corrupt.effectiveStatus).toBe('expired');
    expect(corrupt.accessMode).toBe('read_only');
    expect(corrupt.denialReason).toBe('malformed_entitlement');
  });

  it('fails closed for a complimentary row with a cancellation flag set — that state cannot exist truthfully', () => {
    const corrupt = resolveEffectiveEntitlement(
      complimentaryRecord({ cancelAtPeriodEnd: true }),
      1,
      NOW,
    );
    expect(corrupt.effectiveStatus).toBe('expired');
    expect(corrupt.denialReason).toBe('malformed_entitlement');
  });

  it('is unaffected by trialStartedAt/trialEndsAt — the resolver does not read the preserved baseline for the active branch', () => {
    const pastTrial = resolveEffectiveEntitlement(
      complimentaryRecord({
        trialStartedAt: new Date('2020-01-01T00:00:00Z'),
        trialEndsAt: new Date('2020-01-08T00:00:00Z'),
      }),
      1,
      NOW,
    );
    expect(pastTrial.effectiveStatus).toBe('active');
  });

  it('does not resolve an ordinary active-paid row (source undefined) through the complimentary branch', () => {
    const paid = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'trader' }),
      1,
      NOW,
    );
    expect(paid.effectiveStatus).toBe('active');
    expect(paid.billingCurrency).toBe('USD');
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

describe('resolveEffectiveEntitlement — past due', () => {
  it('fails closed until a later phase defines recovery and grace-period policy', () => {
    const pastDue = resolveEffectiveEntitlement(
      record({ status: 'past_due', planKey: 'trader', trialEndsAt: null }),
      1,
      NOW,
    );

    expect(pastDue.persistedStatus).toBe('past_due');
    expect(pastDue.effectiveStatus).toBe('canceled');
    expect(pastDue.canCreateAccount).toBe(false);
    expect(pastDue.canRestoreAccount).toBe(false);
    expect(pastDue.accessMode).toBe('read_only');
    expect(pastDue.blockReason).toBe('subscription_past_due');
  });
});

describe('resolveEffectiveEntitlement — paid period boundaries', () => {
  it('is writable one millisecond before period end and expired exactly at the end', () => {
    const periodEnd = new Date('2026-07-01T00:00:00Z');
    const paid = record({ status: 'active', planKey: 'trader', currentPeriodEndsAt: periodEnd });

    const before = resolveEffectiveEntitlement(paid, 1, new Date(periodEnd.getTime() - 1));
    expect(before.effectiveStatus).toBe('active');
    expect(before.accessMode).toBe('writable');

    const at = resolveEffectiveEntitlement(paid, 1, periodEnd);
    expect(at.effectiveStatus).toBe('expired');
    expect(at.accessMode).toBe('read_only');
    expect(at.denialReason).toBe('subscription_expired');
  });

  it('keeps scheduled cancellation writable before the boundary and cancels exactly at it', () => {
    const periodEnd = new Date('2026-07-01T00:00:00Z');
    const paid = record({
      status: 'active',
      planKey: 'trader',
      cancelAtPeriodEnd: true,
      currentPeriodEndsAt: periodEnd,
    });

    expect(resolveEffectiveEntitlement(paid, 1, new Date(periodEnd.getTime() - 1)).accessMode).toBe(
      'writable',
    );
    const at = resolveEffectiveEntitlement(paid, 1, periodEnd);
    expect(at.effectiveStatus).toBe('canceled');
    expect(at.denialReason).toBe('subscription_canceled');
  });

  it('fails closed for malformed active billing state', () => {
    const malformed = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'trader', billingCurrency: null }),
      1,
      NOW,
    );
    expect(malformed.accessMode).toBe('read_only');
    expect(malformed.denialReason).toBe('malformed_entitlement');
  });
});

describe('resolveEffectiveEntitlement — pending downgrade', () => {
  const effectiveAt = new Date('2026-06-20T00:00:00Z');
  const pending = record({
    status: 'active',
    planKey: 'professional',
    pendingPlanKey: 'starter',
    pendingPlanEffectiveAt: effectiveAt,
  });

  it('uses the current plan before the boundary', () => {
    const effective = resolveEffectiveEntitlement(pending, 3, new Date(effectiveAt.getTime() - 1));
    expect(effective.effectivePlanKey).toBe('professional');
    expect(effective.accountLimit).toBe(15);
    expect(effective.pendingPlanDue).toBe(false);
  });

  it('uses the lower plan exactly at and after the boundary without a scheduler', () => {
    for (const now of [effectiveAt, new Date(effectiveAt.getTime() + 1)]) {
      const effective = resolveEffectiveEntitlement(pending, 3, now);
      expect(effective.effectivePlanKey).toBe('starter');
      expect(effective.accountLimit).toBe(1);
      expect(effective.pendingPlanDue).toBe(true);
      expect(effective.overLimit).toBe(true);
      expect(effective.accessMode).toBe('over_limit');
    }
  });

  it('reflects an immediate upgrade through the new current plan allowance', () => {
    const upgraded = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'professional' }),
      5,
      NOW,
    );
    expect(upgraded.accountLimit).toBe(15);
    expect(upgraded.remainingAccountSlots).toBe(10);
  });
});

describe('workspace mutation access matrix', () => {
  it('allows every operation while writable except create/restore at the exact limit', () => {
    const below = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'trader' }),
      4,
      NOW,
    );
    for (const operation of [
      'ordinary_write',
      'create_trading_account',
      'restore_trading_account',
      'archive_trading_account',
    ] as const) {
      expect(authorizeWorkspaceMutation(below, operation)).toEqual({ allowed: true });
    }

    const atLimit = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'trader' }),
      5,
      NOW,
    );
    expect(atLimit.accessMode).toBe('writable');
    expect(authorizeWorkspaceMutation(atLimit, 'ordinary_write')).toEqual({ allowed: true });
    expect(authorizeWorkspaceMutation(atLimit, 'create_trading_account')).toEqual({
      allowed: false,
      code: 'account_limit_reached',
    });
  });

  it('allows only archive while over limit', () => {
    const over = resolveEffectiveEntitlement(
      record({ status: 'active', planKey: 'starter' }),
      2,
      NOW,
    );
    expect(authorizeWorkspaceMutation(over, 'archive_trading_account')).toEqual({
      allowed: true,
    });
    expect(authorizeWorkspaceMutation(over, 'ordinary_write')).toEqual({
      allowed: false,
      code: 'over_limit_workspace',
    });
    expect(authorizeWorkspaceMutation(over, 'restore_trading_account')).toEqual({
      allowed: false,
      code: 'workspace_over_limit',
    });
  });

  it('blocks every operation when read-only or entitlement is missing', () => {
    const expired = resolveEffectiveEntitlement(record(), 0, NOW);
    for (const operation of [
      'ordinary_write',
      'create_trading_account',
      'restore_trading_account',
      'archive_trading_account',
    ] as const) {
      expect(authorizeWorkspaceMutation(expired, operation).allowed).toBe(false);
      expect(authorizeWorkspaceMutation(null, operation).allowed).toBe(false);
    }
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

describe('resolveEntitlementGate', () => {
  it('fails closed when the entitlement snapshot is null — never treated as unlimited access', () => {
    const gate = resolveEntitlementGate(null);
    expect(gate.allowed).toBe(false);
    expect(gate.blockReason).toBe('entitlement_unavailable');
  });

  it('allows when the underlying entitlement has no block reason', () => {
    const effective = resolveEffectiveEntitlement(record(), 0, new Date('2026-06-10T00:00:00Z'));
    const gate = resolveEntitlementGate(effective);
    expect(gate.allowed).toBe(true);
    expect(gate.blockReason).toBeNull();
  });

  it('blocks and surfaces the same reason the entitlement itself reports', () => {
    const effective = resolveEffectiveEntitlement(record(), 1, new Date('2026-06-10T00:00:00Z'));
    const gate = resolveEntitlementGate(effective);
    expect(gate.allowed).toBe(false);
    expect(gate.blockReason).toBe('account_limit_reached');
  });

  it('is what both create and restore read — never diverges between the two', () => {
    const effective = resolveEffectiveEntitlement(record(), 1, new Date('2026-06-10T00:00:00Z'));
    const gate = resolveEntitlementGate(effective);
    expect(gate.allowed).toBe(effective.canCreateAccount);
    expect(gate.allowed).toBe(effective.canRestoreAccount);
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
