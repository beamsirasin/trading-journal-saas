/**
 * ADD TRADE CONTRACT v1 — At Entry service semantics against a real database.
 *
 * Covers what the contract write must persist and what later edits must never
 * rewrite: Risk at Entry as the one 1R baseline, Actual Risk as separate
 * evidence, Target and Exit Plan as independent answers, Exit Plan wording
 * snapshotted from the library, unanswered observations kept unanswered, and
 * capture origin recorded once and revised rather than overwritten.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import { CreateTradeSchema } from '@/lib/trades/schemas';
import {
  exitPlans,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import {
  buildAtEntryPayload,
  createAtEntryDraft,
  setRiskState,
} from '@/components/trades/at-entry-draft';
import { withRequiredCloseAnswers } from '@/test/final-close';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { createSetup, createSetupCondition, createStrategy } from './strategy-management';
import { recordAfterTradeContext } from './trade-after-trade-context';
import { replaceTradeEmotions } from './trade-discipline';
import { recordContractExit } from './trade-exit-contract';
import {
  assignTradeClassification,
  correctTradeExecution,
  createTrade,
  updateTradePlan,
  type CreateTradeInput,
} from './trade-management';

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
      name: 'Contract test workspace',
      slug: `contract-${crypto.randomUUID()}`,
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

describe('Add Trade contract At Entry (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    actorUserId = await createUser(db, 'contract-actor');
    const otherUserId = await createUser(db, 'contract-other');
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
    await closeTestDb();
  });

  async function freshFramework() {
    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Contract account',
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
      name: `Contract Strategy ${crypto.randomUUID()}`,
    });
    if (!strategy.ok) throw new Error(`strategy creation failed: ${strategy.code}`);
    const setup = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
      mutationKey: crypto.randomUUID(),
      name: 'Contract Setup',
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

  function contractInput(
    fw: Framework,
    overrides: Partial<CreateTradeInput> = {},
  ): CreateTradeInput {
    return {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: fw.tradingAccountId,
      symbol: 'XAUUSD',
      direction: 'long',
      recordingTiming: 'at_entry',
      recordingContract: 'add_trade_v1',
      systemPlanBasis: 'money',
      // Risk is an explicit decision since contract decision 54.
      plannedRiskState: 'defined',
      plannedRiskMinor: 10_000n,
      ...overrides,
    };
  }

  async function createContract(fw: Framework, overrides: Partial<CreateTradeInput> = {}) {
    const result = await createTrade(workspaceId, actorUserId, contractInput(fw, overrides));
    if (!result.ok) throw new Error(`contract create failed: ${result.code}`);
    return result.tradeId;
  }

  /**
   * A contract Trade as it was saved BEFORE decision 56 retired Actual Risk:
   * its answer written directly, because no current path may create one.
   */
  async function seedHistoricalActualRisk(
    tradeId: string,
    answer: 'matched' | 'different' | 'unknown',
    amount: bigint | null,
  ) {
    await db
      .update(trades)
      .set({ actualRiskAnswer: answer, actualInitialRiskMinor: amount })
      .where(eq(trades.id, tradeId));
  }

  async function readTrade(tradeId: string) {
    const [row] = await db.select().from(trades).where(eq(trades.id, tradeId));
    if (row === undefined) throw new Error('trade row missing');
    return row;
  }

  async function insertExitPlan(values: {
    workspaceId: string;
    strategyId?: string | null;
    name?: string;
    instructions?: string;
    isArchived?: boolean;
  }) {
    const [plan] = await db
      .insert(exitPlans)
      .values({
        workspaceId: values.workspaceId,
        strategyId: values.strategyId ?? null,
        name: values.name ?? 'Scale out',
        instructions: values.instructions ?? 'Half at 1R, trail the rest behind structure.',
        isArchived: values.isArchived ?? false,
      })
      .returning();
    if (plan === undefined) throw new Error('failed to insert exit plan');
    return plan;
  }

  const ENTERED = {
    enteredAt: new Date('2026-09-01T10:00:00Z'),
    enteredAtSource: 'trader' as const,
  };

  /*
    ACTUAL RISK IS RETIRED FROM CAPTURE (contract decision 56). The Step 2
    Risk is the one 1R. New Saves write no Actual Risk; one a Trade recorded
    before the retirement is history, kept exactly and never read as the R
    denominator.
  */
  describe('Actual Risk retired from capture', () => {
    it("a Save built by today's Record Open writes no Actual Risk", async () => {
      const fw = await freshFramework();
      const draft = setRiskState(
        {
          ...createAtEntryDraft(fw.tradingAccountId),
          symbol: 'XAUUSD',
          direction: 'long' as const,
        },
        'defined',
      );
      const payload = buildAtEntryPayload(
        { ...draft, risk: '100' },
        {
          currency: 'USD',
          timezone: 'UTC',
          mutationKey: crypto.randomUUID(),
          options: { strategies: [], exitPlans: [] },
        },
      );
      if (payload === null) throw new Error('payload not ready');
      const parsed = CreateTradeSchema.parse(payload);
      const result = await createTrade(workspaceId, actorUserId, parsed as CreateTradeInput);
      if (!result.ok) throw new Error(`create failed: ${result.code}`);
      expect(await readTrade(result.tradeId)).toMatchObject({
        plannedRiskState: 'defined',
        plannedRiskMinor: 10_000n,
        actualRiskAnswer: null,
        actualInitialRiskMinor: null,
      });
    });

    it('refuses a new Actual Risk on a Record Open Save, and writes nothing', async () => {
      const fw = await freshFramework();
      const before = (await db.select().from(trades).where(eq(trades.workspaceId, workspaceId)))
        .length;
      for (const retired of [
        { actualRiskAnswer: 'matched' as const },
        { actualRiskAnswer: 'different' as const, actualInitialRiskMinor: 30_000n },
        { actualInitialRiskMinor: 30_000n },
      ]) {
        expect(await createTrade(workspaceId, actorUserId, contractInput(fw, retired))).toEqual({
          ok: false,
          code: 'actual_risk_retired',
        });
      }
      expect(
        (await db.select().from(trades).where(eq(trades.workspaceId, workspaceId))).length,
      ).toBe(before);
    });

    it('keeps a historical Actual Risk exactly, and never lets it move R', async () => {
      const fw = await freshFramework();
      // Recorded under the earlier contract: a Different answer of 300.
      const tradeId = await createContract(fw, ENTERED);
      await seedHistoricalActualRisk(tradeId, 'different', 30_000n);
      const closed = await recordContractExit(
        workspaceId,
        actorUserId,
        tradeId,
        await withRequiredCloseAnswers(tradeId, {
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          finalPnlMinor: 20_000n,
          finalExitedAt: new Date('2026-09-01T12:00:00Z'),
        }),
      );
      // Trader R = 200 ÷ the Step 2 Risk of 100 — never ÷ the historical 300.
      expect(closed).toMatchObject({ ok: true, actualR: '2.0000' });
      const saved = await recordAfterTradeContext(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        afterTradeNote: 'Closed on the retest.',
      });
      expect(saved.ok).toBe(true);
      expect(await readTrade(tradeId)).toMatchObject({
        actualRiskAnswer: 'different',
        actualInitialRiskMinor: 30_000n,
        plannedRiskMinor: 10_000n,
        actualR: '2.0000',
      });
    });

    /*
      THE ONE CORRECTION PATH THAT TOUCHES THE FIELD. It stays for legacy
      Trades, whose actual risk is their R denominator. On a contract Trade it
      may not change the value — that would record a new Actual Risk — but its
      other corrections still work and leave the historical value alone.
    */
    it('execution correction: refuses a new Actual Risk on a contract Trade, keeps legacy correction', async () => {
      const fw = await freshFramework();
      const contractId = await createContract(fw, ENTERED);
      await seedHistoricalActualRisk(contractId, 'different', 30_000n);
      expect(
        await correctTradeExecution(workspaceId, actorUserId, contractId, {
          actualInitialRiskMinor: 20_000n,
        }),
      ).toMatchObject({ ok: false, code: 'actual_risk_retired' });
      const plain = await createContract(fw, ENTERED);
      expect(
        await correctTradeExecution(workspaceId, actorUserId, plain, {
          actualInitialRiskMinor: 10_000n,
        }),
      ).toMatchObject({ ok: false, code: 'actual_risk_retired' });
      expect(await readTrade(plain)).toMatchObject({
        actualRiskAnswer: null,
        actualInitialRiskMinor: null,
      });
      // Another correction on the historical Trade works and keeps its value.
      expect(
        await correctTradeExecution(workspaceId, actorUserId, contractId, {
          enteredAt: new Date('2026-09-01T09:30:00Z'),
        }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(contractId)).toMatchObject({
        actualRiskAnswer: 'different',
        actualInitialRiskMinor: 30_000n,
      });

      // A legacy Trade still corrects its risk amount: it is its R denominator.
      const legacy = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'XAUUSD',
        direction: 'long',
        recordingTiming: 'at_entry',
        systemPlanBasis: 'money',
        plannedRiskMinor: 10_000n,
        enteredAt: new Date('2026-09-01T10:00:00Z'),
      });
      if (!legacy.ok) throw new Error(`legacy create failed: ${legacy.code}`);
      expect(
        await correctTradeExecution(workspaceId, actorUserId, legacy.tradeId, {
          actualInitialRiskMinor: 12_000n,
        }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(legacy.tradeId)).toMatchObject({
        recordingContract: null,
        actualInitialRiskMinor: 12_000n,
        actualRiskAnswer: null,
      });
    });
  });

  describe('minimum Save and the 1R baseline', () => {
    it('creates an open contract Trade from Account, Symbol, Direction and Risk at Entry alone', async () => {
      const fw = await freshFramework();
      const row = await readTrade(await createContract(fw));
      expect(row).toMatchObject({
        recordingContract: 'add_trade_v1',
        status: 'open',
        actualResultMode: 'money',
        plannedRiskMinor: 10_000n,
        actualInitialRiskMinor: null,
        actualRiskAnswer: null,
        enteredAt: null,
        enteredAtSource: null,
        targetState: null,
        exitPlanState: null,
        exitPlanInheritanceDeclined: false,
        noStrategy: false,
        strategyOrigin: null,
        confidence: null,
        confidenceOrigin: null,
        emotionsRecordedAt: null,
        emotionsOrigin: null,
      });
    });

    // Decision 54: an explicit No Defined Risk opens a Trade with no 1R. The
    // payloads below are exactly what the At Entry form builds for it — no
    // plan basis without planned money, and one with a remembered Target.
    it.each([
      ['with no planned money at all', {}],
      [
        'with a Fixed Target from Target Profit',
        {
          systemPlanBasis: 'money' as const,
          targetState: 'fixed' as const,
          plannedRewardMinor: 30_000n,
        },
      ],
    ])('opens a No Defined Risk Trade %s', async (_label, extra) => {
      const fw = await freshFramework();
      const { systemPlanBasis: _basis, plannedRiskMinor: _risk, ...base } = contractInput(fw);
      const result = await createTrade(workspaceId, actorUserId, {
        ...base,
        ...ENTERED,
        plannedRiskState: 'no_defined',
        ...extra,
      });
      if (!result.ok) throw new Error(`No Defined Risk create failed: ${result.code}`);
      expect(await readTrade(result.tradeId)).toMatchObject({
        status: 'open',
        actualResultMode: 'money',
        plannedRiskState: 'no_defined',
        plannedRiskMinor: null,
        actualInitialRiskMinor: null,
        actualRiskAnswer: null,
        plannedStopMethod: null,
      });

      // It closes on its stated result, and no R is ever built for it.
      const closed = await recordContractExit(
        workspaceId,
        actorUserId,
        result.tradeId,
        await withRequiredCloseAnswers(result.tradeId, {
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          finalPnlMinor: 12_000n,
          finalExitedAt: new Date('2026-09-01T12:00:00Z'),
        }),
      );
      expect(closed).toMatchObject({ ok: true, actualR: null });
      expect(await readTrade(result.tradeId)).toMatchObject({
        status: 'closed',
        netPnlMinor: 12_000n,
        actualR: null,
        plannedRiskState: 'no_defined',
      });
    });

    it('keeps a defaulted entry time distinct from one the trader confirmed', async () => {
      const fw = await freshFramework();
      const defaulted = await readTrade(
        await createContract(fw, {
          enteredAt: new Date('2026-09-01T10:00:00Z'),
          enteredAtSource: 'default_now',
        }),
      );
      expect(defaulted.enteredAtSource).toBe('default_now');
      const confirmed = await readTrade(await createContract(fw, ENTERED));
      expect(confirmed.enteredAtSource).toBe('trader');
    });

    it('measures Actual R against Risk at Entry when a historical Actual Risk was different', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw, ENTERED);
      await seedHistoricalActualRisk(tradeId, 'different', 30_000n);
      const closed = await recordContractExit(
        workspaceId,
        actorUserId,
        tradeId,
        await withRequiredCloseAnswers(tradeId, {
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          finalPnlMinor: 15_000n,
          finalExitedAt: new Date('2026-09-01T12:00:00Z'),
        }),
      );
      expect(closed).toMatchObject({ ok: true, actualR: '1.5000' });
      const row = await readTrade(tradeId);
      expect(row.actualInitialRiskMinor).toBe(30_000n);
      expect(row.actualR).toBe('1.5000');
    });

    it('keeps a historical Different with the amount unknown and still measures Actual R', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw, ENTERED);
      await seedHistoricalActualRisk(tradeId, 'different', null);
      expect(await readTrade(tradeId)).toMatchObject({
        actualRiskAnswer: 'different',
        actualInitialRiskMinor: null,
      });
      const closed = await recordContractExit(
        workspaceId,
        actorUserId,
        tradeId,
        await withRequiredCloseAnswers(tradeId, {
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          finalPnlMinor: -5_000n,
          finalExitedAt: new Date('2026-09-01T12:00:00Z'),
        }),
      );
      expect(closed).toMatchObject({ ok: true, actualR: '-0.5000' });
    });

    it('refuses price as result authority and a retired Actual Risk amount', async () => {
      const fw = await freshFramework();
      const priced = await createTrade(
        workspaceId,
        actorUserId,
        contractInput(fw, { plannedEntry: '2400', plannedStop: '2390' }),
      );
      expect(priced.ok).toBe(false);
      const matchedAmount = await createTrade(
        workspaceId,
        actorUserId,
        contractInput(fw, { actualInitialRiskMinor: 12_000n }),
      );
      expect(matchedAmount).toMatchObject({ ok: false, code: 'actual_risk_retired' });
    });

    it('stores price context without calculating from it', async () => {
      const fw = await freshFramework();
      const row = await readTrade(
        await createContract(fw, {
          contextEntryPrice: '2400',
          contextStopPrice: '2410',
          contextPositionSize: '0.5',
        }),
      );
      expect(row).toMatchObject({
        plannedEntry: null,
        plannedStop: null,
        contextEntryPrice: '2400.0000000000',
        // A Long stop above entry is a notice, never a refusal (contract §3).
        contextStopPrice: '2410.0000000000',
        plannedR: null,
      });
    });
  });

  describe('Target', () => {
    it('holds Unanswered, Fixed from Target Profit or TP price, and No Fixed apart', async () => {
      const fw = await freshFramework();
      expect((await readTrade(await createContract(fw))).targetState).toBeNull();
      expect(
        await readTrade(
          await createContract(fw, { targetState: 'fixed', plannedRewardMinor: 20_000n }),
        ),
      ).toMatchObject({ targetState: 'fixed', plannedRewardMinor: 20_000n, plannedR: '2.0000' });
      expect(
        await readTrade(await createContract(fw, { targetState: 'fixed', targetPrice: '2450' })),
      ).toMatchObject({ targetState: 'fixed', targetPrice: '2450.0000000000', plannedR: null });
      expect(await readTrade(await createContract(fw, { targetState: 'no_fixed' }))).toMatchObject({
        targetState: 'no_fixed',
        plannedRewardMinor: null,
      });
    });

    it('refuses a Fixed Target with no representation and values without a Fixed Target', async () => {
      const fw = await freshFramework();
      expect(
        await createTrade(workspaceId, actorUserId, contractInput(fw, { targetState: 'fixed' })),
      ).toMatchObject({ ok: false, code: 'invalid_plan' });
      expect(
        await createTrade(
          workspaceId,
          actorUserId,
          contractInput(fw, { targetState: 'no_fixed', plannedRewardMinor: 20_000n }),
        ),
      ).toMatchObject({ ok: false, code: 'invalid_plan' });
    });
  });

  describe('Exit Plan', () => {
    it('snapshots an inherited Strategy default that a later library edit never rewrites', async () => {
      const fw = await freshFramework();
      const plan = await insertExitPlan({ workspaceId, strategyId: fw.strategyId });
      const tradeId = await createContract(fw, {
        strategyId: fw.strategyId,
        exitPlan: { state: 'saved', exitPlanId: plan.id, provenance: 'strategy_default' },
      });
      await db
        .update(exitPlans)
        .set({ name: 'Renamed', instructions: 'Different wording' })
        .where(eq(exitPlans.id, plan.id));
      expect(await readTrade(tradeId)).toMatchObject({
        exitPlanState: 'saved',
        exitPlanProvenance: 'strategy_default',
        exitPlanId: plan.id,
        exitPlanName: 'Scale out',
        exitPlanInstructions: 'Half at 1R, trail the rest behind structure.',
        exitPlanOrigin: 'recorded_at_entry',
      });
    });

    it('refuses an inherited plan that is not this Strategy default, archived, or in another workspace', async () => {
      const fw = await freshFramework();
      const other = await freshFramework();
      const otherDefault = await insertExitPlan({ workspaceId, strategyId: other.strategyId });
      expect(
        await createTrade(
          workspaceId,
          actorUserId,
          contractInput(fw, {
            strategyId: fw.strategyId,
            exitPlan: {
              state: 'saved',
              exitPlanId: otherDefault.id,
              provenance: 'strategy_default',
            },
          }),
        ),
      ).toMatchObject({ ok: false, code: 'invalid_exit_plan' });

      const archived = await insertExitPlan({ workspaceId, isArchived: true });
      expect(
        await createTrade(
          workspaceId,
          actorUserId,
          contractInput(fw, {
            exitPlan: { state: 'saved', exitPlanId: archived.id, provenance: 'selected' },
          }),
        ),
      ).toMatchObject({ ok: false, code: 'invalid_exit_plan' });

      const foreign = await insertExitPlan({ workspaceId: otherWorkspaceId });
      expect(
        await createTrade(
          workspaceId,
          actorUserId,
          contractInput(fw, {
            exitPlan: { state: 'saved', exitPlanId: foreign.id, provenance: 'selected' },
          }),
        ),
      ).toMatchObject({ ok: false, code: 'invalid_exit_plan' });
    });

    it('keeps a customized plan as the trader wrote it, with its starting plan as provenance', async () => {
      const fw = await freshFramework();
      const plan = await insertExitPlan({ workspaceId });
      expect(
        await readTrade(
          await createContract(fw, {
            exitPlan: {
              state: 'customized',
              baseExitPlanId: plan.id,
              instructions: '  Half at 1R, close the rest before the news.  ',
            },
          }),
        ),
      ).toMatchObject({
        exitPlanState: 'customized',
        exitPlanProvenance: 'selected',
        exitPlanId: plan.id,
        exitPlanName: 'Scale out',
        exitPlanInstructions: 'Half at 1R, close the rest before the news.',
      });
    });

    it('records No Defined Exit Rule and a declined inheritance as answers', async () => {
      const fw = await freshFramework();
      expect(
        await readTrade(
          await createContract(fw, {
            strategyId: fw.strategyId,
            exitPlan: { state: 'no_rule' },
            exitPlanInheritanceDeclined: true,
          }),
        ),
      ).toMatchObject({
        exitPlanState: 'no_rule',
        exitPlanInstructions: null,
        exitPlanInheritanceDeclined: true,
        exitPlanOrigin: 'recorded_at_entry',
      });
    });
  });

  describe('observations stay unanswered until answered', () => {
    it('snapshots only answered Setup Conditions, never an unanswered one as Not Met', async () => {
      const fw = await freshFramework();
      const first = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        {
          label: 'Breakout candle closed',
          sortOrder: 0,
        },
      );
      const second = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        {
          label: 'Retest held',
          sortOrder: 1,
        },
      );
      if (!first.ok || !second.ok) throw new Error('condition creation failed');
      const tradeId = await createContract(fw, {
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        conditionSetToken: createConditionSetToken(fw.setupVersionId),
        conditionAnswers: [{ conditionKey: first.conditionKey, status: 'met' }],
      });
      const checks = await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, tradeId));
      expect(checks.map((check) => [check.conditionKey, check.checkStatus, check.origin])).toEqual([
        [first.conditionKey, 'met', 'recorded_at_entry'],
      ]);
      expect(await readTrade(tradeId)).toMatchObject({
        strategyOrigin: 'recorded_at_entry',
        setupOrigin: 'recorded_at_entry',
      });
    });

    it('records "None of these" as an answer distinct from Not answered', async () => {
      const fw = await freshFramework();
      const none = await readTrade(await createContract(fw, { emotionKeys: [] }));
      expect(none.emotionsRecordedAt).not.toBeNull();
      expect(none.emotionsOrigin).toBe('recorded_at_entry');
      const unanswered = await readTrade(await createContract(fw));
      expect(unanswered.emotionsRecordedAt).toBeNull();
      expect(unanswered.emotionsOrigin).toBeNull();
    });
  });

  describe('later edits revise answers without rewriting their origin', () => {
    it('Confidence: first supplied later is recorded during the trade; a change is a revision', async () => {
      const fw = await freshFramework();
      const atEntry = await createContract(fw, { confidence: 50 });
      expect(
        await updateTradePlan(workspaceId, actorUserId, atEntry, { confidence: 75 }),
      ).toMatchObject({ ok: true });
      const revised = await readTrade(atEntry);
      expect(revised).toMatchObject({ confidence: 75, confidenceOrigin: 'recorded_at_entry' });
      expect(revised.confidenceRevisedAt).not.toBeNull();

      const later = await createContract(fw);
      await updateTradePlan(workspaceId, actorUserId, later, { confidence: 25 });
      expect(await readTrade(later)).toMatchObject({
        confidenceOrigin: 'recorded_during_trade',
        confidenceRevisedAt: null,
      });
    });

    it('Emotions: first supply records its origin, a replacement is a revision', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw);
      expect(await replaceTradeEmotions(workspaceId, actorUserId, tradeId, ['calm'])).toMatchObject(
        {
          ok: true,
        },
      );
      const first = await readTrade(tradeId);
      expect(first).toMatchObject({
        emotionsOrigin: 'recorded_during_trade',
        emotionsRevisedAt: null,
      });
      await replaceTradeEmotions(workspaceId, actorUserId, tradeId, ['fomo']);
      const second = await readTrade(tradeId);
      expect(second.emotionsOrigin).toBe('recorded_during_trade');
      expect(second.emotionsRevisedAt).not.toBeNull();
    });

    it('Strategy: assigning after an explicit "No Strategy" is a revision of that answer', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw, { noStrategy: true });
      expect(await readTrade(tradeId)).toMatchObject({
        noStrategy: true,
        strategyOrigin: 'recorded_at_entry',
      });
      expect(
        await assignTradeClassification(workspaceId, actorUserId, tradeId, {
          strategyId: fw.strategyId,
        }),
      ).toMatchObject({ ok: true });
      const assigned = await readTrade(tradeId);
      expect(assigned).toMatchObject({
        noStrategy: false,
        strategyId: fw.strategyId,
        strategyOrigin: 'recorded_at_entry',
      });
      expect(assigned.classificationRevisedAt).not.toBeNull();

      const unanswered = await createContract(fw);
      await assignTradeClassification(workspaceId, actorUserId, unanswered, {
        strategyId: fw.strategyId,
      });
      expect(await readTrade(unanswered)).toMatchObject({
        strategyOrigin: 'recorded_during_trade',
        classificationRevisedAt: null,
      });
    });

    /*
      THE RETAINED HISTORICAL EDIT PATH. A Risk at Entry correction keeps a
      historical Matched answer equal to it — maintaining an observation that
      already exists, never creating one — and leaves a Different one alone.
    */
    it('Plan edit: a historical Matched Actual Risk follows Risk at Entry and a Different one does not', async () => {
      const fw = await freshFramework();
      const matched = await createContract(fw);
      await seedHistoricalActualRisk(matched, 'matched', 10_000n);
      expect(
        await updateTradePlan(workspaceId, actorUserId, matched, { plannedRiskMinor: 12_000n }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(matched)).toMatchObject({
        plannedRiskMinor: 12_000n,
        actualInitialRiskMinor: 12_000n,
      });

      const different = await createContract(fw);
      await seedHistoricalActualRisk(different, 'different', 30_000n);
      await updateTradePlan(workspaceId, actorUserId, different, { plannedRiskMinor: 12_000n });
      // A Trade with no Actual Risk gains none from a plan edit.
      const none = await createContract(fw);
      await updateTradePlan(workspaceId, actorUserId, none, { plannedRiskMinor: 12_000n });
      expect(await readTrade(none)).toMatchObject({
        actualRiskAnswer: null,
        actualInitialRiskMinor: null,
      });
      expect(await readTrade(different)).toMatchObject({ actualInitialRiskMinor: 30_000n });
    });

    it('Plan edit: never introduces price authority and keeps a Fixed Target represented', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw, {
        targetState: 'fixed',
        plannedRewardMinor: 20_000n,
      });
      expect(
        await updateTradePlan(workspaceId, actorUserId, tradeId, {
          systemPlanBasis: 'price',
          plannedEntry: '2400',
          plannedStop: '2390',
        }),
      ).toMatchObject({ ok: false, code: 'invalid_plan_authority' });
      expect(
        await updateTradePlan(workspaceId, actorUserId, tradeId, { plannedRewardMinor: null }),
      ).toMatchObject({ ok: false, code: 'no_plan_representation' });

      const unanswered = await createContract(fw);
      await updateTradePlan(workspaceId, actorUserId, unanswered, { plannedRewardMinor: 5_000n });
      expect(await readTrade(unanswered)).toMatchObject({ targetState: 'fixed' });
    });

    it('Plan edit on a closed Trade re-measures Actual R against the new Risk at Entry', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw, ENTERED);
      await recordContractExit(
        workspaceId,
        actorUserId,
        tradeId,
        await withRequiredCloseAnswers(tradeId, {
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          finalPnlMinor: 15_000n,
          finalExitedAt: new Date('2026-09-01T12:00:00Z'),
        }),
      );
      expect(
        await updateTradePlan(workspaceId, actorUserId, tradeId, { plannedRiskMinor: 5_000n }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(tradeId)).toMatchObject({ actualR: '3.0000' });
    });
  });

  describe('contradictions are refused as validation, never left to the database', () => {
    it('refuses a Risk at Entry edit that would equal a historical Different amount, keeping the answer', async () => {
      const fw = await freshFramework();
      const tradeId = await createContract(fw);
      await seedHistoricalActualRisk(tradeId, 'different', 30_000n);
      expect(
        await updateTradePlan(workspaceId, actorUserId, tradeId, { plannedRiskMinor: 30_000n }),
      ).toMatchObject({ ok: false, code: 'invalid_plan' });
      expect(await readTrade(tradeId)).toMatchObject({
        plannedRiskMinor: 10_000n,
        actualRiskAnswer: 'different',
        actualInitialRiskMinor: 30_000n,
      });
    });

    it('refuses an inherited Exit Plan alongside a declined inheritance', async () => {
      const fw = await freshFramework();
      const plan = await insertExitPlan({ workspaceId, strategyId: fw.strategyId });
      expect(
        await createTrade(
          workspaceId,
          actorUserId,
          contractInput(fw, {
            strategyId: fw.strategyId,
            exitPlan: { state: 'saved', exitPlanId: plan.id, provenance: 'strategy_default' },
            exitPlanInheritanceDeclined: true,
          }),
        ),
      ).toMatchObject({ ok: false, code: 'invalid_exit_plan' });
    });
  });

  it('never stamps contract-era capture provenance onto a legacy row, at create or on a later edit', async () => {
    const fw = await freshFramework();
    const result = await createTrade(workspaceId, actorUserId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: fw.tradingAccountId,
      symbol: 'XAUUSD',
      direction: 'long',
      recordingTiming: 'at_entry',
      systemPlanBasis: 'money',
      plannedRiskMinor: 10_000n,
      enteredAt: new Date('2026-09-01T10:00:00Z'),
      confidence: 50,
      emotionKeys: [],
    });
    if (!result.ok) throw new Error(`legacy create failed: ${result.code}`);
    const tradeId = result.tradeId;

    expect(
      await updateTradePlan(workspaceId, actorUserId, tradeId, { confidence: 75 }),
    ).toMatchObject({ ok: true });
    expect(await replaceTradeEmotions(workspaceId, actorUserId, tradeId, ['calm'])).toMatchObject({
      ok: true,
    });
    expect(
      await assignTradeClassification(workspaceId, actorUserId, tradeId, {
        strategyId: fw.strategyId,
      }),
    ).toMatchObject({ ok: true });

    expect(await readTrade(tradeId)).toMatchObject({
      recordingContract: null,
      confidence: 75,
      strategyId: fw.strategyId,
      strategyOrigin: null,
      setupOrigin: null,
      exitPlanOrigin: null,
      confidenceOrigin: null,
      emotionsOrigin: null,
      classificationRevisedAt: null,
      exitPlanRevisedAt: null,
      confidenceRevisedAt: null,
      emotionsRevisedAt: null,
    });
  });

  it('leaves a legacy At Entry write exactly as it was', async () => {
    const fw = await freshFramework();
    const result = await createTrade(workspaceId, actorUserId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: fw.tradingAccountId,
      symbol: 'XAUUSD',
      direction: 'long',
      recordingTiming: 'at_entry',
      systemPlanBasis: 'money',
      plannedRiskMinor: 10_000n,
      enteredAt: new Date('2026-09-01T10:00:00Z'),
    });
    if (!result.ok) throw new Error(`legacy create failed: ${result.code}`);
    expect(await readTrade(result.tradeId)).toMatchObject({
      recordingContract: null,
      actualInitialRiskMinor: 10_000n,
      actualRiskAnswer: null,
      targetState: null,
      exitPlanState: null,
      enteredAtSource: null,
    });
  });
});
