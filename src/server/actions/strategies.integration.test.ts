import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  strategies,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';

/**
 * Exercises Phase 06D's Server Actions (`src/server/actions/strategies.ts`)
 * against a real, disposable database — the same mocking pattern
 * `checkout.integration.test.ts`/`subscription-management.integration.test.ts`
 * establish: `@/server/auth/dal` is mocked wholesale to control the trusted
 * `{ workspaceId, userId }` context and the `requireStrategyManagement`
 * precheck directly, while the SERVICE layer underneath
 * (`strategy-management.ts`) still runs for real against the real database —
 * it re-verifies membership/entitlement itself via its own direct queries,
 * never through `@/server/auth/dal`, so mocking that module here does not
 * weaken the real authorization boundary under test.
 *
 * This file also carries the "unit-shaped" assertions the Phase 06D brief
 * calls out separately (field-error sanitization, action-result
 * serialization) — `src/server/actions/strategies.ts` imports `server-only`
 * transitively, so it cannot be imported under `vitest.config.ts`'s `jsdom`
 * environment at all (see that config's own exclude comment); every exercise
 * of this module necessarily lives in the `node`-environment integration
 * config instead.
 */

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const actionState = vi.hoisted(() => ({
  context: null as null | { workspaceId: string; userId: string },
  unauthenticated: false,
  forbidden: false,
}));

vi.mock('@/server/auth/dal', () => {
  class UnauthenticatedError extends Error {
    constructor() {
      super('No authenticated session.');
      this.name = 'UnauthenticatedError';
    }
  }
  class ForbiddenError extends Error {
    constructor() {
      super('Not authorized for this workspace.');
      this.name = 'ForbiddenError';
    }
  }
  return {
    UnauthenticatedError,
    ForbiddenError,
    getActiveWorkspaceContext: async () => {
      if (actionState.unauthenticated || actionState.context === null) {
        throw new UnauthenticatedError();
      }
      return actionState.context;
    },
    requireStrategyManagement: async () => {
      if (actionState.forbidden) throw new ForbiddenError();
      return 'member' as const;
    },
  };
});

