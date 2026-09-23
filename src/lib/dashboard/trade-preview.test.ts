import { describe, expect, it } from 'vitest';

import type { TradeDetail } from '@/server/dal/trades';

import { composeTradeQuickPreview } from './trade-preview';

function detail(overrides: Partial<TradeDetail> = {}): TradeDetail {
  return {
    tradeId: '019fd752-2c97-76e2-8af5-178c49d17ab9',
    tradingAccountId: 'account-1',
    tradingAccountName: 'Primary',
    tradingAccountBaseCurrency: 'USD',
    tradingAccountIsArchived: false,
    strategyId: null,
    strategyName: null,
    strategyVersionId: null,
    strategyVersionNumber: null,
    strategyIsArchived: false,
    setupId: null,
    setupName: null,
    setupVersionId: null,
    setupIsArchived: false,
    strategyAssignedAt: null,
    setupAssignedAt: null,
    status: 'closed',
    systemStatus: 'resolved',
    recordedRetrospectively: false,
    recordingContract: null,
    enteredAtSource: null,
    targetState: null,
    targetPrice: null,
    contextEntryPrice: null,
    contextStopPrice: null,
    contextPositionSize: null,
    actualRiskAnswer: null,
    exitPlanState: null,
    exitPlanProvenance: null,
    exitPlanName: null,
    exitPlanInstructions: null,
    exitPlanInheritanceDeclined: false,
    noStrategy: false,
    noSetup: false,
    captureOrigins: {
      strategy: null,
      setup: null,
      exitPlan: null,
      confidence: null,
      emotions: null,
    },
    traderOutcomeSelected: false,
    postTradeEmotionsRecordedAt: null,
    postTradeEmotions: [],

    symbol: 'XAUUSD',
    direction: 'long',
    timeframe: null,
    session: null,
    confidence: null,
    confirmationNotes: null,
    tradingviewUrl: null,
    notes: null,
    reviewNotes: null,
    afterTradeNote: null,
    afterTradeTradingviewUrl: null,
    emotionsRecordedAt: null,
    hasChartAttachment: false,
    chartAttachmentUploadedAt: null,

    plannedEntry: null,
    plannedStop: null,
    plannedTarget: null,
    plannedPositionSize: null,
    plannedRiskMinor: null,
    plannedRiskState: null,
    plannedRewardMinor: null,
    plannedR: null,

    actualResultMode: null,
    actualEntry: null,
    actualInitialStop: null,
    actualPositionSize: null,
    actualInitialRiskMinor: null,
    actualExit: null,
    grossPnlMinor: null,
    commissionMinor: '0',
    feesMinor: '0',
    swapMinor: '0',
    netPnlMinor: null,
    exitHistoryCompleteness: null,
    finalPnlSource: null,
    exitSubtotalMinor: null,
    exitReconciliation: 'not_recorded',
    canAdoptExitSubtotal: false,
    actualR: '2.0000',
    traderOutcome: 'win',
    enteredAt: '2026-03-05T02:00:00.000Z',
    exitedAt: '2026-03-05T06:00:00.000Z',
    exits: [],
    closedBps: 10000,
    remainingBps: 0,
    realizedRToDate: null,

    systemExitPrice: null,
    systemResolutionKind: null,
    systemGrossRInput: null,
    systemExitedAt: '2026-03-05T07:00:00.000Z',
    systemExitReason: null,
    systemGrossR: '3.0000',
    systemCostR: '0.0000',
    systemR: '3.0000',
    systemOutcome: 'win',
    systemResolvedAt: null,
    systemDependencySnapshot: null,
    systemPlanProvenance: null,
    planAdherence: null,
    executionGapR: '-1.0000',

    setupConditionState: 'not_recorded',
    setupConditionChecks: [],
    setupConditionConfiguredCount: null,
    ruleChecks: [],
    mistakes: [],
    mistakeCatalog: [],
    emotions: [],
    emotionCatalog: [],

    createdAt: '2026-03-05T02:00:00.000Z',
    updatedAt: '2026-03-05T07:00:00.000Z',
    ...overrides,
  };
}

