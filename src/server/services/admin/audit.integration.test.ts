import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createFixedClock } from '@/lib/time';
import { platformAdmins, users, workspaces } from '@/server/db/schema';
import type { AdminAuditStateSnapshot } from '@/server/services/admin-audit-log';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Read-only Admin Audit list (Phase 11E), against a real database. Mirrors
 * the exact mocked-session pattern established by Phase 11C/11D's own admin
 * integration suites. Fixture audit rows are inserted directly via
 * `insertAdminAuditLog` (the real, only insert path) rather than by running
 * full mutations — the write path's own atomicity is covered separately in
 * `subscription-support.integration.test.ts`; this file isolates the READ
 * model.
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

const { getAdminAuditList } = await import('./audit');
const { insertAdminAuditLog } = await import('../admin-audit-log');
const { PlatformAdminRequiredError } = await import('@/server/auth/admin-dal');

const db = getTestDb();
const NOW = new Date('2026-08-10T12:00:00Z');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Audit test admin',
      email: 'audit-test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('Admin Audit read model (real database)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'Audit fixture user',
        email: `audit-fixture-${crypto.randomUUID()}@example.test`,
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
      .values({ name: 'Audit fixture workspace', slug: `audit-fixture-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to insert test workspace');
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  /**
   * A grant used as `admin_audit_log.actor_admin_id` can never be deleted
   * again (RESTRICT FK, and `admin_audit_log` has no DELETE path at all —
   * append-only by design). Every admin granted here is treated as
   * potentially becoming such an actor, so it is removed from the
   * deletable `userIds` list up front rather than tracked per call site.
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
    it('a non-admin caller is denied', async () => {
      const userId = await createUser();
      currentSession = sessionFor(userId);
      await expect(getAdminAuditList({}, createFixedClock(NOW))).rejects.toBeInstanceOf(
        PlatformAdminRequiredError,
      );
    });
  });

  describe('list', () => {
    it('orders newest first with a deterministic id tie-break', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });
      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.complimentary_granted',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'complimentary_access',
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId },
        createFixedClock(NOW),
      );
      expect(page.items).toHaveLength(2);
      expect(page.items[0]?.action).toBe('subscription.complimentary_granted');
      expect(page.items[1]?.action).toBe('subscription.trial_extended');
    });

    it('paginates with a small page size and no overlap between pages', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      for (let i = 0; i < 5; i += 1) {
        await insertAdminAuditLog(db, {
          actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
          action: 'subscription.trial_extended',
          subjectWorkspaceId: workspaceId,
          reasonCode: 'trial_extension_goodwill',
        });
      }

      const page1 = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, limit: 2 },
        createFixedClock(NOW),
      );
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, limit: 2, cursor: page1.nextCursor },
        createFixedClock(NOW),
      );
      expect(page2.items).toHaveLength(2);
      const page1Ids = page1.items.map((i) => i.id);
      const page2Ids = page2.items.map((i) => i.id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it('filters by action', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });
      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.complimentary_granted',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'complimentary_access',
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, action: 'subscription.complimentary_granted' },
        createFixedClock(NOW),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.action).toBe('subscription.complimentary_granted');
    });

    it('filters by reason code', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.complimentary_revoked',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'access_revoke',
      });
      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.complimentary_revoked',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'other',
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, reasonCode: 'access_revoke' },
        createFixedClock(NOW),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.reasonCode).toBe('access_revoke');
    });

    it('filters by exact subjectUserId and subjectWorkspaceId', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const subjectUserId = await createUser();
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'platform_admin.granted',
        subjectUserId,
        reasonCode: 'access_grant',
      });
      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });

      const byUser = await getAdminAuditList({ subjectUserId }, createFixedClock(NOW));
      expect(byUser.items.every((i) => i.subjectUserId === subjectUserId)).toBe(true);
      expect(byUser.items.some((i) => i.subjectWorkspaceId === workspaceId)).toBe(false);

      const byWorkspace = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId },
        createFixedClock(NOW),
      );
      expect(byWorkspace.items).toHaveLength(1);
      expect(byWorkspace.items[0]?.subjectWorkspaceId).toBe(workspaceId);
    });

    it('filters by actor (the underlying admin user id)', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorAId = await createUser();
      const actorAGrantId = await grantAdmin(actorAId);
      const actorBId = await createUser();
      const actorBGrantId = await grantAdmin(actorBId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorAGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });
      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorBGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, actorUserId: actorAId },
        createFixedClock(NOW),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.actor).toMatchObject({
        kind: 'platform_admin',
        adminGrantId: actorAGrantId,
      });
    });

    it('the 30d date preset excludes an older event and includes a recent one', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });

      const within30d = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, datePreset: '30d' },
        createFixedClock(NOW),
      );
      expect(within30d.items).toHaveLength(1);

      const farFuture = createFixedClock(new Date(NOW.getTime() + 60 * 24 * 60 * 60 * 1000));
      const outside30d = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, datePreset: '30d' },
        farFuture,
      );
      expect(outside30d.items).toHaveLength(0);

      const allTime = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId, datePreset: 'all' },
        farFuture,
      );
      expect(allTime.items).toHaveLength(1);
    });

    it('resolves a platform_admin actor identity and labels a system actor distinctly', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });
      await insertAdminAuditLog(db, {
        actor: { actorKind: 'system' },
        action: 'platform_admin.granted',
        subjectUserId: actorId,
        reasonCode: 'bootstrap',
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId },
        createFixedClock(NOW),
      );
      expect(page.items[0]?.actor.kind).toBe('platform_admin');
      if (page.items[0]?.actor.kind === 'platform_admin') {
        expect(page.items[0].actor.adminGrantId).toBe(actorGrantId);
      }

      const systemPage = await getAdminAuditList({ subjectUserId: actorId }, createFixedClock(NOW));
      expect(systemPage.items[0]?.actor).toEqual({ kind: 'system' });
    });

    it('exposes only the allowlisted structural before/after fields, with an optional reason note', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.complimentary_granted',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'complimentary_access',
        reasonNote: 'A goodwill gesture for a delayed launch.',
        beforeState: { status: 'trialing', source: 'trial' },
        afterState: { status: 'active', source: 'complimentary', planKey: 'trader' },
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId },
        createFixedClock(NOW),
      );
      const entry = page.items[0];
      expect(entry?.reasonNote).toBe('A goodwill gesture for a delayed launch.');
      expect(entry?.before).toEqual({ status: 'trialing', source: 'trial' });
      expect(entry?.after).toEqual({
        status: 'active',
        source: 'complimentary',
        planKey: 'trader',
      });
    });

    it('drops any non-allowlisted key from a malformed/legacy jsonb snapshot rather than leaking it', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      // Deliberately injecting forbidden fields via an unchecked cast, to
      // prove the READ-side allowlist (`parseAdminAuditStateSnapshot`) drops
      // them even for a malformed/legacy row the writer's own type would
      // never normally allow.
      const forbiddenSnapshot = {
        status: 'trialing',
        ipAddress: '203.0.113.5',
        password: 'should-never-appear',
      } as unknown as AdminAuditStateSnapshot;

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
        beforeState: forbiddenSnapshot,
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId },
        createFixedClock(NOW),
      );
      const serialized = JSON.stringify(page);
      expect(serialized).not.toContain('203.0.113.5');
      expect(serialized).not.toContain('should-never-appear');
      expect(page.items[0]?.before).toEqual({ status: 'trialing' });
    });

    it('the DTO is JSON-safe and round-trips unchanged', async () => {
      const viewerId = await createUser();
      await grantAdmin(viewerId);
      const actorId = await createUser();
      const actorGrantId = await grantAdmin(actorId);
      const workspaceId = await createWorkspace();
      currentSession = sessionFor(viewerId);

      await insertAdminAuditLog(db, {
        actor: { actorKind: 'platform_admin', actorAdminId: actorGrantId },
        action: 'subscription.trial_extended',
        subjectWorkspaceId: workspaceId,
        reasonCode: 'trial_extension_goodwill',
      });

      const page = await getAdminAuditList(
        { subjectWorkspaceId: workspaceId },
        createFixedClock(NOW),
      );
      const roundTripped = JSON.parse(JSON.stringify(page)) as typeof page;
      expect(roundTripped).toEqual(page);
    });
  });
});
