import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateAccountData, UpdateAccountData } from '@/lib/trading-accounts/schema';
import {
  auditLogs,
  tradingAccounts,
  userPreferences,
  users,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

/**
 * Exercises Phase 3B's account-management mutations
 * (`src/server/services/trading-account-management.ts`) against a real,
 * disposable database — the same mocking pattern
 * `trading-account.integration.test.ts` already established: only Better
 * Auth's own session-resolution step is mocked.
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

const { getActiveTradingAccount } = await import('@/server/auth/dal');
const {
  archiveTradingAccount,
  createTradingAccount,
  restoreTradingAccount,
  setActiveTradingAccount,
  updateTradingAccount,
} = await import('./trading-account-management');

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

/** Seeds an account directly (bypassing the service under test) — the workspace's first, always-active usable account for setup. */
async function seedAccount(
  db: ReturnType<typeof getTestDb>,
  workspaceId: string,
  overrides: { name?: string; isArchived?: boolean } = {},
) {
  const [account] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name: overrides.name ?? 'Seed Account',
      accountMode: 'live',
      baseCurrency: 'USD',
      startingBalance: '10000',
      timezone: 'UTC',
      isArchived: overrides.isArchived ?? false,
    })
    .returning({ id: tradingAccounts.id });
  if (account === undefined) throw new Error('failed to seed account');
  return account.id;
}

async function activateAccount(
  db: ReturnType<typeof getTestDb>,
  userId: string,
  accountId: string,
) {
  await db
    .update(userPreferences)
    .set({ activeTradingAccountId: accountId })
    .where(eq(userPreferences.userId, userId));
}

const VALID_INPUT: CreateAccountData = {
  name: 'Second Account',
  accountMode: 'demo',
  baseCurrency: 'EUR',
  startingBalance: '5000',
  timezone: 'Asia/Bangkok',
  riskPerTradePercent: '2',
  maximumDailyLossPercent: '4',
  mutationKey: crypto.randomUUID(),
  setActive: false,
};

