import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
  exitPlans,
  trades,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { archiveStrategy, createStrategy } from '@/server/services/strategy-management';
import {
  buildAtEntryPayload,
  chooseNoExitRule,
  chooseSavedExitPlan,
  createAtEntryDraft,
  removeExitPlanAnswer,
  resolveExitPlan,
  restoreStrategyDefault,
  selectStrategy,
  type AtEntryDraft,
} from '@/components/trades/at-entry-draft';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';

/**
 * SAVED EXIT PLANS AS A REAL USER REACHES THEM.
 *
 * No plan is inserted behind the user's back: every plan below is created
 * through `createExitPlanAction`, read back through the same
 * `getTradeCreateOptions` At Entry renders from, chosen through the At Entry
 * draft model, and saved through `createTradeAction` with the payload the
 * form itself builds. Only the session is mocked (`@/server/auth/dal`); the
 * services underneath re-verify membership and entitlement against the real
 * database, which is why mocking the precheck does not weaken the boundary.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const actionState = vi.hoisted(() => ({
  context: null as null | { workspaceId: string; userId: string },
}));

vi.mock('@/server/auth/dal', () => {
  class UnauthenticatedError extends Error {
    constructor() {
      super('No authenticated session.');
      this.name = 'UnauthenticatedError';
    }
  }
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    getActiveWorkspaceContext: async () => {
      if (actionState.context === null) throw new UnauthenticatedError();
      return actionState.context;
    },
    requireStrategyManagement: async () => 'member' as const,
    requireTradeManagement: async () => 'member' as const,
  };
});

const {
  archiveExitPlanAction,
  createExitPlanAction,
  removeExitPlanStrategyDefaultAction,
  setExitPlanStrategyDefaultAction,
  updateExitPlanAction,
} = await import('./exit-plans');
const { createTradeAction } = await import('./trades');
const { getTradeCreateOptions } = await import('@/server/dal/trades');

const db = getTestDb();
const userIds: string[] = [];
const workspaceIds: string[] = [];

async function createOwnedWorkspace(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user insert failed');
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: label, slug: `exit-plans-${crypto.randomUUID()}`, kind: 'personal' })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace insert failed');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
  await db.insert(userPreferences).values({ userId: user.id, activeWorkspaceId: workspace.id });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(Date.now() - 86_400_000),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 86_400_000),
  });
  const [account] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId: workspace.id,
      name: 'Exit plan account',
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '10000.0000000000',
      timezone: 'UTC',
      mutationKey: crypto.randomUUID(),
    })
    .returning({ id: tradingAccounts.id });
  if (account === undefined) throw new Error('account insert failed');
  userIds.push(user.id);
  workspaceIds.push(workspace.id);
  return { userId: user.id, workspaceId: workspace.id, tradingAccountId: account.id };
}

async function strategyIn(workspace: { workspaceId: string; userId: string }, name: string) {
  const result = await createStrategy(workspace.workspaceId, workspace.userId, {
    mutationKey: crypto.randomUUID(),
    name,
  });
  if (!result.ok) throw new Error(`strategy create failed: ${result.code}`);
  return result.strategyId;
}

function as(workspace: { workspaceId: string; userId: string }) {
  actionState.context = { workspaceId: workspace.workspaceId, userId: workspace.userId };
}

async function createPlan(name: string, instructions: string): Promise<string> {
  const result = await createExitPlanAction({
    mutationKey: crypto.randomUUID(),
    name,
    instructions,
  });
  if (!result.ok) throw new Error(`plan create failed: ${result.error.code}`);
  return result.data.exitPlanId;
}

function draftFor(tradingAccountId: string): AtEntryDraft {
  return {
    ...createAtEntryDraft(tradingAccountId),
    symbol: 'XAUUSD',
    direction: 'long',
    risk: '100',
  };
}

async function saveTrade(draft: AtEntryDraft) {
  const options = await getTradeCreateOptions();
  const payload = buildAtEntryPayload(draft, {
    currency: 'USD',
    timezone: 'UTC',
    mutationKey: crypto.randomUUID(),
    options,
  });
  if (payload === null) throw new Error('draft is not ready');
  const result = await createTradeAction(payload);
  if (!result.ok) throw new Error(`trade create failed: ${JSON.stringify(result.error)}`);
  const [row] = await db.select().from(trades).where(eq(trades.id, result.data.tradeId));
  if (row === undefined) throw new Error('trade missing');
  return row;
}

let me: Awaited<ReturnType<typeof createOwnedWorkspace>>;
let other: Awaited<ReturnType<typeof createOwnedWorkspace>>;

beforeAll(async () => {
  me = await createOwnedWorkspace('exit-plan-owner');
  other = await createOwnedWorkspace('exit-plan-other');
});

afterEach(() => {
  actionState.context = null;
});

afterAll(async () => {
  await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
  await db.delete(users).where(inArray(users.id, userIds));
  await closeDb();
  await closeTestDb();
});

describe('Saved Exit Plans — the real user workflow', () => {
  it('create → choose → edit → snapshot kept → archive → gone from choices → snapshot kept', async () => {
    as(me);
    const planId = await createPlan('Scale out', 'Half at 1R.\nTrail the rest behind structure.');

    // 2. It appears in At Entry, with its line break intact.
    let options = await getTradeCreateOptions();
    expect(options.exitPlans).toContainEqual({
      exitPlanId: planId,
      name: 'Scale out',
      instructions: 'Half at 1R.\nTrail the rest behind structure.',
      strategyId: null,
    });

    // 3. The user selects it and saves a Trade.
    const chosen = chooseSavedExitPlan(draftFor(me.tradingAccountId), planId, options);
    expect(resolveExitPlan(chosen, options).resolved).toMatchObject({ status: 'saved' });
    const first = await saveTrade(chosen);
    expect(first).toMatchObject({
      exitPlanState: 'saved',
      exitPlanProvenance: 'selected',
      exitPlanId: planId,
      exitPlanName: 'Scale out',
      exitPlanInstructions: 'Half at 1R.\nTrail the rest behind structure.',
    });

    // 4. The user edits the library definition.
    expect(
      await updateExitPlanAction({
        exitPlanId: planId,
        name: 'Scale out v2',
        instructions: 'Close everything at 2R.',
      }),
    ).toMatchObject({ ok: true, data: { exitPlanId: planId } });
    options = await getTradeCreateOptions();
    expect(options.exitPlans.find((plan) => plan.exitPlanId === planId)).toMatchObject({
      name: 'Scale out v2',
      instructions: 'Close everything at 2R.',
    });

    // 5. The existing Trade still says what its plan was then.
    const [afterEdit] = await db.select().from(trades).where(eq(trades.id, first.id));
    expect(afterEdit).toMatchObject({
      exitPlanName: 'Scale out',
      exitPlanInstructions: 'Half at 1R.\nTrail the rest behind structure.',
      exitPlanId: planId,
    });

    // 6–7. Archived, it leaves active selection and cannot be edited or chosen.
    const archived = await archiveExitPlanAction({ exitPlanId: planId });
    expect(archived).toMatchObject({ ok: true, data: { exitPlanId: planId } });
    options = await getTradeCreateOptions();
    // The action returns the library a fresh At Entry load would offer, so the
    // editor never has to wait for the page to catch up.
    if (!archived.ok) throw new Error('unreachable');
    expect(archived.exitPlans).toEqual(options.exitPlans);
    expect(options.exitPlans.some((plan) => plan.exitPlanId === planId)).toBe(false);
    expect(
      await updateExitPlanAction({ exitPlanId: planId, name: 'Again', instructions: 'No.' }),
    ).toEqual({ ok: false, error: { code: 'exit_plan_archived' } });
    const stale = await createTradeAction(
      buildAtEntryPayload(
        chooseSavedExitPlan(draftFor(me.tradingAccountId), planId, {
          exitPlans: [
            { exitPlanId: planId, name: 'Scale out v2', instructions: 'x', strategyId: null },
          ],
        }),
        {
          currency: 'USD',
          timezone: 'UTC',
          mutationKey: crypto.randomUUID(),
          options: {
            strategies: options.strategies,
            exitPlans: [
              { exitPlanId: planId, name: 'Scale out v2', instructions: 'x', strategyId: null },
            ],
          },
        },
      ),
    );
    expect(stale.ok).toBe(false);

    // 8. The historical snapshot remains, and the row is archived, not deleted.
    const [afterArchive] = await db.select().from(trades).where(eq(trades.id, first.id));
    expect(afterArchive).toMatchObject({
      exitPlanName: 'Scale out',
      exitPlanInstructions: 'Half at 1R.\nTrail the rest behind structure.',
      exitPlanId: planId,
    });
    const [archivedRow] = await db.select().from(exitPlans).where(eq(exitPlans.id, planId));
    expect(archivedRow?.isArchived).toBe(true);

    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, me.workspaceId), eq(auditLogs.entityId, planId)));
    expect(actions.map((row) => row.action).sort()).toEqual(
      ['exit_plan.archived', 'exit_plan.created', 'exit_plan.updated'].sort(),
    );
  });

  it('default → inherit → decline → restore, and the Trade records each answer honestly', async () => {
    as(me);
    const strategyId = await strategyIn(me, `Breakout ${crypto.randomUUID()}`);
    const planId = await createPlan('Trail', 'Trail behind each higher low.');

    // 9. The user makes it the Strategy default.
    expect(
      await setExitPlanStrategyDefaultAction({ exitPlanId: planId, strategyId }),
    ).toMatchObject({
      ok: true,
      data: { replacedExitPlanId: null },
    });
    const options = await getTradeCreateOptions();

    // 10. At Entry inherits it, visibly, once the Strategy is selected.
    const selected = selectStrategy(draftFor(me.tradingAccountId), strategyId);
    expect(resolveExitPlan(selected, options)).toMatchObject({
      resolved: { status: 'inherited', plan: { exitPlanId: planId } },
      inheritanceDeclined: false,
    });
    expect(await saveTrade(selected)).toMatchObject({
      exitPlanState: 'saved',
      exitPlanProvenance: 'strategy_default',
      exitPlanId: planId,
      exitPlanInheritanceDeclined: false,
    });

    // 11. Declined: Not recorded, and the refusal is itself recorded.
    const declined = removeExitPlanAnswer(selected);
    expect(resolveExitPlan(declined, options)).toMatchObject({
      resolved: { status: 'not_recorded' },
      inheritanceDeclined: true,
    });
    expect(await saveTrade(declined)).toMatchObject({
      exitPlanState: null,
      exitPlanId: null,
      exitPlanInheritanceDeclined: true,
    });

    // An explicit No Defined Exit Rule also overrides it.
    expect(await saveTrade(chooseNoExitRule(selected))).toMatchObject({
      exitPlanState: 'no_rule',
      exitPlanInheritanceDeclined: true,
    });

    // 12. Restored explicitly, it inherits again.
    const restored = restoreStrategyDefault(declined);
    expect(resolveExitPlan(restored, options).resolved).toMatchObject({ status: 'inherited' });
    expect(await saveTrade(restored)).toMatchObject({
      exitPlanProvenance: 'strategy_default',
      exitPlanInheritanceDeclined: false,
    });
  });

  it('replaces and removes a Strategy default without touching the plans themselves', async () => {
    as(me);
    const strategyId = await strategyIn(me, `Reversal ${crypto.randomUUID()}`);
    const firstPlan = await createPlan('First', 'First rule.');
    const secondPlan = await createPlan('Second', 'Second rule.');

    await setExitPlanStrategyDefaultAction({ exitPlanId: firstPlan, strategyId });
    expect(
      await setExitPlanStrategyDefaultAction({ exitPlanId: secondPlan, strategyId }),
    ).toMatchObject({
      ok: true,
      data: { replacedExitPlanId: firstPlan },
    });
    let options = await getTradeCreateOptions();
    expect(options.exitPlans.filter((plan) => plan.strategyId === strategyId)).toEqual([
      expect.objectContaining({ exitPlanId: secondPlan }),
    ]);
    expect(options.exitPlans.some((plan) => plan.exitPlanId === firstPlan)).toBe(true);

    // Setting the same default again is a no-op, not a replacement of itself.
    expect(
      await setExitPlanStrategyDefaultAction({ exitPlanId: secondPlan, strategyId }),
    ).toMatchObject({
      ok: true,
      data: { replacedExitPlanId: null },
    });

    expect(await removeExitPlanStrategyDefaultAction({ exitPlanId: secondPlan })).toMatchObject({
      ok: true,
    });
    options = await getTradeCreateOptions();
    expect(options.exitPlans.some((plan) => plan.strategyId === strategyId)).toBe(false);
    expect(
      resolveExitPlan(selectStrategy(draftFor(me.tradingAccountId), strategyId), options).resolved,
    ).toEqual({ status: 'not_recorded' });

    // Archiving a default plan also ends its default. The At Entry read hides
    // archived plans anyway, so this is judged on the stored row: an archived
    // plan must not keep claiming to be a Strategy's default.
    await setExitPlanStrategyDefaultAction({ exitPlanId: firstPlan, strategyId });
    await archiveExitPlanAction({ exitPlanId: firstPlan });
    const [archived] = await db.select().from(exitPlans).where(eq(exitPlans.id, firstPlan));
    expect(archived).toMatchObject({ isArchived: true, strategyId: null });
  });

  it('refuses archived Strategies and archived plans as defaults', async () => {
    as(me);
    const strategyId = await strategyIn(me, `Archived ${crypto.randomUUID()}`);
    const planId = await createPlan('Plan', 'Rule.');
    await archiveStrategy(me.workspaceId, me.userId, strategyId);
    expect(await setExitPlanStrategyDefaultAction({ exitPlanId: planId, strategyId })).toEqual({
      ok: false,
      error: { code: 'strategy_archived' },
    });

    const liveStrategy = await strategyIn(me, `Live ${crypto.randomUUID()}`);
    await archiveExitPlanAction({ exitPlanId: planId });
    expect(
      await setExitPlanStrategyDefaultAction({ exitPlanId: planId, strategyId: liveStrategy }),
    ).toEqual({ ok: false, error: { code: 'exit_plan_archived' } });
  });

  it('is idempotent on the mutation key and refuses blank or forged input', async () => {
    as(me);
    const mutationKey = crypto.randomUUID();
    const first = await createExitPlanAction({ mutationKey, name: 'Once', instructions: 'Rule.' });
    const replay = await createExitPlanAction({ mutationKey, name: 'Once', instructions: 'Rule.' });
    expect(first.ok && replay.ok && first.data.exitPlanId === replay.data.exitPlanId).toBe(true);

    expect(
      await createExitPlanAction({
        mutationKey: crypto.randomUUID(),
        name: '  ',
        instructions: 'x',
      }),
    ).toEqual({ ok: false, error: { code: 'validation_error' } });
    expect(
      await createExitPlanAction({
        mutationKey: crypto.randomUUID(),
        name: 'x',
        instructions: '\n ',
      }),
    ).toEqual({ ok: false, error: { code: 'validation_error' } });
    expect(
      await createExitPlanAction({
        mutationKey: crypto.randomUUID(),
        name: 'x',
        instructions: 'y',
        workspaceId: other.workspaceId,
      }),
    ).toEqual({ ok: false, error: { code: 'validation_error' } });
  });
});

describe('Saved Exit Plans — workspace isolation', () => {
  it('never reads, edits, archives or defaults another workspace’s plan or Strategy', async () => {
    as(other);
    const foreignPlan = await createPlan('Theirs', 'Not yours.');
    const foreignStrategy = await strategyIn(other, `Theirs ${crypto.randomUUID()}`);

    as(me);
    const minePlan = await createPlan('Mine', 'Mine.');
    const mineStrategy = await strategyIn(me, `Mine ${crypto.randomUUID()}`);

    const options = await getTradeCreateOptions();
    expect(options.exitPlans.some((plan) => plan.exitPlanId === foreignPlan)).toBe(false);

    const notFound = { ok: false, error: { code: 'exit_plan_not_found' } };
    expect(
      await updateExitPlanAction({ exitPlanId: foreignPlan, name: 'Hijack', instructions: 'x' }),
    ).toEqual(notFound);
    expect(await archiveExitPlanAction({ exitPlanId: foreignPlan })).toEqual(notFound);
    expect(await removeExitPlanStrategyDefaultAction({ exitPlanId: foreignPlan })).toEqual(
      notFound,
    );
    expect(
      await setExitPlanStrategyDefaultAction({ exitPlanId: foreignPlan, strategyId: mineStrategy }),
    ).toEqual(notFound);
    expect(
      await setExitPlanStrategyDefaultAction({ exitPlanId: minePlan, strategyId: foreignStrategy }),
    ).toEqual({ ok: false, error: { code: 'strategy_not_found' } });

    const [untouched] = await db.select().from(exitPlans).where(eq(exitPlans.id, foreignPlan));
    expect(untouched).toMatchObject({ name: 'Theirs', isArchived: false, strategyId: null });

    // The database refuses it too, whatever a service might someday forget.
    await expect(
      db.update(exitPlans).set({ strategyId: foreignStrategy }).where(eq(exitPlans.id, minePlan)),
    ).rejects.toThrow();
  });
});
