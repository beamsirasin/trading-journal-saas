import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { PRICE_BOOK } from '@/lib/billing';
import { createFixedClock } from '@/lib/time';
import {
  billingTransactions,
  platformVatConfiguration,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { MockPaymentProvider } from '@/server/payments/mock-payment-provider';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';
import { startCheckout, type CheckoutError } from './checkout';

/**
 * Phase 11F — proves checkout resolves VAT from the REAL `platform_vat_
 * configuration` table (never an injected `dependencies.vatConfiguration`).
 * Deliberately a SEPARATE file from `checkout.integration.test.ts`, not a
 * second `describe` block inside it: the two files' combined query volume
 * on ONE long-lived connection (`fileParallelism: false` keeps files
 * sequential, but each file gets its own fresh `getTestDb()` connection
 * under Vitest's default per-file module isolation) was observed to
 * occasionally exceed a duration/load threshold the shared Neon pooled
 * endpoint enforces, producing a non-recoverable `CONNECTION_ENDED` — never
 * reproducible when this file's own tests run alone. Splitting the file
 * removes the risk without masking anything with a retry.
 *
 * Uses a time window far in the future relative to any other integration
 * test file's fixed dates, so inserting real Admin-authored VAT rows here
 * cannot change what any OTHER file's tests resolve. `afterAll` restores
 * the true baseline far beyond this file's own window so no other
 * integration test file sees a non-baseline "current" VAT configuration
 * (the same restore-after-mutation discipline `vat-configuration-support.
 * integration.test.ts` establishes).
 */
const WINDOW_BASE = new Date('2027-12-23T00:00:00Z');

describe('checkout resolves the real DB VAT configuration (Phase 11F)', () => {
  const db = getTestDb();
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function createWorkspace(): Promise<{ workspaceId: string; userId: string }> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'VAT checkout fixture user',
        email: `vat-checkout-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to create checkout user');
    userIds.push(user.id);
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'VAT checkout fixture workspace',
        slug: `vat-checkout-${crypto.randomUUID()}`,
        personalOwnerUserId: user.id,
        onboardingCompletedAt: WINDOW_BASE,
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to create checkout workspace');
    workspaceIds.push(workspace.id);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
    await db.insert(userPreferences).values({ userId: user.id, activeWorkspaceId: workspace.id });
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: 'trialing',
      trialStartedAt: WINDOW_BASE,
      trialEndsAt: new Date(WINDOW_BASE.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    return { workspaceId: workspace.id, userId: user.id };
  }

  /** A complimentary-sourced workspace — no commercial period/currency (Phase 11E), so checkout must reach it via the `source === 'complimentary'` activation path, never a paid-shaped one. */
  async function createComplimentaryWorkspace(): Promise<{ workspaceId: string; userId: string }> {
    const created = await createWorkspace();
    await db
      .update(workspaceEntitlements)
      .set({
        status: 'active',
        source: 'complimentary',
        planKey: 'starter',
        currentPeriodStartedAt: null,
        currentPeriodEndsAt: null,
        billingCurrency: null,
        billingInterval: null,
      })
      .where(eq(workspaceEntitlements.workspaceId, created.workspaceId));
    return created;
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

  function successProvider(periodEnd: Date): MockPaymentProvider {
    return new MockPaymentProvider({
      outcome: 'immediate_success',
      periodStart: WINDOW_BASE,
      periodEnd,
    });
  }

  afterEach(async () => {
    // `billing_transactions.workspace_id` is `ON DELETE RESTRICT` — must be
    // cleared before the owning workspace/user.
    for (const workspaceId of workspaceIds.splice(0)) {
      await db.delete(billingTransactions).where(eq(billingTransactions.workspaceId, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    // Far beyond every instant this file itself uses, so it is
    // unconditionally the new "current" configuration once this file
    // finishes, for any OTHER integration test file that runs afterward.
    await db.insert(platformVatConfiguration).values({
      enabled: false,
      rateBasisPoints: 700,
      effectiveAt: new Date(WINDOW_BASE.getTime() + 999 * 24 * 60 * 60 * 1000),
      reasonCode: 'configuration_change',
    });
    await closeDb();
    await closeTestDb();
  });

  it('resolves exact exclusive VAT in THB and USD from the real DB configuration when enabled at 7%', async () => {
    const enabledAt = new Date(WINDOW_BASE.getTime() + 1 * 24 * 60 * 60 * 1000);
    await db.insert(platformVatConfiguration).values({
      enabled: true,
      rateBasisPoints: 700,
      effectiveAt: enabledAt,
      reasonCode: 'configuration_change',
    });
    const clock = createFixedClock(new Date(enabledAt.getTime() + 1000));

    for (const currency of ['THB', 'USD'] as const) {
      const { workspaceId, userId } = await createWorkspace();
      const result = await startCheckout(checkoutInput(workspaceId, userId, { currency }), {
        provider: successProvider(new Date(enabledAt.getTime() + 40 * 24 * 60 * 60 * 1000)),
        clock,
      });
      const subtotal = PRICE_BOOK.starter.monthly[currency];
      const expectedVat = (subtotal * 700n + 5_000n) / 10_000n;

      expect(result.vatEnabled).toBe(true);
      expect(result.appliedVatRateBasisPoints).toBe(700);
      expect(result.subtotalMinor).toBe(subtotal);
      expect(result.vatAmountMinor).toBe(expectedVat);
      expect(result.totalMinor).toBe(subtotal + expectedVat);
    }
  });

  it('resolves VAT disabled (total == subtotal) from the real DB configuration in THB and USD', async () => {
    const disabledAt = new Date(WINDOW_BASE.getTime() + 2 * 24 * 60 * 60 * 1000);
    await db.insert(platformVatConfiguration).values({
      enabled: false,
      rateBasisPoints: 700,
      effectiveAt: disabledAt,
      reasonCode: 'configuration_change',
    });
    const clock = createFixedClock(new Date(disabledAt.getTime() + 1000));

    for (const currency of ['THB', 'USD'] as const) {
      const { workspaceId, userId } = await createWorkspace();
      const result = await startCheckout(checkoutInput(workspaceId, userId, { currency }), {
        provider: successProvider(new Date(disabledAt.getTime() + 40 * 24 * 60 * 60 * 1000)),
        clock,
      });
      const subtotal = PRICE_BOOK.starter.monthly[currency];

      expect(result.vatEnabled).toBe(false);
      expect(result.vatAmountMinor).toBe(0n);
      expect(result.totalMinor).toBe(subtotal);
    }
  });

  it('a VAT rate change between two checkouts: the newer checkout uses the new rate; the earlier Billing transaction stays byte-identical', async () => {
    const firstAt = new Date(WINDOW_BASE.getTime() + 10 * 24 * 60 * 60 * 1000);
    const secondAt = new Date(WINDOW_BASE.getTime() + 20 * 24 * 60 * 60 * 1000);

    await db.insert(platformVatConfiguration).values({
      enabled: true,
      rateBasisPoints: 500,
      effectiveAt: firstAt,
      reasonCode: 'configuration_change',
    });
    const first = await createWorkspace();
    const resultA = await startCheckout(checkoutInput(first.workspaceId, first.userId), {
      provider: successProvider(new Date(firstAt.getTime() + 40 * 24 * 60 * 60 * 1000)),
      clock: createFixedClock(new Date(firstAt.getTime() + 1000)),
    });
    expect(resultA.appliedVatRateBasisPoints).toBe(500);
    const snapshotA = await db
      .select()
      .from(billingTransactions)
      .where(eq(billingTransactions.id, resultA.billingTransactionId));

    await db.insert(platformVatConfiguration).values({
      enabled: true,
      rateBasisPoints: 900,
      effectiveAt: secondAt,
      reasonCode: 'configuration_change',
    });
    const second = await createWorkspace();
    const resultB = await startCheckout(checkoutInput(second.workspaceId, second.userId), {
      provider: successProvider(new Date(secondAt.getTime() + 40 * 24 * 60 * 60 * 1000)),
      clock: createFixedClock(new Date(secondAt.getTime() + 1000)),
    });
    expect(resultB.appliedVatRateBasisPoints).toBe(900);

    // No retroactive recalculation: transaction A's stored row is exactly
    // what it was before the second Admin change, byte/value-identical.
    const snapshotAAfter = await db
      .select()
      .from(billingTransactions)
      .where(eq(billingTransactions.id, resultA.billingTransactionId));
    expect(snapshotAAfter).toEqual(snapshotA);
  });

  it('the real production checkout path fails closed (never silently VAT-disabled) when no configuration is effective yet', async () => {
    // A probe instant far in the past — before even the migration-seeded
    // baseline (which this repository's `reset-test-database.mjs` seeds at
    // a fixed historical date, and the real migration seeds at its own
    // apply time) — has no effective row at all.
    const { workspaceId, userId } = await createWorkspace();
    await expect(
      startCheckout(checkoutInput(workspaceId, userId), {
        // Never reached: VAT resolution fails before the provider is used.
        provider: successProvider(new Date('1990-02-01T00:00:00Z')),
        clock: createFixedClock(new Date('1990-01-01T00:00:00Z')),
      }),
    ).rejects.toMatchObject({ code: 'configuration_unavailable' } satisfies Partial<CheckoutError>);
  });

  it('a complimentary workspace converting to real paid uses the current effective VAT configuration, with truthful paid fields', async () => {
    const convertAt = new Date(WINDOW_BASE.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(platformVatConfiguration).values({
      enabled: true,
      rateBasisPoints: 700,
      effectiveAt: convertAt,
      reasonCode: 'configuration_change',
    });

    const { workspaceId, userId } = await createComplimentaryWorkspace();
    const result = await startCheckout(checkoutInput(workspaceId, userId, { planKey: 'trader' }), {
      provider: successProvider(new Date(convertAt.getTime() + 40 * 24 * 60 * 60 * 1000)),
      clock: createFixedClock(new Date(convertAt.getTime() + 1000)),
    });

    expect(result.status).toBe('succeeded');
    expect(result.vatEnabled).toBe(true);
    expect(result.appliedVatRateBasisPoints).toBe(700);
    const subtotal = PRICE_BOOK.trader.monthly.USD;
    const expectedVat = (subtotal * 700n + 5_000n) / 10_000n;
    expect(result.vatAmountMinor).toBe(expectedVat);

    // Truthful paid conversion (Phase 11E's own locked contract): source
    // becomes paid, with real commercial fields, none inherited from the
    // complimentary row (which had none to inherit).
    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(row).toMatchObject({
      source: 'paid',
      status: 'active',
      planKey: 'trader',
      billingCurrency: 'USD',
      billingInterval: 'monthly',
    });
    expect(row?.currentPeriodStartedAt).not.toBeNull();
    expect(row?.currentPeriodEndsAt).not.toBeNull();
  });
});
