import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { platformAdmins, users, workspaceMembers, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Proves that adding the cross-tenant Admin DAL (Phase 11D, `src/server/dal/
 * admin/*.ts`) did NOT weaken the ordinary tenant-scoped boundary
 * (`src/server/auth/dal.ts`) — the two are structurally separate modules,
 * but this is the one test that exercises that separation directly rather
 * than only trusting Phase 01's own (unmodified) isolation tests to still
 * cover it. Ordinary user A must still be unable to read Workspace B through
 * `requireWorkspaceMembership` — the exact function every tenant-scoped
 * mutation and read in this codebase calls first.
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

const { requireWorkspaceMembership, ForbiddenError } = await import('@/server/auth/dal');
const { getAdminWorkspaceDetail } = await import('./workspace-oversight');
const { requirePlatformAdmin } = await import('@/server/auth/admin-dal');

const db = getTestDb();

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Tenant isolation regression user',
      email: 'tenant-isolation-regression@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

describe('Admin DAL does not weaken ordinary tenant isolation (real database)', () => {
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        name: 'Tenant isolation fixture user',
        email: `tenant-isolation-${crypto.randomUUID()}@example.test`,
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
        name: 'Tenant isolation fixture workspace',
        slug: `tenant-isolation-${crypto.randomUUID()}`,
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to insert test workspace');
    workspaceIds.push(workspace.id);
    return workspace.id;
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

  it('an ordinary user A cannot read Workspace B via the tenant DAL, even though the Admin DAL now exists in the same codebase', async () => {
    const userAId = await createUser();
    const userBId = await createUser();
    const workspaceBId = await createWorkspace();
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspaceBId, userId: userBId, role: 'owner', status: 'active' });

    currentSession = sessionFor(userAId);
    await expect(requireWorkspaceMembership(workspaceBId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a platform admin with an active grant CAN read Workspace B only through the Admin DAL/service, never through requireWorkspaceMembership gaining new authority', async () => {
    const adminUserId = await createUser();
    await db.insert(platformAdmins).values({ userId: adminUserId });
    const userBId = await createUser();
    const workspaceBId = await createWorkspace();
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: workspaceBId, userId: userBId, role: 'owner', status: 'active' });

    currentSession = sessionFor(adminUserId);
    // The Admin service can read it (that's the whole point of Phase 11D):
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ user: { id: adminUserId } });
    const detail = await getAdminWorkspaceDetail(workspaceBId);
    expect(detail?.workspaceId).toBe(workspaceBId);

    // But the ORDINARY tenant DAL still denies the same admin user, because
    // platform authority and workspace membership are deliberately two
    // unrelated boundaries (Phase 11's own "Platform Admin is NOT Workspace
    // Admin" contract) — an admin grant must never silently become a
    // membership row.
    await expect(requireWorkspaceMembership(workspaceBId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