describe('trading-account-management (real database)', () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    currentSession = null;
    const db = getTestDb();
    for (const userId of createdUserIds.splice(0)) {
      // Cascades to workspaces/workspace_members/user_preferences/trading_accounts.
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await closeTestDb();
  });

  describe('createTradingAccount', () => {
    it('creates an additional account belonging to the active workspace', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const firstAccountId = await seedAccount(db, workspaceId);
      await activateAccount(db, userId, firstAccountId);

      const result = await createTradingAccount(workspaceId, userId, VALID_INPUT);

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(2);
      const created = accounts.find((account) => account.id === result.accountId);
      expect(created?.workspaceId).toBe(workspaceId);
      expect(created?.name).toBe(VALID_INPUT.name);
    });

    it('does not replace the active account by default', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const firstAccountId = await seedAccount(db, workspaceId);
      await activateAccount(db, userId, firstAccountId);

      await createTradingAccount(workspaceId, userId, VALID_INPUT);

      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(firstAccountId);
    });

    it('create-and-activate sets the new account active atomically', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const firstAccountId = await seedAccount(db, workspaceId);
      await activateAccount(db, userId, firstAccountId);

      const result = await createTradingAccount(workspaceId, userId, {
        ...VALID_INPUT,
        setActive: true,
      });

      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(result.accountId);

      const activatedLogs = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'trading_account.activated'),
          ),
        );
      expect(activatedLogs).toHaveLength(1);
    });

    it('the same mutation key creates exactly one account and returns it on replay', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const mutationKey = crypto.randomUUID();

      const first = await createTradingAccount(workspaceId, userId, {
        ...VALID_INPUT,
        mutationKey,
      });
      const second = await createTradingAccount(workspaceId, userId, {
        ...VALID_INPUT,
        name: 'A Different Name',
        mutationKey,
      });

      expect(second.accountId).toBe(first.accountId);
      expect(second.alreadyCreated).toBe(true);

      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(1);
      expect(accounts[0]?.name).toBe(VALID_INPUT.name);
    });

    it('two truly different mutation keys create two distinct accounts, even submitted concurrently', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);

      const [resultA, resultB] = await Promise.all([
        createTradingAccount(workspaceId, userId, {
          ...VALID_INPUT,
          mutationKey: crypto.randomUUID(),
        }),
        createTradingAccount(workspaceId, userId, {
          ...VALID_INPUT,
          mutationKey: crypto.randomUUID(),
        }),
      ]);

      expect(resultA.accountId).not.toBe(resultB.accountId);
      const accounts = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.workspaceId, workspaceId));
      expect(accounts).toHaveLength(2);
    });

    it('records a trading_account.created audit entry with no financial values', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);

      const result = await createTradingAccount(workspaceId, userId, VALID_INPUT);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'trading_account.created'),
          ),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBe(result.accountId);
      const serialized = JSON.stringify(rows[0]?.metadata ?? {});
      expect(serialized).not.toContain(VALID_INPUT.startingBalance);
      expect(serialized).not.toContain(VALID_INPUT.riskPerTradePercent!);
      expect(serialized).not.toContain(VALID_INPUT.name);
    });
  });

  describe('updateTradingAccount', () => {
    it('updates only the authorized account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const accountId = await seedAccount(db, workspaceId, { name: 'Original Name' });
      const otherAccountId = await seedAccount(db, workspaceId, { name: 'Untouched Account' });

      const input: UpdateAccountData = {
        name: 'Renamed Account',
        accountMode: 'demo',
        baseCurrency: 'EUR',
        startingBalance: '7000',
        timezone: 'UTC',
      };
      const result = await updateTradingAccount(workspaceId, userId, accountId, input);

      expect(result.ok).toBe(true);
      const [updated] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, accountId));
      expect(updated?.name).toBe('Renamed Account');
      const [untouched] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, otherAccountId));
      expect(untouched?.name).toBe('Untouched Account');
    });

    it("rejects updating another workspace's account", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);
      const accountBId = await seedAccount(db, workspaceB, { name: "B's Account" });

      const result = await updateTradingAccount(workspaceA, userA, accountBId, {
        name: 'Hijacked Name',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '1',
        timezone: 'UTC',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not_found');
      const [untouched] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, accountBId));
      expect(untouched?.name).toBe("B's Account");
    });

    it('records only changed field names in the audit entry, never balance or percentage values', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const accountId = await seedAccount(db, workspaceId, { name: 'Original Name' });

      await updateTradingAccount(workspaceId, userId, accountId, {
        name: 'Renamed Account',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '999999.5',
        timezone: 'UTC',
        riskPerTradePercent: '42',
      });

      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'trading_account.updated'),
          ),
        );
      expect(rows).toHaveLength(1);
      const serialized = JSON.stringify(rows[0]?.metadata ?? {});
      expect(serialized).not.toContain('999999.5');
      expect(serialized).not.toContain('42');
      expect(rows[0]?.metadata).toMatchObject({
        changedFields: expect.arrayContaining(['name', 'startingBalance', 'riskPerTradePercent']),
      });
    });
  });

  describe('setActiveTradingAccount', () => {
    it('persists the change for the user/workspace', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const firstAccountId = await seedAccount(db, workspaceId, { name: 'First' });
      const secondAccountId = await seedAccount(db, workspaceId, { name: 'Second' });
      await activateAccount(db, userId, firstAccountId);

      const result = await setActiveTradingAccount(workspaceId, userId, secondAccountId);

      expect(result.ok).toBe(true);
      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(secondAccountId);
    });

    it("rejects activating another workspace's account", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);
      const accountAId = await seedAccount(db, workspaceA);
      const accountBId = await seedAccount(db, workspaceB);
      await activateAccount(db, userA, accountAId);

      const result = await setActiveTradingAccount(workspaceA, userA, accountBId);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not_found');
      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userA));
      expect(preference[0]?.activeTradingAccountId).toBe(accountAId);
    });

    it('rejects activating an archived account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const archivedId = await seedAccount(db, workspaceId, { name: 'Archived', isArchived: true });
      await activateAccount(db, userId, activeId);

      const result = await setActiveTradingAccount(workspaceId, userId, archivedId);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('archived');
      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(activeId);
    });

    it('two simultaneous switches to different accounts produce one valid final active account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const accountAId = await seedAccount(db, workspaceId, { name: 'A' });
      const accountBId = await seedAccount(db, workspaceId, { name: 'B' });
      await activateAccount(db, userId, accountAId);

      const results = await Promise.all([
        setActiveTradingAccount(workspaceId, userId, accountAId),
        setActiveTradingAccount(workspaceId, userId, accountBId),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect([accountAId, accountBId]).toContain(preference[0]?.activeTradingAccountId);
    });
  });

  describe('archiveTradingAccount', () => {
    it('archives a non-active account without touching the active preference', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const otherId = await seedAccount(db, workspaceId, { name: 'Other' });
      await activateAccount(db, userId, activeId);

      const result = await archiveTradingAccount(workspaceId, userId, otherId);

      expect(result.ok).toBe(true);
      const [archived] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, otherId));
      expect(archived?.isArchived).toBe(true);
      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(activeId);
    });

    it('archiving the active account chooses the deterministic (oldest) fallback atomically', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const oldestId = await seedAccount(db, workspaceId, { name: 'Oldest' });
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      await activateAccount(db, userId, activeId);

      const result = await archiveTradingAccount(workspaceId, userId, activeId);

      expect(result.ok).toBe(true);
      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(oldestId);
      const [archived] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, activeId));
      expect(archived?.isArchived).toBe(true);
    });

    it('rejects archiving the final usable account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const onlyId = await seedAccount(db, workspaceId);
      await activateAccount(db, userId, onlyId);

      const result = await archiveTradingAccount(workspaceId, userId, onlyId);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('last_account');
      const [account] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, onlyId));
      expect(account?.isArchived).toBe(false);
    });

    it('repeated archive of the same account is safe (idempotent no-op)', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const otherId = await seedAccount(db, workspaceId, { name: 'Other' });
      await activateAccount(db, userId, activeId);

      const first = await archiveTradingAccount(workspaceId, userId, otherId);
      const second = await archiveTradingAccount(workspaceId, userId, otherId);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'trading_account.archived'),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it("rejects archiving another workspace's account", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);
      const accountBId = await seedAccount(db, workspaceB);

      const result = await archiveTradingAccount(workspaceA, userA, accountBId);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not_found');
      const [account] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, accountBId));
      expect(account?.isArchived).toBe(false);
    });

    it('two archive requests for the same non-final account leave exactly one archived, no error', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const otherId = await seedAccount(db, workspaceId, { name: 'Other' });
      await activateAccount(db, userId, activeId);

      const results = await Promise.all([
        archiveTradingAccount(workspaceId, userId, otherId),
        archiveTradingAccount(workspaceId, userId, otherId),
      ]);

      expect(results.every((result) => result.ok)).toBe(true);
      const [account] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, otherId));
      expect(account?.isArchived).toBe(true);
    });

    it('two concurrent requests to archive the final usable account both reject, and the workspace keeps one usable account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const onlyId = await seedAccount(db, workspaceId);
      await activateAccount(db, userId, onlyId);

      const results = await Promise.all([
        archiveTradingAccount(workspaceId, userId, onlyId),
        archiveTradingAccount(workspaceId, userId, onlyId),
      ]);

      expect(results.every((result) => !result.ok)).toBe(true);
      const remaining = await db
        .select()
        .from(tradingAccounts)
        .where(
          and(eq(tradingAccounts.workspaceId, workspaceId), eq(tradingAccounts.isArchived, false)),
        );
      expect(remaining).toHaveLength(1);
    });

    it('switching active while another request archives that same account preserves a valid active account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const fallbackId = await seedAccount(db, workspaceId, { name: 'Fallback' });
      const targetId = await seedAccount(db, workspaceId, { name: 'Target' });
      await activateAccount(db, userId, targetId);

      await Promise.allSettled([
        archiveTradingAccount(workspaceId, userId, targetId),
        setActiveTradingAccount(workspaceId, userId, targetId),
      ]);

      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      const activeId = preference[0]?.activeTradingAccountId;
      expect(activeId).not.toBeNull();
      const [activeAccountRow] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, activeId!));
      // Whatever ended up active, it must genuinely be usable — never the
      // archived account itself.
      expect(activeAccountRow?.isArchived).toBe(false);
      expect([fallbackId, targetId]).toContain(activeId);
    });
  });

  describe('restoreTradingAccount', () => {
    it('restores an archived account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const archivedId = await seedAccount(db, workspaceId, { name: 'Archived', isArchived: true });
      await activateAccount(db, userId, activeId);

      const result = await restoreTradingAccount(workspaceId, userId, archivedId);

      expect(result.ok).toBe(true);
      const [restored] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, archivedId));
      expect(restored?.isArchived).toBe(false);
    });

    it('does not replace a valid active account', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const archivedId = await seedAccount(db, workspaceId, { name: 'Archived', isArchived: true });
      await activateAccount(db, userId, activeId);

      await restoreTradingAccount(workspaceId, userId, archivedId);

      const preference = await db
        .select({ activeTradingAccountId: userPreferences.activeTradingAccountId })
        .from(userPreferences)
        .where(eq(userPreferences.userId, userId));
      expect(preference[0]?.activeTradingAccountId).toBe(activeId);
    });

    it('repeated restore is safe (idempotent no-op)', async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const activeId = await seedAccount(db, workspaceId, { name: 'Active' });
      const archivedId = await seedAccount(db, workspaceId, { name: 'Archived', isArchived: true });
      await activateAccount(db, userId, activeId);

      const first = await restoreTradingAccount(workspaceId, userId, archivedId);
      const second = await restoreTradingAccount(workspaceId, userId, archivedId);

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      const rows = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            eq(auditLogs.action, 'trading_account.restored'),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it("rejects restoring another workspace's account", async () => {
      const db = getTestDb();
      const userA = await createUser(db, 'user-a');
      const userB = await createUser(db, 'user-b');
      createdUserIds.push(userA, userB);
      const workspaceA = await createWorkspaceWithOwner(db, userA);
      const workspaceB = await createWorkspaceWithOwner(db, userB);
      const archivedBId = await seedAccount(db, workspaceB, { isArchived: true });

      const result = await restoreTradingAccount(workspaceA, userA, archivedBId);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not_found');
      const [account] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, archivedBId));
      expect(account?.isArchived).toBe(true);
    });

    it("getActiveTradingAccount's repair may select a restored account when no valid active account exists", async () => {
      const db = getTestDb();
      const userId = await createUser(db, 'owner');
      createdUserIds.push(userId);
      const workspaceId = await createWorkspaceWithOwner(db, userId);
      const onlyId = await seedAccount(db, workspaceId, { isArchived: true });
      // No active preference set at all — simulates the recovery state.

      await restoreTradingAccount(workspaceId, userId, onlyId);
      currentSession = sessionFor(userId);
      const activeAccount = await getActiveTradingAccount();

      expect(activeAccount?.id).toBe(onlyId);
    });
  });

  describe('removed membership', () => {
    it('invalidates every mutation for the removed member', async () => {
      const db = getTestDb();
      const ownerUserId = await createUser(db, 'owner');
      const removedUserId = await createUser(db, 'removed');
      createdUserIds.push(ownerUserId, removedUserId);
      const workspaceId = await createWorkspaceWithOwner(db, ownerUserId);
      const accountId = await seedAccount(db, workspaceId);
      await activateAccount(db, ownerUserId, accountId);

      // The removed user was never actually a member of this workspace at
      // all — the same effective condition as a real membership row being
      // deleted (`status <> 'active'`), verified directly against the
      // `workspace_members` predicate every mutation re-checks.
      await expect(
        createTradingAccount(workspaceId, removedUserId, {
          ...VALID_INPUT,
          mutationKey: crypto.randomUUID(),
        }),
      ).rejects.toThrow();
      await expect(
        updateTradingAccount(workspaceId, removedUserId, accountId, {
          name: 'Hijacked',
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '1',
          timezone: 'UTC',
        }),
      ).rejects.toThrow();
      await expect(
        setActiveTradingAccount(workspaceId, removedUserId, accountId),
      ).rejects.toThrow();
      await expect(archiveTradingAccount(workspaceId, removedUserId, accountId)).rejects.toThrow();
      await expect(restoreTradingAccount(workspaceId, removedUserId, accountId)).rejects.toThrow();

      const [account] = await db
        .select()
        .from(tradingAccounts)
        .where(eq(tradingAccounts.id, accountId));
      expect(account?.name).not.toBe('Hijacked');
    });
  });
});
