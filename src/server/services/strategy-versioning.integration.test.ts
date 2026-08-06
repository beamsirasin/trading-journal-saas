import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  archiveSetup,
  createSetup,
  createStrategy,
  createStrategyRule,
} from './strategy-management';
import { lockStrategyVersionForReferenceInTx } from './strategy-versioning';

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

async function createWorkspace(db: Db, ownerUserId: string): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 06C versioning test workspace',
      slug: `p06c-ver-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
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

describe('strategy-versioning (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  const allWorkspaceIds: string[] = [];

  beforeAll(async () => {
    actorUserId = await createUser(db, 'p06c-ver-actor');
    workspaceId = await createWorkspace(db, actorUserId);
    otherWorkspaceId = await createWorkspace(db, actorUserId);
    allWorkspaceIds.push(workspaceId, otherWorkspaceId);
  });

  afterAll(async () => {
    for (const id of allWorkspaceIds) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await closeTestDb();
  });

  describe('copy correctness', () => {
    it('a copied Version faithfully duplicates two Setups (one archived), Strategy-level and Setup-level Rules, and leaves the source Version unchanged', async () => {
      const created = await createStrategy(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        name: 'Copy Source Strategy',
      });
      if (!created.ok) throw new Error('strategy creation failed');

      const setupA = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave 2 Reversal',
        sortOrder: 0,
      });
      const setupB = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave 3 Continuation',
        sortOrder: 1,
      });
      if (!setupA.ok || !setupB.ok) throw new Error('setup creation failed');

      const strategyRuleKey = crypto.randomUUID();
      const setupARuleKey = crypto.randomUUID();
      const setupBRuleKey = crypto.randomUUID();
      const strategyRule = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey: strategyRuleKey,
        category: 'risk',
        title: 'Strategy-level risk rule',
      });
      const setupARule = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey: setupARuleKey,
        setupId: setupA.setupId,
        category: 'entry',
        title: 'Setup A entry rule',
      });
      const setupBRule = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey: setupBRuleKey,
        setupId: setupB.setupId,
        category: 'entry',
        title: 'Setup B entry rule',
      });
      if (!strategyRule.ok || !setupARule.ok || !setupBRule.ok) {
        throw new Error('rule creation failed');
      }

      // Archive setup B's identity only AFTER its rule/snapshot already
      // exist — archiving blocks NEW mutations, it must never retroactively
      // remove history. Its snapshot and rule must still be copied below.
      await archiveSetup(workspaceId, actorUserId, created.strategyId, setupB.setupId);

      const sourceVersionId = created.versionId;

      // Lock the source version, then trigger copy-on-write via a content edit.
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, sourceVersionId));

      const { updateStrategyContent } = await import('./strategy-management');
      const updateResult = await updateStrategyContent(
        workspaceId,
        actorUserId,
        created.strategyId,
        {
          name: 'Copy Source Strategy',
          changeNote: 'Trigger a full copy for the correctness test',
        },
      );
      if (!updateResult.ok) throw new Error(`copy trigger failed: ${updateResult.code}`);
      const newVersionId = updateResult.versionId;
      expect(newVersionId).not.toBe(sourceVersionId);

      // --- Setup snapshots ---
      const oldSnapshots = await db
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.strategyVersionId, sourceVersionId));
      const newSnapshots = await db
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.strategyVersionId, newVersionId));

      expect(newSnapshots).toHaveLength(2);
      const newSetupIds = newSnapshots.map((s) => s.setupId).sort();
      expect(newSetupIds).toEqual([setupA.setupId, setupB.setupId].sort());

      // New setup-version row IDs, not the same as the old ones.
      const oldSnapshotIds = new Set(oldSnapshots.map((s) => s.id));
      for (const snap of newSnapshots) {
        expect(oldSnapshotIds.has(snap.id)).toBe(false);
      }

      const newSnapshotA = newSnapshots.find((s) => s.setupId === setupA.setupId);
      const newSnapshotB = newSnapshots.find((s) => s.setupId === setupB.setupId);
      expect(newSnapshotA?.name).toBe('Wave 2 Reversal');
      expect(newSnapshotB?.name).toBe('Wave 3 Continuation');

      // --- Rules ---
      const newRules = await db
        .select()
        .from(strategyRules)
        .where(eq(strategyRules.strategyVersionId, newVersionId));
      expect(newRules).toHaveLength(3);

      const oldRuleIds = new Set([strategyRule.ruleId, setupARule.ruleId, setupBRule.ruleId]);
      for (const rule of newRules) {
        // New Rule row IDs.
        expect(oldRuleIds.has(rule.id)).toBe(false);
      }
      const newRuleKeys = newRules.map((r) => r.ruleKey).sort();
      expect(newRuleKeys).toEqual([strategyRuleKey, setupARuleKey, setupBRuleKey].sort());

      const newStrategyRuleRow = newRules.find((r) => r.setupVersionId === null);
      expect(newStrategyRuleRow?.title).toBe('Strategy-level risk rule');

      const newSetupARuleRow = newRules.find((r) => r.setupVersionId === newSnapshotA?.id);
      const newSetupBRuleRow = newRules.find((r) => r.setupVersionId === newSnapshotB?.id);
      expect(newSetupARuleRow?.title).toBe('Setup A entry rule');
      expect(newSetupBRuleRow?.title).toBe('Setup B entry rule');

      // No new rule points at an old setup-version id.
      for (const rule of newRules) {
        if (rule.setupVersionId !== null) {
          expect(oldSnapshotIds.has(rule.setupVersionId)).toBe(false);
        }
      }

      // --- Old version unchanged ---
      const [oldVersionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, sourceVersionId));
      expect(oldVersionRow?.name).toBe('Copy Source Strategy');
      expect(oldVersionRow?.lockedAt).not.toBeNull();
      expect(oldSnapshots).toHaveLength(2);
      const oldRules = await db
        .select()
        .from(strategyRules)
        .where(eq(strategyRules.strategyVersionId, sourceVersionId));
      expect(oldRules).toHaveLength(3);
      const oldRuleRowIds = oldRules.map((r) => r.id).sort();
      expect(oldRuleRowIds).toEqual(
        [strategyRule.ruleId, setupARule.ruleId, setupBRule.ruleId].sort(),
      );
    });
  });

  describe('lockStrategyVersionForReferenceInTx', () => {
    async function createReady(ws: string = workspaceId) {
      const result = await createStrategy(ws, actorUserId, {
        mutationKey: crypto.randomUUID(),
        name: 'Lock Helper Strategy',
      });
      if (!result.ok) throw new Error('strategy creation failed');
      return result;
    }

    async function lockedEventsFor(versionId: string) {
      return db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'strategy.version.locked'), eq(auditLogs.entityId, versionId)),
        );
    }

    it('transitions locked_at from null to non-null and emits exactly one strategy.version.locked event with safe metadata only', async () => {
      const created = await createReady();
      const result = await db.transaction((tx) =>
        lockStrategyVersionForReferenceInTx(tx, {
          workspaceId,
          strategyId: created.strategyId,
          versionId: created.versionId,
          actorUserId,
        }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.lockedAt).toBeInstanceOf(Date);
      expect(result.versionNumber).toBe(1);

      const [row] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, created.versionId));
      expect(row?.lockedAt).not.toBeNull();

      const events = await lockedEventsFor(created.versionId);
      expect(events).toHaveLength(1);
      expect(events[0]?.workspaceId).toBe(workspaceId);
      expect(events[0]?.metadata).toEqual({
        strategyId: created.strategyId,
        strategyVersionId: created.versionId,
        versionNumber: 1,
      });
    });

    it('is idempotent — a repeated lock returns the same lockedAt rather than erroring, and emits no duplicate event', async () => {
      const created = await createReady();
      const first = await db.transaction((tx) =>
        lockStrategyVersionForReferenceInTx(tx, {
          workspaceId,
          strategyId: created.strategyId,
          versionId: created.versionId,
          actorUserId,
        }),
      );
      const second = await db.transaction((tx) =>
        lockStrategyVersionForReferenceInTx(tx, {
          workspaceId,
          strategyId: created.strategyId,
          versionId: created.versionId,
          actorUserId,
        }),
      );
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.lockedAt.getTime()).toBe(first.lockedAt.getTime());
      }

      const events = await lockedEventsFor(created.versionId);
      expect(events).toHaveLength(1);
    });

    it('rejects locking a non-current Version and emits no event', async () => {
      const created = await createReady();
      // Force a second version so created.versionId is no longer current.
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, created.versionId));
      const { updateStrategyContent } = await import('./strategy-management');
      const updated = await updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
        name: 'Lock Helper Strategy v2',
        changeNote: 'move current version forward',
      });
      if (!updated.ok) throw new Error('update failed');

      const result = await db.transaction((tx) =>
        lockStrategyVersionForReferenceInTx(tx, {
          workspaceId,
          strategyId: created.strategyId,
          versionId: created.versionId, // the now-superseded v1
          actorUserId,
        }),
      );
      expect(result).toMatchObject({ ok: false, code: 'strategy_current_version_missing' });

      const events = await lockedEventsFor(created.versionId);
      expect(events).toHaveLength(0);
    });

    it('rejects a Version from another workspace and emits no event', async () => {
      const inMain = await createReady(workspaceId);
      const inOther = await createReady(otherWorkspaceId);

      const result = await db.transaction((tx) =>
        lockStrategyVersionForReferenceInTx(tx, {
          workspaceId, // main workspace
          strategyId: inMain.strategyId,
          versionId: inOther.versionId, // belongs to otherWorkspaceId
          actorUserId,
        }),
      );
      expect(result).toMatchObject({ ok: false, code: 'strategy_current_version_missing' });

      const crossEvents = await lockedEventsFor(inOther.versionId);
      expect(crossEvents).toHaveLength(0);
      const mainEvents = await lockedEventsFor(inMain.versionId);
      expect(mainEvents).toHaveLength(0);
    });

    it('the database trigger still rejects a direct mutation after the helper locks a Version', async () => {
      const created = await createReady();
      await db.transaction((tx) =>
        lockStrategyVersionForReferenceInTx(tx, {
          workspaceId,
          strategyId: created.strategyId,
          versionId: created.versionId,
          actorUserId,
        }),
      );

      await expect(
        db
          .update(strategyVersions)
          .set({ name: 'Should be rejected' })
          .where(eq(strategyVersions.id, created.versionId)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
  });
});