const {
  archiveSetupAction,
  archiveStrategyAction,
  createSetupAction,
  createStrategyAction,
  createStrategyRuleAction,
  removeStrategyRuleAction,
  restoreStrategyAction,
  updateStrategyAction,
  updateStrategyRuleAction,
} = await import('./strategies');

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
      name: 'Phase 06D action test workspace',
      slug: `p06d-act-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(userPreferences).values({ userId: ownerUserId, activeWorkspaceId: workspace.id });

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

/** Serializable = survives a JSON round-trip with no dropped/mangled keys and no `Error` leaking through as `{}`. */
function assertJsonSerializable(value: unknown): void {
  expect(value).not.toBeInstanceOf(Error);
  const json = JSON.stringify(value);
  expect(json).toBeDefined();
  expect(JSON.parse(json as string)).toEqual(value);
  expect(json).not.toMatch(/"stack"/);
  expect(json).not.toMatch(/"cause"/);
}

const workspaceIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  actionState.context = null;
  actionState.unauthenticated = false;
  actionState.forbidden = false;
  revalidatePath.mockClear();
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

describe('createStrategyAction (real PostgreSQL)', () => {
  const db = getTestDb();

  it('rejects unauthenticated calls without touching the database', async () => {
    actionState.unauthenticated = true;
    const result = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Anything',
    });
    expect(result).toEqual({ ok: false, error: { code: 'unauthenticated' } });
    expect(revalidatePath).not.toHaveBeenCalled();
    assertJsonSerializable(result);
  });

  it('rejects a forbidden precheck as workspace_access_denied', async () => {
    const userId = await createUser(db, 'p06d-act-forbidden');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };
    actionState.forbidden = true;

    const result = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Anything',
    });
    expect(result).toEqual({ ok: false, error: { code: 'workspace_access_denied' } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized field with sanitized field errors — no raw workspaceId echoed, and the forged key never appears as an editable field error', async () => {
    const userId = await createUser(db, 'p06d-act-validation');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };

    const result = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Anything',
      workspaceId: 'forged-workspace-id',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation_error');
    // Only schema-declared fields can ever appear as a field-error key —
    // the unrecognized `workspaceId` key surfaces as a root-level Zod
    // `formErrors` issue, which this action never reads, so it can never be
    // mistaken for an editable field.
    const knownFields = ['mutationKey', 'name', 'description', 'notes'];
    for (const key of Object.keys(result.error.fieldErrors ?? {})) {
      expect(knownFields).toContain(key);
    }
    expect(result.error.fieldErrors?.workspaceId).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('forged-workspace-id');
    expect(revalidatePath).not.toHaveBeenCalled();
    assertJsonSerializable(result);
  });

  it('rejects a blank name as validation_error (schema-level)', async () => {
    const userId = await createUser(db, 'p06d-act-blank');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };

    const result = await createStrategyAction({ mutationKey: crypto.randomUUID(), name: '' });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_error' } });
  });

  it('succeeds in a writable workspace with the full canonical data shape, revalidates both locales, and audits exactly once', async () => {
    const userId = await createUser(db, 'p06d-act-success');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };

    const result = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Momentum Breakout',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      alreadyCreated: false,
      versionNumber: 1,
    });
    expect(typeof result.data.strategyId).toBe('string');
    expect(typeof result.data.versionId).toBe('string');
    // Never exposes workspaceId/actorUserId/mutationKey/lockedAt.
    expect(JSON.stringify(result)).not.toMatch(/workspaceId|actorUserId|mutationKey|lockedAt/);
    assertJsonSerializable(result);

    expect(revalidatePath).toHaveBeenCalledWith('/en/app/strategies');
    expect(revalidatePath).toHaveBeenCalledWith('/th/app/strategies');

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, 'strategy.created')));
    expect(audits).toHaveLength(1);
  });

  it('replays the same mutationKey idempotently, still revalidates, and does not duplicate the audit row', async () => {
    const userId = await createUser(db, 'p06d-act-replay');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };
    const mutationKey = crypto.randomUUID();

    const first = await createStrategyAction({ mutationKey, name: 'Replay Strategy' });
    revalidatePath.mockClear();
    const second = await createStrategyAction({ mutationKey, name: 'Replay Strategy' });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.strategyId).toBe(first.data.strategyId);
    expect(second.data.versionId).toBe(first.data.versionId);
    expect(second.data.versionNumber).toBe(first.data.versionNumber);
    expect(second.data.alreadyCreated).toBe(true);
    // Chosen convention: a successful idempotent replay revalidates the
    // route too — the same code path a fresh success takes, since a replay
    // is still an `ok: true` outcome from the client's perspective.
    expect(revalidatePath).toHaveBeenCalledWith('/en/app/strategies');
    expect(revalidatePath).toHaveBeenCalledWith('/th/app/strategies');

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, 'strategy.created')));
    expect(audits).toHaveLength(1);
  });

  it('denies a fresh mutationKey under a read_only workspace, but still allows the exact prior key to replay with the same identity — proving the Action layer never precheck-blocks a replay', async () => {
    const userId = await createUser(db, 'p06d-act-readonly');
    const workspaceId = await createWorkspace(db, userId, { status: 'active', planKey: 'starter' });
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };

    const mutationKey = crypto.randomUUID();
    const created = await createStrategyAction({ mutationKey, name: 'Before expiry' });
    expect(created.ok).toBe(true);

    // Flip the workspace to read_only by expiring its current period.
    await db
      .update(workspaceEntitlements)
      .set({ currentPeriodEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));

    revalidatePath.mockClear();
    const freshDenied = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'After expiry',
    });
    expect(freshDenied).toEqual({ ok: false, error: { code: 'read_only_workspace' } });
    expect(revalidatePath).not.toHaveBeenCalled();

    const replay = await createStrategyAction({ mutationKey, name: 'Before expiry' });
    expect(replay.ok && created.ok).toBe(true);
    if (replay.ok && created.ok) {
      expect(replay.data.strategyId).toBe(created.data.strategyId);
      expect(replay.data.alreadyCreated).toBe(true);
    }

    const audits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, workspaceId), eq(auditLogs.action, 'strategy.created')));
    expect(audits).toHaveLength(1);
  });

  it('denies a fresh create under an over_limit workspace, but still allows the exact prior key to replay', async () => {
    const userId = await createUser(db, 'p06d-act-overlimit');
    const workspaceId = await createWorkspace(db, userId, { status: 'active', planKey: 'starter' });
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };

    const mutationKey = crypto.randomUUID();
    const created = await createStrategyAction({ mutationKey, name: 'Before over-limit' });
    expect(created.ok).toBe(true);

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

    const freshDenied = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Blocked',
    });
    expect(freshDenied).toEqual({ ok: false, error: { code: 'over_limit_workspace' } });

    const replay = await createStrategyAction({ mutationKey, name: 'Before over-limit' });
    expect(replay.ok && created.ok).toBe(true);
    if (replay.ok && created.ok) {
      expect(replay.data.strategyId).toBe(created.data.strategyId);
      expect(replay.data.alreadyCreated).toBe(true);
    }
  });

  it('denies a removed member even though the action-layer precheck passes — the service re-verifies for real', async () => {
    const ownerUserId = await createUser(db, 'p06d-act-owner');
    const removedUserId = await createUser(db, 'p06d-act-removed');
    const workspaceId = await createWorkspace(db, ownerUserId);
    userIds.push(ownerUserId, removedUserId);
    workspaceIds.push(workspaceId);

    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: removedUserId,
      role: 'member',
      status: 'active',
    });
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, removedUserId),
        ),
      );

    actionState.context = { workspaceId, userId: removedUserId };
    const result = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Should fail',
    });
    expect(result).toEqual({ ok: false, error: { code: 'workspace_access_denied' } });
  });

  it('denies a cross-workspace mutationKey replay — the same key under a different workspace is a fresh create attempt, not a replay', async () => {
    const userA = await createUser(db, 'p06d-act-cross-replay-a');
    const userB = await createUser(db, 'p06d-act-cross-replay-b');
    const workspaceA = await createWorkspace(db, userA);
    const workspaceB = await createWorkspace(db, userB, { status: 'active', planKey: 'starter' });
    userIds.push(userA, userB);
    workspaceIds.push(workspaceA, workspaceB);
    const mutationKey = crypto.randomUUID();

    actionState.context = { workspaceId: workspaceA, userId: userA };
    const first = await createStrategyAction({ mutationKey, name: 'Workspace A strategy' });
    expect(first.ok).toBe(true);

    // Push workspace B over its limit so a genuinely-new create is denied,
    // proving the same key is NOT treated as a cross-workspace replay.
    for (let i = 0; i < 2; i += 1) {
      await db.insert(tradingAccounts).values({
        workspaceId: workspaceB,
        name: `Workspace B account ${i}`,
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '1000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      });
    }
    actionState.context = { workspaceId: workspaceB, userId: userB };
    const second = await createStrategyAction({ mutationKey, name: 'Workspace B strategy' });
    expect(second).toEqual({ ok: false, error: { code: 'over_limit_workspace' } });
  });
});

describe('createSetupAction (real PostgreSQL)', () => {
  const db = getTestDb();

  async function seedStrategy(workspaceId: string, userId: string) {
    actionState.context = { workspaceId, userId };
    const created = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Seed Strategy',
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.error.code}`);
    return created.data;
  }

  it('succeeds with the full canonical data shape including strategyId', async () => {
    const userId = await createUser(db, 'p06d-act-setup-success');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, userId);

    const result = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey: crypto.randomUUID(),
      name: 'Retest entry',
      sortOrder: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      strategyId: strategy.strategyId,
      alreadyCreated: false,
      copied: false,
    });
    expect(typeof result.data.setupId).toBe('string');
    assertJsonSerializable(result);
  });

  it('replays the same mutationKey idempotently with the same identity', async () => {
    const userId = await createUser(db, 'p06d-act-setup-replay');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, userId);
    const mutationKey = crypto.randomUUID();

    const first = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey,
      name: 'Replay setup',
      sortOrder: 0,
    });
    const second = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey,
      name: 'Replay setup',
      sortOrder: 0,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.setupId).toBe(first.data.setupId);
    expect(second.data.alreadyCreated).toBe(true);
  });

  it('denies a fresh Setup mutationKey under a read_only workspace, but still allows the exact prior key to replay', async () => {
    const userId = await createUser(db, 'p06d-act-setup-readonly');
    const workspaceId = await createWorkspace(db, userId, { status: 'active', planKey: 'starter' });
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, userId);
    const mutationKey = crypto.randomUUID();

    const created = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey,
      name: 'Before expiry',
      sortOrder: 0,
    });
    expect(created.ok).toBe(true);

    await db
      .update(workspaceEntitlements)
      .set({ currentPeriodEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));

    const freshDenied = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey: crypto.randomUUID(),
      name: 'After expiry',
      sortOrder: 1,
    });
    expect(freshDenied).toEqual({ ok: false, error: { code: 'read_only_workspace' } });

    const replay = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey,
      name: 'Before expiry',
      sortOrder: 0,
    });
    expect(replay.ok && created.ok).toBe(true);
    if (replay.ok && created.ok) {
      expect(replay.data.setupId).toBe(created.data.setupId);
      expect(replay.data.alreadyCreated).toBe(true);
    }
  });

  it('denies a fresh Setup create under an over_limit workspace, but still allows the exact prior key to replay', async () => {
    const userId = await createUser(db, 'p06d-act-setup-overlimit');
    const workspaceId = await createWorkspace(db, userId, { status: 'active', planKey: 'starter' });
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, userId);
    const mutationKey = crypto.randomUUID();

    const created = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey,
      name: 'Before over-limit',
      sortOrder: 0,
    });
    expect(created.ok).toBe(true);

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

    const freshDenied = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey: crypto.randomUUID(),
      name: 'Blocked',
      sortOrder: 1,
    });
    expect(freshDenied).toEqual({ ok: false, error: { code: 'over_limit_workspace' } });

    const replay = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey,
      name: 'Before over-limit',
      sortOrder: 0,
    });
    expect(replay.ok && created.ok).toBe(true);
    if (replay.ok && created.ok) {
      expect(replay.data.setupId).toBe(created.data.setupId);
      expect(replay.data.alreadyCreated).toBe(true);
    }
  });

  it('denies a removed member replaying a Setup create even though the action-layer precheck passes', async () => {
    const ownerUserId = await createUser(db, 'p06d-act-setup-owner');
    const removedUserId = await createUser(db, 'p06d-act-setup-removed');
    const workspaceId = await createWorkspace(db, ownerUserId);
    userIds.push(ownerUserId, removedUserId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, ownerUserId);

    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: removedUserId,
      role: 'member',
      status: 'active',
    });
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, removedUserId),
        ),
      );

    actionState.context = { workspaceId, userId: removedUserId };
    const result = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey: crypto.randomUUID(),
      name: 'Should fail',
      sortOrder: 0,
    });
    expect(result).toEqual({ ok: false, error: { code: 'workspace_access_denied' } });
  });

  it('denies a cross-workspace Setup mutationKey replay as a fresh create attempt', async () => {
    const userA = await createUser(db, 'p06d-act-setup-cross-a');
    const userB = await createUser(db, 'p06d-act-setup-cross-b');
    const workspaceA = await createWorkspace(db, userA);
    const workspaceB = await createWorkspace(db, userB, { status: 'active', planKey: 'starter' });
    userIds.push(userA, userB);
    workspaceIds.push(workspaceA, workspaceB);
    const strategyA = await seedStrategy(workspaceA, userA);
    const strategyB = await seedStrategy(workspaceB, userB);
    const mutationKey = crypto.randomUUID();

    actionState.context = { workspaceId: workspaceA, userId: userA };
    const first = await createSetupAction({
      strategyId: strategyA.strategyId,
      mutationKey,
      name: 'Workspace A setup',
      sortOrder: 0,
    });
    expect(first.ok).toBe(true);

    for (let i = 0; i < 2; i += 1) {
      await db.insert(tradingAccounts).values({
        workspaceId: workspaceB,
        name: `Workspace B account ${i}`,
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '1000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      });
    }
    actionState.context = { workspaceId: workspaceB, userId: userB };
    const second = await createSetupAction({
      strategyId: strategyB.strategyId,
      mutationKey,
      name: 'Workspace B setup',
      sortOrder: 0,
    });
    expect(second).toEqual({ ok: false, error: { code: 'over_limit_workspace' } });
  });
});

