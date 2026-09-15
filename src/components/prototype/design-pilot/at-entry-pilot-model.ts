import type { EmotionKey } from '@/config/emotions';
import type { ConfidenceStep } from '@/lib/trades/constants';

import { effectiveExitPlan, EMPTY_EXIT_PLAN, type ExitPlanDraft } from '../add-trade/exit-plan';
import { strategyDefaultPlan, type SavedExitPlan } from '../add-trade/exit-plan-library';
import { PROTOTYPE_STRATEGIES } from '../fixtures';

/**
 * AT ENTRY VISUAL PILOT — THE SEMANTICS, KEPT APART FROM THE LOOK.
 *
 * Design validation only (DESIGN.md calibration). Every state here is taken from
 * the approved Add Trade contract and UX Rules, not invented for a screenshot:
 * Unanswered is `null` / `unanswered`, an automatic default carries its origin,
 * an inherited Exit Plan is resolved rather than written, and a declined
 * inheritance stays declined until an explicit restore.
 *
 * Amounts are parsed to `number` for DISPLAY ONLY (a Target R hint and a price
 * notice). Nothing here is persisted or becomes a canonical figure.
 */

export const PILOT_STATES = [
  'untouched',
  'partial',
  'no-target',
  'inherited',
  'customized',
  'validation',
  'analytical',
] as const;
export type PilotState = (typeof PILOT_STATES)[number];

export type Direction = 'long' | 'short';
export type TargetChoice = 'fixed' | 'none';
export type ConditionAnswer = 'met' | 'not_met';

export type FrameworkAnswer =
  | { readonly kind: 'unanswered' }
  | { readonly kind: 'none' }
  | { readonly kind: 'selected'; readonly name: string };

export interface EntryTime {
  readonly date: string;
  readonly time: string;
  /** `default` = the automatic "now"; `confirmed` = edited or confirmed by the trader. */
  readonly origin: 'default' | 'confirmed';
}

export type ActualRisk =
  | { readonly kind: 'matched' }
  /** `amount: ''` is "Different, amount unknown" — never reverted to Matched. */
  | { readonly kind: 'different'; readonly amount: string };

export interface PilotDraft {
  readonly symbol: string;
  readonly direction: Direction | null;
  readonly entryTime: EntryTime | null;
  readonly risk: string;
  readonly actualRisk: ActualRisk;
  readonly target: TargetChoice | null;
  readonly targetProfit: string;
  readonly tpPrice: string;
  readonly exitPlan: ExitPlanDraft;
  /** An explicit rejection of the Strategy default; cleared only by an explicit restore. */
  readonly declinedStrategyPlan: boolean;
  readonly strategy: FrameworkAnswer;
  readonly setup: FrameworkAnswer;
  readonly conditions: Readonly<Record<string, ConditionAnswer>>;
  readonly confidence: ConfidenceStep | null;
  /** `null` = unanswered; `[]` = the explicit "None of these". */
  readonly emotions: readonly EmotionKey[] | null;
  readonly reason: string;
  readonly chartUrl: string;
  readonly notes: string;
  readonly entryPrice: string;
  readonly stopPrice: string;
  readonly size: string;
  readonly timeframe: string;
  readonly session: string;
}

export const CAPTURED_NOW = { date: '2026-09-16', time: '09:42' } as const;
export const PILOT_ACCOUNT = { name: 'FTMO 100K', mode: 'Live', currency: 'USD' } as const;
export const PILOT_TIMEZONE = 'Bangkok time (GMT+7)';

export const CONFIDENCE_LABELS: Readonly<Record<ConfidenceStep, string>> = {
  0: 'Very Low',
  25: 'Low',
  50: 'Neutral',
  75: 'High',
  100: 'Very High',
};

export const PILOT_STRATEGIES = PROTOTYPE_STRATEGIES.map((strategy) => ({
  name: strategy.name,
  setups: [...strategy.setups] as readonly string[],
}));

