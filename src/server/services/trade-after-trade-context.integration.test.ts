/**
 * STAGE 6 — AFTER-TRADE CONTEXT against a real database.
 *
 * Optional enrichment of a Closed contract Trade: an after-trade note, an
 * after-trade chart link, and Post-Trade Emotion, each a three-way patch.
 * It never touches the result, the outcome, the entry evidence or Review /
 * System Assessment, has its own Save key and fingerprint, and gives a
 * legacy-closed contract Trade context without promoting its result.
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  emotionTypes,
  tradeAfterTradeContextSaves,
  tradeEmotions,
  trades,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  canonicalActualConditions,
  canonicalTraderConditions,
} from '../dal/canonical-analytics-population';
import {
  recordAfterTradeContext,
  type RecordAfterTradeContextInput,
} from './trade-after-trade-context';
import { recordContractExit } from './trade-exit-contract';
import { createTrade, openTrade } from './trade-management';

type Db = ReturnType<typeof getTestDb>;

const HOUR = 60 * 60 * 1000;
const ENTERED_AT = new Date(Date.now() - 10 * HOUR);
const CHART = 'https://www.tradingview.com/x/AbCd1234/';

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
      name: 'Stage 6 test workspace',
      slug: `stage6-${crypto.randomUUID()}`,
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

describe('Stage 6 After-Trade Context (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let otherUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let accountId: string;

  beforeAll(async () => {
    actorUserId = await createUser(db, 'stage6-actor');
    otherUserId = await createUser(db, 'stage6-other');
    workspaceId = await createWorkspace(db, actorUserId);
    otherWorkspaceId = await createWorkspace(db, otherUserId);
    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Stage 6 account',
        accountMode: 'demo',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
        timezone: 'UTC',
        mutationKey: crypto.randomUUID(),
      })
      .returning({ id: tradingAccounts.id });
    if (account === undefined) throw new Error('account insert failed');
    accountId = account.id;
  });

  afterEach(async () => {
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

  async function openContractTrade(): Promise<string> {
    const created = await createTrade(workspaceId, actorUserId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: accountId,
      symbol: 'XAUUSD',
      direction: 'long',
      recordingTiming: 'at_entry',
      recordingContract: 'add_trade_v1',
      systemPlanBasis: 'money',
      plannedRiskMinor: 10_000n,
      plannedRiskState: 'defined',
      actualRiskAnswer: 'matched',
      enteredAt: ENTERED_AT,
      enteredAtSource: 'trader',
      confirmationNotes: 'Entry thesis.',
      notes: 'Entry notes.',
      tradingviewUrl: 'https://www.tradingview.com/x/Entry0001/',
    });
    if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created)}`);
    return created.tradeId;
  }

  /** Closed through the canonical Final Close: a stated -50.00, a selected Loss. */
  async function closedCanonicalTrade(): Promise<string> {
    const tradeId = await openContractTrade();
    const closed = await recordContractExit(workspaceId, actorUserId, tradeId, {
      mutationKey: crypto.randomUUID(),
      scope: 'all_remaining',
      finalPnlMinor: -5_000n,
      traderOutcome: 'loss',
      finalExitedAt: new Date(ENTERED_AT.getTime() + HOUR),
    });
    if (!closed.ok) throw new Error(`close failed: ${closed.code}`);
    return tradeId;
  }

  /** Closed through the legacy close before it was retired: a derived outcome, no stated source. */
  async function legacyClosedContractTrade(): Promise<string> {
    const tradeId = await openContractTrade();
    await db
      .update(trades)
      .set({
        status: 'closed',
        actualResultMode: 'money',
        actualExit: '2410',
        netPnlMinor: 3_000n,
        actualR: '0.3000',
        traderOutcome: 'win',
        exitedAt: new Date(ENTERED_AT.getTime() + HOUR),
        calcVersion: 1,
      })
      .where(eq(trades.id, tradeId));
    return tradeId;
  }

  function save(tradeId: string, patch: Omit<RecordAfterTradeContextInput, 'mutationKey'>) {
    return recordAfterTradeContext(workspaceId, actorUserId, tradeId, {
      mutationKey: crypto.randomUUID(),
      ...patch,
    });
  }

  async function readTrade(tradeId: string) {
    const row = await db.query.trades.findFirst({ where: eq(trades.id, tradeId) });
    if (row === undefined) throw new Error('trade missing');
    return row;
  }

  async function emotionRows(tradeId: string) {
    return db
      .select({ key: emotionTypes.key, phase: tradeEmotions.phase })
      .from(tradeEmotions)
      .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
      .where(eq(tradeEmotions.tradeId, tradeId))
      .orderBy(asc(emotionTypes.key));
  }

  async function auditCount(tradeId: string) {
    const rows = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityId, tradeId),
          eq(auditLogs.action, 'trade.after_trade_context_recorded'),
        ),
      );
    return rows.length;
  }

  /** Every column Stage 6 must never touch. */
  function resultAndEvidence(row: typeof trades.$inferSelect) {
    return {
      status: row.status,
      netPnlMinor: row.netPnlMinor,
      finalPnlSource: row.finalPnlSource,
      actualR: row.actualR,
      traderOutcome: row.traderOutcome,
      traderOutcomeSelectedAt: row.traderOutcomeSelectedAt,
      exitedAt: row.exitedAt,
      exitHistoryCompleteness: row.exitHistoryCompleteness,
      confirmationNotes: row.confirmationNotes,
      notes: row.notes,
      tradingviewUrl: row.tradingviewUrl,
      reviewNotes: row.reviewNotes,
      reviewStatus: row.reviewStatus,
      emotionsRecordedAt: row.emotionsRecordedAt,
      systemStatus: row.systemStatus,
      systemR: row.systemR,
    };
  }

  // -------------------------------------------------------------------------
  // The three fields, each a three-way patch
  // -------------------------------------------------------------------------

  describe('patch semantics', () => {
    it('sets, leaves unchanged and clears the after-trade note', async () => {
      const tradeId = await closedCanonicalTrade();
      expect(await save(tradeId, { afterTradeNote: 'Held on hope.' })).toMatchObject({
        ok: true,
        afterTradeNote: 'Held on hope.',
        afterTradeTradingviewUrl: null,
      });
      // Another field changes; the note is left as it was.
      await save(tradeId, { afterTradeTradingviewUrl: CHART });
      expect(await readTrade(tradeId)).toMatchObject({
        afterTradeNote: 'Held on hope.',
        afterTradeTradingviewUrl: CHART,
      });
      expect(await save(tradeId, { afterTradeNote: null })).toMatchObject({
        ok: true,
        afterTradeNote: null,
        afterTradeTradingviewUrl: CHART,
      });
    });

    it('sets and clears the after-trade chart link, apart from the entry link', async () => {
      const tradeId = await closedCanonicalTrade();
      await save(tradeId, { afterTradeTradingviewUrl: CHART });
      expect(await readTrade(tradeId)).toMatchObject({
        afterTradeTradingviewUrl: CHART,
        tradingviewUrl: 'https://www.tradingview.com/x/Entry0001/',
      });
      await save(tradeId, { afterTradeTradingviewUrl: null });
      expect(await readTrade(tradeId)).toMatchObject({
        afterTradeTradingviewUrl: null,
        tradingviewUrl: 'https://www.tradingview.com/x/Entry0001/',
      });
    });

    it('keeps Post-Trade Emotion Unanswered, None and chosen distinct — and Entry Emotion apart', async () => {
      const tradeId = await closedCanonicalTrade();
      // Unanswered to begin with.
      expect(await save(tradeId, { afterTradeNote: 'x' })).toMatchObject({
        postTradeEmotions: { answer: 'unanswered' },
      });
      expect((await readTrade(tradeId)).postTradeEmotionsRecordedAt).toBeNull();
      // Chosen.
      expect(await save(tradeId, { postTradeEmotionKeys: ['frustrated', 'calm'] })).toMatchObject({
        postTradeEmotions: { answer: 'selected', keys: ['calm', 'frustrated'] },
      });
      expect(await emotionRows(tradeId)).toEqual([
        { key: 'calm', phase: 'post_trade' },
        { key: 'frustrated', phase: 'post_trade' },
      ]);
      // Replaced as a set, never appended.
      await save(tradeId, { postTradeEmotionKeys: ['calm'] });
      expect(await emotionRows(tradeId)).toEqual([{ key: 'calm', phase: 'post_trade' }]);
      // An explicit None: recorded, with no rows.
      expect(await save(tradeId, { postTradeEmotionKeys: [] })).toMatchObject({
        postTradeEmotions: { answer: 'none' },
      });
      expect(await emotionRows(tradeId)).toEqual([]);
      expect((await readTrade(tradeId)).postTradeEmotionsRecordedAt).toBeInstanceOf(Date);
      // Cleared back to Unanswered.
      expect(await save(tradeId, { postTradeEmotionKeys: null })).toMatchObject({
        postTradeEmotions: { answer: 'unanswered' },
      });
      expect((await readTrade(tradeId)).postTradeEmotionsRecordedAt).toBeNull();
    });

    it('refuses an unknown emotion and writes nothing', async () => {
      const tradeId = await closedCanonicalTrade();
      expect(await save(tradeId, { postTradeEmotionKeys: ['not-an-emotion'] })).toEqual({
        ok: false,
        code: 'unknown_emotion_key',
      });
      expect((await readTrade(tradeId)).postTradeEmotionsRecordedAt).toBeNull();
      expect(await auditCount(tradeId)).toBe(0);
    });

    it('never changes the result, the outcome, the entry evidence or Review / System data', async () => {
      const tradeId = await closedCanonicalTrade();
      const before = resultAndEvidence(await readTrade(tradeId));
      await save(tradeId, {
        afterTradeNote: 'Exited late.',
        afterTradeTradingviewUrl: CHART,
        postTradeEmotionKeys: ['calm'],
      });
      await save(tradeId, { afterTradeNote: null, postTradeEmotionKeys: null });
      expect(resultAndEvidence(await readTrade(tradeId))).toEqual(before);
      expect(before).toMatchObject({
        status: 'closed',
        netPnlMinor: -5_000n,
        finalPnlSource: 'manual_total',
        actualR: '-0.5000',
        traderOutcome: 'loss',
      });
    });

    it('audits each accepted Save once, naming only which fields changed', async () => {
      const tradeId = await closedCanonicalTrade();
      await save(tradeId, { afterTradeNote: 'Exited late.', postTradeEmotionKeys: [] });
      const [log] = await db
        .select({ metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityId, tradeId),
            eq(auditLogs.action, 'trade.after_trade_context_recorded'),
          ),
        );
      expect(log?.metadata).toEqual({
        tradeId,
        changedFields: ['afterTradeNote', 'postTradeEmotions'],
      });
      expect(JSON.stringify(log?.metadata)).not.toContain('Exited late');
    });
  });

  // -------------------------------------------------------------------------
  // Eligibility
  // -------------------------------------------------------------------------

  describe('eligibility', () => {
    it('refuses an Open contract Trade: Stage 6 follows the Final Close', async () => {
      const tradeId = await openContractTrade();
      expect(await save(tradeId, { afterTradeNote: 'Too early.' })).toEqual({
        ok: false,
        code: 'invalid_status_transition',
      });
      expect((await readTrade(tradeId)).afterTradeNote).toBeNull();
    });

    it('refuses a true legacy Trade', async () => {
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
      expect(await save(created.tradeId, { afterTradeNote: 'Legacy.' })).toEqual({
        ok: false,
        code: 'legacy_trade_not_supported',
      });
    });

    it('the database holds the fields to Closed contract Trades only', async () => {
      const tradeId = await openContractTrade();
      await expect(
        db.update(trades).set({ afterTradeNote: 'Direct write.' }).where(eq(trades.id, tradeId)),
      ).rejects.toThrow();
      const closed = await closedCanonicalTrade();
      await expect(
        db.update(trades).set({ afterTradeNote: '   ' }).where(eq(trades.id, closed)),
      ).rejects.toThrow();
    });

    it('another workspace cannot reach the Trade', async () => {
      const tradeId = await closedCanonicalTrade();
      expect(
        await recordAfterTradeContext(otherWorkspaceId, otherUserId, tradeId, {
          mutationKey: crypto.randomUUID(),
          afterTradeNote: 'x',
        }),
      ).toEqual({ ok: false, code: 'trade_not_found' });
      expect(
        await recordAfterTradeContext(workspaceId, otherUserId, tradeId, {
          mutationKey: crypto.randomUUID(),
          afterTradeNote: 'x',
        }),
      ).toEqual({ ok: false, code: 'workspace_access_denied' });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy isolation
  // -------------------------------------------------------------------------

  describe('a contract Trade closed by the legacy close', () => {
    async function inCanonicalR(tradeId: string): Promise<boolean> {
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.id, tradeId), ...canonicalActualConditions()));
      return rows.length === 1;
    }
    async function inCanonicalTrader(tradeId: string): Promise<boolean> {
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(and(eq(trades.id, tradeId), ...canonicalTraderConditions()));
      return rows.length === 1;
    }

    it('takes Stage 6 context, stored normally, without its result becoming canonical', async () => {
      const tradeId = await legacyClosedContractTrade();
      const before = resultAndEvidence(await readTrade(tradeId));
      expect(await inCanonicalR(tradeId)).toBe(false);
      expect(await inCanonicalTrader(tradeId)).toBe(false);

      const result = await save(tradeId, {
        afterTradeNote: 'Took profit early.',
        afterTradeTradingviewUrl: CHART,
        postTradeEmotionKeys: ['calm'],
      });
      expect(result).toMatchObject({
        ok: true,
        afterTradeNote: 'Took profit early.',
        afterTradeTradingviewUrl: CHART,
        postTradeEmotions: { answer: 'selected', keys: ['calm'] },
      });
      // Its legacy result keeps its authority and its legacy coverage.
      expect(resultAndEvidence(await readTrade(tradeId))).toEqual(before);
      expect(before).toMatchObject({
        finalPnlSource: null,
        traderOutcomeSelectedAt: null,
        actualR: '0.3000',
      });
      expect(await inCanonicalR(tradeId)).toBe(false);
      expect(await inCanonicalTrader(tradeId)).toBe(false);
    });

    it('while a canonically closed Trade stays canonical after the same enrichment', async () => {
      const tradeId = await closedCanonicalTrade();
      expect(await inCanonicalR(tradeId)).toBe(true);
      await save(tradeId, { afterTradeNote: 'Fine.' });
      expect(await inCanonicalR(tradeId)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency and concurrency
  // -------------------------------------------------------------------------

  describe('retries and concurrency', () => {
    it('an exact retry returns the recorded context and writes nothing more', async () => {
      const tradeId = await closedCanonicalTrade();
      const input = {
        mutationKey: crypto.randomUUID(),
        afterTradeNote: 'First.',
        postTradeEmotionKeys: ['calm', 'frustrated'],
      };
      const first = await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input);
      // Emotion key order is not part of what the Save said.
      const again = await recordAfterTradeContext(workspaceId, actorUserId, tradeId, {
        ...input,
        postTradeEmotionKeys: ['frustrated', 'calm'],
      });
      expect(again).toEqual({ ...first, alreadyRecorded: true });
      expect(await emotionRows(tradeId)).toHaveLength(2);
      expect(await auditCount(tradeId)).toBe(1);
    });

    it('a replay answers with the context as it stands now', async () => {
      const tradeId = await closedCanonicalTrade();
      const input = { mutationKey: crypto.randomUUID(), afterTradeNote: 'First.' };
      await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input);
      await save(tradeId, { afterTradeNote: 'Second.' });
      expect(await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input)).toMatchObject(
        {
          ok: true,
          alreadyRecorded: true,
          afterTradeNote: 'Second.',
        },
      );
    });

    it('the same Save key with different content, or on another Trade, is a replay conflict', async () => {
      const tradeId = await closedCanonicalTrade();
      const input = { mutationKey: crypto.randomUUID(), afterTradeNote: 'First.' };
      await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input);
      const conflict = {
        ok: false,
        code: 'mutation_replay_conflict',
        replayConflict: 'different',
      };
      expect(
        await recordAfterTradeContext(workspaceId, actorUserId, tradeId, {
          ...input,
          afterTradeNote: 'Changed.',
        }),
      ).toEqual(conflict);
      // Clearing is a different request from leaving the field out.
      expect(
        await recordAfterTradeContext(workspaceId, actorUserId, tradeId, {
          mutationKey: input.mutationKey,
          afterTradeNote: 'First.',
          afterTradeTradingviewUrl: null,
        }),
      ).toEqual(conflict);
      const other = await closedCanonicalTrade();
      expect(await recordAfterTradeContext(workspaceId, actorUserId, other, input)).toEqual(
        conflict,
      );
      expect((await readTrade(tradeId)).afterTradeNote).toBe('First.');
      expect((await readTrade(other)).afterTradeNote).toBeNull();
    });

    it('never shares a key with the Final Close', async () => {
      const tradeId = await openContractTrade();
      const key = crypto.randomUUID();
      const closed = await recordContractExit(workspaceId, actorUserId, tradeId, {
        mutationKey: key,
        scope: 'all_remaining',
        finalPnlMinor: 1_000n,
      });
      if (!closed.ok) throw new Error(closed.code);
      // The Final Close key does not answer a Stage 6 Save: it is a new Save.
      expect(
        await recordAfterTradeContext(workspaceId, actorUserId, tradeId, {
          mutationKey: key,
          afterTradeNote: 'After.',
        }),
      ).toMatchObject({ ok: true, alreadyRecorded: false, afterTradeNote: 'After.' });
    });

    it('the same Save sent concurrently records once: one audit event, no duplicate emotions', async () => {
      const tradeId = await closedCanonicalTrade();
      const input = {
        mutationKey: crypto.randomUUID(),
        afterTradeNote: 'Once.',
        postTradeEmotionKeys: ['calm'],
      };
      const results = await Promise.all(
        [1, 2, 3].map(() => recordAfterTradeContext(workspaceId, actorUserId, tradeId, input)),
      );
      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.filter((result) => result.ok && !result.alreadyRecorded)).toHaveLength(1);
      expect(await emotionRows(tradeId)).toEqual([{ key: 'calm', phase: 'post_trade' }]);
      expect(await auditCount(tradeId)).toBe(1);
      const saves = await db
        .select({ id: tradeAfterTradeContextSaves.id })
        .from(tradeAfterTradeContextSaves)
        .where(eq(tradeAfterTradeContextSaves.tradeId, tradeId));
      expect(saves).toHaveLength(1);
    });

    it('a read-only workspace gets an exact replay, and nothing new', async () => {
      const tradeId = await closedCanonicalTrade();
      const input = { mutationKey: crypto.randomUUID(), afterTradeNote: 'Before read-only.' };
      const first = await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input);
      await db
        .update(workspaceEntitlements)
        .set({ status: 'expired', currentPeriodStartedAt: null, currentPeriodEndsAt: null })
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      expect(await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input)).toEqual({
        ...first,
        alreadyRecorded: true,
      });
      expect(await save(tradeId, { afterTradeNote: 'New while read-only.' })).toEqual({
        ok: false,
        code: 'read_only_workspace',
      });
      expect((await readTrade(tradeId)).afterTradeNote).toBe('Before read-only.');
    });

    it('an exact replay still needs a valid membership', async () => {
      const tradeId = await closedCanonicalTrade();
      const input = { mutationKey: crypto.randomUUID(), afterTradeNote: 'x' };
      await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input);
      await db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, actorUserId),
          ),
        );
      try {
        expect(await recordAfterTradeContext(workspaceId, actorUserId, tradeId, input)).toEqual({
          ok: false,
          code: 'workspace_access_denied',
        });
      } finally {
        await db
          .insert(workspaceMembers)
          .values({ workspaceId, userId: actorUserId, role: 'owner' });
      }
    });
  });
});
