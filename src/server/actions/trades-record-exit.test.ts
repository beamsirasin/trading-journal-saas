import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveWorkspaceContext: vi.fn(),
  requireTradeManagement: vi.fn(),
  recordContractExit: vi.fn(),
  recordAfterTradeContext: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/server/auth/dal', () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  getActiveWorkspaceContext: mocks.getActiveWorkspaceContext,
  requireTradeManagement: mocks.requireTradeManagement,
}));
vi.mock('@/server/services/trade-completed', () => ({ createCompletedTrade: vi.fn() }));
vi.mock('@/server/services/trade-discipline', () => ({
  attachTradeMistake: vi.fn(),
  removeTradeMistake: vi.fn(),
  replaceTradeEmotions: vi.fn(),
  updateTradeReviewNotes: vi.fn(),
  updateTradeRuleCheck: vi.fn(),
}));
vi.mock('@/server/services/trade-execution', () => ({
  addTradeExit: vi.fn(),
  closeRemainingTrade: vi.fn(),
  correctTradeExit: vi.fn(),
}));
vi.mock('@/server/services/trade-exit-contract', () => ({
  recordContractExit: mocks.recordContractExit,
}));
vi.mock('@/server/services/trade-after-trade-context', () => ({
  recordAfterTradeContext: mocks.recordAfterTradeContext,
}));
vi.mock('@/server/services/trade-historical-execution', () => ({
  adoptHistoricalExitSubtotal: vi.fn(),
  applyHistoricalExitHistoryCorrection: vi.fn(),
  editHistoricalFinalResult: vi.fn(),
}));
vi.mock('@/server/services/trade-management', () => ({
  assignTradeClassification: vi.fn(),
  cancelTrade: vi.fn(),
  closeTrade: vi.fn(),
  correctSystemResolution: vi.fn(),
  correctTradeExecution: vi.fn(),
  correctTradeIdentity: vi.fn(),
  createTrade: vi.fn(),
  markSystemCannotDetermine: vi.fn(),
  markSystemNoTrade: vi.fn(),
  openTrade: vi.fn(),
  resolveSystemTrade: vi.fn(),
  softDeleteTrade: vi.fn(),
  updateTradePlan: vi.fn(),
}));

const { recordAfterTradeContextAction, recordContractExitAction } = await import('./trades');

const TRADE_ID = '019112a0-0000-7000-8000-000000000001';
const KEY = '019112a0-0000-7000-8000-0000000000aa';

