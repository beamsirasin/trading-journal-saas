import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnvCache } from '@/config/env.server';
import {
  billingTransactions,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { checkoutAction, reconcileCheckoutAction } from '../actions/checkout';
import { getBillingHistoryPresentation } from '../billing/billing-history';
import { closeDb, getDb } from '../db/client';
import {
  customerCancelScheduledCancellation,
  customerScheduleCancellationAtPeriodEnd,
} from '../services/subscription-lifecycle';
import { getConfiguredPaymentProvider } from './configured-payment-provider';

/**
 * Proves the Phase 04H-A production payment guard end to end against real
 * PostgreSQL: `getConfiguredPaymentProvider` is exercised directly
 * (unmocked), unlike `checkout.integration.test.ts`, which mocks it out to
 * test checkout logic in isolation.
 */

const actionState = vi.hoisted(() => ({
  context: null as null | { workspaceId: string; userId: string },
}));

vi.mock('@/server/auth/dal', () => {
  class UnauthenticatedError extends Error {}
  return {
    UnauthenticatedError,
    getActiveWorkspaceContext: async () => {
      if (actionState.context === null) throw new UnauthenticatedError();
      return actionState.context;
    },
  };
});

type EntitlementInsert = typeof workspaceEntitlements.$inferInsert;
const userIds: string[] = [];
const workspaceIds: string[] = [];

const originalNodeEnv = process.env.NODE_ENV;
const originalE2eTestMode = process.env.E2E_TEST_MODE;
const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

function setNodeEnv(value: string | undefined): void {
  const writable = process.env as { NODE_ENV?: string };
  if (value === undefined) delete writable.NODE_ENV;
  else writable.NODE_ENV = value;
}

function setOrDelete(key: 'E2E_TEST_MODE' | 'BETTER_AUTH_URL', value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function applyEnv(overrides: {
  readonly NODE_ENV: string | undefined;
  readonly E2E_TEST_MODE?: string;
  readonly BETTER_AUTH_URL?: string;
}): void {
  setNodeEnv(overrides.NODE_ENV);
  setOrDelete('E2E_TEST_MODE', overrides.E2E_TEST_MODE);
  setOrDelete('BETTER_AUTH_URL', overrides.BETTER_AUTH_URL);
  resetServerEnvCache();
}

function restoreEnv(): void {
  setNodeEnv(originalNodeEnv ?? 'test');
  setOrDelete('E2E_TEST_MODE', originalE2eTestMode);
  setOrDelete('BETTER_AUTH_URL', originalBetterAuthUrl);
  resetServerEnvCache();
}

async function createWorkspace(
  email: string,
  entitlement: Partial<EntitlementInsert> = {},
): Promise<{ workspaceId: string; userId: string }> {
  const db = getTestDb();
  // Idempotent, mirroring `e2e/support/provision-user.ts`: some of the fixed
  // trusted e2e checkout identities (e.g. `e2e-checkout-success-chromium@...`)
  // are also real Playwright fixtures against this same guarded database, so
  // a prior E2E run can leave a permanent row behind. `billing_transactions
  // .workspace_id` is `onDelete: 'restrict'`, so any of its rows must be
  // cleared before the cascade delete below can reach the owned workspace.
  const priorOwnedWorkspaces = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .innerJoin(users, eq(users.id, workspaces.personalOwnerUserId))
    .where(eq(users.email, email));
  for (const { id: priorWorkspaceId } of priorOwnedWorkspaces) {
    await db
      .delete(billingTransactions)
      .where(eq(billingTransactions.workspaceId, priorWorkspaceId));
  }
  await db.delete(users).where(eq(users.email, email));
  const [user] = await db
    .insert(users)
    .values({ name: 'Production guard', email, emailVerified: true })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user fixture failed');
  userIds.push(user.id);
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Production guard workspace',
      slug: `production-guard-${crypto.randomUUID()}`,
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
  return { workspaceId: workspace.id, userId: user.id };
}

function checkoutRequest(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'starter',
    currency: 'USD',
    interval: 'monthly',
    idempotencyKey: crypto.randomUUID(),
    ...overrides,
  };
}

function activePeriod() {
  return {
    currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  };
}

afterEach(async () => {
  actionState.context = null;
  restoreEnv();
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

describe('production payment guard (real PostgreSQL, unmocked provider)', () => {
  it('development: mock checkout is available and unaffected by an unmatched identity', async () => {
    applyEnv({ NODE_ENV: 'development' });
    const { workspaceId, userId } = await createWorkspace(
      `dev-checkout-${crypto.randomUUID()}@example.test`,
    );
    actionState.context = { workspaceId, userId };

    const result = await checkoutAction(checkoutRequest());
    expect(result).toMatchObject({ ok: true, status: 'succeeded' });
    expect(
      await getDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(1);
  });

  it('test: mock checkout is available (Vitest runs are inherently trusted, same as development)', async () => {
    applyEnv({ NODE_ENV: 'test' });
    const { workspaceId, userId } = await createWorkspace(
      `test-checkout-${crypto.randomUUID()}@example.test`,
    );
    actionState.context = { workspaceId, userId };

    const result = await checkoutAction(checkoutRequest());
    expect(result).toMatchObject({ ok: true, status: 'succeeded' });
  });

  it('unknown runtime environments fail closed even with the guarded seam fully armed', async () => {
    for (const unknownNodeEnv of [undefined, '', 'staging', 'preview', 'Production']) {
      applyEnv({
        NODE_ENV: unknownNodeEnv,
        E2E_TEST_MODE: 'true',
        BETTER_AUTH_URL: 'http://127.0.0.1:3100',
      });
      const { workspaceId, userId } = await createWorkspace(
        `unknown-env-${crypto.randomUUID()}@example.test`,
      );
      actionState.context = { workspaceId, userId };

      await expect(checkoutAction(checkoutRequest())).resolves.toEqual({
        ok: false,
        code: 'payment_provider_unavailable',
      });
      expect(
        await getDb()
          .select()
          .from(billingTransactions)
          .where(eq(billingTransactions.workspaceId, workspaceId)),
      ).toHaveLength(0);
    }
  });

  it('production without the guarded test seam: checkout and reconciliation fail closed with no billing row', async () => {
    applyEnv({ NODE_ENV: 'production' });
    const { workspaceId, userId } = await createWorkspace(
      `prod-checkout-${crypto.randomUUID()}@example.test`,
    );
    actionState.context = { workspaceId, userId };

    await expect(checkoutAction(checkoutRequest())).resolves.toEqual({
      ok: false,
      code: 'payment_provider_unavailable',
    });
    await expect(
      reconcileCheckoutAction({ billingTransactionId: crypto.randomUUID() }),
    ).resolves.toEqual({ ok: false, code: 'payment_provider_unavailable' });
    expect(
      await getDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(0);
    const [entitlement] = await getDb()
      .select({ status: workspaceEntitlements.status, planKey: workspaceEntitlements.planKey })
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    expect(entitlement).toMatchObject({ status: 'trialing', planKey: null });
  });

  it('production with E2E_TEST_MODE set but a non-loopback origin: still unavailable (does not fall back to mock)', async () => {
    applyEnv({
      NODE_ENV: 'production',
      E2E_TEST_MODE: 'true',
      BETTER_AUTH_URL: 'https://app.trading-os.example',
    });
    const { workspaceId, userId } = await createWorkspace(
      `prod-nonloop-${crypto.randomUUID()}@example.test`,
    );
    actionState.context = { workspaceId, userId };

    await expect(checkoutAction(checkoutRequest())).resolves.toEqual({
      ok: false,
      code: 'payment_provider_unavailable',
    });
  });

  it('production with the seam armed but an unmatched identity: still unavailable', async () => {
    applyEnv({
      NODE_ENV: 'production',
      E2E_TEST_MODE: 'true',
      BETTER_AUTH_URL: 'http://127.0.0.1:3100',
    });
    const { workspaceId, userId } = await createWorkspace(
      `prod-armed-unmatched-${crypto.randomUUID()}@example.test`,
    );
    actionState.context = { workspaceId, userId };

    await expect(checkoutAction(checkoutRequest())).resolves.toEqual({
      ok: false,
      code: 'payment_provider_unavailable',
    });
    expect(
      await getDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });

  it('production with the seam armed: a self-registered identity resembling the pattern is still unavailable', async () => {
    applyEnv({
      NODE_ENV: 'production',
      E2E_TEST_MODE: 'true',
      BETTER_AUTH_URL: 'http://127.0.0.1:3100',
    });
    // Shaped like the trusted prefix but with a segment no guarded Playwright
    // project ever produces — exactly what a normal signup could register.
    // Before Correction 2 tightened the matcher to a closed project-segment
    // allowlist, this would have been treated as a trusted E2E identity.
    const { workspaceId, userId } = await createWorkspace(
      'e2e-checkout-success-attacker@example.test',
    );
    actionState.context = { workspaceId, userId };

    await expect(checkoutAction(checkoutRequest())).resolves.toEqual({
      ok: false,
      code: 'payment_provider_unavailable',
    });
    expect(
      await getDb()
        .select()
        .from(billingTransactions)
        .where(eq(billingTransactions.workspaceId, workspaceId)),
    ).toHaveLength(0);
  });

  it('production with the seam armed and a matching e2e checkout identity: mock checkout still works', async () => {
    applyEnv({
      NODE_ENV: 'production',
      E2E_TEST_MODE: 'true',
      BETTER_AUTH_URL: 'http://localhost:3100',
    });
    const { workspaceId, userId } = await createWorkspace(
      'e2e-checkout-success-chromium@example.test',
    );
    actionState.context = { workspaceId, userId };

    const result = await checkoutAction(checkoutRequest());
    expect(result).toMatchObject({ ok: true, status: 'succeeded' });
  });

  it('malformed E2E_TEST_MODE in production fails closed rather than being treated as armed', async () => {
    applyEnv({
      NODE_ENV: 'production',
      E2E_TEST_MODE: 'TRUE',
      BETTER_AUTH_URL: 'http://127.0.0.1:3100',
    });
    const { workspaceId, userId } = await createWorkspace(
      'e2e-checkout-success-mobile-chrome@example.test',
    );
    actionState.context = { workspaceId, userId };

    await expect(checkoutAction(checkoutRequest())).resolves.toEqual({
      ok: false,
      code: 'payment_provider_unavailable',
    });
  });

  it('direct getConfiguredPaymentProvider invocation fails closed in production without the seam', async () => {
    applyEnv({ NODE_ENV: 'production' });
    const { userId } = await createWorkspace(`prod-direct-${crypto.randomUUID()}@example.test`);
    await expect(getConfiguredPaymentProvider(userId)).rejects.toMatchObject({
      code: 'payment_provider_unavailable',
    });
  });

  it('plan/billing-history reads and subscription cancellation management stay available when checkout is unavailable', async () => {
    applyEnv({ NODE_ENV: 'production' });
    const { workspaceId, userId } = await createWorkspace(
      `prod-management-${crypto.randomUUID()}@example.test`,
      {
        status: 'active',
        planKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        ...activePeriod(),
      },
    );
    actionState.context = { workspaceId, userId };

    const history = await getBillingHistoryPresentation(1);
    expect(history).toMatchObject({ items: [], totalItems: 0 });

    const scheduled = await customerScheduleCancellationAtPeriodEnd({
      workspaceId,
      actorUserId: userId,
    });
    expect(scheduled).toEqual({ changed: true });
    const reversed = await customerCancelScheduledCancellation({
      workspaceId,
      actorUserId: userId,
    });
    expect(reversed).toEqual({ changed: true });
  });
});
