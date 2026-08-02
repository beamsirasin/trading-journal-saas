import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  userPreferences,
  users,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

// `ensurePersonalWorkspace` reads the pre-login locale from `next/headers`'s
// `cookies()`, which throws outside a real Next.js request. Mocked here so
// the real transaction/constraint logic underneath can run against a real
// database without a request context.
const cookieValue = vi.fn<() => string | undefined>(() => undefined);
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'NEXT_LOCALE' ? { value: cookieValue() } : undefined),
  }),
}));

const { ensurePersonalWorkspace } = await import('./workspace-provisioning');

async function createTestUser(db: ReturnType<typeof getTestDb>, email: string) {
  const [user] = await db
    .insert(users)
    .values({ name: 'Test User', email, emailVerified: true })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('failed to insert test user');
  return user.id;
}

describe('ensurePersonalWorkspace', () => {
  const db = getTestDb();
  const createdUserIds: string[] = [];

  beforeAll(() => {
    cookieValue.mockReturnValue(undefined);
  });

  afterEach(async () => {
    // Cascades to workspaces/memberships/preferences/audit rows via FK
    // `onDelete` rules declared in the schema — see src/server/db/schema/.
    for (const id of createdUserIds.splice(0)) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it('creates exactly one workspace, one owner membership, and one preferences row', async () => {
    const userId = await createTestUser(db, `provision-${crypto.randomUUID()}@example.test`);
    createdUserIds.push(userId);

    const { workspaceId } = await ensurePersonalWorkspace(userId);

    const workspaceRows = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(workspaceRows).toHaveLength(1);
    expect(workspaceRows[0]?.kind).toBe('personal');
    expect(workspaceRows[0]?.personalOwnerUserId).toBe(userId);

    const memberRows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.role).toBe('owner');
    expect(memberRows[0]?.workspaceId).toBe(workspaceId);

    const prefRows = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    expect(prefRows).toHaveLength(1);
    expect(prefRows[0]?.activeWorkspaceId).toBe(workspaceId);
  });

  it('seeds locale from the NEXT_LOCALE cookie, defaulting to en when absent or invalid', async () => {
    const userIdTh = await createTestUser(db, `locale-th-${crypto.randomUUID()}@example.test`);
    const userIdInvalid = await createTestUser(
      db,
      `locale-bad-${crypto.randomUUID()}@example.test`,
    );
    createdUserIds.push(userIdTh, userIdInvalid);

    cookieValue.mockReturnValue('th');
    await ensurePersonalWorkspace(userIdTh);
    const thRow = await db
      .select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userIdTh));
    expect(thRow[0]?.locale).toBe('th');

    cookieValue.mockReturnValue('fr'); // unsupported — must not violate the locale CHECK constraint
    await ensurePersonalWorkspace(userIdInvalid);
    const invalidRow = await db
      .select({ locale: userPreferences.locale })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userIdInvalid));
    expect(invalidRow[0]?.locale).toBe('en');

    cookieValue.mockReturnValue(undefined);
  });

  it('is idempotent: a second call for the same user creates nothing new', async () => {
    const userId = await createTestUser(db, `idempotent-${crypto.randomUUID()}@example.test`);
    createdUserIds.push(userId);

    const first = await ensurePersonalWorkspace(userId);
    const second = await ensurePersonalWorkspace(userId);
    expect(second.workspaceId).toBe(first.workspaceId);

    const workspaceRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    expect(workspaceRows).toHaveLength(1);

    const memberRows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    expect(memberRows).toHaveLength(1);
  });

  it('creates exactly one workspace under concurrent calls for the same user', async () => {
    const userId = await createTestUser(db, `concurrent-${crypto.randomUUID()}@example.test`);
    createdUserIds.push(userId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => ensurePersonalWorkspace(userId)),
    );

    const distinctWorkspaceIds = new Set(results.map((r) => r.workspaceId));
    expect(distinctWorkspaceIds.size).toBe(1);

    const workspaceRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    expect(workspaceRows).toHaveLength(1);

    const memberRows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));
    expect(memberRows).toHaveLength(1);
  });

  it('appends sanitized audit events for first-time provisioning', async () => {
    const userId = await createTestUser(db, `audit-${crypto.randomUUID()}@example.test`);
    createdUserIds.push(userId);

    await ensurePersonalWorkspace(userId);

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, userId));
    const actions = rows.map((row) => row.action).sort();
    expect(actions).toEqual(
      [
        'user_preferences.active_workspace_initialized',
        'workspace.personal_created',
        'workspace_member.owner_created',
      ].sort(),
    );

    // Never a token, secret, or header — only the plain values this module writes.
    for (const row of rows) {
      expect(JSON.stringify(row.metadata)).not.toMatch(/token|secret|password/i);
    }
  });
});
