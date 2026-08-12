import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { resolveEffectiveEntitlement } from '@/lib/entitlements/resolve';
import { createFixedClock } from '@/lib/time';
import {
  adminAuditLog,
  billingTransactions,
  platformAdmins,
  users,
  workspaceEntitlements,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Read-write Admin Subscription Support (Phase 11E), against a real
 * database. Mirrors the exact mocked-session pattern established by
 * `metrics.integration.test.ts` (Phase 11C) and
 * `user-oversight.integration.test.ts` (Phase 11D).
 */
type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => currentSession,
    },
  }),
}));

const {
  extendTrialByAdmin,
  grantComplimentaryPlan,
  revokeComplimentaryPlan,
  AdminSubscriptionMutationError,
} = await import('./subscription-support');
const { PlatformAdminRequiredError } = await import('@/server/auth/admin-dal');

const db = getTestDb();
const NOW = new Date('2026-08-10T12:00:00Z');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Subscription support test admin',
      email: 'subscription-support-test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('Admin Subscription Support mutations (real database)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'Subscription support fixture user',
        email: `subscription-support-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to insert test user');
    userIds.push(user.id);
    return user.id;
  }

  async function createWorkspace(): Promise<string> {
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Subscription support fixture workspace',
        slug: `subscription-support-${crypto.randomUUID()}`,
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to insert test workspace');
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  async function createTrialEntitlement(
    workspaceId: string,
    overrides: Partial<typeof workspaceEntitlements.$inferInsert> = {},
  ): Promise<void> {
    await db.insert(workspaceEntitlements).values({
      workspaceId,
      status: 'trialing',
      source: 'trial',
      trialStartedAt: new Date('2026-08-01T00:00:00Z'),
      trialEndsAt: new Date('2026-08-08T00:00:00Z'),
      ...overrides,
    });
  }

  async function createPaidEntitlement(workspaceId: string): Promise<void> {
    await db.insert(workspaceEntitlements).values({
      workspaceId,
      status: 'active',
      source: 'paid',
      planKey: 'professional',
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
      currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
    });
  }

  /**
   * Once a grant is used as `admin_audit_log.actor_admin_id` (every real
   * mutation in this file does this), `platform_admins_..._fk`'s RESTRICT
   * means that row — and therefore its owning user — can never be deleted
   * again; `admin_audit_log` is append-only forever (no DELETE path exists
   * at all, by design). So an admin user is removed from the deletable
   * `userIds` list the moment it is granted, and is simply left behind in
   * the shared, disposable TEST database — the same accumulation every
   * prior admin-audit-writing test file already produces.
   */
  async function grantAdmin(userId: string): Promise<string> {
    const index = userIds.indexOf(userId);
    if (index !== -1) userIds.splice(index, 1);
    const [row] = await db
      .insert(platformAdmins)
      .values({ userId })
      .returning({ id: platformAdmins.id });
    if (row === undefined) throw new Error('failed to insert admin grant');
    return row.id;
  }

  async function revokeAdmin(adminGrantId: string): Promise<void> {
    await db
      .update(platformAdmins)
      .set({ revokedAt: new Date() })
      .where(eq(platformAdmins.id, adminGrantId));
  }

  async function getEntitlementRow(workspaceId: string) {
    const [row] = await db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    if (row === undefined) throw new Error('entitlement row not found');
    return row;
  }

  async function getAuditRows(workspaceId: string) {
    return db.select().from(adminAuditLog).where(eq(adminAuditLog.subjectWorkspaceId, workspaceId));
  }

  async function countBillingTransactions(workspaceId: string): Promise<number> {
    const rows = await db
      .select({ id: billingTransactions.id })
      .from(billingTransactions)
      .where(eq(billingTransactions.workspaceId, workspaceId));
    return rows.length;
  }

  afterEach(async () => {
    currentSession = null;
    for (const workspaceId of workspaceIds.splice(0)) {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('authorization', () => {
    it('a non-admin caller is denied for all three mutations', async () => {
      const userId = await createUser();
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(userId);

      await expect(
        extendTrialByAdmin(
          {
            workspaceId,
            newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
            reasonCode: 'trial_extension_goodwill',
          },
          createFixedClock(NOW),
        ),
      ).rejects.toBeInstanceOf(PlatformAdminRequiredError);

      await expect(
        grantComplimentaryPlan(
          { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
      ).rejects.toBeInstanceOf(PlatformAdminRequiredError);

      await expect(
        revokeComplimentaryPlan(
          { workspaceId, reasonCode: 'access_revoke' },
          createFixedClock(NOW),
        ),
      ).rejects.toBeInstanceOf(PlatformAdminRequiredError);
    });

    it('a revoked admin is denied by the DB-level check, not a stale cache', async () => {
      const adminUserId = await createUser();
      const adminGrantId = await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await revokeAdmin(adminGrantId);

      await expect(
        extendTrialByAdmin(
          {
            workspaceId,
            newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
            reasonCode: 'trial_extension_goodwill',
          },
          createFixedClock(NOW),
        ),
      ).rejects.toBeInstanceOf(PlatformAdminRequiredError);

      const row = await getEntitlementRow(workspaceId);
      expect(row.trialEndsAt?.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    });

    it('an active admin is allowed', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      const result = await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        createFixedClock(NOW),
      );
      expect(result.changed).toBe(true);
    });

    it('an unknown workspaceId returns not_found, never a raw Postgres error', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      await expect(
        extendTrialByAdmin(
          {
            workspaceId: crypto.randomUUID(),
            newTrialEndsAt: new Date('2026-08-15T00:00:00Z'),
            reasonCode: 'trial_extension_goodwill',
          },
          createFixedClock(NOW),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('extendTrialByAdmin — atomicity and audit', () => {
    it('success: mutates trialEndsAt and writes exactly one audit event, atomically', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      const result = await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
          reasonNote: 'Customer requested more time to evaluate.',
        },
        createFixedClock(NOW),
      );
      expect(result.changed).toBe(true);

      const row = await getEntitlementRow(workspaceId);
      expect(row.trialEndsAt?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
      expect(row.source).toBe('trial');
      expect(row.status).toBe('trialing');

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.action).toBe('subscription.trial_extended');
      expect(auditRows[0]?.reasonCode).toBe('trial_extension_goodwill');
      expect(auditRows[0]?.reasonNote).toBe('Customer requested more time to evaluate.');
      expect(auditRows[0]?.actorAdminId).not.toBeNull();
      expect(auditRows[0]?.beforeState).toMatchObject({ trialEndsAt: '2026-08-08T00:00:00.000Z' });
      expect(auditRows[0]?.afterState).toMatchObject({ trialEndsAt: '2026-08-20T00:00:00.000Z' });
    });

    it('rejects a paid Workspace — the row is untouched and no audit is written', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createPaidEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await expect(
        extendTrialByAdmin(
          {
            workspaceId,
            newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
            reasonCode: 'trial_extension_goodwill',
          },
          createFixedClock(NOW),
        ),
      ).rejects.toMatchObject({ code: 'incompatible_state' });

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows).toHaveLength(0);
    });

    it('a no-op (same absolute end) writes no row change and no second audit event', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      const first = await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        createFixedClock(NOW),
      );
      expect(first.changed).toBe(true);
      const rowAfterFirst = await getEntitlementRow(workspaceId);

      const retry = await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        createFixedClock(NOW),
      );
      expect(retry.changed).toBe(false);

      const rowAfterRetry = await getEntitlementRow(workspaceId);
      expect(rowAfterRetry.updatedAt.getTime()).toBe(rowAfterFirst.updatedAt.getTime());

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows).toHaveLength(1);
    });

    it('billing integrity: extending a trial never creates a billing_transactions row', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        createFixedClock(NOW),
      );

      expect(await countBillingTransactions(workspaceId)).toBe(0);
    });

    it('customer entitlement resolution immediately reflects the extended trial', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      // Trial already expired relative to NOW — proves the extension revives it.
      await createTrialEntitlement(workspaceId, { trialEndsAt: new Date('2026-08-01T00:00:00Z') });
      currentSession = sessionFor(adminUserId);

      await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
          reasonCode: 'support_adjustment',
        },
        createFixedClock(NOW),
      );

      const row = await getEntitlementRow(workspaceId);
      const effective = resolveEffectiveEntitlement(
        {
          workspaceId,
          status: row.status as 'trialing',
          planKey: null,
          trialStartedAt: row.trialStartedAt,
          trialEndsAt: row.trialEndsAt,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          billingCurrency: null,
          billingInterval: null,
          pendingPlanKey: null,
          pendingPlanEffectiveAt: null,
        },
        0,
        NOW,
      );
      expect(effective.effectiveStatus).toBe('trialing');
      expect(effective.accessMode).toBe('writable');
    });
  });

  describe('grantComplimentaryPlan — atomicity, baseline, and boundaries', () => {
    it('grants a fresh complimentary plan from a trial, preserving the original trial baseline', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      const result = await grantComplimentaryPlan(
        { workspaceId, planKey: 'trader', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      expect(result.changed).toBe(true);

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('complimentary');
      expect(row.status).toBe('active');
      expect(row.planKey).toBe('trader');
      // The ORIGINAL trial baseline must survive the grant, unchanged.
      expect(row.trialStartedAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(row.trialEndsAt?.toISOString()).toBe('2026-08-08T00:00:00.000Z');
      expect(row.providerKind).toBeNull();
      expect(row.providerCustomerId).toBeNull();
      expect(row.providerSubscriptionId).toBeNull();
      // No fabricated commercial state: complimentary access is Admin-granted,
      // not paid — there is no period, currency, interval, or cancellation
      // flag to represent, so none is written.
      expect(row.currentPeriodStartedAt).toBeNull();
      expect(row.currentPeriodEndsAt).toBeNull();
      expect(row.billingCurrency).toBeNull();
      expect(row.billingInterval).toBeNull();
      expect(row.cancelAtPeriodEnd).toBe(false);
      expect(row.canceledAt).toBeNull();

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]?.action).toBe('subscription.complimentary_granted');
      expect(auditRows[0]?.afterState).toMatchObject({
        status: 'active',
        planKey: 'trader',
        source: 'complimentary',
        periodStart: null,
        periodEnd: null,
      });
    });

    it('rejects a paid Workspace — the critical boundary — with no mutation and no audit', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createPaidEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await expect(
        grantComplimentaryPlan(
          { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
      ).rejects.toMatchObject({ code: 'incompatible_state' });

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('paid');
      expect(await getAuditRows(workspaceId)).toHaveLength(0);
    });

    it('changing the complimentary plan tier preserves the baseline and writes one audit event', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      const changeResult = await grantComplimentaryPlan(
        { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      expect(changeResult.changed).toBe(true);

      const row = await getEntitlementRow(workspaceId);
      expect(row.planKey).toBe('professional');
      expect(row.trialStartedAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(row.trialEndsAt?.toISOString()).toBe('2026-08-08T00:00:00.000Z');
      // A plan change never introduces commercial fields either.
      expect(row.currentPeriodStartedAt).toBeNull();
      expect(row.currentPeriodEndsAt).toBeNull();
      expect(row.billingCurrency).toBeNull();
      expect(row.billingInterval).toBeNull();

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows).toHaveLength(2);
    });

    it('an identical repeated grant (same plan) is a no-op with no second audit event', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      const retry = await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      expect(retry.changed).toBe(false);
      expect(await getAuditRows(workspaceId)).toHaveLength(1);
    });

    it('fails closed (data_integrity_error) for a legacy complimentary row with no trial baseline', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await db.insert(workspaceEntitlements).values({
        workspaceId,
        status: 'active',
        source: 'complimentary',
        planKey: 'starter',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: NOW,
        currentPeriodEndsAt: new Date('2126-08-10T12:00:00Z'),
        // trialStartedAt/trialEndsAt deliberately omitted — the corrupted case.
      });
      currentSession = sessionFor(adminUserId);

      await expect(
        grantComplimentaryPlan(
          { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
      ).rejects.toMatchObject({ code: 'data_integrity_error' });
    });

    it('billing integrity: a complimentary grant never creates a billing_transactions row', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );

      expect(await countBillingTransactions(workspaceId)).toBe(0);
    });

    it('customer entitlement resolution immediately reflects the granted plan allowance', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );

      const row = await getEntitlementRow(workspaceId);
      const effective = resolveEffectiveEntitlement(
        {
          workspaceId,
          status: row.status as 'active',
          source: row.source as 'complimentary',
          planKey: row.planKey as 'professional',
          trialStartedAt: row.trialStartedAt,
          trialEndsAt: row.trialEndsAt,
          currentPeriodStartedAt: row.currentPeriodStartedAt,
          currentPeriodEndsAt: row.currentPeriodEndsAt,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          canceledAt: row.canceledAt,
          billingCurrency: row.billingCurrency as null,
          billingInterval: row.billingInterval as null,
          pendingPlanKey: null,
          pendingPlanEffectiveAt: null,
        },
        0,
        NOW,
      );
      expect(effective.effectiveStatus).toBe('active');
      expect(effective.accessMode).toBe('writable');
      expect(effective.accountLimit).toBe(15); // professional plan allowance
    });

    it('a complimentary downgrade that leaves the Workspace over_limit is not blocked and does not archive accounts', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      const downgrade = await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      expect(downgrade.changed).toBe(true);

      const row = await getEntitlementRow(workspaceId);
      expect(row.planKey).toBe('starter');
      // Simulate 3 active accounts (over the Starter limit of 1) — the
      // mutation itself never touches trading_accounts.
      const effective = resolveEffectiveEntitlement(
        {
          workspaceId,
          status: row.status as 'active',
          source: row.source as 'complimentary',
          planKey: row.planKey as 'starter',
          trialStartedAt: row.trialStartedAt,
          trialEndsAt: row.trialEndsAt,
          currentPeriodStartedAt: row.currentPeriodStartedAt,
          currentPeriodEndsAt: row.currentPeriodEndsAt,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          canceledAt: row.canceledAt,
          billingCurrency: row.billingCurrency as null,
          billingInterval: row.billingInterval as null,
          pendingPlanKey: null,
          pendingPlanEffectiveAt: null,
        },
        3,
        NOW,
      );
      expect(effective.overLimit).toBe(true);
      expect(effective.accessMode).toBe('over_limit');
    });
  });

  describe('revokeComplimentaryPlan — atomicity and baseline restoration', () => {
    it('revokes complimentary access and restores the original trial baseline exactly', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId, { trialEndsAt: new Date('2026-09-01T00:00:00Z') });
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      const result = await revokeComplimentaryPlan(
        { workspaceId, reasonCode: 'access_revoke' },
        createFixedClock(NOW),
      );
      expect(result.changed).toBe(true);

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('trial');
      expect(row.status).toBe('trialing');
      expect(row.planKey).toBeNull();
      expect(row.currentPeriodStartedAt).toBeNull();
      expect(row.currentPeriodEndsAt).toBeNull();
      expect(row.billingCurrency).toBeNull();
      expect(row.billingInterval).toBeNull();
      expect(row.trialEndsAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows.some((r) => r.action === 'subscription.complimentary_revoked')).toBe(true);
    });

    it('a future original trial resolves back to writable trialing access after revoke', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId, { trialEndsAt: new Date('2026-09-01T00:00:00Z') });
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      await revokeComplimentaryPlan(
        { workspaceId, reasonCode: 'access_revoke' },
        createFixedClock(NOW),
      );

      const row = await getEntitlementRow(workspaceId);
      const effective = resolveEffectiveEntitlement(
        {
          workspaceId,
          status: row.status as 'trialing',
          planKey: null,
          trialStartedAt: row.trialStartedAt,
          trialEndsAt: row.trialEndsAt,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          billingCurrency: null,
          billingInterval: null,
          pendingPlanKey: null,
          pendingPlanEffectiveAt: null,
        },
        0,
        NOW,
      );
      expect(effective.effectiveStatus).toBe('trialing');
      expect(effective.accessMode).toBe('writable');
    });

    it('a past original trial resolves to expired/read-only access after revoke — never a fresh trial', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId, { trialEndsAt: new Date('2026-08-05T00:00:00Z') }); // already past NOW
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      await revokeComplimentaryPlan(
        { workspaceId, reasonCode: 'access_revoke' },
        createFixedClock(NOW),
      );

      const row = await getEntitlementRow(workspaceId);
      expect(row.trialEndsAt?.toISOString()).toBe('2026-08-05T00:00:00.000Z');
      const effective = resolveEffectiveEntitlement(
        {
          workspaceId,
          status: row.status as 'trialing',
          planKey: null,
          trialStartedAt: row.trialStartedAt,
          trialEndsAt: row.trialEndsAt,
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          billingCurrency: null,
          billingInterval: null,
          pendingPlanKey: null,
          pendingPlanEffectiveAt: null,
        },
        0,
        NOW,
      );
      expect(effective.effectiveStatus).toBe('expired');
      expect(effective.accessMode).toBe('read_only');
    });

    it('rejects a paid Workspace — paid access is never revoked through this action', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createPaidEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await expect(
        revokeComplimentaryPlan(
          { workspaceId, reasonCode: 'access_revoke' },
          createFixedClock(NOW),
        ),
      ).rejects.toMatchObject({ code: 'incompatible_state' });

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('paid');
    });

    it('a direct revoke call on a plain trial Workspace is a safe no-op, not an error', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      const result = await revokeComplimentaryPlan(
        { workspaceId, reasonCode: 'access_revoke' },
        createFixedClock(NOW),
      );
      expect(result.changed).toBe(false);
      expect(await getAuditRows(workspaceId)).toHaveLength(0);
    });

    it('billing integrity: revoking complimentary access never creates a billing_transactions row', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      await revokeComplimentaryPlan(
        { workspaceId, reasonCode: 'access_revoke' },
        createFixedClock(NOW),
      );

      expect(await countBillingTransactions(workspaceId)).toBe(0);
    });
  });

  describe('paid-activation interaction', () => {
    it('a real paid activation after a plain trial correctly sets source to paid (locked Phase 04/11B lifecycle boundary, unmodified)', async () => {
      const { activatePaidSubscription } = await import('@/server/services/subscription-lifecycle');
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await activatePaidSubscription(
        {
          workspaceId,
          planKey: 'trader',
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          periodStartedAt: NOW,
          periodEndsAt: new Date('2026-09-10T12:00:00Z'),
        },
        createFixedClock(NOW),
      );

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('paid');
      expect(row.planKey).toBe('trader');
    });

    it('a complimentary Workspace converts to real paid ONLY through the canonical trusted paid-activation path — never through an Admin mutation', async () => {
      const { activatePaidSubscription } = await import('@/server/services/subscription-lifecycle');
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );

      // Deliberately a DIFFERENT plan/currency than the comp grant, to prove
      // the paid fields come only from this trusted input, never from
      // whatever the complimentary row happened to carry (it carried none).
      const periodStart = NOW;
      const periodEnd = new Date('2026-09-10T12:00:00Z');
      await expect(
        activatePaidSubscription(
          {
            workspaceId,
            planKey: 'trader',
            billingCurrency: 'THB',
            billingInterval: 'monthly',
            periodStartedAt: periodStart,
            periodEndsAt: periodEnd,
            providerKind: 'trusted-test',
            providerCustomerId: 'cust_paid_1',
            providerSubscriptionId: 'sub_paid_1',
          },
          createFixedClock(NOW),
        ),
      ).resolves.toEqual({ changed: true });

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('paid');
      expect(row.status).toBe('active');
      expect(row.planKey).toBe('trader');
      expect(row.billingCurrency).toBe('THB');
      expect(row.billingInterval).toBe('monthly');
      expect(row.currentPeriodStartedAt?.toISOString()).toBe(periodStart.toISOString());
      expect(row.currentPeriodEndsAt?.toISOString()).toBe(periodEnd.toISOString());
      expect(row.providerKind).toBe('trusted-test');
      expect(row.providerCustomerId).toBe('cust_paid_1');
      expect(row.providerSubscriptionId).toBe('sub_paid_1');
      expect(row.cancelAtPeriodEnd).toBe(false);
      expect(row.canceledAt).toBeNull();
      expect(row.pendingPlanKey).toBeNull();
      // No billing_transactions row: this trusted-path activation itself
      // fabricates no Billing history — that only happens through checkout.
      expect(await countBillingTransactions(workspaceId)).toBe(0);
    });

    it('a direct Admin mutation still cannot turn a paid Workspace into complimentary, even after a genuine paid conversion', async () => {
      const { activatePaidSubscription } = await import('@/server/services/subscription-lifecycle');
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );
      await activatePaidSubscription(
        {
          workspaceId,
          planKey: 'trader',
          billingCurrency: 'USD',
          billingInterval: 'monthly',
          periodStartedAt: NOW,
          periodEndsAt: new Date('2026-09-10T12:00:00Z'),
        },
        createFixedClock(NOW),
      );

      await expect(
        grantComplimentaryPlan(
          { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
      ).rejects.toMatchObject({ code: 'incompatible_state' });

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('paid');
      expect(row.planKey).toBe('trader');
    });
  });

  describe('concurrency and locking', () => {
    it('two identical concurrent complimentary grants result in exactly one state change and one audit row', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      const [a, b] = await Promise.all([
        grantComplimentaryPlan(
          { workspaceId, planKey: 'trader', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
        grantComplimentaryPlan(
          { workspaceId, planKey: 'trader', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
      ]);

      const changedCount = [a, b].filter((r) => r.changed).length;
      expect(changedCount).toBe(1);

      const row = await getEntitlementRow(workspaceId);
      expect(row.source).toBe('complimentary');
      expect(row.planKey).toBe('trader');
      expect(await getAuditRows(workspaceId)).toHaveLength(1);
    });

    it('two concurrent trial extensions to different future timestamps serialize into a coherent final state', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId, { trialEndsAt: new Date('2026-08-11T00:00:00Z') });
      currentSession = sessionFor(adminUserId);

      const earlierTarget = new Date('2026-08-25T00:00:00Z');
      const laterTarget = new Date('2026-08-30T00:00:00Z');

      const results = await Promise.allSettled([
        extendTrialByAdmin(
          { workspaceId, newTrialEndsAt: earlierTarget, reasonCode: 'trial_extension_goodwill' },
          createFixedClock(NOW),
        ),
        extendTrialByAdmin(
          { workspaceId, newTrialEndsAt: laterTarget, reasonCode: 'trial_extension_goodwill' },
          createFixedClock(NOW),
        ),
      ]);

      // Whichever order the row lock serialized them in, the final
      // trialEndsAt must be a value ONE of the two calls actually requested
      // — never a corrupted or unrequested value — and every audit row
      // written must correspond to an actual committed state change.
      const row = await getEntitlementRow(workspaceId);
      const finalIso = row.trialEndsAt?.toISOString();
      expect([earlierTarget.toISOString(), laterTarget.toISOString()]).toContain(finalIso);

      const auditRows = await getAuditRows(workspaceId);
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows.length).toBeLessThanOrEqual(2);

      const fulfilledChanged = results.filter(
        (r) => r.status === 'fulfilled' && r.value.changed,
      ).length;
      expect(fulfilledChanged).toBe(auditRows.length);
    });

    it('a grant racing a revoke never produces an internally-inconsistent row', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      const workspaceId = await createWorkspace();
      await createTrialEntitlement(workspaceId);
      currentSession = sessionFor(adminUserId);

      // Seed complimentary access first so the revoke has something to act on.
      await grantComplimentaryPlan(
        { workspaceId, planKey: 'starter', reasonCode: 'complimentary_access' },
        createFixedClock(NOW),
      );

      await Promise.allSettled([
        grantComplimentaryPlan(
          { workspaceId, planKey: 'professional', reasonCode: 'complimentary_access' },
          createFixedClock(NOW),
        ),
        revokeComplimentaryPlan(
          { workspaceId, reasonCode: 'access_revoke' },
          createFixedClock(NOW),
        ),
      ]);

      const row = await getEntitlementRow(workspaceId);
      // Complimentary access has no commercial period either way — the two
      // outcomes differ only in status/planKey/trial baseline, never in
      // whether a period/currency was fabricated (neither state has one).
      expect(row.currentPeriodStartedAt).toBeNull();
      expect(row.currentPeriodEndsAt).toBeNull();
      expect(row.billingCurrency).toBeNull();
      if (row.source === 'trial') {
        expect(row.planKey).toBeNull();
      } else {
        expect(row.source).toBe('complimentary');
        expect(row.planKey).not.toBeNull();
      }
    });
  });

  it('the mutation error class is the only thing thrown for a known failure — never a raw AdminSubscriptionMutationError leaking Postgres internals', async () => {
    const adminUserId = await createUser();
    await grantAdmin(adminUserId);
    const workspaceId = await createWorkspace();
    await createPaidEntitlement(workspaceId);
    currentSession = sessionFor(adminUserId);

    try {
      await extendTrialByAdmin(
        {
          workspaceId,
          newTrialEndsAt: new Date('2026-08-20T00:00:00Z'),
          reasonCode: 'trial_extension_goodwill',
        },
        createFixedClock(NOW),
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminSubscriptionMutationError);
      const message = (error as Error).message;
      expect(message).not.toMatch(/select|insert|update|constraint|relation/i);
    }
  });
});