const SETUP_CONDITIONS: Readonly<Record<string, readonly string[]>> = {
  'Wave 3 Continuation': [
    'Wave 2 held above the wave 1 origin',
    'Price broke the wave 1 high',
    'Higher-timeframe trend agrees',
    'Momentum confirms the break',
  ],
  'Wave C exhaustion': ['Five-wave C leg is complete', 'Divergence on the entry timeframe'],
  'Deviation band': ['Price closed outside the band', 'No major news in the next hour'],
  'Liquidity sweep': ['Prior high or low was taken', 'Reclaim candle closed back inside'],
};

export function setupConditions(setup: FrameworkAnswer): readonly string[] {
  return setup.kind === 'selected' ? (SETUP_CONDITIONS[setup.name] ?? []) : [];
}

export const EMPTY_DRAFT: PilotDraft = {
  symbol: '',
  direction: null,
  entryTime: { ...CAPTURED_NOW, origin: 'default' },
  risk: '',
  actualRisk: { kind: 'matched' },
  target: null,
  targetProfit: '',
  tpPrice: '',
  exitPlan: EMPTY_EXIT_PLAN,
  declinedStrategyPlan: false,
  strategy: { kind: 'unanswered' },
  setup: { kind: 'unanswered' },
  conditions: {},
  confidence: null,
  emotions: null,
  reason: '',
  chartUrl: '',
  notes: '',
  entryPrice: '',
  stopPrice: '',
  size: '',
  timeframe: '',
  session: '',
};

export interface PilotSeed {
  readonly draft: PilotDraft;
  readonly attempted: boolean;
  readonly contextOpen: boolean;
  readonly journalOpen: boolean;
}

/** The named review states. Each is reachable by ordinary interaction; the seed only saves clicks. */
export function seedDraft(state: PilotState): PilotSeed {
  const partial: PilotDraft = {
    ...EMPTY_DRAFT,
    symbol: 'XAUUSD',
    direction: 'long',
    risk: '250.00',
  };
  const inherited: PilotDraft = {
    ...partial,
    target: 'fixed',
    targetProfit: '750.00',
    strategy: { kind: 'selected', name: 'Elliott Wave' },
    setup: { kind: 'selected', name: 'Wave 3 Continuation' },
  };
  const base = { attempted: false, contextOpen: false, journalOpen: false };

  switch (state) {
    case 'untouched':
      return { ...base, draft: EMPTY_DRAFT };
    case 'partial':
      return { ...base, draft: partial };
    case 'no-target':
      return { ...base, draft: { ...partial, target: 'none' } };
    case 'inherited':
      return { ...base, draft: inherited, journalOpen: true };
    case 'customized': {
      const plan = strategyDefaultPlan('Elliott Wave');
      return {
        ...base,
        journalOpen: true,
        draft: {
          ...inherited,
          entryTime: { date: CAPTURED_NOW.date, time: '08:15', origin: 'confirmed' },
          exitPlan: {
            source: 'custom',
            planId: plan?.id ?? null,
            planName: plan?.name ?? null,
            instructions:
              'Trail beneath each higher low. Take half off at 2R and close the rest on RSI invalidation.',
          },
        },
      };
    }
    case 'validation':
      return {
        attempted: true,
        contextOpen: true,
        journalOpen: false,
        draft: {
          ...EMPTY_DRAFT,
          direction: 'long',
          risk: '0',
          target: 'fixed',
          entryPrice: '2350.40',
          stopPrice: '2362.00',
        },
      };
    case 'analytical':
      return {
        ...base,
        journalOpen: true,
        draft: {
          ...inherited,
          actualRisk: { kind: 'different', amount: '' },
          conditions: {
            'Wave 2 held above the wave 1 origin': 'met',
            'Price broke the wave 1 high': 'met',
            'Higher-timeframe trend agrees': 'not_met',
          },
          confidence: 75,
          emotions: ['calm', 'focused'],
          reason: 'Wave 3 continuation after wave 2 held the 61.8% retracement.',
        },
      };
  }
}

/** Display-only parse of a plain decimal amount or price. */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim().replaceAll(',', '');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

