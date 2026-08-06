import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  strategies,
  strategyVersions,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import {
  archiveSetup,
  archiveStrategy,
  createSetup,
  createStrategy,
  createStrategyRule,
  updateStrategyContent,
} from '@/server/services/strategy-management';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';

/**
 * Exercises Phase 06D's authenticated reads (`src/server/dal/strategies.ts`)
 * against a real, disposable database — the same session-mocking pattern
 * `trading-account-management.integration.test.ts` established: only Better
 * Auth's own session-resolution step is mocked, so `getActiveWorkspaceContext`
 * itself runs for real, including its membership/active-workspace lookup.
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

const { getWorkspaceStrategyDetail, listWorkspaceStrategies } = await import('./strategies');

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

type Db = ReturnType<typeof getTestDb>;

async function createUser(db: Db, label: string): Promise<string> {
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

async function createWorkspaceWithOwner(db: Db, ownerUserId: string): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 06D DAL test workspace',
      slug: `p06d-dal-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(userPreferences).values({ userId: ownerUserId, activeWorkspaceId: workspace.id });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return workspace.id;
}

const workspaceIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  currentSession = null;
});

afterAll(async () => {
  const db = getTestDb();
  for (const id of workspaceIds.splice(0)) {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  for (const id of userIds.splice(0)) {
    await db.delete(users).where(eq(users.id, id));
  }
  await closeDb();
  await closeTestDb();
});

describe('listWorkspaceStrategies (real PostgreSQL)', () => {
  const db = getTestDb();

  it('returns an empty list for a workspace with no strategies', async () => {
    const userId = await createUser(db, 'p06d-dal-empty');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const result = await listWorkspaceStrategies();
    expect(result).toEqual({ ok: true, strategies: [] });
  });

  it('lists a Strategy with its current Version, Setup counts and Rule count, never exposing mutationKey/workspaceId', async () => {
    const userId = await createUser(db, 'p06d-dal-basic');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const created = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Trend Following',
      description: 'Ride the trend',
      notes: null,
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.code}`);

    const setup = await createSetup(workspaceId, userId, created.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'Pullback entry',
      description: null,
      sortOrder: 0,
      changeNote: null,
    });
    if (!setup.ok) throw new Error(`fixture failed: ${setup.code}`);

    const rule = await createStrategyRule(workspaceId, userId, created.strategyId, {
      ruleKey: crypto.randomUUID(),
      setupId: null,
      category: 'entry',
      title: 'Confirm higher high',
      description: null,
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: 0,
      changeNote: null,
    });
    if (!rule.ok) throw new Error(`fixture failed: ${rule.code}`);

    const result = await listWorkspaceStrategies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategies).toHaveLength(1);
    const item = result.strategies[0];
    expect(item).toMatchObject({
      strategyId: created.strategyId,
      isStrategyArchived: false,
      currentVersion: {
        name: 'Trend Following',
        description: 'Ride the trend',
        versionNumber: 1,
        isCurrentVersionLocked: false,
      },
      setupCounts: { total: 1, effectiveAvailable: 1, individuallyArchived: 0 },
      ruleCount: 1,
    });
    // Structural boundary: never expose mutationKey/workspaceId on a read model.
    expect(JSON.stringify(item)).not.toContain('mutationKey');
    expect(JSON.stringify(item)).not.toContain('workspaceId');
  });

  it('zeroes effectiveAvailable Setup count when the Strategy itself is archived', async () => {
    const userId = await createUser(db, 'p06d-dal-archived-strategy');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const created = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Archived Strategy',
      description: null,
      notes: null,
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.code}`);
    const setup = await createSetup(workspaceId, userId, created.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'Setup A',
      description: null,
      sortOrder: 0,
      changeNote: null,
    });
    if (!setup.ok) throw new Error(`fixture failed: ${setup.code}`);

    const archived = await archiveStrategy(workspaceId, userId, created.strategyId);
    expect(archived.ok).toBe(true);

    const result = await listWorkspaceStrategies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.strategies.find((s) => s.strategyId === created.strategyId);
    expect(item?.isStrategyArchived).toBe(true);
    expect(item?.setupCounts).toEqual({ total: 1, effectiveAvailable: 0, individuallyArchived: 0 });
  });

  it('subtracts only individually archived Setups from effectiveAvailable when the Strategy stays active', async () => {
    const userId = await createUser(db, 'p06d-dal-archived-setup');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const created = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Mixed Setups',
      description: null,
      notes: null,
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.code}`);
    const setupA = await createSetup(workspaceId, userId, created.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'Setup A',
      description: null,
      sortOrder: 0,
      changeNote: null,
    });
    const setupB = await createSetup(workspaceId, userId, created.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'Setup B',
      description: null,
      sortOrder: 1,
      changeNote: null,
    });
    if (!setupA.ok || !setupB.ok) throw new Error('fixture failed');
    const archived = await archiveSetup(workspaceId, userId, created.strategyId, setupA.setupId);
    expect(archived.ok).toBe(true);

    const result = await listWorkspaceStrategies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.strategies.find((s) => s.strategyId === created.strategyId);
    expect(item?.setupCounts).toEqual({ total: 2, effectiveAvailable: 1, individuallyArchived: 1 });
  });

  it('sorts non-archived Strategies before archived ones, then by updatedAt descending', async () => {
    const userId = await createUser(db, 'p06d-dal-sort');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const older = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Older',
      description: null,
      notes: null,
    });
    const newer = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Newer',
      description: null,
      notes: null,
    });
    const toArchive = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Will be archived',
      description: null,
      notes: null,
    });
    if (!older.ok || !newer.ok || !toArchive.ok) throw new Error('fixture failed');

    // Bump `newer`'s updatedAt strictly after `older`'s by editing its content.
    const bumped = await updateStrategyContent(workspaceId, userId, newer.strategyId, {
      name: 'Newer (edited)',
      description: null,
      notes: null,
      changeNote: null,
    });
    expect(bumped.ok).toBe(true);
    const archived = await archiveStrategy(workspaceId, userId, toArchive.strategyId);
    expect(archived.ok).toBe(true);

    const result = await listWorkspaceStrategies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.strategies.map((s) => s.strategyId);
    // Archived strategy must sort after both active ones regardless of its updatedAt.
    expect(ids.indexOf(toArchive.strategyId)).toBe(ids.length - 1);
    // Among active strategies, the more recently updated one sorts first.
    expect(ids.indexOf(newer.strategyId)).toBeLessThan(ids.indexOf(older.strategyId));
  });

  it('fails closed with strategy_current_version_missing when a Strategy has a null current_version_id', async () => {
    const userId = await createUser(db, 'p06d-dal-malformed');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const created = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Corrupt me',
      description: null,
      notes: null,
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.code}`);

    // No trigger protects the `strategies` table itself — only
    // `strategy_versions`/`setups`/`strategy_rules` deletion/mutation are
    // guarded — so this direct corruption is reachable in principle and must
    // fail closed rather than crash or silently drop the row.
    await db
      .update(strategies)
      .set({ currentVersionId: null })
      .where(eq(strategies.id, created.strategyId));

    const result = await listWorkspaceStrategies();
    expect(result).toEqual({ ok: false, code: 'strategy_current_version_missing' });
  });

  it('only ever returns Strategies scoped to the caller’s active workspace', async () => {
    const userId = await createUser(db, 'p06d-dal-scope-a');
    const otherUserId = await createUser(db, 'p06d-dal-scope-b');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    const otherWorkspaceId = await createWorkspaceWithOwner(db, otherUserId);
    userIds.push(userId, otherUserId);
    workspaceIds.push(workspaceId, otherWorkspaceId);

    currentSession = sessionFor(otherUserId);
    const otherCreated = await createStrategy(otherWorkspaceId, otherUserId, {
      mutationKey: crypto.randomUUID(),
      name: 'Other workspace strategy',
      description: null,
      notes: null,
    });
    if (!otherCreated.ok) throw new Error(`fixture failed: ${otherCreated.code}`);

    currentSession = sessionFor(userId);
    const result = await listWorkspaceStrategies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategies.find((s) => s.strategyId === otherCreated.strategyId)).toBeUndefined();
  });
});

describe('getWorkspaceStrategyDetail (real PostgreSQL)', () => {
  const db = getTestDb();

  it('returns strategy_not_found for a missing id and for a cross-workspace id identically', async () => {
    const userId = await createUser(db, 'p06d-dal-detail-notfound');
    const otherUserId = await createUser(db, 'p06d-dal-detail-other');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    const otherWorkspaceId = await createWorkspaceWithOwner(db, otherUserId);
    userIds.push(userId, otherUserId);
    workspaceIds.push(workspaceId, otherWorkspaceId);

    currentSession = sessionFor(otherUserId);
    const otherStrategy = await createStrategy(otherWorkspaceId, otherUserId, {
      mutationKey: crypto.randomUUID(),
      name: 'Not mine',
      description: null,
      notes: null,
    });
    if (!otherStrategy.ok) throw new Error(`fixture failed: ${otherStrategy.code}`);

    currentSession = sessionFor(userId);
    const missing = await getWorkspaceStrategyDetail(crypto.randomUUID());
    const crossWorkspace = await getWorkspaceStrategyDetail(otherStrategy.strategyId);
    expect(missing).toEqual({ ok: false, code: 'strategy_not_found' });
    expect(crossWorkspace).toEqual({ ok: false, code: 'strategy_not_found' });
  });

  it('groups current-Version Rules Strategy-level vs Setup-level and reports effective Setup availability', async () => {
    const userId = await createUser(db, 'p06d-dal-detail-groups');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const created = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Grouping test',
      description: null,
      notes: null,
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.code}`);
    const setup = await createSetup(workspaceId, userId, created.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'Retest setup',
      description: null,
      sortOrder: 0,
      changeNote: null,
    });
    if (!setup.ok) throw new Error(`fixture failed: ${setup.code}`);

    const strategyLevelRule = await createStrategyRule(workspaceId, userId, created.strategyId, {
      ruleKey: crypto.randomUUID(),
      setupId: null,
      category: 'risk',
      title: 'Risk 1% max',
      description: null,
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: 0,
      changeNote: null,
    });
    const setupLevelRule = await createStrategyRule(workspaceId, userId, created.strategyId, {
      ruleKey: crypto.randomUUID(),
      setupId: setup.setupId,
      category: 'entry',
      title: 'Confirm retest',
      description: null,
      isRequired: true,
      isPreTradeCheck: false,
      sortOrder: 0,
      changeNote: null,
    });
    if (!strategyLevelRule.ok || !setupLevelRule.ok) throw new Error('fixture failed');
    await archiveSetup(workspaceId, userId, created.strategyId, setup.setupId);

    const result = await getWorkspaceStrategyDetail(created.strategyId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.strategyLevelRules).toHaveLength(1);
    expect(result.strategy.strategyLevelRules[0]?.title).toBe('Risk 1% max');
    expect(result.strategy.setupLevelRulesBySetupId[setup.setupId]).toHaveLength(1);
    expect(result.strategy.setupLevelRulesBySetupId[setup.setupId]?.[0]?.title).toBe(
      'Confirm retest',
    );
    const setupDetail = result.strategy.setups.find((s) => s.setupId === setup.setupId);
    expect(setupDetail?.isSetupArchived).toBe(true);
    expect(setupDetail?.isEffectivelyAvailable).toBe(false);
  });

  it('reports a lightweight Version history after a locked Version is copied forward', async () => {
    const userId = await createUser(db, 'p06d-dal-detail-history');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);

    const created = await createStrategy(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      name: 'Versioned strategy',
      description: null,
      notes: null,
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.code}`);

    // Simulate a future Phase 08 Trade referencing Version 1 by locking it
    // directly — nothing in Phase 06 itself locks a Version yet.
    await db
      .update(strategyVersions)
      .set({ lockedAt: new Date() })
      .where(eq(strategyVersions.id, created.versionId));

    const updated = await updateStrategyContent(workspaceId, userId, created.strategyId, {
      name: 'Versioned strategy v2',
      description: null,
      notes: null,
      changeNote: 'Tightened entry rule',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.copied).toBe(true);
    expect(updated.versionNumber).toBe(2);

    const result = await getWorkspaceStrategyDetail(created.strategyId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strategy.versionCount).toBe(2);
    expect(result.strategy.versionHistory).toHaveLength(2);
    // Newest version first.
    expect(result.strategy.versionHistory[0]).toMatchObject({
      versionNumber: 2,
      isLocked: false,
      changeNote: 'Tightened entry rule',
    });
    expect(result.strategy.versionHistory[1]).toMatchObject({ versionNumber: 1, isLocked: true });
  });
});
