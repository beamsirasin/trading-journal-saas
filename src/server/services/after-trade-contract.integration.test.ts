/**
 * ADD TRADE CONTRACT v1 — After Trade (Save Closed Trade) against a real database.
 *
 * What a historical Closed Trade must persist, and what nothing may invent:
 * only identity is required; blank stays blank; the trader's outcome is stored
 * as chosen and never derived; Actual R is Final Net P&L / Risk at Entry and
 * exists only when both do; exit history is supporting evidence whose
 * discrepancy never blocks; nothing is inherited from today's Strategy; and
 * every answer supplied here is recorded as recalled after the trade. Later
 * edits must keep a selected outcome and a stated Final Net P&L.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import {
  emotionTypes,
  exitPlans,
  tradeEmotions,
  tradeExits,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { createSetup, createSetupCondition, createStrategy } from './strategy-management';
import { createCompletedTrade, type CreateCompletedTradeInput } from './trade-completed';
import { correctTradeExit } from './trade-execution';
import {
  adoptHistoricalExitSubtotal,
  applyHistoricalExitHistoryCorrection,
  editHistoricalFinalResult,
} from './trade-historical-execution';
import { correctTradeExecution, createTrade, updateTradePlan } from './trade-management';

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
      name: 'After Trade test workspace',
      slug: `after-trade-${crypto.randomUUID()}`,
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

const HOUR = 60 * 60 * 1000;

describe('Add Trade contract After Trade (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    actorUserId = await createUser(db, 'after-trade-actor');
    otherUserId = await createUser(db, 'after-trade-other');
    workspaceId = await createWorkspace(db, actorUserId);
    otherWorkspaceId = await createWorkspace(db, otherUserId);
  });

  afterEach(async () => {
    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(
        and(
          inArray(tradingAccounts.workspaceId, [workspaceId, otherWorkspaceId]),
          eq(tradingAccounts.isArchived, false),
        ),
      );
  });

  afterAll(async () => {
    await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]));
    await db.delete(users).where(inArray(users.id, [actorUserId, otherUserId]));
    await closeTestDb();
  });

  async function freshFramework() {
    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'After Trade account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      })
      .returning({ id: tradingAccounts.id });
    if (account === undefined) throw new Error('failed to insert trading account');
    const strategy = await createStrategy(workspaceId, actorUserId, {
      mutationKey: crypto.randomUUID(),
      name: `After Trade Strategy ${crypto.randomUUID()}`,
    });
    if (!strategy.ok) throw new Error(`strategy creation failed: ${strategy.code}`);
    const setup = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'After Trade Setup',
      sortOrder: 0,
    });
    if (!setup.ok) throw new Error(`setup creation failed: ${setup.code}`);
    const snapshot = await db.query.strategySetupVersions.findFirst({
      where: (t, { and: andOp, eq: eqOp }) =>
        andOp(eqOp(t.strategyVersionId, setup.versionId), eqOp(t.setupId, setup.setupId)),
    });
    if (snapshot === undefined) throw new Error('setup snapshot missing');
    return {
      tradingAccountId: account.id,
      strategyId: strategy.strategyId,
      setupId: setup.setupId,
      setupVersionId: snapshot.id,
    };
  }

  type Framework = Awaited<ReturnType<typeof freshFramework>>;

  function input(
    fw: Framework,
    overrides: Partial<CreateCompletedTradeInput> = {},
  ): CreateCompletedTradeInput {
    return {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: fw.tradingAccountId,
      recordingTiming: 'after_trade',
      recordingContract: 'add_trade_v1',
      symbol: 'XAUUSD',
      direction: 'long',
      ...overrides,
    };
  }

  async function save(fw: Framework, overrides: Partial<CreateCompletedTradeInput> = {}) {
    const result = await createCompletedTrade(workspaceId, actorUserId, input(fw, overrides));
    if (!result.ok) throw new Error(`After Trade save failed: ${result.code}`);
    return result;
  }

  async function readTrade(tradeId: string) {
    const [row] = await db.select().from(trades).where(eq(trades.id, tradeId));
    if (row === undefined) throw new Error('trade row missing');
    return row;
  }

  async function readExits(tradeId: string) {
    return db
      .select()
      .from(tradeExits)
      .where(eq(tradeExits.tradeId, tradeId))
      .orderBy(asc(tradeExits.sequence));
  }

  async function insertExitPlan(values: { strategyId?: string | null; name?: string }) {
    const [plan] = await db
      .insert(exitPlans)
      .values({
        workspaceId,
        strategyId: values.strategyId ?? null,
        name: values.name ?? 'Scale out',
        instructions: 'Half at 1R, trail the rest behind structure.',
      })
      .returning();
    if (plan === undefined) throw new Error('failed to insert exit plan');
    return plan;
  }

  describe('the minimum', () => {
    it('saves a closed contract Trade from Account, Symbol and Direction alone', async () => {
      const fw = await freshFramework();
      const result = await save(fw);
      expect(result).toMatchObject({
        ok: true,
        alreadyCreated: false,
        status: 'closed',
        actualR: null,
        traderOutcome: null,
        systemStatus: 'pending',
      });
      const row = await readTrade(result.tradeId);
      expect(row).toMatchObject({
        status: 'closed',
        recordingContract: 'add_trade_v1',
        actualResultMode: 'money',
        enteredAt: null,
        enteredAtSource: null,
        exitedAt: null,
        plannedRiskMinor: null,
        actualRiskAnswer: null,
        actualInitialRiskMinor: null,
        targetState: null,
        exitPlanState: null,
        netPnlMinor: null,
        finalPnlSource: null,
        actualR: null,
        traderOutcome: null,
        traderOutcomeSelectedAt: null,
        exitHistoryCompleteness: null,
        strategyId: null,
        noStrategy: false,
        strategyOrigin: null,
        setupOrigin: null,
        exitPlanOrigin: null,
        confidenceOrigin: null,
        emotionsOrigin: null,
        emotionsRecordedAt: null,
        postTradeEmotionsRecordedAt: null,
      });
      expect(await readExits(result.tradeId)).toEqual([]);
    });

    it('refuses a write without the Add Trade contract', async () => {
      const fw = await freshFramework();
      const { recordingContract: _omitted, ...legacy } = input(fw);
      expect(
        await createCompletedTrade(
          workspaceId,
          actorUserId,
          legacy as unknown as CreateCompletedTradeInput,
        ),
      ).toEqual({ ok: false, code: 'invalid_plan_authority' });
    });

    it('replays the same mutation key into exactly one Trade', async () => {
      const fw = await freshFramework();
      const request = input(fw, { finalPnlMinor: 1_500n, traderOutcome: 'win' });
      const first = await createCompletedTrade(workspaceId, actorUserId, request);
      const replay = await createCompletedTrade(workspaceId, actorUserId, request);
      expect(first).toMatchObject({ ok: true, alreadyCreated: false });
      expect(replay).toMatchObject({ ok: true, alreadyCreated: true });
      if (!first.ok || !replay.ok) return;
      expect(replay.tradeId).toBe(first.tradeId);
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(
          and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, request.mutationKey)),
        );
      expect(rows).toHaveLength(1);
    });

    it('refuses the same key with different answers, and never overwrites the saved Trade', async () => {
      const fw = await freshFramework();
      const request = input(fw, { finalPnlMinor: 1_500n, traderOutcome: 'win' });
      const first = await createCompletedTrade(workspaceId, actorUserId, request);
      if (!first.ok) throw new Error('first save failed');
      // An edit made after a Save whose answer was lost, retried with the old key.
      const edited = await createCompletedTrade(workspaceId, actorUserId, {
        ...request,
        finalPnlMinor: 1_700n,
      });
      expect(edited).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        existingTradeId: first.tradeId,
        replayConflict: 'different',
      });
      expect(await readTrade(first.tradeId)).toMatchObject({ netPnlMinor: 1_500n });
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(
          and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, request.mutationKey)),
        );
      expect(rows).toHaveLength(1);
    });

    it('refuses a Save key replayed across recording modes, in both directions', async () => {
      const fw = await freshFramework();
      const atEntryRequest = {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        recordingTiming: 'at_entry' as const,
        recordingContract: 'add_trade_v1' as const,
        systemPlanBasis: 'money' as const,
        symbol: 'XAUUSD',
        direction: 'long',
        plannedRiskMinor: 10_000n,
        plannedRiskState: 'defined' as const,
      };
      const open = await createTrade(workspaceId, actorUserId, atEntryRequest);
      if (!open.ok) throw new Error('At Entry save failed');
      // At Entry key replayed as After Trade.
      expect(
        await createCompletedTrade(
          workspaceId,
          actorUserId,
          input(fw, { mutationKey: atEntryRequest.mutationKey }),
        ),
      ).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        existingTradeId: open.tradeId,
        replayConflict: 'different',
      });

      // After Trade key replayed as At Entry.
      const closed = await save(fw);
      const closedRow = await readTrade(closed.tradeId);
      expect(
        await createTrade(workspaceId, actorUserId, {
          ...atEntryRequest,
          mutationKey: closedRow.mutationKey,
        }),
      ).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        existingTradeId: closed.tradeId,
        replayConflict: 'different',
      });
      expect(await readTrade(closed.tradeId)).toMatchObject({ status: 'closed' });
    });

    /*
      A TRADE FROM BEFORE MIGRATION 0024 stored only its key. Its creating
      request is not provable, so no replay of that key is honest — not even one
      with identical answers — and no fingerprint is ever backfilled from it.
    */
    describe('a Trade saved before migration 0024 (no fingerprint)', () => {
      async function unfingerprinted(tradeId: string) {
        await db.update(trades).set({ mutationFingerprint: null }).where(eq(trades.id, tradeId));
        return readTrade(tradeId);
      }

      it('refuses an identical Save Closed Trade replay as unverifiable, and changes nothing', async () => {
        const fw = await freshFramework();
        const request = input(fw, { finalPnlMinor: 1_500n, traderOutcome: 'win' });
        const first = await createCompletedTrade(workspaceId, actorUserId, request);
        if (!first.ok) throw new Error('first save failed');
        const before = await unfingerprinted(first.tradeId);

        expect(await createCompletedTrade(workspaceId, actorUserId, request)).toEqual({
          ok: false,
          code: 'mutation_replay_conflict',
          existingTradeId: first.tradeId,
          replayConflict: 'unverifiable',
        });
        const after = await readTrade(first.tradeId);
        expect(after).toEqual(before);
        expect(after.mutationFingerprint).toBeNull();

        // "Save this draft as a new trade": a fresh key creates a second Trade.
        const asNew = await createCompletedTrade(workspaceId, actorUserId, {
          ...request,
          mutationKey: crypto.randomUUID(),
        });
        expect(asNew).toMatchObject({ ok: true, alreadyCreated: false });
        if (!asNew.ok) return;
        expect(asNew.tradeId).not.toBe(first.tradeId);
        expect((await readTrade(asNew.tradeId)).mutationFingerprint).toMatch(/^[0-9a-f]{64}$/);
      });

      it('refuses an identical At Entry replay as unverifiable, and changes nothing', async () => {
        const fw = await freshFramework();
        const request = {
          mutationKey: crypto.randomUUID(),
          tradingAccountId: fw.tradingAccountId,
          recordingTiming: 'at_entry' as const,
          recordingContract: 'add_trade_v1' as const,
          systemPlanBasis: 'money' as const,
          symbol: 'XAUUSD',
          direction: 'long',
          plannedRiskMinor: 10_000n,
          plannedRiskState: 'defined' as const,
        };
        const first = await createTrade(workspaceId, actorUserId, request);
        if (!first.ok) throw new Error('first save failed');
        const before = await unfingerprinted(first.tradeId);

        expect(await createTrade(workspaceId, actorUserId, request)).toEqual({
          ok: false,
          code: 'mutation_replay_conflict',
          existingTradeId: first.tradeId,
          replayConflict: 'unverifiable',
        });
        expect(await readTrade(first.tradeId)).toEqual(before);
        const rows = await db
          .select({ id: trades.id })
          .from(trades)
          .where(eq(trades.mutationKey, request.mutationKey));
        expect(rows).toHaveLength(1);
      });
    });

    it('still honours an honest replay of a fingerprinted Trade', async () => {
      const fw = await freshFramework();
      const request = input(fw, { finalPnlMinor: 900n });
      const first = await createCompletedTrade(workspaceId, actorUserId, request);
      if (!first.ok) throw new Error('first save failed');
      expect(await createCompletedTrade(workspaceId, actorUserId, request)).toMatchObject({
        ok: true,
        tradeId: first.tradeId,
        alreadyCreated: true,
      });
    });

    it('stores the request fingerprint with the Trade', async () => {
      const fw = await freshFramework();
      const result = await save(fw);
      expect((await readTrade(result.tradeId)).mutationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never writes into another workspace from a foreign account', async () => {
      const fw = await freshFramework();
      expect(await createCompletedTrade(otherWorkspaceId, actorUserId, input(fw))).toMatchObject({
        ok: false,
      });
    });

    it('records the times given, and an entry time as the trader’s own', async () => {
      const fw = await freshFramework();
      const exitedAt = new Date(Date.now() - HOUR);
      const enteredAt = new Date(exitedAt.getTime() - 2 * HOUR);
      const result = await save(fw, { enteredAt, exitedAt });
      const row = await readTrade(result.tradeId);
      expect(row.enteredAt?.toISOString()).toBe(enteredAt.toISOString());
      expect(row.enteredAtSource).toBe('trader');
      expect(row.exitedAt?.toISOString()).toBe(exitedAt.toISOString());
      expect(
        await createCompletedTrade(
          workspaceId,
          actorUserId,
          input(fw, { enteredAt: exitedAt, exitedAt: enteredAt }),
        ),
      ).toEqual({ ok: false, code: 'invalid_completed_trade_time' });
    });
  });

  describe('Final Net P&L, Trader Outcome and Actual R', () => {
    it('stores the trader’s outcome as chosen, even against the P&L sign', async () => {
      const fw = await freshFramework();
      const winAtLoss = await save(fw, { finalPnlMinor: -2_500n, traderOutcome: 'win' });
      const scratch = await save(fw, {
        finalPnlMinor: 1_000n,
        plannedRiskMinor: 5_000n,
        traderOutcome: 'break_even',
      });
      const winRow = await readTrade(winAtLoss.tradeId);
      expect(winRow).toMatchObject({
        netPnlMinor: -2_500n,
        finalPnlSource: 'manual_total',
        traderOutcome: 'win',
        actualR: null,
      });
      expect(winRow.traderOutcomeSelectedAt).not.toBeNull();
      expect(await readTrade(scratch.tradeId)).toMatchObject({
        traderOutcome: 'break_even',
        actualR: '0.2000',
      });
    });

    it('stores an outcome without a P&L, and a P&L without an outcome', async () => {
      const fw = await freshFramework();
      const outcomeOnly = await save(fw, { traderOutcome: 'loss' });
      const pnlOnly = await save(fw, { finalPnlMinor: -800n });
      expect(await readTrade(outcomeOnly.tradeId)).toMatchObject({
        netPnlMinor: null,
        traderOutcome: 'loss',
      });
      expect(await readTrade(pnlOnly.tradeId)).toMatchObject({
        netPnlMinor: -800n,
        traderOutcome: null,
        traderOutcomeSelectedAt: null,
      });
    });

    it('measures Actual R against Risk at Entry only, and only when both are known', async () => {
      const fw = await freshFramework();
      const both = await save(fw, {
        finalPnlMinor: 7_500n,
        plannedRiskMinor: 5_000n,
      });
      const noRisk = await save(fw, { finalPnlMinor: 7_500n });
      const noPnl = await save(fw, { plannedRiskMinor: 5_000n });
      expect(both.actualR).toBe('1.5000');
      expect(await readTrade(both.tradeId)).toMatchObject({
        actualR: '1.5000',
        actualRiskAnswer: null,
        actualInitialRiskMinor: null,
      });
      expect(noRisk.actualR).toBeNull();
      expect(noPnl.actualR).toBeNull();
    });

    it('treats a zero Final Net P&L as a known zero, never as Break-even', async () => {
      const fw = await freshFramework();
      const result = await save(fw, { finalPnlMinor: 0n, plannedRiskMinor: 5_000n });
      expect(await readTrade(result.tradeId)).toMatchObject({
        netPnlMinor: 0n,
        actualR: '0.0000',
        traderOutcome: null,
      });
    });
  });

  /*
    ACTUAL RISK IS RETIRED FROM CAPTURE (contract decision 56). A Record Closed
    Save may not create an Actual Risk observation in any form — answer,
    amount, or both — and a refused Save writes nothing.
  */
  describe('Actual Risk (retired)', () => {
    it.each([
      ['Matched', { actualRiskAnswer: 'matched' }],
      [
        'Different with an amount',
        { actualRiskAnswer: 'different', actualInitialRiskMinor: 6_000n },
      ],
      ['Different, amount unknown', { actualRiskAnswer: 'different' }],
      ["Don't know", { actualRiskAnswer: 'unknown' }],
      ['an amount alone', { actualInitialRiskMinor: 6_000n }],
    ] as const)('refuses %s and writes nothing', async (_label, retired) => {
      const fw = await freshFramework();
      const request = input(fw, { plannedRiskMinor: 5_000n, ...retired });
      expect(await createCompletedTrade(workspaceId, actorUserId, request)).toEqual({
        ok: false,
        code: 'actual_risk_retired',
      });
      expect(
        await db.select().from(trades).where(eq(trades.mutationKey, request.mutationKey)),
      ).toEqual([]);
    });

    it('saves the same Trade without it and stores no Actual Risk', async () => {
      const fw = await freshFramework();
      const result = await save(fw, { plannedRiskMinor: 5_000n });
      expect(await readTrade(result.tradeId)).toMatchObject({
        actualRiskAnswer: null,
        actualInitialRiskMinor: null,
        plannedRiskMinor: 5_000n,
      });
    });
  });

  describe('Target', () => {
    it('keeps Unanswered, Fixed (profit, price or both) and No Fixed Target distinct', async () => {
      const fw = await freshFramework();
      const unanswered = await save(fw);
      const profit = await save(fw, { targetState: 'fixed', plannedRewardMinor: 10_000n });
      const price = await save(fw, { targetState: 'fixed', targetPrice: '2400.5' });
      const none = await save(fw, { targetState: 'no_fixed' });
      expect(await readTrade(unanswered.tradeId)).toMatchObject({ targetState: null });
      // Remembered without a Risk at Entry: the Target stands, Planned R is unavailable.
      expect(await readTrade(profit.tradeId)).toMatchObject({
        targetState: 'fixed',
        plannedRewardMinor: 10_000n,
        plannedRiskMinor: null,
        plannedR: null,
        targetPrice: null,
      });
      expect(await readTrade(price.tradeId)).toMatchObject({
        targetState: 'fixed',
        plannedRewardMinor: null,
      });
      expect(await readTrade(none.tradeId)).toMatchObject({ targetState: 'no_fixed' });
    });

    it('refuses a Fixed Target with neither Target Profit nor TP price', async () => {
      const fw = await freshFramework();
      expect(
        await createCompletedTrade(workspaceId, actorUserId, input(fw, { targetState: 'fixed' })),
      ).toEqual({ ok: false, code: 'invalid_plan' });
    });
  });

  describe('Plan Outcome (decision 55)', () => {
    const BOUNDED = {
      plannedRiskMinor: 5_000n,
      plannedRiskState: 'defined' as const,
      targetState: 'fixed' as const,
      plannedRewardMinor: 10_000n,
    };

    it('saves the answer with the Closed Trade, in the same Save', async () => {
      const fw = await freshFramework();
      const saved = await save(fw, { ...BOUNDED, planOutcome: 'planned_risk_first' });
      const row = await readTrade(saved.tradeId);
      expect(row).toMatchObject({
        status: 'closed',
        planOutcome: 'planned_risk_first',
        planOutcomeMinor: null,
      });
      expect(row.planOutcomeRecordedAt).not.toBeNull();
    });

    it('stores an amount only where the plan cannot derive it', async () => {
      const fw = await freshFramework();
      const tpOnly = await save(fw, {
        ...BOUNDED,
        plannedRewardMinor: null,
        targetPrice: '2410',
        planOutcome: 'planned_target_first',
        planOutcomeMinor: 9_000n,
      });
      expect(await readTrade(tpOnly.tradeId)).toMatchObject({
        planOutcome: 'planned_target_first',
        planOutcomeMinor: 9_000n,
      });
    });

    it('leaves it Unanswered when the trader did not answer', async () => {
      const fw = await freshFramework();
      const saved = await save(fw, BOUNDED);
      expect(await readTrade(saved.tradeId)).toMatchObject({
        planOutcome: null,
        planOutcomeMinor: null,
        planOutcomeRecordedAt: null,
      });
    });

    it('refuses an answer the recorded plan does not offer, and creates nothing', async () => {
      const fw = await freshFramework();
      for (const overrides of [
        { ...BOUNDED, planOutcome: 'exit_plan_result' as const, planOutcomeMinor: 1_000n },
        { ...BOUNDED, planOutcome: 'planned_target_first' as const, planOutcomeMinor: 10_000n },
        {
          plannedRiskState: 'no_defined' as const,
          targetState: 'fixed' as const,
          plannedRewardMinor: 10_000n,
          planOutcome: 'cannot_determine' as const,
        },
        { planOutcome: 'cannot_determine' as const },
        { ...BOUNDED, planOutcomeMinor: 500n },
      ]) {
        const result = await createCompletedTrade(workspaceId, actorUserId, input(fw, overrides));
        expect(result).toEqual({ ok: false, code: 'invalid_plan_outcome' });
      }
    });
  });

  describe('Exit Plan', () => {
    it('snapshots a plan chosen during reconstruction as recalled, not as the entry-time rule', async () => {
      const fw = await freshFramework();
      const plan = await insertExitPlan({ strategyId: fw.strategyId, name: 'Trail structure' });
      const result = await save(fw, {
        strategyId: fw.strategyId,
        exitPlan: { state: 'saved', exitPlanId: plan.id, provenance: 'selected' },
      });
      await db.update(exitPlans).set({ name: 'Renamed later' }).where(eq(exitPlans.id, plan.id));
      expect(await readTrade(result.tradeId)).toMatchObject({
        exitPlanState: 'saved',
        exitPlanProvenance: 'selected',
        exitPlanName: 'Trail structure',
        exitPlanOrigin: 'recalled_after_trade',
        exitPlanInheritanceDeclined: false,
      });
    });

    it('never inherits the Strategy default, even when asked to', async () => {
      const fw = await freshFramework();
      const plan = await insertExitPlan({ strategyId: fw.strategyId });
      expect(
        await createCompletedTrade(
          workspaceId,
          actorUserId,
          input(fw, {
            strategyId: fw.strategyId,
            exitPlan: { state: 'saved', exitPlanId: plan.id, provenance: 'strategy_default' },
          }),
        ),
      ).toEqual({ ok: false, code: 'invalid_exit_plan' });
      const unanswered = await save(fw, { strategyId: fw.strategyId });
      expect(await readTrade(unanswered.tradeId)).toMatchObject({
        exitPlanState: null,
        exitPlanOrigin: null,
      });
    });

    it('records No Defined Exit Rule and a customized plan', async () => {
      const fw = await freshFramework();
      const noRule = await save(fw, { exitPlan: { state: 'no_rule' } });
      const custom = await save(fw, {
        exitPlan: { state: 'customized', baseExitPlanId: null, instructions: 'Out on a 4h close.' },
      });
      expect(await readTrade(noRule.tradeId)).toMatchObject({ exitPlanState: 'no_rule' });
      expect(await readTrade(custom.tradeId)).toMatchObject({
        exitPlanState: 'customized',
        exitPlanInstructions: 'Out on a 4h close.',
        exitPlanOrigin: 'recalled_after_trade',
      });
    });
  });

  describe('exit history', () => {
    it('keeps reason-only exits, unknown scope and every optional field as given', async () => {
      const fw = await freshFramework();
      const exitedAt = new Date(Date.now() - HOUR);
      const result = await save(fw, {
        exitedAt,
        exitHistoryCompleteness: 'incomplete',
        exits: [
          { exitReason: 'Took half off at the level' },
          { exitScope: 'unknown', realizedPnlMinor: 1_200n },
          {
            exitScope: 'all_remaining',
            closedBps: 5_000,
            exitPrice: '2405.25',
            exitedAt,
            exitReason: 'Trail hit',
          },
        ],
      });
      const exits = await readExits(result.tradeId);
      expect(
        exits.map((exit) => ({
          scope: exit.exitScope,
          bps: exit.closedBps,
          pnl: exit.realizedPnlMinor,
          price: exit.exitPrice,
          reason: exit.exitReason,
        })),
      ).toEqual([
        { scope: null, bps: null, pnl: null, price: null, reason: 'Took half off at the level' },
        { scope: 'unknown', bps: null, pnl: 1_200n, price: null, reason: null },
        {
          scope: 'all_remaining',
          bps: 5_000,
          pnl: null,
          price: '2405.2500000000',
          reason: 'Trail hit',
        },
      ]);
      expect(await readTrade(result.tradeId)).toMatchObject({
        exitHistoryCompleteness: 'incomplete',
        netPnlMinor: null,
      });
    });

    it.each([
      ['Unanswered', undefined, null],
      ['Complete', 'complete', 'complete'],
      ['Incomplete', 'incomplete', 'incomplete'],
      ['Unknown', 'unknown', 'unknown'],
    ] as const)('keeps %s completeness distinct', async (_label, completeness, stored) => {
      const fw = await freshFramework();
      const result = await save(fw, {
        exits: [{ realizedPnlMinor: 500n }],
        ...(completeness === undefined ? {} : { exitHistoryCompleteness: completeness }),
      });
      expect(await readTrade(result.tradeId)).toMatchObject({ exitHistoryCompleteness: stored });
    });

    it('saves a Complete history that disagrees with Final Net P&L, and keeps both figures', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        finalPnlMinor: 1_000n,
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 600n }, { realizedPnlMinor: 600n }],
      });
      const row = await readTrade(result.tradeId);
      expect(row).toMatchObject({ netPnlMinor: 1_000n, finalPnlSource: 'manual_total' });
      expect((await readExits(result.tradeId)).map((exit) => exit.realizedPnlMinor)).toEqual([
        600n,
        600n,
      ]);
    });

    it('never re-weights exit P&L by percentage, and saves percentages short of 100%', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        exits: [
          { closedBps: 2_500, realizedPnlMinor: 900n },
          { closedBps: 2_500, realizedPnlMinor: 300n },
        ],
      });
      expect(
        (await readExits(result.tradeId)).map((exit) => [exit.closedBps, exit.realizedPnlMinor]),
      ).toEqual([
        [2_500, 900n],
        [2_500, 300n],
      ]);
    });

    it('refuses exits that together close more than the whole position', async () => {
      const fw = await freshFramework();
      expect(
        await createCompletedTrade(
          workspaceId,
          actorUserId,
          input(fw, { exits: [{ closedBps: 6_000 }, { closedBps: 6_000 }] }),
        ),
      ).toEqual({ ok: false, code: 'invalid_completed_exit_coverage' });
    });

    it('refuses completeness without an exit and an exit with nothing in it', async () => {
      const fw = await freshFramework();
      expect(
        await createCompletedTrade(
          workspaceId,
          actorUserId,
          input(fw, { exitHistoryCompleteness: 'complete' }),
        ),
      ).toEqual({ ok: false, code: 'invalid_exit_shape' });
      expect(
        await createCompletedTrade(workspaceId, actorUserId, input(fw, { exits: [{}] })),
      ).toEqual({ ok: false, code: 'invalid_exit_shape' });
    });
  });

  describe('Strategy, Setup and conditions', () => {
    it('keeps Unanswered, No Strategy and a selected Strategy with No Setup distinct, as recalled', async () => {
      const fw = await freshFramework();
      const unanswered = await save(fw);
      const none = await save(fw, { noStrategy: true });
      const noSetup = await save(fw, { strategyId: fw.strategyId, noSetup: true });
      expect(await readTrade(unanswered.tradeId)).toMatchObject({
        noStrategy: false,
        strategyOrigin: null,
      });
      expect(await readTrade(none.tradeId)).toMatchObject({
        noStrategy: true,
        strategyId: null,
        strategyOrigin: 'recalled_after_trade',
      });
      expect(await readTrade(noSetup.tradeId)).toMatchObject({
        strategyId: fw.strategyId,
        noSetup: true,
        strategyOrigin: 'recalled_after_trade',
        setupOrigin: 'recalled_after_trade',
      });
    });

    it('stores Met, Not Met and Don’t remember, leaves the rest Unanswered, and never at entry', async () => {
      const fw = await freshFramework();
      const conditions = await Promise.all(
        ['Trend aligned', 'Retest held', 'News clear', 'Volume confirmed'].map((label, index) =>
          createSetupCondition(workspaceId, actorUserId, fw.strategyId, fw.setupId, {
            label,
            sortOrder: index,
          }),
        ),
      );
      const keys = conditions.map((condition) => {
        if (!condition.ok) throw new Error('condition creation failed');
        return condition.conditionKey;
      });
      const result = await save(fw, {
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        conditionSetToken: createConditionSetToken(fw.setupVersionId),
        conditionAnswers: [
          { conditionKey: keys[0]!, status: 'met' },
          { conditionKey: keys[1]!, status: 'not_met' },
          { conditionKey: keys[2]!, status: 'unknown' },
        ],
      });
      const checks = await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, result.tradeId))
        .orderBy(asc(tradeSetupConditionChecks.sortOrder));
      expect(checks.map((check) => [check.label, check.checkStatus, check.origin])).toEqual([
        ['Trend aligned', 'met', 'recalled_after_trade'],
        ['Retest held', 'not_met', 'recalled_after_trade'],
        ['News clear', 'unknown', 'recalled_after_trade'],
      ]);

      // At Entry still has no "Don't remember" (contract §8).
      await expect(
        createTrade(workspaceId, actorUserId, {
          mutationKey: crypto.randomUUID(),
          tradingAccountId: fw.tradingAccountId,
          recordingTiming: 'at_entry',
          recordingContract: 'add_trade_v1',
          systemPlanBasis: 'money',
          symbol: 'XAUUSD',
          direction: 'long',
          plannedRiskMinor: 5_000n,
          plannedRiskState: 'defined',
          strategyId: fw.strategyId,
          setupId: fw.setupId,
          conditionSetToken: createConditionSetToken(fw.setupVersionId),
          conditionAnswers: [{ conditionKey: keys[0]!, status: 'unknown' }],
        }),
      ).resolves.toEqual({ ok: false, code: 'invalid_condition_status' });
    });
  });

  describe('psychology', () => {
    it('records recalled Entry psychology and a separate Post-Trade Emotion', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        confidence: 75,
        emotionKeys: ['calm', 'focused'],
        postTradeEmotionKeys: ['calm', 'frustrated'],
      });
      const row = await readTrade(result.tradeId);
      expect(row).toMatchObject({ confidence: 75, confidenceOrigin: 'recalled_after_trade' });
      expect(row.emotionsOrigin).toBe('recalled_after_trade');
      expect(row.emotionsRecordedAt).not.toBeNull();
      expect(row.postTradeEmotionsRecordedAt).not.toBeNull();
      const emotions = await db
        .select({ key: emotionTypes.key, phase: tradeEmotions.phase })
        .from(tradeEmotions)
        .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
        .where(eq(tradeEmotions.tradeId, result.tradeId));
      expect(emotions.map((emotion) => `${emotion.phase}:${emotion.key}`).sort()).toEqual([
        'entry:calm',
        'entry:focused',
        'post_trade:calm',
        'post_trade:frustrated',
      ]);
    });

    it('keeps None of these distinct from Unanswered in each phase', async () => {
      const fw = await freshFramework();
      const result = await save(fw, { postTradeEmotionKeys: [] });
      const row = await readTrade(result.tradeId);
      expect(row.emotionsRecordedAt).toBeNull();
      expect(row.emotionsOrigin).toBeNull();
      expect(row.postTradeEmotionsRecordedAt).not.toBeNull();
      expect(
        await db.select().from(tradeEmotions).where(eq(tradeEmotions.tradeId, result.tradeId)),
      ).toEqual([]);
    });
  });

  describe('later edits keep what the trader stated', () => {
    it('records an adoption chosen during capture as exit history, after checking it', async () => {
      const fw = await freshFramework();
      const adopted = await save(fw, {
        plannedRiskMinor: 1_000n,
        finalPnlMinor: 1_500n,
        finalPnlAdoptedFromExits: true,
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 800n }, { realizedPnlMinor: 700n }],
      });
      expect(await readTrade(adopted.tradeId)).toMatchObject({
        netPnlMinor: 1_500n,
        finalPnlSource: 'exit_history',
      });

      const manual = await save(fw, {
        finalPnlMinor: 1_500n,
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 800n }, { realizedPnlMinor: 700n }],
      });
      expect(await readTrade(manual.tradeId)).toMatchObject({ finalPnlSource: 'manual_total' });
    });

    it('refuses an adoption the exit history does not support, and writes nothing', async () => {
      const fw = await freshFramework();
      const cases: Partial<CreateCompletedTradeInput>[] = [
        // Not declared Complete.
        {
          finalPnlMinor: 1_500n,
          exitHistoryCompleteness: 'incomplete',
          exits: [{ realizedPnlMinor: 800n }, { realizedPnlMinor: 700n }],
        },
        // An exit without P&L.
        {
          finalPnlMinor: 800n,
          exitHistoryCompleteness: 'complete',
          exits: [{ realizedPnlMinor: 800n }, { exitReason: 'rest at stop' }],
        },
        // Final Net P&L is not the subtotal.
        {
          finalPnlMinor: 1_400n,
          exitHistoryCompleteness: 'complete',
          exits: [{ realizedPnlMinor: 800n }, { realizedPnlMinor: 700n }],
        },
        // No Final Net P&L at all.
        { exitHistoryCompleteness: 'complete', exits: [{ realizedPnlMinor: 800n }] },
      ];
      for (const overrides of cases) {
        const request = input(fw, { ...overrides, finalPnlAdoptedFromExits: true });
        expect(await createCompletedTrade(workspaceId, actorUserId, request)).toEqual({
          ok: false,
          code: 'exit_history_not_adoptable',
        });
        const rows = await db
          .select({ id: trades.id })
          .from(trades)
          .where(eq(trades.mutationKey, request.mutationKey));
        expect(rows).toHaveLength(0);
      }
    });

    it('adopts a Complete exit subtotal only when asked, keeping the selected outcome', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        plannedRiskMinor: 1_000n,
        finalPnlMinor: 1_000n,
        traderOutcome: 'break_even',
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 800n }, { realizedPnlMinor: 700n }],
      });
      const adopted = await adoptHistoricalExitSubtotal(workspaceId, actorUserId, result.tradeId);
      expect(adopted).toMatchObject({
        ok: true,
        netPnlMinor: 1_500n,
        finalPnlSource: 'exit_history',
        actualR: '1.5000',
        traderOutcome: 'break_even',
      });
      expect(await readTrade(result.tradeId)).toMatchObject({
        netPnlMinor: 1_500n,
        traderOutcome: 'break_even',
      });
    });

    it('lets a Final Net P&L edit disagree with a Complete history, and never derives an outcome', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        plannedRiskMinor: 2_000n,
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 1_000n }],
      });
      const edited = await editHistoricalFinalResult(
        workspaceId,
        actorUserId,
        result.tradeId,
        -500n,
      );
      expect(edited).toMatchObject({
        ok: true,
        netPnlMinor: -500n,
        reconciliation: 'conflict',
        actualR: '-0.2500',
        traderOutcome: null,
      });
    });

    it('never lets an exit correction rewrite an adopted Final Net P&L', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 400n }],
      });
      await adoptHistoricalExitSubtotal(workspaceId, actorUserId, result.tradeId);
      const [exit] = await readExits(result.tradeId);
      const corrected = await applyHistoricalExitHistoryCorrection(
        workspaceId,
        actorUserId,
        result.tradeId,
        {
          exitHistoryCompleteness: 'complete',
          exits: [
            { exitId: exit!.id, realizedPnlMinor: 400n },
            { exitScope: 'unknown', exitReason: 'Remembered another partial' },
          ],
        },
      );
      expect(corrected).toMatchObject({ ok: true, netPnlMinor: 400n });
    });

    it('re-measures Actual R when Risk at Entry changes, and keeps the selected outcome', async () => {
      const fw = await freshFramework();
      const result = await save(fw, {
        plannedRiskMinor: 1_000n,
        finalPnlMinor: 1_000n,
        traderOutcome: 'loss',
      });
      expect(
        await updateTradePlan(workspaceId, actorUserId, result.tradeId, {
          plannedRiskMinor: 4_000n,
        }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(result.tradeId)).toMatchObject({
        actualR: '0.2500',
        traderOutcome: 'loss',
      });
    });

    it('refuses a live exit correction that would rebuild the stated result', async () => {
      const fw = await freshFramework();
      const exitedAt = new Date(Date.now() - HOUR);
      const result = await save(fw, {
        enteredAt: new Date(exitedAt.getTime() - HOUR),
        exitedAt,
        finalPnlMinor: 1_000n,
        exits: [{ closedBps: 10_000, realizedPnlMinor: 900n, exitedAt }],
      });
      const [exit] = await readExits(result.tradeId);
      expect(
        await correctTradeExit(workspaceId, actorUserId, result.tradeId, exit!.id, {
          closedBps: 10_000,
          realizedPnlMinor: 1_000n,
          exitedAt,
        }),
      ).toEqual({ ok: false, code: 'contract_close_required' });
      expect(await readTrade(result.tradeId)).toMatchObject({ netPnlMinor: 1_000n });
    });

    it('refuses the live execution correction that would rebuild the result from exit legs', async () => {
      const fw = await freshFramework();
      const result = await save(fw, { finalPnlMinor: 1_000n, traderOutcome: 'win' });
      expect(
        await correctTradeExecution(workspaceId, actorUserId, result.tradeId, {
          actualResultMode: 'money',
        }),
      ).toMatchObject({ ok: false, code: 'invalid_execution_context' });
    });
  });
});