export interface PilotIssues {
  readonly symbol?: string;
  readonly direction?: string;
  readonly risk?: string;
  readonly target?: string;
  readonly targetProfit?: string;
  readonly tpPrice?: string;
  readonly actualRisk?: string;
  readonly entryPrice?: string;
  readonly stopPrice?: string;
}

/**
 * Save-blocking issues only: contract requirements (Account, Symbol, Direction,
 * Risk at Entry > 0; an explicit Fixed Target needs a representation) and input
 * that is malformed as entered. A plausible price inconsistency is NOT here.
 */
export function validateDraft(draft: PilotDraft): PilotIssues {
  const issues: Record<string, string> = {};
  const amountFormat = 'Enter an amount, like 250.00.';
  const priceFormat = 'Enter a price, like 2350.40.';

  if (draft.symbol.trim() === '') issues['symbol'] = 'Enter the symbol you are trading.';
  if (draft.direction === null) issues['direction'] = 'Choose Long or Short.';

  const risk = parseAmount(draft.risk);
  if (draft.risk.trim() === '') issues['risk'] = 'Enter your risk at entry.';
  else if (risk === null) issues['risk'] = amountFormat;
  else if (risk <= 0) issues['risk'] = 'Risk at entry must be more than zero.';

  if (draft.target === 'fixed') {
    const hasProfit = draft.targetProfit.trim() !== '';
    const hasPrice = draft.tpPrice.trim() !== '';
    if (!hasProfit && !hasPrice) {
      issues['target'] = 'Add a target profit or a TP price, or choose another target option.';
    }
    const profit = parseAmount(draft.targetProfit);
    if (hasProfit && profit === null) issues['targetProfit'] = amountFormat;
    else if (hasProfit && profit !== null && profit <= 0) {
      issues['targetProfit'] = 'Target profit must be more than zero.';
    }
    if (hasPrice && parseAmount(draft.tpPrice) === null) issues['tpPrice'] = priceFormat;
  }

  if (draft.actualRisk.kind === 'different' && draft.actualRisk.amount.trim() !== '') {
    const actual = parseAmount(draft.actualRisk.amount);
    if (actual === null)
      issues['actualRisk'] = 'Enter an amount, or leave it blank if you are not sure.';
    else if (actual <= 0)
      issues['actualRisk'] = 'Actual risk must be more than zero, or leave it blank.';
  }

  if (draft.entryPrice.trim() !== '' && parseAmount(draft.entryPrice) === null) {
    issues['entryPrice'] = priceFormat;
  }
  if (draft.stopPrice.trim() !== '' && parseAmount(draft.stopPrice) === null) {
    issues['stopPrice'] = priceFormat;
  }

  return issues as PilotIssues;
}

export function issueCount(issues: PilotIssues): number {
  return Object.keys(issues).length;
}

/** A non-blocking data-quality notice (contract §3). Never an error, never a changed value. */
export function priceNotice(draft: PilotDraft): string | null {
  const entry = parseAmount(draft.entryPrice);
  const stop = parseAmount(draft.stopPrice);
  if (entry === null || stop === null || draft.direction === null) return null;
  if (draft.direction === 'long' && stop >= entry) {
    return 'Your stop is at or above entry for a Long. Worth a second look. It will not stop you saving.';
  }
  if (draft.direction === 'short' && stop <= entry) {
    return 'Your stop is at or below entry for a Short. Worth a second look. It will not stop you saving.';
  }
  return null;
}

export interface SaveRequirement {
  readonly key: 'account' | 'symbol' | 'direction' | 'risk';
  readonly label: string;
  readonly done: boolean;
}

export function saveRequirements(draft: PilotDraft): readonly SaveRequirement[] {
  const risk = parseAmount(draft.risk);
  return [
    { key: 'account', label: 'Account', done: true },
    { key: 'symbol', label: 'Symbol', done: draft.symbol.trim() !== '' },
    { key: 'direction', label: 'Direction', done: draft.direction !== null },
    { key: 'risk', label: 'Risk at entry', done: risk !== null && risk > 0 },
  ];
}