describe('updateStrategyAction / lifecycle actions (real PostgreSQL)', () => {
  const db = getTestDb();

  async function seedStrategy(workspaceId: string, userId: string) {
    actionState.context = { workspaceId, userId };
    const created = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Seed Strategy',
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.error.code}`);
    return created.data;
  }

  it('returns strategy_not_found for a cross-workspace strategyId — indistinguishable from missing', async () => {
    const userId = await createUser(db, 'p06d-act-cross-a');
    const otherUserId = await createUser(db, 'p06d-act-cross-b');
    const workspaceId = await createWorkspace(db, userId);
    const otherWorkspaceId = await createWorkspace(db, otherUserId);
    userIds.push(userId, otherUserId);
    workspaceIds.push(workspaceId, otherWorkspaceId);

    const otherStrategy = await seedStrategy(otherWorkspaceId, otherUserId);

    actionState.context = { workspaceId, userId };
    const missing = await updateStrategyAction({ strategyId: crypto.randomUUID(), name: 'X' });
    const crossWorkspace = await updateStrategyAction({
      strategyId: otherStrategy.strategyId,
      name: 'X',
    });
    expect(missing).toEqual({ ok: false, error: { code: 'strategy_not_found' } });
    expect(crossWorkspace).toEqual({ ok: false, error: { code: 'strategy_not_found' } });
  });

  it('rejects mutating an archived Strategy, never revalidates on that failure, and reports final archived state on lifecycle success', async () => {
    const userId = await createUser(db, 'p06d-act-archived');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const created = await seedStrategy(workspaceId, userId);

    const archived = await archiveStrategyAction({ strategyId: created.strategyId });
    expect(archived).toEqual({
      ok: true,
      data: { strategyId: created.strategyId, isArchived: true },
    });
    assertJsonSerializable(archived);

    revalidatePath.mockClear();
    const attempt = await updateStrategyAction({
      strategyId: created.strategyId,
      name: 'New name',
    });
    expect(attempt).toEqual({ ok: false, error: { code: 'strategy_archived' } });
    expect(revalidatePath).not.toHaveBeenCalled();

    const restored = await restoreStrategyAction({ strategyId: created.strategyId });
    expect(restored).toEqual({
      ok: true,
      data: { strategyId: created.strategyId, isArchived: false },
    });
    const [row] = await db.select().from(strategies).where(eq(strategies.id, created.strategyId));
    expect(row?.isArchived).toBe(false);
  });

  it('rejects a client attempt to smuggle currentVersionId/isArchived through the schema boundary', async () => {
    const userId = await createUser(db, 'p06d-act-forge');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const created = await seedStrategy(workspaceId, userId);

    const result = await updateStrategyAction({
      strategyId: created.strategyId,
      name: 'Forged',
      currentVersionId: crypto.randomUUID(),
    } as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_error' } });
  });

  it('returns the canonical current-Version data on a successful update, including strategyId', async () => {
    const userId = await createUser(db, 'p06d-act-update-shape');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const created = await seedStrategy(workspaceId, userId);

    const result = await updateStrategyAction({ strategyId: created.strategyId, name: 'Renamed' });
    expect(result).toEqual({
      ok: true,
      data: {
        strategyId: created.strategyId,
        versionId: created.versionId,
        versionNumber: created.versionNumber,
        copied: false,
      },
    });
    assertJsonSerializable(result);
  });
});

describe('Setup and Rule actions (real PostgreSQL)', () => {
  const db = getTestDb();

  async function seedStrategy(workspaceId: string, userId: string) {
    actionState.context = { workspaceId, userId };
    const created = await createStrategyAction({
      mutationKey: crypto.randomUUID(),
      name: 'Seed Strategy',
    });
    if (!created.ok) throw new Error(`fixture failed: ${created.error.code}`);
    return created.data;
  }

  it('creates a Setup, then a Rule scoped to it — keyed by ruleKey, never the internal Rule row id — updates and removes the Rule idempotently', async () => {
    const userId = await createUser(db, 'p06d-act-setup-rule');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, userId);

    const setup = await createSetupAction({
      strategyId: strategy.strategyId,
      mutationKey: crypto.randomUUID(),
      name: 'Retest entry',
      sortOrder: 0,
    });
    expect(setup.ok).toBe(true);
    if (!setup.ok) return;

    const ruleKey = crypto.randomUUID();
    const rule = await createStrategyRuleAction({
      strategyId: strategy.strategyId,
      setupId: setup.data.setupId,
      ruleKey,
      category: 'entry',
      title: 'Wait for close above level',
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: 0,
    });
    expect(rule).toMatchObject({
      ok: true,
      data: { strategyId: strategy.strategyId, ruleKey, alreadyCreated: false },
    });
    if (rule.ok) {
      // The public contract never carries an internal Rule row id.
      expect((rule.data as unknown as Record<string, unknown>).ruleId).toBeUndefined();
      assertJsonSerializable(rule);
    }

    const updated = await updateStrategyRuleAction({
      strategyId: strategy.strategyId,
      setupId: setup.data.setupId,
      ruleKey,
      category: 'entry',
      title: 'Wait for daily close above level',
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: 0,
    });
    expect(updated).toMatchObject({ ok: true, data: { strategyId: strategy.strategyId, ruleKey } });

    const removed = await removeStrategyRuleAction({ strategyId: strategy.strategyId, ruleKey });
    expect(removed).toMatchObject({ ok: true, data: { ruleKey, alreadyRemoved: false } });
    const removedAgain = await removeStrategyRuleAction({
      strategyId: strategy.strategyId,
      ruleKey,
    });
    expect(removedAgain).toMatchObject({ ok: true, data: { ruleKey, alreadyRemoved: true } });

    const archivedSetup = await archiveSetupAction({
      strategyId: strategy.strategyId,
      setupId: setup.data.setupId,
    });
    expect(archivedSetup).toEqual({
      ok: true,
      data: { strategyId: strategy.strategyId, setupId: setup.data.setupId, isArchived: true },
    });
  });

  it('rejects an invalid rule category as validation_error', async () => {
    const userId = await createUser(db, 'p06d-act-invalid-category');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    const strategy = await seedStrategy(workspaceId, userId);

    const result = await createStrategyRuleAction({
      strategyId: strategy.strategyId,
      ruleKey: crypto.randomUUID(),
      category: 'not-a-real-category',
      title: 'Bad rule',
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: 0,
    } as never);
    expect(result).toMatchObject({ ok: false, error: { code: 'validation_error' } });
  });
});

describe('action-result serialization (no DB required, colocated for the server-only import boundary)', () => {
  it('every failure branch is JSON-serializable and free of Error/stack/cause', () => {
    const failures = [
      { ok: false, error: { code: 'unauthenticated' as const } },
      { ok: false, error: { code: 'workspace_access_denied' as const } },
      {
        ok: false,
        error: { code: 'validation_error' as const, fieldErrors: { name: ['Required'] } },
      },
      { ok: false, error: { code: 'strategy_archived' as const } },
      { ok: false, error: { code: 'unexpected_error' as const } },
    ];
    for (const failure of failures) {
      assertJsonSerializable(failure);
    }
  });
});
