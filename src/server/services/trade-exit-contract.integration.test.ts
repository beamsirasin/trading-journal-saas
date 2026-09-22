/**
 * ADD TRADE CONTRACT v1 — Record Exit / Final Close against a real database.
 *
 * What closing an Open Trade must persist, and what nothing may invent: a
 * Part exit records only its own leg and leaves the Trade Open; All Remaining
 * is the explicit Final Close, storing Final Net P&L exactly as stated and the
 * trader's outcome as chosen, never derived from sign; Actual R exists only
 * when Final Net P&L and Risk at Entry both do. Exit legs stay supporting
 * evidence. Saves are retry-safe, concurrency-safe and authorized; legacy
 * Trades keep their legacy lifecycle.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  tradeEmotions,
  tradeExits,
  trades,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { addTradeExit } from './trade-execution';
import { recordContractExit, type RecordContractExitInput } from './trade-exit-contract';
import { closeTrade, createTrade, openTrade } from './trade-management';

type Db = ReturnType<typeof getTestDb>;

const HOUR = 60 * 60 * 1000;

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
      name: 'Record Exit test workspace',
      slug: `record-exit-${crypto.randomUUID()}`,
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
    currentPeriodStartedAt: new Date(Date.now() - 24 * HOUR),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * HOUR),
  });
  return workspace.id;
}

describe('Add Trade contract Record Exit / Final Close (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let accountId: string;

  beforeAll(async () => {
    actorUserId = await createUser(db, 'record-exit-actor');
    otherUserId = await createUser(db, 'record-exit-other');
    workspaceId = await createWorkspace(db, actorUserId);
    otherWorkspaceId = await createWorkspace(db, otherUserId);
    accountId = await createAccount(workspaceId);
  });

  afterEach(async () => {
    // Every case below runs writable unless it says otherwise.
    await db
      .update(workspaceEntitlements)
      .set({
        status: 'active',
        currentPeriodStartedAt: new Date(Date.now() - 24 * HOUR),
        currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * HOUR),
      })
      .where(eq(workspaceEntitlements.workspaceId, workspaceId));
  });

  afterAll(async () => {
    await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId, otherWorkspaceId]));
    await db.delete(users).where(inArray(users.id, [actorUserId, otherUserId]));
    await closeTestDb();
  });

  async function createAccount(ws: string): Promise<string> {
    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId: ws,
        name: 'Record Exit account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      })
      .returning({ id: tradingAccounts.id });
    if (account === undefined) throw new Error('failed to insert trading account');
    return account.id;
  }

  const ENTERED_AT = new Date(Date.now() - 10 * HOUR);

  /** An Open Trade recorded by At Entry, with Risk at Entry 100.00. */
  async function openContractTrade() {
    const created = await createTrade(workspaceId, actorUserId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: accountId,
      symbol: 'XAUUSD',
      direction: 'long',
      recordingTiming: 'at_entry',
      recordingContract: 'add_trade_v1',
      systemPlanBasis: 'money',
      plannedRiskMinor: 10_000n,
      actualRiskAnswer: 'matched',
      enteredAt: ENTERED_AT,
      enteredAtSource: 'trader',
    });
    if (!created.ok) throw new Error(`contract create failed: ${JSON.stringify(created)}`);
    return created.tradeId;
  }

  function at(hoursAfterEntry: number): Date {
    return new Date(ENTERED_AT.getTime() + hoursAfterEntry * HOUR);
  }

  function part(
    extra: Partial<Omit<RecordContractExitInput, 'scope'>> = {},
  ): RecordContractExitInput {
    return { mutationKey: crypto.randomUUID(), scope: 'part', ...extra } as RecordContractExitInput;
  }

  function finalClose(
    extra: Partial<
      Omit<Extract<RecordContractExitInput, { scope: 'all_remaining' }>, 'scope'>
    > = {},
  ): RecordContractExitInput {
    return { mutationKey: crypto.randomUUID(), scope: 'all_remaining', ...extra };
  }

  async function record(
    tradeId: string,
    input: RecordContractExitInput,
    ws = workspaceId,
    user = actorUserId,
  ) {
    return recordContractExit(ws, user, tradeId, input);
  }

  async function readTrade(tradeId: string) {
    const row = await db.query.trades.findFirst({ where: eq(trades.id, tradeId) });
    if (row === undefined) throw new Error('trade missing');
    return row;
  }

  async function readExits(tradeId: string) {
    return db
      .select()
      .from(tradeExits)
      .where(eq(tradeExits.tradeId, tradeId))
      .orderBy(asc(tradeExits.sequence));
  }

  const WHOLE_TRADE_UNTOUCHED = {
    status: 'open',
    netPnlMinor: null,
    finalPnlSource: null,
    actualR: null,
    traderOutcome: null,
    traderOutcomeSelectedAt: null,
    exitHistoryCompleteness: null,
    exitedAt: null,
  } as const;

  // -------------------------------------------------------------------------
  // Part
  // -------------------------------------------------------------------------

  describe('Part', () => {
    it('records only its own leg and keeps the Trade Open', async () => {
      const tradeId = await openContractTrade();
      const result = await record(
        tradeId,
        part({
          realizedPnlMinor: 5_000n,
          closedBps: 5_000,
          exitPrice: '2410.5',
          exitedAt: at(1),
          exitReason: '  Took half at 1R  ',
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        scope: 'part',
        status: 'open',
        alreadyRecorded: false,
        actualR: null,
        traderOutcome: null,
      });
      expect(await readTrade(tradeId)).toMatchObject(WHOLE_TRADE_UNTOUCHED);
      const [leg] = await readExits(tradeId);
      expect(leg).toMatchObject({
        sequence: 1,
        exitScope: 'part',
        realizedPnlMinor: 5_000n,
        closedBps: 5_000,
        exitPrice: '2410.5000000000',
        exitedAt: at(1),
        exitReason: 'Took half at 1R',
      });
      expect(leg?.mutationFingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('accepts a leg with every answer unanswered, and still never completes the Trade', async () => {
      const tradeId = await openContractTrade();
      expect(await record(tradeId, part())).toMatchObject({ ok: true, status: 'open' });
      const [leg] = await readExits(tradeId);
      expect(leg).toMatchObject({
        exitScope: 'part',
        realizedPnlMinor: null,
        closedBps: null,
        exitPrice: null,
        exitedAt: null,
        exitReason: null,
      });
      expect(await readTrade(tradeId)).toMatchObject(WHOLE_TRADE_UNTOUCHED);
    });

    it('cannot carry Final Net P&L, Trader Outcome or any whole-Trade answer', async () => {
      const { RecordContractExitSchema } = await import('@/lib/trades/schemas');
      const base = {
        tradeId: crypto.randomUUID(),
        mutationKey: crypto.randomUUID(),
        scope: 'part',
      };
      for (const extra of [
        { finalPnlMinor: '100' },
        { traderOutcome: 'win' },
        { exitHistoryCompleteness: 'complete' },
        { finalExitedAt: at(1).toISOString() },
        { finalPnlAdoptedFromExits: true },
        { postTradeEmotionKeys: [] },
      ]) {
        expect(RecordContractExitSchema.safeParse({ ...base, ...extra }).success).toBe(false);
      }
      expect(RecordContractExitSchema.safeParse(base).success).toBe(true);
    });

    it('a 100% Part is refused: only All Remaining closes the position', async () => {
      const tradeId = await openContractTrade();
      expect(await record(tradeId, part({ closedBps: 10_000 }))).toEqual({
        ok: false,
        code: 'invalid_closed_bps',
      });
      await record(tradeId, part({ closedBps: 6_000 }));
      expect(await record(tradeId, part({ closedBps: 4_000 }))).toEqual({
        ok: false,
        code: 'invalid_closed_bps',
      });
      expect(await readExits(tradeId)).toHaveLength(1);
      expect(await readTrade(tradeId)).toMatchObject(WHOLE_TRADE_UNTOUCHED);
    });

    it('multiple Parts stay distinct legs in order', async () => {
      const tradeId = await openContractTrade();
      await record(tradeId, part({ realizedPnlMinor: 3_000n, closedBps: 3_000, exitedAt: at(1) }));
      await record(tradeId, part({ realizedPnlMinor: 3_000n, closedBps: 3_000, exitedAt: at(1) }));
      await record(tradeId, part({ realizedPnlMinor: -1_000n, exitedAt: at(2) }));
      const legs = await readExits(tradeId);
      expect(legs.map((leg) => [leg.sequence, leg.realizedPnlMinor, leg.closedBps])).toEqual([
        [1, 3_000n, 3_000],
        [2, 3_000n, 3_000],
        [3, -1_000n, null],
      ]);
      expect(new Set(legs.map((leg) => leg.id)).size).toBe(3);
      expect(await readTrade(tradeId)).toMatchObject(WHOLE_TRADE_UNTOUCHED);
    });

    it('rejects an exit time before entry or in the future, each with its own reason', async () => {
      const tradeId = await openContractTrade();
      expect(await record(tradeId, part({ exitedAt: new Date(ENTERED_AT.getTime() - 1) }))).toEqual(
        {
          ok: false,
          code: 'exit_time_before_entry',
        },
      );
      expect(await record(tradeId, part({ exitedAt: new Date(Date.now() + HOUR) }))).toEqual({
        ok: false,
        code: 'exit_time_in_future',
      });
      expect(await readExits(tradeId)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // All Remaining — the Final Close
  // -------------------------------------------------------------------------

  describe('All Remaining', () => {
    it('closes the Trade with Final Net P&L exactly as stated and Actual R against Risk at Entry', async () => {
      const tradeId = await openContractTrade();
      const result = await record(
        tradeId,
        finalClose({ finalPnlMinor: 12_345n, finalExitedAt: at(3), exitPrice: '2420' }),
      );
      expect(result).toMatchObject({
        ok: true,
        scope: 'all_remaining',
        status: 'closed',
        actualR: '1.2345',
        traderOutcome: null,
      });
      expect(await readTrade(tradeId)).toMatchObject({
        status: 'closed',
        netPnlMinor: 12_345n,
        finalPnlSource: 'manual_total',
        actualR: '1.2345',
        actualResultMode: 'money',
        traderOutcome: null,
        traderOutcomeSelectedAt: null,
        exitedAt: at(3),
        actualExit: null,
        calcVersion: 1,
      });
      const legs = await readExits(tradeId);
      expect(legs).toHaveLength(1);
      expect(legs[0]).toMatchObject({ exitScope: 'all_remaining', exitPrice: '2420.0000000000' });
    });

    it('stores the selected outcome independently of the P&L sign', async () => {
      // A loss the trader calls a Win, and a profit the trader calls BE.
      const lossWin = await openContractTrade();
      await record(lossWin, finalClose({ finalPnlMinor: -2_000n, traderOutcome: 'win' }));
      expect(await readTrade(lossWin)).toMatchObject({
        netPnlMinor: -2_000n,
        actualR: '-0.2000',
        traderOutcome: 'win',
      });
      expect((await readTrade(lossWin)).traderOutcomeSelectedAt).toBeInstanceOf(Date);

      const profitBe = await openContractTrade();
      await record(profitBe, finalClose({ finalPnlMinor: 9_000n, traderOutcome: 'break_even' }));
      expect(await readTrade(profitBe)).toMatchObject({
        netPnlMinor: 9_000n,
        actualR: '0.9000',
        traderOutcome: 'break_even',
      });
    });

    it('never derives an outcome, and never fabricates 0R, when answers are missing', async () => {
      // No Final Net P&L: no R, no outcome — not 0R, not a loss.
      const noPnl = await openContractTrade();
      expect(await record(noPnl, finalClose())).toMatchObject({
        ok: true,
        status: 'closed',
        actualR: null,
        traderOutcome: null,
      });
      expect(await readTrade(noPnl)).toMatchObject({
        status: 'closed',
        netPnlMinor: null,
        finalPnlSource: null,
        actualR: null,
        traderOutcome: null,
        exitedAt: null,
      });

      // A zero Final Net P&L is a stated zero: 0R is real here, and still no outcome.
      const zero = await openContractTrade();
      await record(zero, finalClose({ finalPnlMinor: 0n }));
      expect(await readTrade(zero)).toMatchObject({
        netPnlMinor: 0n,
        actualR: '0.0000',
        traderOutcome: null,
      });

      // A missing Risk at Entry is the other way to an unknown R, but an Open
      // contract Trade cannot lack one (trades_status_consistency_check), so a
      // live Final Close reaches an unknown R only through a missing Final Net P&L.
    });

    it('keeps the exit subtotal as evidence: a differing Final Net P&L stays authoritative', async () => {
      const tradeId = await openContractTrade();
      await record(tradeId, part({ realizedPnlMinor: 4_000n, closedBps: 5_000 }));
      await record(
        tradeId,
        finalClose({
          realizedPnlMinor: 4_000n,
          closedBps: 5_000,
          finalPnlMinor: 7_500n,
          exitHistoryCompleteness: 'complete',
        }),
      );
      // Legs sum to 80.00; the trader's 75.00 (after costs) is the result.
      expect(await readTrade(tradeId)).toMatchObject({
        netPnlMinor: 7_500n,
        finalPnlSource: 'manual_total',
        actualR: '0.7500',
        exitHistoryCompleteness: 'complete',
      });
      expect((await readExits(tradeId)).map((leg) => leg.realizedPnlMinor)).toEqual([
        4_000n,
        4_000n,
      ]);
    });

    it('adopts the exit subtotal only on an explicit, re-checked claim', async () => {
      const adopted = await openContractTrade();
      await record(adopted, part({ realizedPnlMinor: 4_000n, closedBps: 5_000 }));
      await record(
        adopted,
        finalClose({
          realizedPnlMinor: 2_000n,
          closedBps: 5_000,
          finalPnlMinor: 6_000n,
          finalPnlAdoptedFromExits: true,
          exitHistoryCompleteness: 'complete',
        }),
      );
      expect(await readTrade(adopted)).toMatchObject({
        netPnlMinor: 6_000n,
        finalPnlSource: 'exit_history',
      });

      // Each broken premise is refused, and nothing is written.
      for (const [label, input] of [
        [
          'a subtotal that differs',
          { realizedPnlMinor: 2_000n, finalPnlMinor: 7_000n, exitHistoryCompleteness: 'complete' },
        ],
        [
          'an incomplete history',
          {
            realizedPnlMinor: 2_000n,
            finalPnlMinor: 6_000n,
            exitHistoryCompleteness: 'incomplete',
          },
        ],
        ['an unanswered completeness', { realizedPnlMinor: 2_000n, finalPnlMinor: 6_000n }],
        ['a leg with no P&L', { finalPnlMinor: 4_000n, exitHistoryCompleteness: 'complete' }],
      ] as const) {
        const tradeId = await openContractTrade();
        await record(tradeId, part({ realizedPnlMinor: 4_000n, closedBps: 5_000 }));
        const result = await record(
          tradeId,
          finalClose({ ...input, finalPnlAdoptedFromExits: true }),
        );
        expect(result, label).toEqual({ ok: false, code: 'exit_history_not_adoptable' });
        expect(await readTrade(tradeId), label).toMatchObject(WHOLE_TRADE_UNTOUCHED);
        expect(await readExits(tradeId), label).toHaveLength(1);
      }
    });

    it('validates the final exit time against entry, the clock and every leg', async () => {
      for (const [code, legAt, finalAt] of [
        ['exit_time_before_entry', null, new Date(ENTERED_AT.getTime() - 1)],
        ['exit_time_in_future', null, new Date(Date.now() + HOUR)],
        ['final_exit_before_recorded_exit', at(4), at(3)],
      ] as const) {
        const tradeId = await openContractTrade();
        if (legAt !== null) await record(tradeId, part({ exitedAt: legAt }));
        expect(await record(tradeId, finalClose({ finalExitedAt: finalAt })), code).toEqual({
          ok: false,
          code,
        });
        expect(await readTrade(tradeId), code).toMatchObject({ status: 'open' });
      }
      // The closing leg itself counts as a recorded exit.
      const closingLeg = await openContractTrade();
      expect(
        await record(closingLeg, finalClose({ exitedAt: at(4), finalExitedAt: at(3) })),
      ).toEqual({ ok: false, code: 'final_exit_before_recorded_exit' });
    });

    it('leaves an unanswered final exit time unknown, never "now" or the last leg time', async () => {
      const tradeId = await openContractTrade();
      await record(tradeId, part({ exitedAt: at(2) }));
      await record(tradeId, finalClose({ exitedAt: at(3), finalPnlMinor: 1_000n }));
      expect(await readTrade(tradeId)).toMatchObject({ status: 'closed', exitedAt: null });
    });

    it('refuses closed percentages over the whole position', async () => {
      const tradeId = await openContractTrade();
      await record(tradeId, part({ closedBps: 7_000 }));
      expect(await record(tradeId, finalClose({ closedBps: 4_000 }))).toEqual({
        ok: false,
        code: 'invalid_closed_bps',
      });
      expect(await record(tradeId, finalClose({ closedBps: 3_000 }))).toMatchObject({
        ok: true,
        status: 'closed',
      });
    });

    it('takes no Post-Trade Emotion: that is After-Trade Context, captured once Closed', async () => {
      const { RecordContractExitSchema } = await import('@/lib/trades/schemas');
      expect(
        RecordContractExitSchema.safeParse({
          tradeId: crypto.randomUUID(),
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          postTradeEmotionKeys: ['calm'],
        }).success,
      ).toBe(false);
      const tradeId = await openContractTrade();
      await record(tradeId, finalClose({ finalPnlMinor: 1_000n }));
      expect((await readTrade(tradeId)).postTradeEmotionsRecordedAt).toBeNull();
      expect(
        await db.select().from(tradeEmotions).where(eq(tradeEmotions.tradeId, tradeId)),
      ).toEqual([]);
    });

    it('a Closed Trade takes no further exit of either scope', async () => {
      const tradeId = await openContractTrade();
      await record(tradeId, finalClose({ finalPnlMinor: 1_000n }));
      expect(await record(tradeId, part())).toEqual({
        ok: false,
        code: 'invalid_status_transition',
      });
      expect(await record(tradeId, finalClose({ finalPnlMinor: 2_000n }))).toEqual({
        ok: false,
        code: 'invalid_status_transition',
      });
      expect(await readTrade(tradeId)).toMatchObject({ netPnlMinor: 1_000n });
      expect(await readExits(tradeId)).toHaveLength(1);
    });

    it('audits the exit and the close', async () => {
      const tradeId = await openContractTrade();
      const result = await record(tradeId, finalClose({ finalPnlMinor: 1_000n }));
      if (!result.ok) throw new Error(result.code);
      const logs = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.workspaceId, workspaceId),
            inArray(auditLogs.entityId, [tradeId, result.exitId]),
            inArray(auditLogs.action, ['trade.exit_added', 'trade.closed']),
          ),
        );
      // One of each, nothing more: the exit is not audited twice on a close.
      expect(logs.map((log) => log.action).sort()).toEqual(['trade.closed', 'trade.exit_added']);
      // Audit metadata is identifiers and lifecycle only — never money.
      for (const log of logs) expect(Object.keys(log.metadata ?? {})).not.toContain('netPnlMinor');
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency and concurrency
  // -------------------------------------------------------------------------

  describe('retries and concurrency', () => {
    it('an exact Part replay returns the recorded leg and writes nothing', async () => {
      const tradeId = await openContractTrade();
      const input = part({ realizedPnlMinor: 1_000n, closedBps: 2_500, exitedAt: at(1) });
      const first = await record(tradeId, input);
      const again = await record(tradeId, input);
      if (!first.ok || !again.ok) throw new Error('expected success');
      expect(again).toMatchObject({ alreadyRecorded: true, exitId: first.exitId, status: 'open' });
      expect(await readExits(tradeId)).toHaveLength(1);
    });

    it('an exact Final Close replay returns the closed result, not a status error', async () => {
      const tradeId = await openContractTrade();
      const input = finalClose({ finalPnlMinor: -5_000n, traderOutcome: 'loss' });
      const first = await record(tradeId, input);
      const again = await record(tradeId, input);
      expect(again).toEqual({ ...first, alreadyRecorded: true });
      expect(again).toMatchObject({ status: 'closed', actualR: '-0.5000', traderOutcome: 'loss' });
      expect(await readExits(tradeId)).toHaveLength(1);
    });

    it('a used Save key with different content, or on another Trade, is a replay conflict', async () => {
      const tradeId = await openContractTrade();
      const input = part({ realizedPnlMinor: 1_000n });
      await record(tradeId, input);
      expect(await record(tradeId, { ...input, realizedPnlMinor: 2_000n })).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: 'different',
      });
      // The same key re-sent as a Final Close is a different request, not a close.
      expect(
        await record(tradeId, { mutationKey: input.mutationKey, scope: 'all_remaining' }),
      ).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: 'different',
      });
      const other = await openContractTrade();
      expect(await record(other, input)).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: 'different',
      });
      expect(await readExits(tradeId)).toHaveLength(1);
      expect(await readTrade(tradeId)).toMatchObject({ status: 'open' });
      expect(await readExits(other)).toHaveLength(0);
    });

    it('a Save key recorded before fingerprints existed is unverifiable, never assumed identical', async () => {
      const tradeId = await openContractTrade();
      const input = part({ realizedPnlMinor: 1_000n });
      await record(tradeId, input);
      await db
        .update(tradeExits)
        .set({ mutationFingerprint: null })
        .where(eq(tradeExits.mutationKey, input.mutationKey));
      expect(await record(tradeId, input)).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: 'unverifiable',
      });
    });

    it('the same request sent concurrently records exactly one leg', async () => {
      const tradeId = await openContractTrade();
      const input = finalClose({ finalPnlMinor: 2_000n });
      const results = await Promise.all([
        record(tradeId, input),
        record(tradeId, input),
        record(tradeId, input),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.filter((result) => result.ok && !result.alreadyRecorded)).toHaveLength(1);
      expect(await readExits(tradeId)).toHaveLength(1);
      expect(await readTrade(tradeId)).toMatchObject({ status: 'closed', netPnlMinor: 2_000n });
    });

    it('two different Final Closes racing: one closes, the other is refused', async () => {
      const tradeId = await openContractTrade();
      const results = await Promise.all([
        record(tradeId, finalClose({ finalPnlMinor: 1_000n })),
        record(tradeId, finalClose({ finalPnlMinor: 9_000n })),
      ]);
      const winners = results.filter((result) => result.ok);
      expect(winners).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, code: 'invalid_status_transition' },
      ]);
      const legs = await readExits(tradeId);
      expect(legs).toHaveLength(1);
      const winner = winners[0];
      if (winner === undefined || !winner.ok) throw new Error('no winner');
      // The Trade holds the winner's Final Net P&L, never a mix of the two.
      expect((await readTrade(tradeId)).netPnlMinor).toBe(
        winner.actualR === '0.1000' ? 1_000n : 9_000n,
      );
      expect(legs[0]?.id).toBe(winner.exitId);
    });

    it('concurrent Parts get distinct sequences and never exceed the position', async () => {
      const tradeId = await openContractTrade();
      const results = await Promise.all(
        [4_000, 4_000, 4_000].map((closedBps) => record(tradeId, part({ closedBps }))),
      );
      // Two fit under 100%; the third would reach 120% and is refused.
      expect(results.filter((result) => result.ok)).toHaveLength(2);
      expect(results.filter((result) => !result.ok)).toEqual([
        { ok: false, code: 'invalid_closed_bps' },
      ]);
      expect((await readExits(tradeId)).map((leg) => leg.sequence)).toEqual([1, 2]);
      expect(await readTrade(tradeId)).toMatchObject({ status: 'open' });
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('another workspace cannot reach the Trade, whatever user it acts as', async () => {
      const tradeId = await openContractTrade();
      // Another member's own workspace: the Trade is not there.
      expect(
        await record(tradeId, finalClose({ finalPnlMinor: 1n }), otherWorkspaceId, otherUserId),
      ).toEqual({
        ok: false,
        code: 'trade_not_found',
      });
      // A non-member naming this workspace.
      expect(
        await record(tradeId, finalClose({ finalPnlMinor: 1n }), workspaceId, otherUserId),
      ).toEqual({
        ok: false,
        code: 'workspace_access_denied',
      });
      expect(await readTrade(tradeId)).toMatchObject(WHOLE_TRADE_UNTOUCHED);
      expect(await readExits(tradeId)).toHaveLength(0);
    });

    async function makeReadOnly(): Promise<void> {
      await db
        .update(workspaceEntitlements)
        .set({ status: 'expired', currentPeriodStartedAt: null, currentPeriodEndsAt: null })
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
    }

    it('a read-only workspace cannot record a new exit or close', async () => {
      const tradeId = await openContractTrade();
      await makeReadOnly();
      for (const input of [part({ closedBps: 1_000 }), finalClose({ finalPnlMinor: 1_000n })]) {
        expect(await record(tradeId, input)).toEqual({ ok: false, code: 'read_only_workspace' });
      }
      expect(await readTrade(tradeId)).toMatchObject(WHOLE_TRADE_UNTOUCHED);
      expect(await readExits(tradeId)).toHaveLength(0);
    });

    it('a read-only workspace still gets the recorded result of an exact replay, and nothing else', async () => {
      const partTrade = await openContractTrade();
      const partInput = part({ realizedPnlMinor: 1_000n, closedBps: 2_000 });
      const partFirst = await record(partTrade, partInput);
      const closedTrade = await openContractTrade();
      const closeInput = finalClose({ finalPnlMinor: -3_000n, traderOutcome: 'loss' });
      const closeFirst = await record(closedTrade, closeInput);
      await makeReadOnly();

      // Exact replays write nothing, so write entitlement is not needed.
      expect(await record(partTrade, partInput)).toEqual({ ...partFirst, alreadyRecorded: true });
      expect(await record(closedTrade, closeInput)).toEqual({
        ...closeFirst,
        alreadyRecorded: true,
      });
      // Different content under a used key is still a conflict, never a write.
      expect(await record(partTrade, { ...partInput, closedBps: 3_000 })).toEqual({
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: 'different',
      });
      // A new key is a new write: refused.
      expect(await record(partTrade, part({ closedBps: 1_000 }))).toEqual({
        ok: false,
        code: 'read_only_workspace',
      });
      expect((await readExits(partTrade)).map((leg) => leg.closedBps)).toEqual([2_000]);
      expect(await readExits(closedTrade)).toHaveLength(1);
    });

    it('an exact replay still needs a valid membership', async () => {
      const tradeId = await openContractTrade();
      const input = part({ closedBps: 1_000 });
      await record(tradeId, input);
      await db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, actorUserId),
          ),
        );
      try {
        expect(await record(tradeId, input)).toEqual({
          ok: false,
          code: 'workspace_access_denied',
        });
      } finally {
        await db
          .insert(workspaceMembers)
          .values({ workspaceId, userId: actorUserId, role: 'owner' });
      }
    });

    it('an exact replay on a Trade since deleted is not found', async () => {
      const tradeId = await openContractTrade();
      const input = part({ closedBps: 1_000 });
      await record(tradeId, input);
      await db.update(trades).set({ deletedAt: new Date() }).where(eq(trades.id, tradeId));
      expect(await record(tradeId, input)).toEqual({ ok: false, code: 'trade_not_found' });
    });

    it('a soft-deleted Trade is not found', async () => {
      const tradeId = await openContractTrade();
      await db.update(trades).set({ deletedAt: new Date() }).where(eq(trades.id, tradeId));
      expect(await record(tradeId, part())).toEqual({ ok: false, code: 'trade_not_found' });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy isolation
  // -------------------------------------------------------------------------

  describe('legacy isolation', () => {
    async function openLegacyTrade(): Promise<string> {
      const created = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: accountId,
        symbol: 'EURUSD',
        direction: 'long',
        systemPlanBasis: 'money',
        plannedRiskMinor: 10_000n,
      });
      if (!created.ok) throw new Error(created.code);
      const opened = await openTrade(workspaceId, actorUserId, created.tradeId, {
        actualResultMode: 'money',
        actualInitialRiskMinor: 5_000n,
        enteredAt: ENTERED_AT,
      });
      if (!opened.ok) throw new Error(opened.code);
      return created.tradeId;
    }

    it('a legacy Trade is refused and left exactly as it was', async () => {
      const tradeId = await openLegacyTrade();
      const before = await readTrade(tradeId);
      for (const input of [
        part({ closedBps: 1_000 }),
        finalClose({ finalPnlMinor: 1_000n, traderOutcome: 'win' }),
      ]) {
        expect(await record(tradeId, input)).toEqual({
          ok: false,
          code: 'legacy_trade_not_supported',
        });
      }
      expect(await readTrade(tradeId)).toEqual(before);
      expect(await readExits(tradeId)).toHaveLength(0);
    });

    it('a legacy exit leg on a contract Trade stays evidence, never the Final Net P&L', async () => {
      const tradeId = await openContractTrade();
      // Written through the legacy exit path before this slice existed.
      await db.update(trades).set({ actualResultMode: 'money' }).where(eq(trades.id, tradeId));
      const legacy = await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 5_000,
        realizedPnlMinor: 8_000n,
        exitedAt: at(1),
      });
      if (!legacy.ok) throw new Error(`legacy exit: ${legacy.code}`);
      const result = await record(
        tradeId,
        finalClose({ closedBps: 5_000, finalPnlMinor: -1_000n }),
      );
      expect(result).toMatchObject({
        ok: true,
        status: 'closed',
        actualR: '-0.1000',
        traderOutcome: null,
      });
      expect(await readTrade(tradeId)).toMatchObject({
        netPnlMinor: -1_000n,
        finalPnlSource: 'manual_total',
      });
      const legs = await readExits(tradeId);
      expect(legs.map((leg) => [leg.exitScope, leg.mutationFingerprint === null])).toEqual([
        [null, true],
        ['all_remaining', false],
      ]);
    });

    it('the database still holds a legacy Open Trade to the legacy exit shape (migration 0027)', async () => {
      const tradeId = await openLegacyTrade();
      // A shapeless leg written straight to the table, bypassing every service.
      await expect(
        db.insert(tradeExits).values({ workspaceId, tradeId, sequence: 1, exitScope: 'part' }),
      ).rejects.toThrow();
      expect(await readExits(tradeId)).toHaveLength(0);
    });

    it('the database lets a contract Open Trade take a shapeless leg, never a whole position of Parts', async () => {
      const tradeId = await openContractTrade();
      await db.insert(tradeExits).values({ workspaceId, tradeId, sequence: 1, exitScope: 'part' });
      // Known allocations reaching 100% on a Trade still Open fail at commit.
      await expect(
        db.insert(tradeExits).values({
          workspaceId,
          tradeId,
          sequence: 2,
          exitScope: 'part',
          closedBps: 10_000,
        }),
      ).rejects.toThrow();
      expect(await readExits(tradeId)).toHaveLength(1);
    });

    it('a contract Trade closed by the legacy live close cannot be re-closed here', async () => {
      const tradeId = await openContractTrade();
      const closed = await closeTrade(workspaceId, actorUserId, tradeId, {
        actualExit: '2410',
        netPnlMinor: 3_000n,
        exitedAt: at(1),
      });
      if (!closed.ok) throw new Error(closed.code);
      const before = await readTrade(tradeId);
      // Its derived outcome and derived R stay as recorded: nothing here makes them canonical.
      expect(before).toMatchObject({ finalPnlSource: null, traderOutcomeSelectedAt: null });
      expect(
        await record(tradeId, finalClose({ finalPnlMinor: 3_000n, traderOutcome: 'win' })),
      ).toEqual({
        ok: false,
        code: 'invalid_status_transition',
      });
      expect(await readTrade(tradeId)).toEqual(before);
    });
  });
});