/** `+3.00R at target`, only when both amounts exist. A hint about the plan, not a result. */
export function targetRText(draft: PilotDraft): string | null {
  if (draft.target !== 'fixed') return null;
  const profit = parseAmount(draft.targetProfit);
  const risk = parseAmount(draft.risk);
  if (profit === null || risk === null || profit <= 0 || risk <= 0) return null;
  return `${(profit / risk).toFixed(2)}R`;
}

export function selectedStrategyName(draft: PilotDraft): string | null {
  return draft.strategy.kind === 'selected' ? draft.strategy.name : null;
}

export type ExitPlanStatus =
  | { readonly kind: 'not_recorded'; readonly strategyDefault: SavedExitPlan | null }
  | {
      readonly kind: 'inherited';
      readonly plan: ExitPlanDraft;
      readonly strategyName: string;
      readonly strategyDefault: SavedExitPlan;
    }
  | {
      readonly kind: 'saved' | 'custom' | 'no_rule';
      readonly plan: ExitPlanDraft;
      readonly strategyDefault: SavedExitPlan | null;
    };

export function exitPlanStatus(draft: PilotDraft): ExitPlanStatus {
  const strategyName = selectedStrategyName(draft);
  const strategyDefault = strategyDefaultPlan(strategyName);

  if (draft.exitPlan.source === 'none') {
    if (!draft.declinedStrategyPlan && strategyName !== null && strategyDefault !== null) {
      const resolved = effectiveExitPlan(draft.exitPlan, strategyName, true);
      if (resolved.inherited) {
        return { kind: 'inherited', plan: resolved.draft, strategyName, strategyDefault };
      }
    }
    return { kind: 'not_recorded', strategyDefault };
  }

  const kind =
    draft.exitPlan.source === 'saved'
      ? 'saved'
      : draft.exitPlan.source === 'custom'
        ? 'custom'
        : 'no_rule';
  return { kind, plan: draft.exitPlan, strategyDefault };
}

export const NO_RULE_PLAN: ExitPlanDraft = {
  source: 'no_rule',
  planId: null,
  planName: null,
  instructions: '',
};

/** Explicit transitions. Each is a trader action; none is a side effect. */
export const exitPlanActions = {
  /** Keeps the inherited plan as an explicit choice. */
  confirmInherited(draft: PilotDraft): PilotDraft {
    const status = exitPlanStatus(draft);
    return status.kind === 'inherited' ? { ...draft, exitPlan: status.plan } : draft;
  },
  decline(draft: PilotDraft): PilotDraft {
    return { ...draft, exitPlan: EMPTY_EXIT_PLAN, declinedStrategyPlan: true };
  },
  restoreStrategyDefault(draft: PilotDraft): PilotDraft {
    return { ...draft, exitPlan: EMPTY_EXIT_PLAN, declinedStrategyPlan: false };
  },
  choose(draft: PilotDraft, plan: ExitPlanDraft): PilotDraft {
    return { ...draft, exitPlan: plan };
  },
};

export function journalSummary(draft: PilotDraft): string {
  const parts: string[] = [];
  if (draft.strategy.kind === 'selected') parts.push(draft.strategy.name);
  if (draft.strategy.kind === 'none') parts.push('No strategy');
  if (draft.confidence !== null) parts.push(`${CONFIDENCE_LABELS[draft.confidence]} confidence`);
  if (draft.emotions !== null) {
    parts.push(
      draft.emotions.length === 0 ? 'None of these feelings' : `${draft.emotions.length} feelings`,
    );
  }
  return parts.length === 0 ? 'Not answered yet' : parts.join(', ');
}

export function contextSummary(draft: PilotDraft): string {
  const parts: string[] = [];
  if (draft.reason.trim() !== '') parts.push('Reason');
  if (draft.chartUrl.trim() !== '') parts.push('Chart link');
  if (draft.notes.trim() !== '') parts.push('Notes');
  if ([draft.entryPrice, draft.stopPrice, draft.size].some((value) => value.trim() !== '')) {
    parts.push('Price levels');
  }
  if (draft.timeframe.trim() !== '' || draft.session.trim() !== '') parts.push('Timeframe');
  return parts.length === 0 ? 'Nothing added yet' : parts.join(', ');
}
