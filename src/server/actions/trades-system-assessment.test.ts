import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveWorkspaceContext: vi.fn(),
  requireTradeManagement: vi.fn(),
  markSystemCannotDetermine: vi.fn(),
  markSystemNoTrade: vi.fn(),
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
vi.mock('@/server/services/trade-exit-contract', () => ({ recordContractExit: vi.fn() }));
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
  markSystemCannotDetermine: mocks.markSystemCannotDetermine,
  markSystemNoTrade: mocks.markSystemNoTrade,
  openTrade: vi.fn(),
  resolveSystemTrade: vi.fn(),
  softDeleteTrade: vi.fn(),
  updateTradePlan: vi.fn(),
}));

const { markSystemCannotDetermineAction, markSystemNoTradeAction } = await import('./trades');

describe('markSystemCannotDetermineAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveWorkspaceContext.mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'user-1',
    });
    mocks.requireTradeManagement.mockResolvedValue('member');
    mocks.markSystemCannotDetermine.mockResolvedValue({ ok: true });
    mocks.markSystemNoTrade.mockResolvedValue({ ok: true });
  });

  it('uses the existing service with trusted identity and accepted metadata', async () => {
    const tradeId = '019112a0-0000-7000-8000-000000000001';
    await expect(
      markSystemCannotDetermineAction({
        tradeId,
        systemPlanProvenance: 'unknown',
        planAdherence: 'not_followed',
      }),
    ).resolves.toEqual({
      ok: true,
      data: { tradeId, systemStatus: 'cannot_determine' },
    });
    expect(mocks.markSystemCannotDetermine).toHaveBeenCalledWith('workspace-1', 'user-1', tradeId, {
      systemPlanProvenance: 'unknown',
      planAdherence: 'not_followed',
    });
  });

  it('forwards no_trade assessment metadata through the existing service', async () => {
    const tradeId = '019112a0-0000-7000-8000-000000000002';
    await expect(
      markSystemNoTradeAction({
        tradeId,
        systemPlanProvenance: 'reconstructed_later',
        planAdherence: 'partly',
      }),
    ).resolves.toEqual({ ok: true, data: { tradeId, systemStatus: 'no_trade' } });
    expect(mocks.markSystemNoTrade).toHaveBeenCalledWith('workspace-1', 'user-1', tradeId, {
      systemPlanProvenance: 'reconstructed_later',
      planAdherence: 'partly',
    });
  });
});
