import { describe, expect, it, vi } from 'vitest';

import type { EffectiveEntitlement } from '@/lib/entitlements/resolve';

import { buildSubscriptionManagementPresentation } from './subscription-management';

vi.mock('server-only', () => ({}));

function entitlement(overrides: Partial<EffectiveEntitlement> = {}): EffectiveEntitlement {
  return {
    workspaceId: 'workspace-1',
    persistedStatus: 'active',
    effectiveStatus: 'active',
    planKey: 'trader',
    effectivePlanKey: 'trader',
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
    currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
    effectivePeriodEnd: new Date('2026-09-01T00:00:00Z'),
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    cancelAtPeriodEnd: false,
    canceledAt: null,
    pendingPlanKey: null,
    pendingPlanEffectiveAt: null,
    pendingPlanDue: false,
    accountLimit: 5,
    activeAccountCount: 2,
    remainingAccountSlots: 3,
    canCreateAccount: true,
    canRestoreAccount: true,
    trialExpired: false,
    overLimit: false,
    accessMode: 'writable',
    denialReason: null,
    blockReason: null,
    ...overrides,
  };
}

describe('subscription-management presentation', () => {
  it.each([
    ['starter', [], ['trader', 'professional']],
    ['trader', ['starter'], ['professional']],
    ['professional', ['starter', 'trader'], []],
  ] as const)('derives active %s upgrade and downgrade choices', (planKey, downgrade, upgrade) => {
    const limit = planKey === 'starter' ? 1 : planKey === 'trader' ? 5 : 15;
    const model = buildSubscriptionManagementPresentation(
      entitlement({ planKey, effectivePlanKey: planKey, accountLimit: limit }),
      'en',
      'UTC',
      false,
    );
    expect(model.currentPlan?.id).toBe(planKey);
    expect(model.downgradeOptions.map((option) => option.id)).toEqual(downgrade);
    expect(model.upgradeOptions.map((option) => option.id)).toEqual(upgrade);
    expect(model.downgradeOptions.every((option) => option.effectiveAt === '01 Sept 2026')).toBe(
      true,
    );
  });

  it.each(['trialing', 'expired', 'canceled'] as const)(
    'offers activation but no lifecycle controls for %s',
    (status) => {
      const model = buildSubscriptionManagementPresentation(
        entitlement({
          persistedStatus: status,
          effectiveStatus: status,
          planKey: status === 'trialing' ? null : 'starter',
          effectivePlanKey: status === 'trialing' ? null : 'starter',
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          accountLimit: 1,
          accessMode: status === 'trialing' ? 'writable' : 'read_only',
          denialReason: status === 'trialing' ? null : (`subscription_${status}` as never),
        }),
        'en',
        'UTC',
        false,
      );
      expect(model.upgradeOptions.map((option) => option.id)).toEqual([
        'starter',
        'trader',
        'professional',
      ]);
      expect(model.downgradeOptions).toHaveLength(0);
      expect(model.canScheduleCancellation).toBe(false);
    },
  );

  it('blocks past-due and malformed subscriptions without inventing recovery checkout', () => {
    const pastDue = buildSubscriptionManagementPresentation(
      entitlement({
        persistedStatus: 'past_due',
        effectiveStatus: 'canceled',
        accessMode: 'read_only',
        denialReason: 'subscription_past_due',
      }),
      'en',
      'UTC',
      false,
    );
    expect(pastDue.blockReason).toBe('past_due');
    expect(pastDue.upgradeOptions).toHaveLength(0);

    const malformed = buildSubscriptionManagementPresentation(
      entitlement({
        effectiveStatus: 'expired',
        accessMode: 'read_only',
        denialReason: 'malformed_entitlement',
      }),
      'en',
      'UTC',
      false,
    );
    expect(malformed.blockReason).toBe('malformed');
    expect(malformed.upgradeOptions).toHaveLength(0);
  });

  it('previews over-limit downgrade impact and preserves account-selection messaging inputs', () => {
    const model = buildSubscriptionManagementPresentation(
      entitlement({
        planKey: 'professional',
        effectivePlanKey: 'professional',
        accountLimit: 15,
        activeAccountCount: 7,
      }),
      'en',
      'UTC',
      false,
    );
    expect(model.downgradeOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'starter', willBeOverLimit: true }),
        expect.objectContaining({ id: 'trader', willBeOverLimit: true }),
      ]),
    );
  });

  it('shows pending/cancellation state and blocks mutations during checkout', () => {
    const pending = buildSubscriptionManagementPresentation(
      entitlement({
        pendingPlanKey: 'starter',
        pendingPlanEffectiveAt: new Date('2026-09-01T00:00:00Z'),
      }),
      'th',
      'Asia/Bangkok',
      false,
    );
    expect(pending.pendingDowngrade?.plan.id).toBe('starter');
    expect(pending.canCancelPendingDowngrade).toBe(true);
    expect(pending.downgradeOptions).toHaveLength(0);

    const blocked = buildSubscriptionManagementPresentation(entitlement(), 'en', 'UTC', true);
    expect(blocked.blockReason).toBe('checkout_in_progress');
    expect(blocked.upgradeOptions).toHaveLength(0);
    expect(blocked.canScheduleCancellation).toBe(false);
  });
});
