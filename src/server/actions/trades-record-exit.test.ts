import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveWorkspaceContext: vi.fn(),
  requireTradeManagement: vi.fn(),
  recordContractExit: vi.fn(),
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

const { recordContractExitAction } = await import('./trades');

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
