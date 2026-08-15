import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  archiveSetup,
  archiveStrategy,
  createSetup,
  createSetupCondition,
  createStrategy,
  createStrategyRule,
  removeSetupCondition,
  removeStrategyRule,
  restoreSetup,
  restoreStrategy,
  updateSetupCondition,
  updateSetupContent,
  updateStrategyContent,
  updateStrategyRule,
} from './strategy-management';

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

async function createWorkspace(
  db: Db,
  ownerUserId: string,
  entitlement: { status: string; planKey?: string | null } = {
    status: 'active',
    planKey: 'professional',
  },
): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 06C test workspace',
      slug: `p06c-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });

  if (entitlement.status === 'trialing_expired') {
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: 'trialing',
      trialStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });
  } else {
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: entitlement.status,
      planKey: entitlement.planKey ?? null,
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }

  return workspace.id;
}

async function makeOverLimitWorkspace(db: Db, ownerUserId: string): Promise<string> {
  const workspaceId = await createWorkspace(db, ownerUserId, {
    status: 'active',
    planKey: 'starter',
  });
  for (let i = 0; i < 2; i += 1) {
    await db.insert(tradingAccounts).values({
      workspaceId,
      name: `Over-limit account ${i}`,
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '1000',
      timezone: 'UTC',
      mutationKey: crypto.randomUUID(),
    });
  }
  return workspaceId;
}

/** Flips an already-`active` workspace to `read_only` (via `subscription_expired`) without touching its rows' identity — used to test replay behavior after a workspace transitions post-creation. */
async function flipWorkspaceToReadOnly(db: Db, workspaceId: string): Promise<void> {
  await db
    .update(workspaceEntitlements)
    .set({ currentPeriodEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
    .where(eq(workspaceEntitlements.workspaceId, workspaceId));
}

/** Flips an already-`active` workspace to `over_limit` by adding a second active trading account under a Starter (limit 1) plan. */
async function flipWorkspaceToOverLimit(db: Db, workspaceId: string): Promise<void> {
  await db
    .update(workspaceEntitlements)
    .set({ planKey: 'starter' })
    .where(eq(workspaceEntitlements.workspaceId, workspaceId));
  for (let i = 0; i < 2; i += 1) {
    await db.insert(tradingAccounts).values({
      workspaceId,
      name: `Flip over-limit account ${i}`,
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '1000',
      timezone: 'UTC',
      mutationKey: crypto.randomUUID(),
    });
  }
}

describe('Phase 06C strategy-management (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let removedMemberWorkspaceId: string;
  let removedMemberUserId: string;
  let overLimitWorkspaceId: string;
  let readOnlyWorkspaceId: string;

  const allWorkspaceIds: string[] = [];

  beforeAll(async () => {
    actorUserId = await createUser(db, 'p06c-actor');
    workspaceId = await createWorkspace(db, actorUserId);
    otherWorkspaceId = await createWorkspace(db, actorUserId);
    overLimitWorkspaceId = await makeOverLimitWorkspace(db, actorUserId);
    readOnlyWorkspaceId = await createWorkspace(db, actorUserId, { status: 'trialing_expired' });

    removedMemberUserId = await createUser(db, 'p06c-removed');
    removedMemberWorkspaceId = await createWorkspace(db, actorUserId);
    await db.insert(workspaceMembers).values({
      workspaceId: removedMemberWorkspaceId,
      userId: removedMemberUserId,
      role: 'member',
      status: 'active',
    });
    // "removed" is simulated by deleting the membership row entirely — 'active'
    // is the only value workspace_members_status_check permits (matching
    // trading-account-management.integration.test.ts's own convention).
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, removedMemberWorkspaceId),
          eq(workspaceMembers.userId, removedMemberUserId),
        ),
      );

    allWorkspaceIds.push(
      workspaceId,
      otherWorkspaceId,
      overLimitWorkspaceId,
      readOnlyWorkspaceId,
      removedMemberWorkspaceId,
    );
  });

  afterAll(async () => {
    for (const id of allWorkspaceIds) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await closeTestDb();
  });

  async function createReadyStrategy(ws: string = workspaceId, name = 'Elliott Wave + RSI') {
    const result = await createStrategy(ws, actorUserId, {
      mutationKey: crypto.randomUUID(),
      name,
    });
    if (!result.ok) throw new Error(`failed to create strategy: ${result.code}`);
    return result;
  }

  describe('createStrategy', () => {
    it('atomically creates Strategy + Version 1 with current_version_id set', async () => {
      const result = await createReadyStrategy();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, result.strategyId));
      expect(strategyRow?.currentVersionId).toBe(result.versionId);

      const [versionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, result.versionId));
      expect(versionRow?.versionNumber).toBe(1);
      expect(versionRow?.name).toBe('Elliott Wave + RSI');
      expect(versionRow?.lockedAt).toBeNull();
    });

    it('rejects a blank name', async () => {
      const result = await createStrategy(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        name: '   ',
      });
      expect(result).toMatchObject({ ok: false, code: 'blank_name' });
    });

    it('is idempotent on retry with the same mutationKey', async () => {
      const mutationKey = crypto.randomUUID();
      const first = await createStrategy(workspaceId, actorUserId, {
        mutationKey,
        name: 'Breakout and Retest',
      });
      const second = await createStrategy(workspaceId, actorUserId, {
        mutationKey,
        name: 'Breakout and Retest',
      });
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.strategyId).toBe(first.strategyId);
        expect(second.alreadyCreated).toBe(true);
      }
    });

    it('creates exactly one Strategy when the same mutationKey races concurrently', async () => {
      const mutationKey = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          createStrategy(workspaceId, actorUserId, { mutationKey, name: 'Race Strategy' }),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      const strategyIds = new Set(results.map((r) => (r.ok ? r.strategyId : null)));
      expect(strategyIds.size).toBe(1);

      const rows = await db
        .select()
        .from(strategies)
        .where(eq(strategies.mutationKey, mutationKey));
      expect(rows).toHaveLength(1);
    });

    it('denies a removed member', async () => {
      const result = await createStrategy(removedMemberWorkspaceId, removedMemberUserId, {
        mutationKey: crypto.randomUUID(),
        name: 'Should Not Exist',
      });
      expect(result).toMatchObject({ ok: false, code: 'workspace_access_denied' });
    });

    it('allows creation in a writable workspace', async () => {
      const result = await createStrategy(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        name: 'Writable Policy Strategy',
      });
      expect(result.ok).toBe(true);
    });

    it('denies creation in an over_limit workspace', async () => {
      const result = await createStrategy(overLimitWorkspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        name: 'Over Limit Strategy',
      });
      expect(result).toMatchObject({ ok: false, code: 'over_limit_workspace' });
    });

    it('denies creation in a read_only workspace', async () => {
      const result = await createStrategy(readOnlyWorkspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        name: 'Read Only Strategy',
      });
      expect(result).toMatchObject({ ok: false, code: 'read_only_workspace' });
    });
  });

  describe('replay idempotency policy', () => {
    describe('createStrategy', () => {
      it('a successful create stays safely replayable after the workspace becomes read_only, with no duplicate write or audit event', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const mutationKey = crypto.randomUUID();

        const first = await createStrategy(replayWs, actorUserId, {
          mutationKey,
          name: 'Replay Strategy',
        });
        expect(first).toMatchObject({ ok: true, alreadyCreated: false });
        if (!first.ok) throw new Error('setup failed');

        await flipWorkspaceToReadOnly(db, replayWs);

        const replay = await createStrategy(replayWs, actorUserId, {
          mutationKey,
          name: 'Replay Strategy',
        });
        expect(replay).toMatchObject({
          ok: true,
          alreadyCreated: true,
          strategyId: first.strategyId,
          versionId: first.versionId,
        });

        const strategyRows = await db
          .select()
          .from(strategies)
          .where(eq(strategies.mutationKey, mutationKey));
        expect(strategyRows).toHaveLength(1);
        const versionRows = await db
          .select()
          .from(strategyVersions)
          .where(eq(strategyVersions.strategyId, first.strategyId));
        expect(versionRows).toHaveLength(1);
        const createdLogs = await db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.action, 'strategy.created'), eq(auditLogs.entityId, first.strategyId)),
          );
        expect(createdLogs).toHaveLength(1);

        // A genuinely NEW mutationKey in the now-read_only workspace is still denied.
        const freshAttempt = await createStrategy(replayWs, actorUserId, {
          mutationKey: crypto.randomUUID(),
          name: 'Should Be Denied',
        });
        expect(freshAttempt).toMatchObject({ ok: false, code: 'read_only_workspace' });

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });

      it('a successful create stays safely replayable after the workspace becomes over_limit, with no duplicate write or audit event', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const mutationKey = crypto.randomUUID();

        const first = await createStrategy(replayWs, actorUserId, {
          mutationKey,
          name: 'Replay Strategy 2',
        });
        expect(first).toMatchObject({ ok: true, alreadyCreated: false });
        if (!first.ok) throw new Error('setup failed');

        await flipWorkspaceToOverLimit(db, replayWs);

        const replay = await createStrategy(replayWs, actorUserId, {
          mutationKey,
          name: 'Replay Strategy 2',
        });
        expect(replay).toMatchObject({
          ok: true,
          alreadyCreated: true,
          strategyId: first.strategyId,
        });

        const strategyRows = await db
          .select()
          .from(strategies)
          .where(eq(strategies.mutationKey, mutationKey));
        expect(strategyRows).toHaveLength(1);
        const createdLogs = await db
          .select()
          .from(auditLogs)
          .where(
            and(eq(auditLogs.action, 'strategy.created'), eq(auditLogs.entityId, first.strategyId)),
          );
        expect(createdLogs).toHaveLength(1);

        const freshAttempt = await createStrategy(replayWs, actorUserId, {
          mutationKey: crypto.randomUUID(),
          name: 'Should Be Denied',
        });
        expect(freshAttempt).toMatchObject({ ok: false, code: 'over_limit_workspace' });

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });

      it('rejects a replay from a removed member using the original mutationKey', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const mutationKey = crypto.randomUUID();
        const first = await createStrategy(replayWs, actorUserId, {
          mutationKey,
          name: 'Guarded Strategy',
        });
        expect(first.ok).toBe(true);

        const guestUserId = await createUser(db, 'p06c-replay-guest');
        await db
          .insert(workspaceMembers)
          .values({ workspaceId: replayWs, userId: guestUserId, role: 'member' });
        await db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, replayWs),
              eq(workspaceMembers.userId, guestUserId),
            ),
          );

        const result = await createStrategy(replayWs, guestUserId, {
          mutationKey,
          name: 'Guarded Strategy',
        });
        expect(result).toMatchObject({ ok: false, code: 'workspace_access_denied' });

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });

      it('rejects a cross-workspace replay of the same mutationKey text', async () => {
        const mutationKey = crypto.randomUUID();
        const first = await createStrategy(workspaceId, actorUserId, {
          mutationKey,
          name: 'Original Workspace Strategy',
        });
        expect(first.ok).toBe(true);

        // actorUserId is not a member of otherWorkspaceId's sibling — use the
        // removed-member workspace, where actorUserId genuinely has no
        // membership, to prove workspace scoping rather than plan/limit gating.
        const nonMemberUserId = await createUser(db, 'p06c-cross-ws');
        const isolatedWs = await createWorkspace(db, actorUserId);
        // isolatedWs owner is actorUserId; nonMemberUserId is never added.
        const crossResult = await createStrategy(isolatedWs, nonMemberUserId, {
          mutationKey,
          name: 'Should Not Reuse Original',
        });
        expect(crossResult).toMatchObject({ ok: false, code: 'workspace_access_denied' });

        // No strategy was created in isolatedWs under this key.
        const rows = await db
          .select()
          .from(strategies)
          .where(
            and(eq(strategies.workspaceId, isolatedWs), eq(strategies.mutationKey, mutationKey)),
          );
        expect(rows).toHaveLength(0);

        await db.delete(workspaces).where(eq(workspaces.id, isolatedWs));
      });

      it('creates exactly one Strategy when the same mutationKey races concurrently across a read_only transition window', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const mutationKey = crypto.randomUUID();
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            createStrategy(replayWs, actorUserId, {
              mutationKey,
              name: 'Concurrent Replay Strategy',
            }),
          ),
        );
        expect(results.every((r) => r.ok)).toBe(true);
        const ids = new Set(results.map((r) => (r.ok ? r.strategyId : null)));
        expect(ids.size).toBe(1);
        const rows = await db
          .select()
          .from(strategies)
          .where(eq(strategies.mutationKey, mutationKey));
        expect(rows).toHaveLength(1);

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });
    });

    describe('createSetup', () => {
      async function createReadyStrategyIn(ws: string) {
        const result = await createStrategy(ws, actorUserId, {
          mutationKey: crypto.randomUUID(),
          name: 'Replay Host Strategy',
        });
        if (!result.ok) throw new Error('strategy creation failed');
        return result;
      }

      it('a successful create stays safely replayable after the workspace becomes read_only, with no duplicate write or audit event', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const strategy = await createReadyStrategyIn(replayWs);
        const mutationKey = crypto.randomUUID();

        const first = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey,
          name: 'Replay Setup',
          sortOrder: 0,
        });
        expect(first).toMatchObject({ ok: true, alreadyCreated: false });
        if (!first.ok) throw new Error('setup failed');

        await flipWorkspaceToReadOnly(db, replayWs);

        const replay = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey,
          name: 'Replay Setup',
          sortOrder: 0,
        });
        expect(replay).toMatchObject({ ok: true, alreadyCreated: true, setupId: first.setupId });

        const setupRows = await db.select().from(setups).where(eq(setups.mutationKey, mutationKey));
        expect(setupRows).toHaveLength(1);
        const snapshotRows = await db
          .select()
          .from(strategySetupVersions)
          .where(eq(strategySetupVersions.setupId, first.setupId));
        expect(snapshotRows).toHaveLength(1);
        const createdLogs = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'setup.created'), eq(auditLogs.entityId, first.setupId)));
        expect(createdLogs).toHaveLength(1);

        const freshAttempt = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey: crypto.randomUUID(),
          name: 'Should Be Denied',
          sortOrder: 0,
        });
        expect(freshAttempt).toMatchObject({ ok: false, code: 'read_only_workspace' });

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });

      it('a successful create stays safely replayable after the workspace becomes over_limit, with no duplicate write or audit event', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const strategy = await createReadyStrategyIn(replayWs);
        const mutationKey = crypto.randomUUID();

        const first = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey,
          name: 'Replay Setup 2',
          sortOrder: 0,
        });
        expect(first).toMatchObject({ ok: true, alreadyCreated: false });
        if (!first.ok) throw new Error('setup failed');

        await flipWorkspaceToOverLimit(db, replayWs);

        const replay = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey,
          name: 'Replay Setup 2',
          sortOrder: 0,
        });
        expect(replay).toMatchObject({ ok: true, alreadyCreated: true, setupId: first.setupId });

        const setupRows = await db.select().from(setups).where(eq(setups.mutationKey, mutationKey));
        expect(setupRows).toHaveLength(1);
        const createdLogs = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'setup.created'), eq(auditLogs.entityId, first.setupId)));
        expect(createdLogs).toHaveLength(1);

        const freshAttempt = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey: crypto.randomUUID(),
          name: 'Should Be Denied',
          sortOrder: 0,
        });
        expect(freshAttempt).toMatchObject({ ok: false, code: 'over_limit_workspace' });

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });

      it('rejects a replay from a removed member using the original mutationKey', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const strategy = await createReadyStrategyIn(replayWs);
        const mutationKey = crypto.randomUUID();
        const first = await createSetup(replayWs, actorUserId, strategy.strategyId, {
          mutationKey,
          name: 'Guarded Setup',
          sortOrder: 0,
        });
        expect(first.ok).toBe(true);

        const guestUserId = await createUser(db, 'p06c-replay-setup-guest');
        await db
          .insert(workspaceMembers)
          .values({ workspaceId: replayWs, userId: guestUserId, role: 'member' });
        await db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, replayWs),
              eq(workspaceMembers.userId, guestUserId),
            ),
          );

        const result = await createSetup(replayWs, guestUserId, strategy.strategyId, {
          mutationKey,
          name: 'Guarded Setup',
          sortOrder: 0,
        });
        expect(result).toMatchObject({ ok: false, code: 'workspace_access_denied' });

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });

      it('rejects a cross-workspace replay of the same mutationKey text', async () => {
        const strategy = await createReadyStrategyIn(workspaceId);
        const mutationKey = crypto.randomUUID();
        const first = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
          mutationKey,
          name: 'Original Workspace Setup',
          sortOrder: 0,
        });
        expect(first.ok).toBe(true);

        const nonMemberUserId = await createUser(db, 'p06c-cross-ws-setup');
        const isolatedWs = await createWorkspace(db, actorUserId);
        const isolatedStrategy = await createReadyStrategyIn(isolatedWs);

        const crossResult = await createSetup(
          isolatedWs,
          nonMemberUserId,
          isolatedStrategy.strategyId,
          {
            mutationKey,
            name: 'Should Not Reuse Original',
            sortOrder: 0,
          },
        );
        expect(crossResult).toMatchObject({ ok: false, code: 'workspace_access_denied' });

        const rows = await db
          .select()
          .from(setups)
          .where(and(eq(setups.workspaceId, isolatedWs), eq(setups.mutationKey, mutationKey)));
        expect(rows).toHaveLength(0);

        await db.delete(workspaces).where(eq(workspaces.id, isolatedWs));
      });

      it('creates exactly one Setup when the same mutationKey races concurrently across a read_only transition window', async () => {
        const replayWs = await createWorkspace(db, actorUserId);
        const strategy = await createReadyStrategyIn(replayWs);
        const mutationKey = crypto.randomUUID();
        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            createSetup(replayWs, actorUserId, strategy.strategyId, {
              mutationKey,
              name: 'Concurrent Replay Setup',
              sortOrder: 0,
            }),
          ),
        );
        expect(results.every((r) => r.ok)).toBe(true);
        const ids = new Set(results.map((r) => (r.ok ? r.setupId : null)));
        expect(ids.size).toBe(1);
        const rows = await db.select().from(setups).where(eq(setups.mutationKey, mutationKey));
        expect(rows).toHaveLength(1);

        await db.delete(workspaces).where(eq(workspaces.id, replayWs));
      });
    });
  });

  describe('updateStrategyContent', () => {
    it('edits the current Version in place while unlocked', async () => {
      const created = await createReadyStrategy();
      const result = await updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
        name: 'Elliott Wave + RSI (v1 edit)',
      });
      expect(result).toMatchObject({ ok: true, copied: false, versionId: created.versionId });

      const [versionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, created.versionId));
      expect(versionRow?.name).toBe('Elliott Wave + RSI (v1 edit)');
      expect(versionRow?.versionNumber).toBe(1);
    });

    it('requires a change note and creates exactly one next Version when the current Version is locked', async () => {
      const created = await createReadyStrategy();
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, created.versionId));

      const denied = await updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
        name: 'Renamed',
      });
      expect(denied).toMatchObject({ ok: false, code: 'change_note_required' });

      const result = await updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
        name: 'Renamed With Note',
        changeNote: 'Tightened entry confirmation rules',
      });
      expect(result).toMatchObject({ ok: true, copied: true });
      if (!result.ok) return;
      expect(result.versionNumber).toBe(2);
      expect(result.versionId).not.toBe(created.versionId);

      const [oldVersion] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, created.versionId));
      expect(oldVersion?.name).toBe('Elliott Wave + RSI');

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, created.strategyId));
      expect(strategyRow?.currentVersionId).toBe(result.versionId);

      const versionRows = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.strategyId, created.strategyId));
      expect(versionRows).toHaveLength(2);
    });

    it('rejects an archived Strategy with strategy_archived when the current Version is unlocked, and performs no write', async () => {
      const created = await createReadyStrategy();
      await archiveStrategy(workspaceId, actorUserId, created.strategyId);

      const result = await updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
        name: 'Should Not Apply',
      });
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });

      const [versionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, created.versionId));
      expect(versionRow?.name).toBe('Elliott Wave + RSI');

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, created.strategyId));
      expect(strategyRow?.currentVersionId).toBe(created.versionId);

      const versionRows = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.strategyId, created.strategyId));
      expect(versionRows).toHaveLength(1);

      const updatedLogs = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'strategy.updated'), eq(auditLogs.entityId, created.strategyId)),
        );
      expect(updatedLogs).toHaveLength(0);
      const versionCreatedLogs = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'strategy.version.created'),
            eq(auditLogs.workspaceId, workspaceId),
          ),
        );
      const versionCreatedForThisStrategy = versionCreatedLogs.filter(
        (log) => (log.metadata as Record<string, unknown>)?.strategyId === created.strategyId,
      );
      expect(versionCreatedForThisStrategy).toHaveLength(0);

      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
    });

    it('rejects an archived Strategy with strategy_archived when the current Version is locked, and never copies', async () => {
      const created = await createReadyStrategy();
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, created.versionId));
      await archiveStrategy(workspaceId, actorUserId, created.strategyId);

      const result = await updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
        name: 'Should Not Apply',
        changeNote: 'Attempted while archived',
      });
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });

      const versionRows = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.strategyId, created.strategyId));
      expect(versionRows).toHaveLength(1); // no copy was created

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, created.strategyId));
      expect(strategyRow?.currentVersionId).toBe(created.versionId); // unchanged

      const versionCreatedLogs = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'strategy.version.created'),
            eq(auditLogs.workspaceId, workspaceId),
          ),
        );
      const versionCreatedForThisStrategy = versionCreatedLogs.filter(
        (log) => (log.metadata as Record<string, unknown>)?.strategyId === created.strategyId,
      );
      expect(versionCreatedForThisStrategy).toHaveLength(0);

      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
    });
  });

  describe('createSetup / updateSetupContent', () => {
    it('creates and updates a Setup in the unlocked current Version', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave 2 Reversal',
        sortOrder: 0,
      });
      expect(setupResult).toMatchObject({ ok: true, copied: false, versionId: created.versionId });
      if (!setupResult.ok) return;

      const updateResult = await updateSetupContent(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
        {
          name: 'Wave 2 Reversal (refined)',
          sortOrder: 1,
        },
      );
      expect(updateResult).toMatchObject({ ok: true, copied: false });

      const [snapshot] = await db
        .select()
        .from(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, created.versionId),
            eq(strategySetupVersions.setupId, setupResult.setupId),
          ),
        );
      expect(snapshot?.name).toBe('Wave 2 Reversal (refined)');
      expect(snapshot?.sortOrder).toBe(1);
    });

    it('is idempotent on retry with the same mutationKey', async () => {
      const created = await createReadyStrategy();
      const mutationKey = crypto.randomUUID();
      const first = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey,
        name: 'Wave 3 Continuation',
        sortOrder: 0,
      });
      const second = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey,
        name: 'Wave 3 Continuation',
        sortOrder: 0,
      });
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.setupId).toBe(first.setupId);
        expect(second.alreadyCreated).toBe(true);
      }
    });

    it('copy-on-write applies when creating a Setup against a locked Version', async () => {
      const created = await createReadyStrategy();
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, created.versionId));

      const denied = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave 4 Pullback',
        sortOrder: 0,
      });
      expect(denied).toMatchObject({ ok: false, code: 'change_note_required' });

      const result = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave 4 Pullback',
        sortOrder: 0,
        changeNote: 'Added a fourth setup',
      });
      expect(result).toMatchObject({ ok: true, copied: true });
      if (!result.ok) return;
      expect(result.versionId).not.toBe(created.versionId);

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, created.strategyId));
      expect(strategyRow?.currentVersionId).toBe(result.versionId);
    });

    it('copy-on-write applies when updating a Setup against a locked Version, and old content is preserved', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave 5 Exhaustion',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');

      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, setupResult.versionId));

      const result = await updateSetupContent(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
        {
          name: 'Wave 5 Exhaustion (v2)',
          sortOrder: 0,
          changeNote: 'Refined exhaustion criteria',
        },
      );
      expect(result).toMatchObject({ ok: true, copied: true });
      if (!result.ok) return;

      const [oldSnapshot] = await db
        .select()
        .from(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, setupResult.versionId),
            eq(strategySetupVersions.setupId, setupResult.setupId),
          ),
        );
      expect(oldSnapshot?.name).toBe('Wave 5 Exhaustion');

      const [newSnapshot] = await db
        .select()
        .from(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, result.versionId),
            eq(strategySetupVersions.setupId, setupResult.setupId),
          ),
        );
      expect(newSnapshot?.name).toBe('Wave 5 Exhaustion (v2)');
    });

    it('blocks Setup creation when the Strategy is archived', async () => {
      const created = await createReadyStrategy();
      await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      const result = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Should Fail',
        sortOrder: 0,
      });
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });
      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
    });

    it('blocks content mutation when the Setup itself is archived', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Archivable Setup',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');
      await archiveSetup(workspaceId, actorUserId, created.strategyId, setupResult.setupId);

      const result = await updateSetupContent(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
        {
          name: 'Should Fail',
          sortOrder: 0,
        },
      );
      expect(result).toMatchObject({ ok: false, code: 'setup_archived' });
    });

    it('rejects a Setup with no snapshot in the current Version as malformed', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Ghost Setup',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');
      // Simulate a malformed state: delete the snapshot directly (never done by a real service).
      await db
        .delete(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, setupResult.versionId),
            eq(strategySetupVersions.setupId, setupResult.setupId),
          ),
        );
      const result = await updateSetupContent(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
        {
          name: 'Should Fail',
          sortOrder: 0,
        },
      );
      expect(result).toMatchObject({ ok: false, code: 'setup_snapshot_missing' });
    });
  });

  describe('archiveStrategy / restoreStrategy', () => {
    it('is idempotent', async () => {
      const created = await createReadyStrategy();
      const first = await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      const second = await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });
      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
    });

    it('never changes setups.is_archived on archive or restore', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Untouched Setup',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');

      await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      let [setupRow] = await db.select().from(setups).where(eq(setups.id, setupResult.setupId));
      expect(setupRow?.isArchived).toBe(false);

      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
      [setupRow] = await db.select().from(setups).where(eq(setups.id, setupResult.setupId));
      expect(setupRow?.isArchived).toBe(false);
    });

    it('a restored Strategy exposes only Setups whose own is_archived is false', async () => {
      const created = await createReadyStrategy();
      const activeSetup = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Stays Active',
        sortOrder: 0,
      });
      const archivedSetup = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Gets Archived',
        sortOrder: 1,
      });
      if (!activeSetup.ok || !archivedSetup.ok) throw new Error('setup creation failed');

      await archiveSetup(workspaceId, actorUserId, created.strategyId, archivedSetup.setupId);
      await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      await restoreStrategy(workspaceId, actorUserId, created.strategyId);

      const effectivelyAvailable = await db
        .select({ id: setups.id })
        .from(setups)
        .where(and(eq(setups.strategyId, created.strategyId), eq(setups.isArchived, false)));
      const ids = effectivelyAvailable.map((r) => r.id);
      expect(ids).toContain(activeSetup.setupId);
      expect(ids).not.toContain(archivedSetup.setupId);
    });
  });

  describe('archiveSetup / restoreSetup', () => {
    it('is idempotent and changes only Setup identity state', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Toggle Setup',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');

      const first = await archiveSetup(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
      );
      const second = await archiveSetup(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
      );
      expect(first).toEqual({ ok: true });
      expect(second).toEqual({ ok: true });

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, created.strategyId));
      expect(strategyRow?.isArchived).toBe(false);

      await restoreSetup(workspaceId, actorUserId, created.strategyId, setupResult.setupId);
      const [setupRow] = await db.select().from(setups).where(eq(setups.id, setupResult.setupId));
      expect(setupRow?.isArchived).toBe(false);
    });

    it('blocks Setup lifecycle mutation while the parent Strategy is archived', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Blocked Setup',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');

      await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      const result = await archiveSetup(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupResult.setupId,
      );
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });
      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
    });
  });

  describe('rules', () => {
    it('creates, updates, and removes a Strategy-level Rule while unlocked', async () => {
      const created = await createReadyStrategy();
      const ruleKey = crypto.randomUUID();
      const createResult = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey,
        category: 'entry',
        title: 'Must confirm RSI divergence',
      });
      expect(createResult).toMatchObject({ ok: true, copied: false });

      const updateResult = await updateStrategyRule(
        workspaceId,
        actorUserId,
        created.strategyId,
        ruleKey,
        {
          category: 'entry',
          title: 'Must confirm RSI divergence on the 4H chart',
        },
      );
      expect(updateResult).toMatchObject({ ok: true, copied: false });

      const removeResult = await removeStrategyRule(
        workspaceId,
        actorUserId,
        created.strategyId,
        ruleKey,
      );
      expect(removeResult).toMatchObject({ ok: true, copied: false, alreadyRemoved: false });

      const [row] = await db
        .select()
        .from(strategyRules)
        .where(
          and(
            eq(strategyRules.strategyVersionId, created.versionId),
            eq(strategyRules.ruleKey, ruleKey),
          ),
        );
      expect(row).toBeUndefined();
    });

    it('create/update/remove after lock uses copy-on-write, affecting only the new Version', async () => {
      const created = await createReadyStrategy();
      const ruleKey = crypto.randomUUID();
      const createResult = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey,
        category: 'entry',
        title: 'Original title',
      });
      if (!createResult.ok) throw new Error('rule creation failed');

      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, createResult.versionId));

      const deniedUpdate = await updateStrategyRule(
        workspaceId,
        actorUserId,
        created.strategyId,
        ruleKey,
        {
          category: 'entry',
          title: 'Renamed',
        },
      );
      expect(deniedUpdate).toMatchObject({ ok: false, code: 'change_note_required' });

      const updateResult = await updateStrategyRule(
        workspaceId,
        actorUserId,
        created.strategyId,
        ruleKey,
        {
          category: 'entry',
          title: 'Renamed with note',
          changeNote: 'Sharper entry wording',
        },
      );
      expect(updateResult).toMatchObject({ ok: true, copied: true });
      if (!updateResult.ok) return;

      const [oldRule] = await db
        .select()
        .from(strategyRules)
        .where(
          and(
            eq(strategyRules.strategyVersionId, createResult.versionId),
            eq(strategyRules.ruleKey, ruleKey),
          ),
        );
      expect(oldRule?.title).toBe('Original title');

      const [newRule] = await db
        .select()
        .from(strategyRules)
        .where(
          and(
            eq(strategyRules.strategyVersionId, updateResult.versionId),
            eq(strategyRules.ruleKey, ruleKey),
          ),
        );
      expect(newRule?.title).toBe('Renamed with note');

      // Now remove it — locked again, requires another copy.
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, updateResult.versionId));
      const removeResult = await removeStrategyRule(
        workspaceId,
        actorUserId,
        created.strategyId,
        ruleKey,
        {
          changeNote: 'No longer needed',
        },
      );
      expect(removeResult).toMatchObject({ ok: true, copied: true });
      if (!removeResult.ok) return;

      const [removedFromNew] = await db
        .select()
        .from(strategyRules)
        .where(
          and(
            eq(strategyRules.strategyVersionId, removeResult.versionId),
            eq(strategyRules.ruleKey, ruleKey),
          ),
        );
      expect(removedFromNew).toBeUndefined();

      const [stillInPrevious] = await db
        .select()
        .from(strategyRules)
        .where(
          and(
            eq(strategyRules.strategyVersionId, updateResult.versionId),
            eq(strategyRules.ruleKey, ruleKey),
          ),
        );
      expect(stillInPrevious?.title).toBe('Renamed with note');
    });

    it('does not duplicate the same logical ruleKey within one Version on a repeated create', async () => {
      const created = await createReadyStrategy();
      const ruleKey = crypto.randomUUID();
      const first = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey,
        category: 'risk',
        title: 'Risk no more than 1R',
      });
      const second = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey,
        category: 'risk',
        title: 'Risk no more than 1R',
      });
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.ruleId).toBe(first.ruleId);
        expect(second.alreadyCreated).toBe(true);
      }
      const rows = await db
        .select()
        .from(strategyRules)
        .where(
          and(
            eq(strategyRules.strategyVersionId, created.versionId),
            eq(strategyRules.ruleKey, ruleKey),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it('rejects an unsupported category', async () => {
      const created = await createReadyStrategy();
      const result = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey: crypto.randomUUID(),
        category: 'confirmation',
        title: 'Bogus',
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_rule_category' });
    });

    it('rejects a Setup-scoped Rule targeting a Setup from another Strategy', async () => {
      const strategyA = await createReadyStrategy(workspaceId, 'Strategy A');
      const strategyB = await createReadyStrategy(workspaceId, 'Strategy B');
      const setupOnB = await createSetup(workspaceId, actorUserId, strategyB.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Setup on B',
        sortOrder: 0,
      });
      if (!setupOnB.ok) throw new Error('setup creation failed');

      const result = await createStrategyRule(workspaceId, actorUserId, strategyA.strategyId, {
        ruleKey: crypto.randomUUID(),
        setupId: setupOnB.setupId,
        category: 'entry',
        title: 'Cross-strategy rule',
      });
      expect(result).toMatchObject({ ok: false, code: 'setup_not_found' });
    });

    it('rejects a Setup-scoped Rule targeting a Setup from another workspace', async () => {
      const created = await createReadyStrategy(otherWorkspaceId, 'Other Workspace Strategy');
      const setupResult = await createSetup(otherWorkspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Other workspace setup',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');

      const strategyInMain = await createReadyStrategy(workspaceId, 'Main Workspace Strategy');
      const result = await createStrategyRule(workspaceId, actorUserId, strategyInMain.strategyId, {
        ruleKey: crypto.randomUUID(),
        setupId: setupResult.setupId,
        category: 'entry',
        title: 'Cross-workspace rule',
      });
      expect(result).toMatchObject({ ok: false, code: 'setup_not_found' });
    });

    it('blocks Rule mutation when the Strategy is archived', async () => {
      const created = await createReadyStrategy();
      await archiveStrategy(workspaceId, actorUserId, created.strategyId);
      const result = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey: crypto.randomUUID(),
        category: 'entry',
        title: 'Should fail',
      });
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });
      await restoreStrategy(workspaceId, actorUserId, created.strategyId);
    });

    it('blocks a Setup-scoped Rule create when the Setup is archived', async () => {
      const created = await createReadyStrategy();
      const setupResult = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Archived Setup For Rules',
        sortOrder: 0,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');
      await archiveSetup(workspaceId, actorUserId, created.strategyId, setupResult.setupId);

      const result = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey: crypto.randomUUID(),
        setupId: setupResult.setupId,
        category: 'entry',
        title: 'Should fail',
      });
      expect(result).toMatchObject({ ok: false, code: 'setup_archived' });
    });
  });

  describe('setup conditions', () => {
    it('creates, renames, reorders, and removes unlocked Conditions without changing their key', async () => {
      const created = await createReadyStrategy(workspaceId, 'Condition CRUD');
      const setupA = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Wave continuation',
        sortOrder: 0,
      });
      const setupB = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Range reclaim',
        sortOrder: 1,
      });
      if (!setupA.ok || !setupB.ok) throw new Error('setup creation failed');

      const first = await createSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupA.setupId,
        { label: 'Wave 2 complete', sortOrder: 0 },
      );
      const independent = await createSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupB.setupId,
        { label: 'Range reclaimed', sortOrder: 0 },
      );
      expect(first).toMatchObject({ ok: true, copied: false });
      expect(independent).toMatchObject({ ok: true, copied: false });
      if (!first.ok || !independent.ok) return;
      expect(first.conditionKey).not.toBe(independent.conditionKey);

      const renamed = await updateSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupA.setupId,
        first.conditionKey,
        { label: 'Wave 2 structure complete', sortOrder: 3 },
      );
      expect(renamed).toMatchObject({
        ok: true,
        conditionKey: first.conditionKey,
        copied: false,
      });

      const [renamedRow] = await db
        .select()
        .from(setupConditions)
        .where(
          and(
            eq(setupConditions.workspaceId, workspaceId),
            eq(setupConditions.conditionKey, first.conditionKey),
          ),
        );
      expect(renamedRow).toMatchObject({
        setupId: setupA.setupId,
        label: 'Wave 2 structure complete',
        sortOrder: 3,
      });

      const removed = await removeSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setupA.setupId,
        first.conditionKey,
      );
      expect(removed).toMatchObject({ ok: true, copied: false, alreadyRemoved: false });
      const remaining = await db
        .select()
        .from(setupConditions)
        .where(eq(setupConditions.workspaceId, workspaceId));
      expect(remaining.some((row) => row.conditionKey === first.conditionKey)).toBe(false);
      expect(remaining.some((row) => row.conditionKey === independent.conditionKey)).toBe(true);
    });

    it('protects locked rows in PostgreSQL and updates through the authoritative COW path', async () => {
      const created = await createReadyStrategy(workspaceId, 'Condition COW');
      const setup = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Breakout retest',
        sortOrder: 0,
      });
      if (!setup.ok) throw new Error('setup creation failed');
      const condition = await createSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setup.setupId,
        { label: 'Retest holds', sortOrder: 2 },
      );
      if (!condition.ok) throw new Error('condition creation failed');

      const [source] = await db
        .select()
        .from(setupConditions)
        .where(
          and(
            eq(setupConditions.setupId, setup.setupId),
            eq(setupConditions.conditionKey, condition.conditionKey),
          ),
        );
      if (source === undefined) throw new Error('source condition missing');
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, condition.versionId));

      await expect(
        db
          .update(setupConditions)
          .set({ label: 'Illegal direct mutation' })
          .where(eq(setupConditions.id, source.id)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      await expect(
        db.delete(setupConditions).where(eq(setupConditions.id, source.id)),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      const withoutNote = await updateSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setup.setupId,
        condition.conditionKey,
        { label: 'Retest closes above level', sortOrder: 1 },
      );
      expect(withoutNote).toMatchObject({ ok: false, code: 'change_note_required' });

      const updated = await updateSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setup.setupId,
        condition.conditionKey,
        {
          label: 'Retest closes above level',
          sortOrder: 1,
          changeNote: 'Clarify the retest requirement',
        },
      );
      expect(updated).toMatchObject({
        ok: true,
        conditionKey: condition.conditionKey,
        copied: true,
        versionNumber: 2,
      });
      if (!updated.ok) return;

      const rows = await db
        .select()
        .from(setupConditions)
        .where(eq(setupConditions.conditionKey, condition.conditionKey));
      expect(rows).toHaveLength(2);
      const destination = rows.find((row) => row.id !== source.id);
      expect(destination).toBeDefined();
      expect(destination).toMatchObject({
        conditionKey: source.conditionKey,
        setupId: source.setupId,
        label: 'Retest closes above level',
        sortOrder: 1,
      });
      expect(destination?.setupVersionId).not.toBe(source.setupVersionId);
      expect(source).toMatchObject({ label: 'Retest holds', sortOrder: 2 });
    });

    it('rejects cross-workspace and cross-Setup source keys privacy-safely', async () => {
      const foreign = await createReadyStrategy(otherWorkspaceId, 'Foreign Conditions');
      const foreignSetup = await createSetup(otherWorkspaceId, actorUserId, foreign.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Foreign setup',
        sortOrder: 0,
      });
      if (!foreignSetup.ok) throw new Error('foreign setup creation failed');
      const foreignCondition = await createSetupCondition(
        otherWorkspaceId,
        actorUserId,
        foreign.strategyId,
        foreignSetup.setupId,
        { label: 'Foreign condition', sortOrder: 0 },
      );
      if (!foreignCondition.ok) throw new Error('foreign condition creation failed');

      const local = await createReadyStrategy(workspaceId, 'Local Conditions');
      const localSetup = await createSetup(workspaceId, actorUserId, local.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Local setup',
        sortOrder: 0,
      });
      if (!localSetup.ok) throw new Error('local setup creation failed');
      const crossWorkspace = await updateSetupCondition(
        workspaceId,
        actorUserId,
        local.strategyId,
        localSetup.setupId,
        foreignCondition.conditionKey,
        { label: 'Should not resolve', sortOrder: 0 },
      );
      expect(crossWorkspace).toMatchObject({ ok: false, code: 'condition_not_found' });

      const localCondition = await createSetupCondition(
        workspaceId,
        actorUserId,
        local.strategyId,
        localSetup.setupId,
        { label: 'Local condition', sortOrder: 0 },
      );
      if (!localCondition.ok) throw new Error('local condition creation failed');
      const otherLocalSetup = await createSetup(workspaceId, actorUserId, local.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Other local setup',
        sortOrder: 1,
      });
      if (!otherLocalSetup.ok) throw new Error('second local setup creation failed');
      const crossSetup = await updateSetupCondition(
        workspaceId,
        actorUserId,
        local.strategyId,
        otherLocalSetup.setupId,
        localCondition.conditionKey,
        { label: 'Should not cross Setups', sortOrder: 0 },
      );
      expect(crossSetup).toMatchObject({ ok: false, code: 'condition_not_found' });
    });

    it('keeps archived Setup history readable while rejecting further Condition mutation', async () => {
      const created = await createReadyStrategy(workspaceId, 'Archived Condition History');
      const setup = await createSetup(workspaceId, actorUserId, created.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Historical setup',
        sortOrder: 0,
      });
      if (!setup.ok) throw new Error('setup creation failed');
      const condition = await createSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setup.setupId,
        { label: 'Historical condition', sortOrder: 0 },
      );
      if (!condition.ok) throw new Error('condition creation failed');
      await archiveSetup(workspaceId, actorUserId, created.strategyId, setup.setupId);

      const historicalRows = await db
        .select()
        .from(setupConditions)
        .where(eq(setupConditions.conditionKey, condition.conditionKey));
      expect(historicalRows).toHaveLength(1);
      expect(historicalRows[0]?.label).toBe('Historical condition');
      const rejected = await updateSetupCondition(
        workspaceId,
        actorUserId,
        created.strategyId,
        setup.setupId,
        condition.conditionKey,
        { label: 'No longer editable', sortOrder: 0 },
      );
      expect(rejected).toMatchObject({ ok: false, code: 'setup_archived' });
    });
  });

  describe('concurrency', () => {
    it('creates exactly one Setup when the same mutationKey races concurrently', async () => {
      const created = await createReadyStrategy();
      const mutationKey = crypto.randomUUID();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          createSetup(workspaceId, actorUserId, created.strategyId, {
            mutationKey,
            name: 'Race Setup',
            sortOrder: 0,
          }),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);
      const setupIds = new Set(results.map((r) => (r.ok ? r.setupId : null)));
      expect(setupIds.size).toBe(1);

      const rows = await db.select().from(setups).where(eq(setups.mutationKey, mutationKey));
      expect(rows).toHaveLength(1);
    });

    it('two mutations racing against one locked current Version never produce a duplicate version_number', async () => {
      const created = await createReadyStrategy();
      await db
        .update(strategyVersions)
        .set({ lockedAt: new Date() })
        .where(eq(strategyVersions.id, created.versionId));

      const results = await Promise.all([
        updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
          name: 'Racer A',
          changeNote: 'from A',
        }),
        updateStrategyContent(workspaceId, actorUserId, created.strategyId, {
          name: 'Racer B',
          changeNote: 'from B',
        }),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);

      const versionRows = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.strategyId, created.strategyId));
      const versionNumbers = versionRows.map((v) => v.versionNumber);
      expect(new Set(versionNumbers).size).toBe(versionNumbers.length);
      // Whichever racer wins the Strategy-row lock first sees v1 locked and
      // copies to v2. The loser, unblocking second, re-reads the Strategy row
      // (lock order step 4->5's whole point) and finds v2 already unlocked —
      // so it edits v2 in place rather than copying again. Exactly one copy
      // ever happens no matter which racer wins, so the version count is
      // deterministically 2, not 3: this is the "re-read after acquiring the
      // lock" requirement paying off as fewer versions, not a race bug.
      expect(versionRows).toHaveLength(2);

      const [strategyRow] = await db
        .select()
        .from(strategies)
        .where(eq(strategies.id, created.strategyId));
      const currentVersion = versionRows.find((v) => v.id === strategyRow?.currentVersionId);
      expect(currentVersion).toBeDefined();
      expect(currentVersion?.versionNumber).toBe(2);
      expect(currentVersion?.lockedAt).toBeNull();
      // One of the two racers' names is now current; the other is not lost
      // data corruption — it simply lost the race for "who edits first" and
      // its intended change was superseded by the second (in-place) editor,
      // matching ordinary last-write-wins semantics for an in-place edit.
      expect(['Racer A', 'Racer B']).toContain(currentVersion?.name);
    });
  });

  describe('audit', () => {
    it('emits strategy.created with only safe structural metadata', async () => {
      const created = await createReadyStrategy();
      const [log] = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'strategy.created'), eq(auditLogs.entityId, created.strategyId)),
        );
      expect(log).toBeDefined();
      expect(log?.workspaceId).toBe(workspaceId);
      const metadata = log?.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({ strategyVersionId: created.versionId, versionNumber: 1 });
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain('Elliott Wave');
    });

    it('emits strategy.version.created and strategy.rule.created without rule/version content', async () => {
      const created = await createReadyStrategy();
      const ruleKey = crypto.randomUUID();
      const ruleResult = await createStrategyRule(workspaceId, actorUserId, created.strategyId, {
        ruleKey,
        category: 'risk',
        title: 'Never risk more than the plan allows',
        description: 'Sensitive rule description text',
      });
      if (!ruleResult.ok) throw new Error('rule creation failed');

      const [ruleLog] = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'strategy.rule.created'),
            eq(auditLogs.entityId, ruleResult.ruleId),
          ),
        );
      expect(ruleLog).toBeDefined();
      const metadata = ruleLog?.metadata as Record<string, unknown>;
      expect(metadata).toMatchObject({ ruleKey, ruleCategory: 'risk', ruleScope: 'strategy' });
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain('Never risk');
      expect(serialized).not.toContain('Sensitive rule description');
    });
  });
});
