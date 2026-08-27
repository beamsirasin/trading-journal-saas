import type { TradeDetail } from '@/server/dal/trades';

/**
 * Which condensed sections a Trade actually supports.
 *
 * The tab list is DERIVED FROM THE TRADE, never fixed. A Trade with no exit
 * legs has no Executions tab, and a Trade with no chart has no Chart tab —
 * rather than six tabs of which three say "nothing recorded". An empty tab is
 * a promise the data did not keep.
 */
export const TRADE_PREVIEW_TABS = [
  'overview',
  'strategy',
  'review',
  'executions',
  'chart',
  'notes',
] as const;

export type TradeQuickPreviewTab = (typeof TRADE_PREVIEW_TABS)[number];

export interface TradeQuickPreviewExit {
  readonly exitId: string;
  readonly sequence: number;
  readonly closedBps: number;
  readonly exitPrice: string | null;
  readonly realizedPnlMinor: string | null;
  readonly exitReason: string | null;
  readonly exitedAt: string;
}

/**
 * A serializable projection of the canonical Trade detail.
 *
 * EVERY FIELD IS SELECTED, NOTHING IS COMPUTED. `executionGapR` in particular
 * is the value `getWorkspaceTradeDetail` already derived through the calc
 * engine's own `executionGapR` — it is not `actualR - systemR` recomputed at
 * the presentation boundary, which would be a second implementation of the
 * one formula CLAUDE.md §6 says may never be reimplemented inline.
 *
 * The Quick Preview is a preview: it reads, and offers a link into the
 * Journal for anything that would need editing. It is not a second Journal
 * editor and holds no mutation of its own.
 */
export interface TradeQuickPreviewModel {
  readonly tradeId: string;
  readonly symbol: string;
  readonly direction: TradeDetail['direction'];
  readonly status: TradeDetail['status'];
  readonly systemStatus: TradeDetail['systemStatus'];
  readonly tradingAccountName: string;
  readonly tradingAccountBaseCurrency: string;

  readonly actualR: string | null;
  readonly systemR: string | null;
  /** Already derived server-side by the calc engine; `null` while either side is incomplete. */
  readonly executionGapR: string | null;

  readonly enteredAt: string | null;
  readonly exitedAt: string | null;
  readonly systemExitedAt: string | null;
  readonly timeframe: string | null;
  readonly session: string | null;

  readonly strategyName: string | null;
  readonly strategyVersionNumber: number | null;
  readonly setupName: string | null;
  readonly plannedR: string | null;

  readonly ruleChecks: readonly {
    readonly ruleKey: string;
    readonly title: string;
    readonly isRequired: boolean;
    readonly checkStatus: TradeDetail['ruleChecks'][number]['checkStatus'];
  }[];
  readonly mistakes: readonly { readonly key: string; readonly label: string }[];
  readonly emotions: readonly { readonly key: string; readonly label: string }[];

  readonly exits: readonly TradeQuickPreviewExit[];
  readonly closedBps: number;
  readonly remainingBps: number;

  readonly tradingviewUrl: string | null;
  readonly hasChartAttachment: boolean;

  readonly notes: string | null;
  readonly reviewNotes: string | null;
  readonly confirmationNotes: string | null;

  readonly tabs: readonly TradeQuickPreviewTab[];
}

export function composeTradeQuickPreview(trade: TradeDetail): TradeQuickPreviewModel {
  const ruleChecks = trade.ruleChecks.map((check) => ({
    ruleKey: check.ruleKey,
    title: check.title,
    isRequired: check.isRequired,
    checkStatus: check.checkStatus,
  }));
  const mistakes = trade.mistakes.map((mistake) => ({
    key: mistake.key,
    label: mistake.label,
  }));
  const emotions = trade.emotions.map((emotion) => ({
    key: emotion.key,
    label: emotion.label,
  }));

  const hasStrategy = trade.strategyName !== null || trade.setupName !== null;
  const hasReview = ruleChecks.length > 0 || mistakes.length > 0 || emotions.length > 0;
  const hasExecutions = trade.exits.length > 0;
  const hasChart = trade.tradingviewUrl !== null || trade.hasChartAttachment;
  const hasNotes =
    trade.notes !== null || trade.reviewNotes !== null || trade.confirmationNotes !== null;

  const tabs: TradeQuickPreviewTab[] = ['overview'];
  if (hasStrategy) tabs.push('strategy');
  if (hasReview) tabs.push('review');
  if (hasExecutions) tabs.push('executions');
  if (hasChart) tabs.push('chart');
  if (hasNotes) tabs.push('notes');

  return {
    tradeId: trade.tradeId,
    symbol: trade.symbol,
    direction: trade.direction,
    status: trade.status,
    systemStatus: trade.systemStatus,
    tradingAccountName: trade.tradingAccountName,
    tradingAccountBaseCurrency: trade.tradingAccountBaseCurrency,

    actualR: trade.actualR,
    systemR: trade.systemR,
    executionGapR: trade.executionGapR,

    enteredAt: trade.enteredAt,
    exitedAt: trade.exitedAt,
    systemExitedAt: trade.systemExitedAt,
    timeframe: trade.timeframe,
    session: trade.session,

    strategyName: trade.strategyName,
    strategyVersionNumber: trade.strategyVersionNumber,
    setupName: trade.setupName,
    plannedR: trade.plannedR,

    ruleChecks,
    mistakes,
    emotions,

    exits: trade.exits.map((exit) => ({
      exitId: exit.exitId,
      sequence: exit.sequence,
      closedBps: exit.closedBps,
      exitPrice: exit.exitPrice,
      realizedPnlMinor: exit.realizedPnlMinor,
      exitReason: exit.exitReason,
      exitedAt: exit.exitedAt,
    })),
    closedBps: trade.closedBps,
    remainingBps: trade.remainingBps,

    tradingviewUrl: trade.tradingviewUrl,
    hasChartAttachment: trade.hasChartAttachment,

    notes: trade.notes,
    reviewNotes: trade.reviewNotes,
    confirmationNotes: trade.confirmationNotes,

    tabs,
  };
}
