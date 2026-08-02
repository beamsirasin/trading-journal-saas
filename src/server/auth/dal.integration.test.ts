import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { userPreferences, users, workspaceMembers, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * The required authorization matrix (Phase 2 brief §22) exercised against a
 * real database, with only Better Auth's own session-resolution step
 * mocked — the actual boundary under test (`requireWorkspaceMembership`,
 * `getActiveWorkspaceContext`, cross-user isolation) runs unmocked, as real
 * Drizzle queries against real rows.
 */
type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  // `getActiveWorkspaceContext`'s repair path calls the real
  // `ensurePersonalWorkspace`, which reads `NEXT_LOCALE` via `cookies()` —
  // absent here on purpose, exercising its documented default-to-`en` path.
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
  getActiveWorkspaceContext,
  getOptionalSession,
  requireSession,
  requireWorkspaceMembership,
  requireWorkspaceRole,
  UnauthenticatedError,
  ForbiddenError,
} = await import('./dal');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Test User',
      email: 'test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

async function createUser(db: ReturnType<typeof getTestDb>, label: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('failed to insert test user');
  return user.id;
}

async function createWorkspaceWithOwner(db: ReturnType<typeof getTestDb>, ownerUserId: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Test workspace',
      slug: `ws-${crypto.randomUUID()}`,
      kind: 'personal',
      personalOwnerUserId: ownerUserId,
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(userPreferences).values({ userId: ownerUserId, activeWorkspaceId: workspace.id });
  return workspace.id;
}

describe('server/auth/dal (authorization matrix)', () => {
  const db = getTestDb();
  const createdUserIds: string[] = [];

  afterEach(async () => {
    currentSession = null;
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('getOptionalSession returns null with no session', async () => {
    currentSession = null;
    expect(await getOptionalSession()).toBeNull();
  });

  it('requireSession throws UnauthenticatedError with no session', async () => {
    currentSession = null;
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it('a member can access their own workspace', async () => {
    const userId = await createUser(db, 'owner');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    currentSession = sessionFor(userId);

    const role = await requireWorkspaceMembership(workspaceId);
    expect(role).toBe('owner');
  });

  it('User A cannot read User B workspace by supplying B workspace ID', async () => {
    const userA = await createUser(db, 'user-a');
    const userB = await createUser(db, 'user-b');
    createdUserIds.push(userA, userB);
    const workspaceB = await createWorkspaceWithOwner(db, userB);

    currentSession = sessionFor(userA);
    await expect(requireWorkspaceMembership(workspaceB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a non-member is rejected even with a valid session', async () => {
    const stranger = await createUser(db, 'stranger');
    const owner = await createUser(db, 'owner2');
    createdUserIds.push(stranger, owner);
    const workspaceId = await createWorkspaceWithOwner(db, owner);

    currentSession = sessionFor(stranger);
    await expect(requireWorkspaceMembership(workspaceId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('requireWorkspaceRole enforces the role hierarchy (member cannot act as owner)', async () => {
    const owner = await createUser(db, 'owner3');
    const member = await createUser(db, 'member3');
    createdUserIds.push(owner, member);
    const workspaceId = await createWorkspaceWithOwner(db, owner);
    await db.insert(workspaceMembers).values({ workspaceId, userId: member, role: 'member' });

    currentSession = sessionFor(member);
    await expect(requireWorkspaceRole(workspaceId, 'owner')).rejects.toBeInstanceOf(ForbiddenError);
    // A member still passes a 'member'-level check.
    await expect(requireWorkspaceRole(workspaceId, 'member')).resolves.toBe('member');
  });

  it('getActiveWorkspaceContext returns the real active workspace for a properly provisioned user', async () => {
    const userId = await createUser(db, 'active-ctx');
    createdUserIds.push(userId);
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    currentSession = sessionFor(userId);

    const context = await getActiveWorkspaceContext();
    expect(context.workspaceId).toBe(workspaceId);
    expect(context.role).toBe('owner');
  });

  it('getActiveWorkspaceContext repairs a user with no preferences row at all', async () => {
    // A user created directly (bypassing ensurePersonalWorkspace) so there
    // is no workspace, membership, or preferences row yet — the exact state
    // an interrupted `databaseHooks.user.create.after` call would leave.
    const userId = await createUser(db, 'unrepaired');
    createdUserIds.push(userId);
    currentSession = sessionFor(userId);

    const context = await getActiveWorkspaceContext();
    expect(context.role).toBe('owner');

    const workspaceRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    expect(workspaceRows).toHaveLength(1);
    expect(workspaceRows[0]?.id).toBe(context.workspaceId);
  });
});