describe('Quick Preview projection', () => {
  /**
   * §17 — the Gap on the Overview is the calc engine's own derived figure,
   * carried through from `getWorkspaceTradeDetail`. It is deliberately NOT
   * `actualR - systemR` recomputed at the presentation boundary, which would
   * be a second implementation of the one formula CLAUDE.md §6 forbids
   * reimplementing inline.
   */
  it('carries the already-derived Execution Gap rather than recomputing it', () => {
    const model = composeTradeQuickPreview(detail({ executionGapR: '-1.0000' }));
    expect(model.executionGap).toEqual({ status: 'legacy_derived', executionGapR: '-1.0000' });
    expect(model.actualR).toBe('2.0000');
    expect(model.systemResult).toEqual({ status: 'legacy_derived', systemR: '3.0000' });
  });

  it('keeps the Gap null while a side is incomplete instead of inventing a zero', () => {
    const model = composeTradeQuickPreview(
      detail({ systemStatus: 'pending', systemR: null, systemOutcome: null, executionGapR: null }),
    );
    expect(model.executionGap).toEqual({ status: 'unavailable', reason: 'not_comparable' });
    expect(model.systemResult).toEqual({ status: 'unavailable', reason: 'not_resolved' });
  });

  /*
    A contract row's Actual R is canonical and its stored System R is not, so
    the preview must not hand the sheet two numbers that invite subtraction
    (contract §25, §28).
  */
  it('offers no System Result and no Gap for an Add Trade contract row', () => {
    const model = composeTradeQuickPreview(
      detail({ recordingContract: 'add_trade_v1', executionGapR: '-1.0000' }),
    );
    expect(model.actualR).toBe('2.0000');
    expect(model.systemResult).toEqual({
      status: 'unavailable',
      reason: 'no_canonical_system_result',
    });
    expect(model.executionGap).toEqual({
      status: 'unavailable',
      reason: 'no_canonical_system_result',
    });
    expect(model.traderOutcome).toEqual({ status: 'unavailable', reason: 'outcome_not_selected' });
  });
});

describe('Quick Preview tabs', () => {
  /**
   * §16 — the tab list is derived from the Trade. Six tabs of which three say
   * "nothing recorded" is a promise the data did not keep.
   */
  it('exposes only Overview for a Trade with nothing else recorded', () => {
    expect(composeTradeQuickPreview(detail()).tabs).toEqual(['overview']);
  });

  it('adds Strategy only when a Strategy or Setup is pinned', () => {
    expect(composeTradeQuickPreview(detail({ strategyName: 'Momentum v1' })).tabs).toContain(
      'strategy',
    );
    expect(composeTradeQuickPreview(detail({ setupName: 'Retest' })).tabs).toContain('strategy');
  });

  it('adds Review only when rules, mistakes or emotions exist', () => {
    const withEmotion = composeTradeQuickPreview(
      detail({ emotions: [{ key: 'fomo', label: 'FOMO' }] }),
    );
    expect(withEmotion.tabs).toContain('review');
    expect(withEmotion.emotions).toEqual([{ key: 'fomo', label: 'FOMO' }]);
  });

  it('adds Executions only when the position has exit legs', () => {
    const partial = composeTradeQuickPreview(
      detail({
        closedBps: 6000,
        remainingBps: 4000,
        exits: [
          {
            exitId: 'exit-1',
            sequence: 1,
            closedBps: 6000,
            exitScope: null,
            exitPrice: '2410.5',
            realizedPnlMinor: '12000',
            exitReason: 'target',
            exitedAt: '2026-03-05T05:00:00.000Z',
          },
        ],
      }),
    );
    expect(partial.tabs).toContain('executions');
    expect(partial.exits).toHaveLength(1);
    expect(partial.remainingBps).toBe(4000);
  });

  it('adds Chart for either a TradingView link or an attachment', () => {
    expect(
      composeTradeQuickPreview(detail({ tradingviewUrl: 'https://example.test/c' })).tabs,
    ).toContain('chart');
    expect(composeTradeQuickPreview(detail({ hasChartAttachment: true })).tabs).toContain('chart');
  });

  it('adds Notes for any of the three note fields', () => {
    expect(composeTradeQuickPreview(detail({ reviewNotes: 'Chased it.' })).tabs).toContain('notes');
  });

  it('always leads with Overview and keeps a stable order', () => {
    const model = composeTradeQuickPreview(
      detail({
        strategyName: 'Momentum v1',
        reviewNotes: 'note',
        hasChartAttachment: true,
        emotions: [{ key: 'fomo', label: 'FOMO' }],
      }),
    );
    expect(model.tabs).toEqual(['overview', 'strategy', 'review', 'chart', 'notes']);
  });
});
