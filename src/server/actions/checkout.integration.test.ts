import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  billingTransactions,
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
import { checkoutAction, reconcileCheckoutAction } from './checkout';

const actionState = vi.hoisted(() => ({
  context: null as null | { workspaceId: string; userId: string },
  unauthenticated: false,
  provider: null as unknown as PaymentProvider,
}));

vi.mock('@/server/auth/dal', () => {
  class UnauthenticatedError extends Error {}
  return {
    UnauthenticatedError,
    getActiveWorkspaceContext: async () => {
      if (actionState.unauthenticated || actionState.context === null) {
        throw new UnauthenticatedError();
      }
      return actionState.context;
    },
  };
});

vi.mock('@/server/payments/configured-payment-provider', () => ({
  getConfiguredPaymentProvider: () => actionState.provider,
}));

type EntitlementInsert = typeof workspaceEntitlements.$inferInsert;
const userIds: string[] = [];
const workspaceIds: string[] = [];

function validPeriod() {
  const now = Date.now();
  return {
    periodStart: new Date(now - 60_000),
    periodEnd: new Date(now + 31 * 24 * 60 * 60 * 1000),
  };
}

function provider(outcome: ConstructorParameters<typeof MockPaymentProvider>[0]['outcome']) {
  return new MockPaymentProvider({ outcome, ...validPeriod(), failureCode: 'safe_mock_decline' });
}

async function createWorkspace(entitlement: Partial<EntitlementInsert> = {}) {
  const db = getTestDb();
  const [user] = await db
    .insert(users)
    .values({
      name: 'Checkout action',
      email: `checkout-action-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user fixture failed');
  userIds.push(user.id);
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Checkout action workspace',
      slug: `checkout-action-${crypto.randomUUID()}`,
      personalOwnerUserId: user.id,
      onboardingCompletedAt: new Date(),
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace fixture failed');
  workspaceIds.push(workspace.id);
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
  await db.insert(userPreferences).values({ userId: user.id, activeWorkspaceId: workspace.id });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'trialing',
    trialStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    trialEndsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
    ...entitlement,
  });
  actionState.context = { workspaceId: workspace.id, userId: user.id };
  return { workspaceId: workspace.id, userId: user.id };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'starter',
    currency: 'USD',
    interval: 'monthly',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

afterEach(async () => {
  actionState.context = null;
  actionState.unauthenticated = false;
  const db = getTestDb();
  for (const workspaceId of workspaceIds.splice(0)) {
    await db.delete(billingTransactions).where(eq(billingTransactions.workspaceId, workspaceId));
  }
  for (const userId of userIds.splice(0)) await db.delete(users).where(eq(users.id, userId));
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
});

describe('checkout server actions (real PostgreSQL)', () => {
  it('activates an authenticated trial and reuses a duplicate browser attempt exactly once', async () => {
    const { workspaceId } = await createWorkspace();
    actionState.provider = provider('immediate_success');
    const input = request();
    const first = await checkoutAction(input);
    const duplicate = await checkoutAction(input);
    expect(first).toMatchObject({
      ok: true,
      status: 'succeeded',
      plan: 'starter',
      total: { amountMinor: '500' },
    });
    expect(duplicate).toMatchObject({ ok: true, status: 'succeeded', reused: true });
    expect(
      await getTestDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(1);
  });

  it('rejects malformed and customer-controlled commercial/provider fields before persistence', async () => {
    const { workspaceId } = await createWorkspace();
    actionState.provider = provider('immediate_success');
    for (const invalid of [
      request({ plan: 'elite' }),
      request({ currency: 'EUR' }),
      request({ interval: 'annual' }),
      request({ idempotencyKey: 'not-a-uuid' }),
      request({ subtotal: '1' }),
      request({ vatAmount: '0', total: '1' }),
      request({ mockOutcome: 'immediate_success' }),
    ]) {
      await expect(checkoutAction(invalid)).resolves.toEqual({ ok: false, code: 'validation' });
    }
    expect(
      await getTestDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });

  it('permits expired activation and a valid paid upgrade but rejects same/lower, currency changes, and past-due checkout', async () => {
    await createWorkspace({ status: 'expired' });
    actionState.provider = provider('immediate_success');
    await expect(checkoutAction(request({ plan: 'trader' }))).resolves.toMatchObject({
      ok: true,
      status: 'succeeded',
    });

    await createWorkspace({
      status: 'active',
      planKey: 'starter',
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      currentPeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    actionState.provider = provider('immediate_success');
    await expect(checkoutAction(request({ plan: 'starter' }))).resolves.toEqual({
      ok: false,
      code: 'not_eligible',
    });
    await expect(checkoutAction(request({ plan: 'trader', currency: 'THB' }))).resolves.toEqual({
      ok: false,
      code: 'not_eligible',
    });
    await expect(checkoutAction(request({ plan: 'trader' }))).resolves.toMatchObject({
      ok: true,
      status: 'succeeded',
      plan: 'trader',
    });

    await createWorkspace({
      status: 'past_due',
      planKey: 'starter',
      trialEndsAt: null,
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      currentPeriodEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    await expect(checkoutAction(request({ plan: 'trader' }))).resolves.toEqual({
      ok: false,
      code: 'not_eligible',
    });
  });

  it('keeps processing provider state server-side and reconciles it idempotently', async () => {
    await createWorkspace();
    actionState.provider = provider('processing_then_success');
    const processing = await checkoutAction(request());
    expect(processing).toMatchObject({ ok: true, status: 'processing' });
    if (!processing.ok) throw new Error('expected processing checkout');
    const reconciled = await reconcileCheckoutAction({
      billingTransactionId: processing.billingTransactionId,
    });
    const repeated = await reconcileCheckoutAction({
      billingTransactionId: processing.billingTransactionId,
    });
    expect(reconciled).toMatchObject({ ok: true, status: 'succeeded' });
    expect(repeated).toMatchObject({ ok: true, status: 'succeeded', reused: true });
  });

  it('denies removed membership, cross-workspace reconciliation, unauthenticated calls, and raw provider failures', async () => {
    const first = await createWorkspace();
    actionState.provider = provider('processing_then_success');
    const processing = await checkoutAction(request());
    if (!processing.ok) throw new Error('expected processing checkout');
    await getTestDb()
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, first.workspaceId),
          eq(workspaceMembers.userId, first.userId),
        ),
      );
    await expect(checkoutAction(request())).resolves.toEqual({ ok: false, code: 'forbidden' });

    await createWorkspace();
    await expect(
      reconcileCheckoutAction({ billingTransactionId: processing.billingTransactionId }),
    ).resolves.toEqual({ ok: false, code: 'forbidden' });

    actionState.unauthenticated = true;
    await expect(checkoutAction(request())).resolves.toEqual({
      ok: false,
      code: 'unauthenticated',
    });
    actionState.unauthenticated = false;
    actionState.provider = {
      kind: 'mock',
      createOrRetrievePayment: async () => {
        throw new Error('SECRET provider response');
      },
      retrievePayment: async () => {
        throw new Error('SECRET provider response');
      },
    };
    await createWorkspace();
    const failure = await checkoutAction(request());
    expect(failure).toEqual({ ok: false, code: 'payment_unavailable' });
    expect(JSON.stringify(failure)).not.toContain('SECRET');
  });
});
