import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  platformAdmins,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { activePaidPeriod } from '@/test/entitlement-fixtures';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Phase 11B's required authorization matrix (its own "authorization tests"
 * section), exercised against a real database with only Better Auth's own
 * session-resolution step mocked — the same pattern `dal.integration.test.ts`
 * already established for the tenant-scoped boundary. The point of every
 * test here is the negative space: NOTHING about a workspace, a role, a
 * plan, or an entitlement status may ever grant platform authority.
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

const { getOptionalPlatformAdmin, requirePlatformAdmin, PlatformAdminRequiredError } =
  await import('./admin-dal');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Admin DAL test user',
      email: 'admin-dal@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('requirePlatformAdmin / getOptionalPlatformAdmin (real database)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(): Promise<string> {
    const db = getTestDb();
    const [user] = await db
      .insert(users)
      .values({
        name: 'Admin DAL test user',
        email: `admin-dal-${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning({ id: users.id });
    if (user === undefined) throw new Error('failed to insert test user');
    userIds.push(user.id);
    return user.id;
  }

  async function grant(userId: string): Promise<string> {
    const [row] = await getTestDb()
      .insert(platformAdmins)
      .values({ userId })
      .returning({ id: platformAdmins.id });
    if (row === undefined) throw new Error('failed to insert grant');
    return row.id;
  }

  async function revoke(grantId: string): Promise<void> {
    await getTestDb()
      .update(platformAdmins)
      .set({ revokedAt: new Date() })
      .where(eq(platformAdmins.id, grantId));
  }

  afterEach(async () => {
    currentSession = null;
    const db = getTestDb();
    for (const workspaceId of workspaceIds.splice(0)) {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    }
    // platform_admins.user_id is RESTRICT — a grant's mere EXISTENCE blocks
    // deleting its user, regardless of revocation state (Phase 11B's
    // retention-safe contract; see admin-foundation-migration.integration.
    // test.ts's own comment on this exact teardown pattern). Test teardown
    // deletes its own fixture grant rows directly rather than revoking them.
    for (const userId of userIds.splice(0)) {
      await db.delete(platformAdmins).where(eq(platformAdmins.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('no session at all -> getOptionalPlatformAdmin returns null, requirePlatformAdmin throws', async () => {
    currentSession = null;
    await expect(getOptionalPlatformAdmin()).resolves.toBeNull();
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('a user with an active grant authorizes, and the context carries that grant id', async () => {
    const userId = await createUser();
    const grantId = await grant(userId);
    currentSession = sessionFor(userId);

    const context = await requirePlatformAdmin();
    expect(context.adminGrantId).toBe(grantId);
    expect(context.user.id).toBe(userId);
  });

  it('a user with NO grant at all is denied, even with a valid session', async () => {
    const userId = await createUser();
    currentSession = sessionFor(userId);
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('a Workspace owner with no platform-admin grant is denied — ownership grants nothing', async () => {
    const userId = await createUser();
    const db = getTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Owner-only workspace', slug: `owner-only-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    workspaceIds.push(workspace!.id);
    await db.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId, role: 'owner' });
    await db.insert(userPreferences).values({ userId, activeWorkspaceId: workspace!.id });

    currentSession = sessionFor(userId);
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('a Professional-plan (active, paid) workspace user with no grant is denied — plan grants nothing', async () => {
    const userId = await createUser();
    const db = getTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Professional workspace', slug: `professional-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    workspaceIds.push(workspace!.id);
    await db.insert(workspaceMembers).values({ workspaceId: workspace!.id, userId, role: 'owner' });
    await db.insert(userPreferences).values({ userId, activeWorkspaceId: workspace!.id });
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace!.id,
      status: 'active',
      planKey: 'professional',
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      ...activePaidPeriod(),
      source: 'paid',
    });

    currentSession = sessionFor(userId);
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('a revoked admin is denied immediately on the next check', async () => {
    const userId = await createUser();
    const grantId = await grant(userId);
    currentSession = sessionFor(userId);
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ adminGrantId: grantId });

    await revoke(grantId);
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(PlatformAdminRequiredError);
  });

  it('grant -> revoke -> grant again: the second historical grant is the one that authorizes, with a different id', async () => {
    const userId = await createUser();
    const firstGrantId = await grant(userId);
    await revoke(firstGrantId);
    const secondGrantId = await grant(userId);
    expect(secondGrantId).not.toBe(firstGrantId);

    currentSession = sessionFor(userId);
    const context = await requirePlatformAdmin();
    expect(context.adminGrantId).toBe(secondGrantId);
  });

  it('an admin with NO Workspace at all still authorizes', async () => {
    const userId = await createUser();
    await grant(userId);
    currentSession = sessionFor(userId);
    // No workspace, no workspace_members row, no user_preferences row was
    // ever created for this user — requirePlatformAdmin must not touch any
    // of those tables to succeed.
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ user: { id: userId } });
  });

  it("a second user's workspace/entitlement state has no effect on this user's authorization", async () => {
    const adminUserId = await createUser();
    await grant(adminUserId);
    const otherUserId = await createUser();
    const db = getTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Other user workspace', slug: `other-${crypto.randomUUID()}` })
      .returning({ id: workspaces.id });
    workspaceIds.push(workspace!.id);
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace!.id, userId: otherUserId, role: 'owner' });

    currentSession = sessionFor(adminUserId);
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ user: { id: adminUserId } });
  });
});
