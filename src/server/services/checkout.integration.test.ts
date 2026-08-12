import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { PRICE_BOOK, quoteCheckout } from '@/lib/billing';
import { createFixedClock } from '@/lib/time';
import {
  auditLogs,
  billingTransactions,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { MockPaymentProvider } from '@/server/payments/mock-payment-provider';
import type { PaymentProvider } from '@/server/payments/payment-provider';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';
import { CheckoutError, reconcileCheckout, startCheckout } from './checkout';
import { schedulePlanDowngrade } from './subscription-lifecycle';
import { createTradingAccount } from './trading-account-management';

const NOW = new Date('2026-08-10T00:00:00Z');
const PERIOD_START = new Date('2026-08-09T00:00:00Z');
const PERIOD_END = new Date('2026-09-10T00:00:00Z');
const CLOCK = createFixedClock(NOW);

type EntitlementInsert = typeof workspaceEntitlements.$inferInsert;

describe('trusted checkout service (real PostgreSQL)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(label = 'checkout'): Promise<string> {
    const [user] = await getTestDb()
      .insert(users)
      .values({
        name: label,
        email: `${label}-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to create checkout user');
    userIds.push(user.id);
    return user.id;
  }

  async function createWorkspace(
    entitlement: Partial<EntitlementInsert> = {},
  ): Promise<{ workspaceId: string; userId: string }> {
    const userId = await createUser();
    const [workspace] = await getTestDb()
      .insert(workspaces)
      .values({
        name: 'Checkout workspace',
        slug: `checkout-${crypto.randomUUID()}`,
        personalOwnerUserId: userId,
        onboardingCompletedAt: NOW,
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to create checkout workspace');
    workspaceIds.push(workspace.id);
    await getTestDb().insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    });
    await getTestDb().insert(userPreferences).values({
      userId,
      activeWorkspaceId: workspace.id,
    });
    await getTestDb()
      .insert(workspaceEntitlements)
      .values({
        workspaceId: workspace.id,
        status: 'trialing',
        trialStartedAt: new Date('2026-08-03T00:00:00Z'),
        trialEndsAt: new Date('2026-08-10T00:00:00Z'),
        ...entitlement,
      });
    return { workspaceId: workspace.id, userId };
  }

  function activePaid(planKey: 'starter' | 'trader' | 'professional'): Partial<EntitlementInsert> {
    return {
      status: 'active',
      planKey,
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEndsAt: new Date('2026-08-25T00:00:00Z'),
    };
  }

  function successProvider(periodEnd = PERIOD_END): MockPaymentProvider {
    return new MockPaymentProvider({
      outcome: 'immediate_success',
      periodStart: PERIOD_START,
      periodEnd,
    });
  }

  function checkoutInput(
    workspaceId: string,
    userId: string,
    overrides: Partial<Parameters<typeof startCheckout>[0]> = {},
  ): Parameters<typeof startCheckout>[0] {
    return {
      workspaceId,
      userId,
      planKey: 'starter',
      currency: 'USD',
      billingInterval: 'monthly',
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    };
  }

  function dependencies(provider: PaymentProvider) {
    return { provider, clock: CLOCK } as const;
  }

  async function entitlementRow(workspaceId: string) {
    const [row] = await getTestDb()
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    if (row === undefined) throw new Error('entitlement missing');
    return row;
  }

  afterEach(async () => {
    const db = getTestDb();
    for (const workspaceId of workspaceIds.splice(0)) {
      await db.delete(billingTransactions).where(eq(billingTransactions.workspaceId, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeDb();
    await closeTestDb();
  });

  it('persists all six canonical THB/USD plan snapshots as exact bigint values', async () => {
    for (const planKey of ['starter', 'trader', 'professional'] as const) {
      for (const currency of ['THB', 'USD'] as const) {
        const { workspaceId, userId } = await createWorkspace();
        const provider = new MockPaymentProvider({ outcome: 'immediate_decline' });
        const result = await startCheckout(
          checkoutInput(workspaceId, userId, { planKey, currency }),
          dependencies(provider),
        );
        const [stored] = await getTestDb()
          .select()
          .from(billingTransactions)
          .where(eq(billingTransactions.id, result.billingTransactionId));

        const expected = PRICE_BOOK[planKey].monthly[currency];
        expect(result.status).toBe('failed');
        expect(result.subtotalMinor).toBe(expected);
        expect(typeof stored?.subtotalMinor).toBe('bigint');
        expect(stored).toMatchObject({
          planKey,
          billingCurrency: currency,
          billingInterval: 'monthly',
          subtotalMinor: expected,
          vatEnabled: false,
          appliedVatRateBasisPoints: 0,
          vatAmountMinor: 0n,
          totalMinor: expected,
          taxMode: 'disabled',
          taxJurisdiction: null,
          vatRegistrationNumber: null,
        });
      }
    }
  });

  it('uses trusted exclusive VAT and ignores caller-shaped monetary and tax fields', async () => {
    const { workspaceId, userId } = await createWorkspace();
    const input = {
      ...checkoutInput(workspaceId, userId, { currency: 'THB' }),
      subtotalMinor: 1n,
      vatEnabled: false,
      appliedVatRateBasisPoints: 1,
      vatAmountMinor: 1n,
      totalMinor: 2n,
      billingPeriod: { start: NOW, end: NOW },
      providerStatus: 'succeeded',
    } as Parameters<typeof startCheckout>[0];
    const result = await startCheckout(input, {
      provider: new MockPaymentProvider({ outcome: 'immediate_decline' }),
      clock: CLOCK,
      vatConfiguration: { enabled: true, rateBasisPoints: 700 },
      taxJurisdiction: 'TH',
      vatRegistrationNumber: 'TEST-VAT-001',
    });

    expect(result).toMatchObject({
      subtotalMinor: 14_900n,
      vatEnabled: true,
      appliedVatRateBasisPoints: 700,
      vatAmountMinor: 1_043n,
      totalMinor: 15_943n,
    });
    const expectedQuote = quoteCheckout({
      planKey: 'starter',
      currency: 'THB',
      billingInterval: 'monthly',
      vatConfiguration: { enabled: true, rateBasisPoints: 700 },
    });
    expect(result.totalMinor).toBe(expectedQuote.totalMinor);
  });

  it('reuses an immutable snapshot without requoting and rejects a conflicting retry', async () => {
    const { workspaceId, userId } = await createWorkspace();
    const idempotencyKey = crypto.randomUUID();
    const provider = new MockPaymentProvider({ outcome: 'immediate_decline' });
    const input = checkoutInput(workspaceId, userId, { idempotencyKey });
    const first = await startCheckout(input, dependencies(provider));
    const retry = await startCheckout(input, {
      provider,
      clock: CLOCK,
      vatConfiguration: { enabled: true, rateBasisPoints: 700 },
      quote: () => {
        throw new Error('an idempotent retry must never recalculate');
      },
    });

    expect(retry).toMatchObject({
      billingTransactionId: first.billingTransactionId,
      subtotalMinor: first.subtotalMinor,
      vatAmountMinor: first.vatAmountMinor,
      totalMinor: first.totalMinor,
      reused: true,
    });
    expect(provider.paymentCount).toBe(1);
    const rows = await getTestDb()
      .select()
      .from(billingTransactions)
      .where(eq(billingTransactions.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);

    await expect(
      startCheckout(
        checkoutInput(workspaceId, userId, { idempotencyKey, planKey: 'trader' }),
        dependencies(provider),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' } satisfies Partial<CheckoutError>);
  });

  it('rejects unsupported catalogue values before creating a snapshot', async () => {
    const { workspaceId, userId } = await createWorkspace();
    const provider = successProvider();
    for (const input of [
      checkoutInput(workspaceId, userId, { planKey: 'enterprise' as never }),
      checkoutInput(workspaceId, userId, { currency: 'EUR' as never }),
      checkoutInput(workspaceId, userId, { billingInterval: 'annual' as never }),
    ]) {
      await expect(startCheckout(input, dependencies(provider))).rejects.toBeInstanceOf(
        CheckoutError,
      );
    }
    expect(provider.paymentCount).toBe(0);
    expect(
      await getTestDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });

  it('activates trial, expired, canceled, and complimentary workspaces and preserves trial history exactly once', async () => {
    const cases = [
      { entitlement: {}, planKey: 'starter' as const },
      { entitlement: {}, planKey: 'trader' as const },
      { entitlement: { status: 'expired' }, planKey: 'professional' as const },
      { entitlement: { ...activePaid('starter'), status: 'canceled' }, planKey: 'trader' as const },
      {
        // Complimentary access has no commercial period at all — this is the
        // canonical real-paid activation path, reachable from the customer's
        // own checkout, that is the ONLY way a complimentary workspace's
        // `source` becomes `'paid'`.
        entitlement: {
          status: 'active',
          source: 'complimentary',
          planKey: 'starter',
          billingCurrency: null,
          billingInterval: null,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
        },
        planKey: 'professional' as const,
      },
    ];

    for (const testCase of cases) {
      const { workspaceId, userId } = await createWorkspace(testCase.entitlement);
      const before = await entitlementRow(workspaceId);
      const idempotencyKey = crypto.randomUUID();
      const input = checkoutInput(workspaceId, userId, {
        planKey: testCase.planKey,
        idempotencyKey,
      });
      const provider = successProvider();
      const result = await startCheckout(input, dependencies(provider));
      const retry = await startCheckout(input, dependencies(provider));
      const after = await entitlementRow(workspaceId);

      expect(result.status).toBe('succeeded');
      expect(retry.reused).toBe(true);
      expect(after).toMatchObject({
        status: 'active',
        source: 'paid',
        planKey: testCase.planKey,
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: PERIOD_START,
        currentPeriodEndsAt: PERIOD_END,
      });
      expect(after.trialStartedAt).toEqual(before.trialStartedAt);
      expect(after.trialEndsAt).toEqual(before.trialEndsAt);
      const audits = await getTestDb()
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.workspaceId, workspaceId));
      expect(audits.filter(({ action }) => action === 'subscription.activated')).toHaveLength(1);
      expect(audits.filter(({ action }) => action === 'billing.checkout_succeeded')).toHaveLength(
        1,
      );
    }
  });

  it('applies every strictly larger upgrade immediately and never shortens access', async () => {
    for (const [from, to] of [
      ['starter', 'trader'],
      ['starter', 'professional'],
      ['trader', 'professional'],
    ] as const) {
      const { workspaceId, userId } = await createWorkspace(activePaid(from));
      const result = await startCheckout(
        checkoutInput(workspaceId, userId, { planKey: to }),
        dependencies(successProvider()),
      );
      const after = await entitlementRow(workspaceId);
      expect(result.status).toBe('succeeded');
      expect(after.planKey).toBe(to);
      expect(after.currentPeriodEndsAt).toEqual(PERIOD_END);
    }

    const { workspaceId, userId } = await createWorkspace(activePaid('trader'));
    for (const request of [
      checkoutInput(workspaceId, userId, { planKey: 'trader' }),
      checkoutInput(workspaceId, userId, { planKey: 'starter' }),
      checkoutInput(workspaceId, userId, { planKey: 'professional', currency: 'THB' }),
    ]) {
      await expect(startCheckout(request, dependencies(successProvider()))).rejects.toMatchObject({
        code: 'checkout_not_allowed',
      } satisfies Partial<CheckoutError>);
    }
    const rows = await getTestDb()
      .select()
      .from(billingTransactions)
      .where(eq(billingTransactions.workspaceId, workspaceId));
    expect(rows).toHaveLength(0);

    await expect(
      startCheckout(
        checkoutInput(workspaceId, userId, { planKey: 'professional' }),
        dependencies(successProvider(new Date('2026-08-20T00:00:00Z'))),
      ),
    ).rejects.toMatchObject({ code: 'invalid_billing_period' } satisfies Partial<CheckoutError>);
    expect((await entitlementRow(workspaceId)).planKey).toBe('trader');
  });

  it('persists decline, cancellation, and processing without changing entitlement', async () => {
    for (const outcome of ['immediate_decline', 'canceled', 'processing_then_failure'] as const) {
      const { workspaceId, userId } = await createWorkspace();
      const before = await entitlementRow(workspaceId);
      const provider = new MockPaymentProvider({ outcome, failureCode: 'safe_decline' });
      const result = await startCheckout(
        checkoutInput(workspaceId, userId),
        dependencies(provider),
      );
      expect(result.status).toBe(
        outcome === 'immediate_decline'
          ? 'failed'
          : outcome === 'canceled'
            ? 'canceled'
            : 'processing',
      );
      if (outcome === 'processing_then_failure') {
        const reconciled = await reconcileCheckout(
          {
            workspaceId,
            userId,
            billingTransactionId: result.billingTransactionId,
          },
          dependencies(provider),
        );
        expect(reconciled).toMatchObject({ status: 'failed', failureCode: 'safe_decline' });
      }
      const after = await entitlementRow(workspaceId);
      expect(after.status).toBe(before.status);
      expect(after.planKey).toBe(before.planKey);
    }
  });

  it('reconciles processing to success once and keeps repeated reconciliation idempotent', async () => {
    const { workspaceId, userId } = await createWorkspace();
    const provider = new MockPaymentProvider({
      outcome: 'processing_then_success',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    const processing = await startCheckout(
      checkoutInput(workspaceId, userId),
      dependencies(provider),
    );
    expect(processing.status).toBe('processing');

    const input = { workspaceId, userId, billingTransactionId: processing.billingTransactionId };
    const first = await reconcileCheckout(input, dependencies(provider));
    const retry = await reconcileCheckout(input, dependencies(provider));
    expect(first.status).toBe('succeeded');
    expect(retry).toMatchObject({ status: 'succeeded', reused: true });
    const audits = await getTestDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, workspaceId));
    expect(audits.filter(({ action }) => action === 'subscription.activated')).toHaveLength(1);
    expect(audits.filter(({ action }) => action === 'billing.checkout_succeeded')).toHaveLength(1);
    expect((await entitlementRow(workspaceId)).status).toBe('active');
  });

  it('rejects malformed successful provider periods and leaves entitlement unchanged', async () => {
    for (const configuration of [
      { outcome: 'immediate_success' as const },
      {
        outcome: 'immediate_success' as const,
        periodStart: PERIOD_END,
        periodEnd: PERIOD_START,
      },
    ]) {
      const { workspaceId, userId } = await createWorkspace();
      await expect(
        startCheckout(
          checkoutInput(workspaceId, userId),
          dependencies(new MockPaymentProvider(configuration)),
        ),
      ).rejects.toMatchObject({
        code: 'invalid_billing_period',
      } satisfies Partial<CheckoutError>);
      expect((await entitlementRow(workspaceId)).status).toBe('trialing');
    }
  });

  it('serializes same-key and different-key checkout races per workspace', async () => {
    const same = await createWorkspace();
    const sameKey = crypto.randomUUID();
    const provider = new MockPaymentProvider({ outcome: 'processing_then_failure' });
    const sameResults = await Promise.all([
      startCheckout(
        checkoutInput(same.workspaceId, same.userId, { idempotencyKey: sameKey }),
        dependencies(provider),
      ),
      startCheckout(
        checkoutInput(same.workspaceId, same.userId, { idempotencyKey: sameKey }),
        dependencies(provider),
      ),
    ]);
    expect(new Set(sameResults.map(({ billingTransactionId }) => billingTransactionId)).size).toBe(
      1,
    );
    expect(provider.paymentCount).toBe(1);

    const different = await createWorkspace();
    const results = await Promise.allSettled([
      startCheckout(
        checkoutInput(different.workspaceId, different.userId),
        dependencies(new MockPaymentProvider({ outcome: 'processing_then_failure' })),
      ),
      startCheckout(
        checkoutInput(different.workspaceId, different.userId),
        dependencies(new MockPaymentProvider({ outcome: 'processing_then_failure' })),
      ),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ code: 'checkout_already_in_progress' }),
    });
  });

  it('serializes concurrent finalization and applies lifecycle success once', async () => {
    const { workspaceId, userId } = await createWorkspace();
    const provider = new MockPaymentProvider({
      outcome: 'processing_then_success',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    const processing = await startCheckout(
      checkoutInput(workspaceId, userId),
      dependencies(provider),
    );
    const reconcileInput = {
      workspaceId,
      userId,
      billingTransactionId: processing.billingTransactionId,
    };
    const results = await Promise.all([
      reconcileCheckout(reconcileInput, dependencies(provider)),
      reconcileCheckout(reconcileInput, dependencies(provider)),
    ]);
    expect(results.every(({ status }) => status === 'succeeded')).toBe(true);
    const audits = await getTestDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, workspaceId));
    expect(audits.filter(({ action }) => action === 'subscription.activated')).toHaveLength(1);
  });

  it('keeps cross-workspace keys independent and rejects tenant or removed-member access', async () => {
    const first = await createWorkspace();
    const second = await createWorkspace();
    const sharedKey = crypto.randomUUID();
    const firstProvider = new MockPaymentProvider({ outcome: 'processing_then_failure' });
    const secondProvider = new MockPaymentProvider({ outcome: 'processing_then_failure' });
    const [firstCheckout, secondCheckout] = await Promise.all([
      startCheckout(
        checkoutInput(first.workspaceId, first.userId, { idempotencyKey: sharedKey }),
        dependencies(firstProvider),
      ),
      startCheckout(
        checkoutInput(second.workspaceId, second.userId, { idempotencyKey: sharedKey }),
        dependencies(secondProvider),
      ),
    ]);
    expect(firstCheckout.billingTransactionId).not.toBe(secondCheckout.billingTransactionId);

    await expect(
      reconcileCheckout(
        {
          workspaceId: second.workspaceId,
          userId: second.userId,
          billingTransactionId: firstCheckout.billingTransactionId,
        },
        dependencies(firstProvider),
      ),
    ).rejects.toMatchObject({ code: 'transaction_not_found' } satisfies Partial<CheckoutError>);

    await getTestDb()
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, first.workspaceId),
          eq(workspaceMembers.userId, first.userId),
        ),
      );
    await expect(
      startCheckout(
        checkoutInput(first.workspaceId, first.userId, { idempotencyKey: crypto.randomUUID() }),
        dependencies(firstProvider),
      ),
    ).rejects.toMatchObject({
      code: 'cross_workspace_access_denied',
    } satisfies Partial<CheckoutError>);
    await expect(
      startCheckout(
        checkoutInput(second.workspaceId, '', { idempotencyKey: crypto.randomUUID() }),
        dependencies(secondProvider),
      ),
    ).rejects.toMatchObject({
      code: 'cross_workspace_access_denied',
    } satisfies Partial<CheckoutError>);
  });

  it('rejects past_due and permits an over-limit active workspace only to upgrade', async () => {
    const pastDue = await createWorkspace({ ...activePaid('starter'), status: 'past_due' });
    await expect(
      startCheckout(
        checkoutInput(pastDue.workspaceId, pastDue.userId, { planKey: 'trader' }),
        dependencies(successProvider()),
      ),
    ).rejects.toMatchObject({ code: 'checkout_not_allowed' } satisfies Partial<CheckoutError>);

    const malformed = await createWorkspace({ status: 'active', planKey: null });
    await expect(
      startCheckout(
        checkoutInput(malformed.workspaceId, malformed.userId, { planKey: 'trader' }),
        dependencies(successProvider()),
      ),
    ).rejects.toMatchObject({ code: 'checkout_not_allowed' } satisfies Partial<CheckoutError>);

    const overLimit = await createWorkspace(activePaid('starter'));
    await getTestDb()
      .insert(tradingAccounts)
      .values([
        {
          workspaceId: overLimit.workspaceId,
          name: 'One',
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '1000',
          timezone: 'UTC',
        },
        {
          workspaceId: overLimit.workspaceId,
          name: 'Two',
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '1000',
          timezone: 'UTC',
        },
      ]);
    await expect(
      startCheckout(
        checkoutInput(overLimit.workspaceId, overLimit.userId, { planKey: 'starter' }),
        dependencies(successProvider()),
      ),
    ).rejects.toMatchObject({ code: 'checkout_not_allowed' } satisfies Partial<CheckoutError>);
    await expect(
      startCheckout(
        checkoutInput(overLimit.workspaceId, overLimit.userId, { planKey: 'trader' }),
        dependencies(successProvider()),
      ),
    ).resolves.toMatchObject({ status: 'succeeded', planKey: 'trader' });
  });

  it('uses the shared lock order when checkout races with downgrade and account creation', async () => {
    const downgradeRace = await createWorkspace(activePaid('trader'));
    const checkout = startCheckout(
      checkoutInput(downgradeRace.workspaceId, downgradeRace.userId, {
        planKey: 'professional',
      }),
      dependencies(successProvider()),
    );
    const downgrade = schedulePlanDowngrade(
      {
        workspaceId: downgradeRace.workspaceId,
        actorUserId: downgradeRace.userId,
        targetPlanKey: 'starter',
      },
      CLOCK,
    );
    const [checkoutResult, downgradeResult] = await Promise.allSettled([checkout, downgrade]);
    expect(checkoutResult.status).toBe('fulfilled');
    expect(downgradeResult.status).toBe('fulfilled');
    expect((await entitlementRow(downgradeRace.workspaceId)).status).toBe('active');

    const accountRace = await createWorkspace(activePaid('starter'));
    await getTestDb().insert(tradingAccounts).values({
      workspaceId: accountRace.workspaceId,
      name: 'Existing',
      accountMode: 'live',
      baseCurrency: 'USD',
      startingBalance: '1000',
      timezone: 'UTC',
    });
    const raceResults = await Promise.allSettled([
      startCheckout(
        checkoutInput(accountRace.workspaceId, accountRace.userId, { planKey: 'trader' }),
        dependencies(successProvider()),
      ),
      createTradingAccount(
        accountRace.workspaceId,
        accountRace.userId,
        {
          name: 'Concurrent',
          accountMode: 'demo',
          baseCurrency: 'USD',
          startingBalance: '1000',
          timezone: 'UTC',
          mutationKey: crypto.randomUUID(),
          setActive: false,
        },
        CLOCK,
      ),
    ]);
    expect(raceResults.every(({ status }) => status === 'fulfilled')).toBe(true);
    expect((await entitlementRow(accountRace.workspaceId)).planKey).toBe('trader');
  });

  it('stores only decimal-string money in billing audit metadata', async () => {
    const { workspaceId, userId } = await createWorkspace();
    await startCheckout(
      checkoutInput(workspaceId, userId, { currency: 'THB' }),
      dependencies(new MockPaymentProvider({ outcome: 'immediate_decline' })),
    );
    const rows = await getTestDb()
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.workspaceId, workspaceId));
    const created = rows.find(({ action }) => action === 'billing.checkout_created');
    expect(created?.metadata).toMatchObject({
      subtotalMinor: '14900',
      vatAmountMinor: '0',
      totalMinor: '14900',
    });
    expect(() => JSON.stringify(created?.metadata)).not.toThrow();
  });
});
