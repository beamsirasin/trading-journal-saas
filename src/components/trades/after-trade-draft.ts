/**
 * THE AFTER TRADE FORM'S DRAFT STATE, AS DATA.
 *
 * Lifted out of `trade-after-trade-form.tsx` unchanged so the shared Add Trade
 * Recording Draft can persist it and restore it after a reload. Nothing here
 * changes After Trade semantics: the form still reads and writes exactly these
 * fields, and its Money/Price bases, derived outcome and boolean condition
 * checklist remain the current implementation pending the Add Trade contract
 * migration (CLAUDE.md §6). This module only gives that state a name.
 */

export type AfterTradeBasis = 'money' | 'price';
export type AfterTradeDirection = '' | 'long' | 'short';
export type AfterTradeExitScope = '' | 'part' | 'all_remaining';
export type AfterTradeCompleteness = 'unknown' | 'incomplete' | 'complete';

export interface AfterTradeExitDraft {
  readonly id: string;
  closedPercent: string;
  scope: AfterTradeExitScope;
  value: string;
  exitedAt: string;
  reason: string;
}

export interface AfterTradeValues {
  tradingAccountId: string;
  symbol: string;
  direction: AfterTradeDirection;
  enteredAt: string;
  exitedAt: string;
  strategyId: string;
  setupId: string;
  timeframe: string;
  session: string;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget: string;
  plannedPositionSize: string;
  plannedRisk: string;
  plannedReward: string;
  actualEntry: string;
  actualStop: string;
  actualPositionSize: string;
  actualRisk: string;
  finalPnl: string;
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
  confidence: string;
}

/** Everything the After Trade form holds that is the trader's work, in one value. */
export interface AfterTradeDraft {
  readonly values: AfterTradeValues;
  readonly planBasis: AfterTradeBasis;
  readonly actualBasis: AfterTradeBasis;
  readonly exits: readonly AfterTradeExitDraft[];
  readonly completeness: AfterTradeCompleteness;
  readonly conditionMet: Readonly<Record<string, boolean>>;
  /** `null` = never answered; `[]` = explicitly none of these. */
  readonly emotions: readonly string[] | null;
}

export function emptyAfterTradeValues(tradingAccountId: string): AfterTradeValues {
  return {
    tradingAccountId,
    symbol: '',
    direction: '',
    enteredAt: '',
    exitedAt: '',
    strategyId: '',
    setupId: '',
    timeframe: '',
    session: '',
    plannedEntry: '',
    plannedStop: '',
    plannedTarget: '',
    plannedPositionSize: '',
    plannedRisk: '',
    plannedReward: '',
    actualEntry: '',
    actualStop: '',
    actualPositionSize: '',
    actualRisk: '',
    finalPnl: '',
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
    confidence: '',
  };
}

export function createAfterTradeDraft(tradingAccountId: string): AfterTradeDraft {
  return {
    values: emptyAfterTradeValues(tradingAccountId),
    planBasis: 'money',
    actualBasis: 'money',
    exits: [],
    completeness: 'unknown',
    conditionMet: {},
    emotions: null,
  };
}

export function meaningfulAfterTradeExit(exit: AfterTradeExitDraft): boolean {
  return (
    exit.closedPercent.trim() !== '' ||
    exit.scope !== '' ||
    exit.value.trim() !== '' ||
    exit.exitedAt !== ''
  );
}

/**
 * Whether the trader has put anything into this draft — the same test the form
 * has always used for "dirty", so a pristine After Trade is never recovered.
 */
export function hasAfterTradeWork(draft: AfterTradeDraft, pristine: AfterTradeValues): boolean {
  return (
    draft.exits.some(meaningfulAfterTradeExit) ||
    draft.emotions !== null ||
    (Object.keys(pristine) as (keyof AfterTradeValues)[]).some(
      (key) => draft.values[key] !== pristine[key],
    )
  );
}
