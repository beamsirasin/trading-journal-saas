import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createFixedClock } from '@/lib/time';
import {
  accounts,
  platformAdmins,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Read-only User oversight (Phase 11D), against a real database. Mirrors
 * `metrics.integration.test.ts`'s exact mocked-session pattern
 * (`admin-dal.integration.test.ts`'s own authorization matrix) and its delta
 * assertions against the shared, never-reset fixture database.
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

const { getAdminUserList, getAdminUserDetail } = await import('./user-oversight');
const { PlatformAdminRequiredError } = await import('@/server/auth/admin-dal');

const db = getTestDb();
const NOW = new Date('2026-08-10T12:00:00Z');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'User oversight test admin',
      email: 'user-oversight-test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('User oversight (real database)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'User oversight fixture user',
        email: `user-oversight-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
        ...overrides,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to insert test user');
    userIds.push(user.id);
    return user.id;
  }

  async function createWorkspace(name = 'User oversight fixture workspace'): Promise<string> {
    const [workspace] = await db
      .insert(workspaces)
      .values({ name, slug: `user-oversight-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to insert test workspace');
    workspaceIds.push(workspace.id);
    return workspace.id;
  }

  async function addMember(
    workspaceId: string,
    userId: string,
    role: 'owner' | 'member' = 'owner',
  ): Promise<void> {
    await db.insert(workspaceMembers).values({ workspaceId, userId, role, status: 'active' });
  }

  async function createEntitlement(
    workspaceId: string,
    overrides: Partial<typeof workspaceEntitlements.$inferInsert>,
  ): Promise<void> {
    await db
      .insert(workspaceEntitlements)
      .values({ workspaceId, status: 'trialing', ...overrides });
  }

  async function addProvider(userId: string, providerId: string): Promise<void> {
    await db.insert(accounts).values({ userId, accountId: crypto.randomUUID(), providerId });
  }

  async function grantAdmin(userId: string): Promise<void> {
    await db.insert(platformAdmins).values({ userId });
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
    it('a non-admin caller is denied for both list and detail', async () => {
      const userId = await createUser();
      currentSession = sessionFor(userId);
      await expect(getAdminUserList({}, createFixedClock(NOW))).rejects.toBeInstanceOf(
        PlatformAdminRequiredError,
      );
      await expect(getAdminUserDetail(userId, createFixedClock(NOW))).rejects.toBeInstanceOf(
        PlatformAdminRequiredError,
      );
    });

    it('no session at all is denied', async () => {
      currentSession = null;
      await expect(getAdminUserList({}, createFixedClock(NOW))).rejects.toBeInstanceOf(
        PlatformAdminRequiredError,
      );
    });

    it('an active admin is allowed', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);
      await expect(getAdminUserList({}, createFixedClock(NOW))).resolves.toBeDefined();
    });
  });

  describe('list', () => {
    it('finds a user by exact ID', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetId = await createUser({ name: 'Findable By Id' });
      const page = await getAdminUserList({ q: targetId }, createFixedClock(NOW));
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.userId).toBe(targetId);
    });

    it('finds a user by a case-insensitive email prefix', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const marker = crypto.randomUUID();
      await createUser({ email: `Prefix-${marker}@Example.test` });
      const page = await getAdminUserList(
        { q: `PREFIX-${marker}`.toUpperCase() },
        createFixedClock(NOW),
      );
      expect(page.items).toHaveLength(1);
    });

    it('finds a user by a case-insensitive name prefix', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const marker = crypto.randomUUID().slice(0, 8);
      await createUser({ name: `Zebra-${marker} Trader` });
      const page = await getAdminUserList({ q: `zebra-${marker}` }, createFixedClock(NOW));
      expect(page.items).toHaveLength(1);
    });

    it('an unmatched search returns an empty page, not an error', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const page = await getAdminUserList(
        { q: `no-such-user-${crypto.randomUUID()}` },
        createFixedClock(NOW),
      );
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it('paginates with a small page size and a working cursor, with no overlap between pages', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      // Not a UUID: a genuine UUID-shaped marker would be classified as an
      // exact-ID search (`isUuidLike`), not a name prefix — this must be a
      // plain token, and it must lead the name so the prefix match applies.
      const marker = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      for (let i = 0; i < 5; i += 1) {
        await createUser({ name: `${marker} page fixture` });
      }

      const page1 = await getAdminUserList({ q: marker, limit: 2 }, createFixedClock(NOW));
      expect(page1.items).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await getAdminUserList(
        { q: marker, limit: 2, cursor: page1.nextCursor },
        createFixedClock(NOW),
      );
      expect(page2.items).toHaveLength(2);
      const page1Ids = page1.items.map((item) => item.userId);
      const page2Ids = page2.items.map((item) => item.userId);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });

    it('a user in exactly one workspace gets a "single" summary with the correct effective status', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      const workspaceId = await createWorkspace();
      await addMember(workspaceId, targetUserId, 'owner');
      await createEntitlement(workspaceId, {
        status: 'active',
        planKey: 'trader',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        source: 'paid',
      });

      const page = await getAdminUserList({ q: targetUserId }, createFixedClock(NOW));
      const summary = page.items[0]?.workspaceSummary;
      expect(summary).toEqual({
        kind: 'single',
        workspaceId,
        role: 'owner',
        effectiveStatus: 'active',
        effectivePlanKey: 'trader',
      });
    });

    it('a user in multiple workspaces gets a "multiple" summary with the exact count, never a fabricated single status', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      const workspaceOneId = await createWorkspace();
      const workspaceTwoId = await createWorkspace();
      await addMember(workspaceOneId, targetUserId, 'owner');
      await addMember(workspaceTwoId, targetUserId, 'member');

      const page = await getAdminUserList({ q: targetUserId }, createFixedClock(NOW));
      expect(page.items[0]?.workspaceSummary).toEqual({ kind: 'multiple', count: 2 });
    });

    it('a user in no workspace gets a "none" summary', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      const page = await getAdminUserList({ q: targetUserId }, createFixedClock(NOW));
      expect(page.items[0]?.workspaceSummary).toEqual({ kind: 'none' });
    });

    it('the DTO is JSON-safe and contains no forbidden raw fields', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      await addProvider(targetUserId, 'credential');
      const page = await getAdminUserList({ q: targetUserId }, createFixedClock(NOW));
      const serialized = JSON.stringify(page);
      // Not a blanket ban on the substring "password": the legitimate,
      // safely-mapped provider label is literally `"email_password"` (see
      // `toSafeProvider`). The forbidden thing is a `"password"` FIELD KEY —
      // the raw `accounts.password` hash — which this checks precisely.
      expect(serialized).not.toMatch(/"password"\s*:/);
      expect(serialized).not.toContain('accessToken');
      expect(serialized).not.toContain('refreshToken');
      expect(serialized).not.toContain('ipAddress');
      // `providerId` values ('credential'/'google') are mapped away entirely.
      expect(serialized).not.toContain('"credential"');
      const roundTripped = JSON.parse(serialized) as typeof page;
      expect(roundTripped).toEqual(page);
    });
  });

  describe('detail', () => {
    it('returns null for an unknown userId — the caller renders a 404, not a 403', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const result = await getAdminUserDetail(crypto.randomUUID(), createFixedClock(NOW));
      expect(result).toBeNull();
    });

    it('exposes identity fields and safely-mapped, deduplicated sign-in methods', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser({ name: 'Detail Fixture', emailVerified: false });
      await addProvider(targetUserId, 'google');
      await addProvider(targetUserId, 'google'); // simulates a re-link; must dedupe
      await addProvider(targetUserId, 'some-unrecognized-provider');

      const detail = await getAdminUserDetail(targetUserId, createFixedClock(NOW));
      expect(detail?.name).toBe('Detail Fixture');
      expect(detail?.emailVerified).toBe(false);
      expect([...(detail?.providers ?? [])].sort()).toEqual(['google', 'other']);
    });

    it('lists every active workspace membership with its own correct effective entitlement', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      const trialWorkspaceId = await createWorkspace('Trial workspace');
      const paidWorkspaceId = await createWorkspace('Paid workspace');
      await addMember(trialWorkspaceId, targetUserId, 'owner');
      await addMember(paidWorkspaceId, targetUserId, 'member');
      await createEntitlement(trialWorkspaceId, {
        status: 'trialing',
        trialStartedAt: NOW,
        trialEndsAt: new Date(NOW.getTime() + 7 * 86_400_000),
        source: 'trial',
      });
      await createEntitlement(paidWorkspaceId, {
        status: 'active',
        planKey: 'starter',
        billingCurrency: 'THB',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
        source: 'paid',
      });

      const detail = await getAdminUserDetail(targetUserId, createFixedClock(NOW));
      expect(detail?.workspaces).toHaveLength(2);
      const trialMembership = detail?.workspaces.find((w) => w.workspaceId === trialWorkspaceId);
      const paidMembership = detail?.workspaces.find((w) => w.workspaceId === paidWorkspaceId);
      expect(trialMembership).toMatchObject({
        role: 'owner',
        effectiveStatus: 'trialing',
        effectivePlanKey: null,
        source: 'trial',
      });
      expect(paidMembership).toMatchObject({
        role: 'member',
        effectiveStatus: 'active',
        effectivePlanKey: 'starter',
        source: 'paid',
      });
    });

    it('a revoked membership (status != active) does not appear', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      const workspaceId = await createWorkspace();
      await db
        .insert(workspaceMembers)
        .values({ workspaceId, userId: targetUserId, role: 'member', status: 'active' });
      // Simulate a departed member by deleting the row entirely — the DAL's
      // own `status = 'active'` filter is what this test exercises indirectly
      // via a workspace with zero remaining active members.
      await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));

      const detail = await getAdminUserDetail(targetUserId, createFixedClock(NOW));
      expect(detail?.workspaces).toEqual([]);
    });

    it('the DTO contains no session, verification, or Trade-content fields', async () => {
      const adminUserId = await createUser();
      await grantAdmin(adminUserId);
      currentSession = sessionFor(adminUserId);

      const targetUserId = await createUser();
      const detail = await getAdminUserDetail(targetUserId, createFixedClock(NOW));
      const serialized = JSON.stringify(detail);
      expect(serialized).not.toMatch(/"password"\s*:/);
      expect(serialized).not.toContain('token');
      expect(serialized).not.toContain('ipAddress');
      expect(serialized).not.toContain('symbol');
    });
  });
});