describe('recordContractExitAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });
    mocks.requireTradeManagement.mockResolvedValue('member');
  });

  it('passes the session identity and exact money to the service, never a client workspace', async () => {
    mocks.recordContractExit.mockResolvedValue({
      ok: true,
      tradeId: TRADE_ID,
      exitId: 'exit-1',
      scope: 'all_remaining',
      alreadyRecorded: false,
      status: 'closed',
      actualR: '-0.5000',
      traderOutcome: 'win',
    });
    const result = await recordContractExitAction({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      scope: 'all_remaining',
      finalPnlMinor: '-5000',
      traderOutcome: 'win',
      finalExitedAt: '2026-09-20T10:00:00Z',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        tradeId: TRADE_ID,
        exitId: 'exit-1',
        scope: 'all_remaining',
        alreadyRecorded: false,
        status: 'closed',
        actualR: '-0.5000',
        traderOutcome: 'win',
      },
    });
    expect(mocks.recordContractExit).toHaveBeenCalledWith('workspace-1', 'user-1', TRADE_ID, {
      mutationKey: KEY,
      scope: 'all_remaining',
      finalPnlMinor: -5000n,
      traderOutcome: 'win',
      finalExitedAt: new Date('2026-09-20T10:00:00Z'),
    });
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });

  it('refuses a Part carrying a whole-Trade answer before reaching the service', async () => {
    for (const extra of [
      { finalPnlMinor: '100' },
      { traderOutcome: 'loss' },
      { exitHistoryCompleteness: 'complete' },
    ]) {
      const result = await recordContractExitAction({
        tradeId: TRADE_ID,
        mutationKey: KEY,
        scope: 'part',
        ...extra,
      });
      expect(result).toMatchObject({ ok: false, error: { code: 'validation_error' } });
    }
    expect(mocks.recordContractExit).not.toHaveBeenCalled();
  });

  it('refuses a missing scope, a basis selector, and a client workspace', async () => {
    for (const input of [
      { tradeId: TRADE_ID, mutationKey: KEY },
      { tradeId: TRADE_ID, mutationKey: KEY, scope: 'all_remaining', actualResultMode: 'price' },
      { tradeId: TRADE_ID, mutationKey: KEY, scope: 'part', workspaceId: 'workspace-2' },
    ]) {
      expect(await recordContractExitAction(input)).toMatchObject({
        ok: false,
        error: { code: 'validation_error' },
      });
    }
    expect(mocks.recordContractExit).not.toHaveBeenCalled();
  });

  it('maps a replay conflict with its kind, and a legacy Trade to its own code', async () => {
    mocks.recordContractExit.mockResolvedValueOnce({
      ok: false,
      code: 'mutation_replay_conflict',
      replayConflict: 'unverifiable',
    });
    expect(
      await recordContractExitAction({ tradeId: TRADE_ID, mutationKey: KEY, scope: 'part' }),
    ).toEqual({
      ok: false,
      error: { code: 'mutation_replay_conflict', replayConflict: 'unverifiable' },
    });
    mocks.recordContractExit.mockResolvedValueOnce({
      ok: false,
      code: 'legacy_trade_not_supported',
    });
    expect(
      await recordContractExitAction({ tradeId: TRADE_ID, mutationKey: KEY, scope: 'part' }),
    ).toEqual({ ok: false, error: { code: 'legacy_trade_not_supported' } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('passes each precise exit-time reason through to the client', async () => {
    for (const code of [
      'exit_time_before_entry',
      'exit_time_in_future',
      'final_exit_before_recorded_exit',
    ]) {
      mocks.recordContractExit.mockResolvedValueOnce({ ok: false, code });
      expect(
        await recordContractExitAction({ tradeId: TRADE_ID, mutationKey: KEY, scope: 'part' }),
      ).toEqual({ ok: false, error: { code } });
    }
  });

  it('refuses Post-Trade Emotion on a Final Close before reaching the service', async () => {
    expect(
      await recordContractExitAction({
        tradeId: TRADE_ID,
        mutationKey: KEY,
        scope: 'all_remaining',
        postTradeEmotionKeys: ['calm'],
      }),
    ).toMatchObject({ ok: false, error: { code: 'validation_error' } });
    expect(mocks.recordContractExit).not.toHaveBeenCalled();
  });

  it('an unauthenticated caller never reaches the service', async () => {
    const error = new Error('no session');
    error.name = 'UnauthenticatedError';
    mocks.getActiveWorkspaceContext.mockRejectedValue(error);
    expect(
      await recordContractExitAction({ tradeId: TRADE_ID, mutationKey: KEY, scope: 'part' }),
    ).toEqual({ ok: false, error: { code: 'unauthenticated' } });
    expect(mocks.recordContractExit).not.toHaveBeenCalled();
  });
});

describe('recordAfterTradeContextAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });
    mocks.requireTradeManagement.mockResolvedValue('member');
    mocks.recordAfterTradeContext.mockResolvedValue({
      ok: true,
      tradeId: TRADE_ID,
      alreadyRecorded: false,
      afterTradeNote: 'Held too long.',
      afterTradeTradingviewUrl: null,
      postTradeEmotions: { answer: 'none' },
      planOutcome: null,
      planOutcomeMinor: null,
    });
  });

  it('passes a three-way patch with the session identity, and a trimmed note', async () => {
    const result = await recordAfterTradeContextAction({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      afterTradeNote: '  Held too long.  ',
      afterTradeTradingviewUrl: null,
      postTradeEmotionKeys: [],
    });
    expect(result).toMatchObject({ ok: true, data: { postTradeEmotions: { answer: 'none' } } });
    // The note is set, the link is cleared, the emotion answer is an explicit None.
    expect(mocks.recordAfterTradeContext).toHaveBeenCalledWith('workspace-1', 'user-1', TRADE_ID, {
      mutationKey: KEY,
      afterTradeNote: 'Held too long.',
      afterTradeTradingviewUrl: null,
      postTradeEmotionKeys: [],
    });
  });

  it('passes a Plan Outcome patch — an answer, its stated amount, or a clear — and returns the amount as text', async () => {
    mocks.recordAfterTradeContext.mockResolvedValueOnce({
      ok: true,
      tradeId: TRADE_ID,
      alreadyRecorded: false,
      afterTradeNote: null,
      afterTradeTradingviewUrl: null,
      postTradeEmotions: { answer: 'unanswered' },
      planOutcome: 'exit_plan_result',
      planOutcomeMinor: 30_000n,
    });
    const result = await recordAfterTradeContextAction({
      tradeId: TRADE_ID,
      mutationKey: KEY,
      planOutcome: { outcome: 'exit_plan_result', amountMinor: '30000' },
    });
    expect(result).toMatchObject({
      ok: true,
      data: { planOutcome: 'exit_plan_result', planOutcomeMinor: '30000' },
    });
    expect(mocks.recordAfterTradeContext).toHaveBeenCalledWith('workspace-1', 'user-1', TRADE_ID, {
      mutationKey: KEY,
      planOutcome: { outcome: 'exit_plan_result', amountMinor: 30_000n },
    });

    await recordAfterTradeContextAction({ tradeId: TRADE_ID, mutationKey: KEY, planOutcome: null });
    expect(mocks.recordAfterTradeContext).toHaveBeenLastCalledWith(
      'workspace-1',
      'user-1',
      TRADE_ID,
      { mutationKey: KEY, planOutcome: null },
    );
  });

  it('refuses a malformed Plan Outcome before it reaches the service', async () => {
    for (const planOutcome of [
      { outcome: 'guessed', amountMinor: null },
      { outcome: 'planned_target_first' },
      { outcome: 'exit_plan_result', amountMinor: 300 },
      { outcome: 'exit_plan_result', amountMinor: '3.5' },
      { outcome: 'cannot_determine', amountMinor: null, system: 'net' },
    ]) {
      expect(
        await recordAfterTradeContextAction({ tradeId: TRADE_ID, mutationKey: KEY, planOutcome }),
      ).toMatchObject({ ok: false, error: { code: 'validation_error' } });
    }
    expect(mocks.recordAfterTradeContext).not.toHaveBeenCalled();
  });

  it('refuses a blank note, a non-TradingView link, an empty patch and result fields', async () => {
    for (const extra of [
      { afterTradeNote: '   ' },
      { afterTradeTradingviewUrl: 'https://example.com/chart' },
      { afterTradeTradingviewUrl: 'http://www.tradingview.com/x/abc/' },
      {},
      { afterTradeNote: 'ok', finalPnlMinor: '100' },
      { afterTradeNote: 'ok', traderOutcome: 'win' },
      { afterTradeNote: 'ok', notes: 'entry note' },
      { afterTradeNote: 'ok', tradingviewUrl: 'https://www.tradingview.com/x/abc/' },
    ]) {
      expect(
        await recordAfterTradeContextAction({ tradeId: TRADE_ID, mutationKey: KEY, ...extra }),
      ).toMatchObject({ ok: false, error: { code: 'validation_error' } });
    }
    expect(mocks.recordAfterTradeContext).not.toHaveBeenCalled();
  });

  it('maps a replay conflict and a legacy Trade to their own codes', async () => {
    mocks.recordAfterTradeContext.mockResolvedValueOnce({
      ok: false,
      code: 'mutation_replay_conflict',
      replayConflict: 'different',
    });
    expect(
      await recordAfterTradeContextAction({
        tradeId: TRADE_ID,
        mutationKey: KEY,
        afterTradeNote: 'x',
      }),
    ).toEqual({
      ok: false,
      error: { code: 'mutation_replay_conflict', replayConflict: 'different' },
    });
    mocks.recordAfterTradeContext.mockResolvedValueOnce({
      ok: false,
      code: 'legacy_trade_not_supported',
    });
    expect(
      await recordAfterTradeContextAction({
        tradeId: TRADE_ID,
        mutationKey: KEY,
        afterTradeNote: 'x',
      }),
    ).toEqual({ ok: false, error: { code: 'legacy_trade_not_supported' } });
  });
});
