/**
 * AFTER TRADE DRAFT — the pure state model behind "Record a closed trade".
 *
 * Add Trade contract v1 §13 (docs/product-contracts/add-trade.md) and UX Rules
 * §12 decide what each answer means; this module decides how a draft holds
 * those answers while the trader reconstructs a finished trade, and nothing
 * here renders. It mirrors `at-entry-draft.ts`, and differs where the moment
 * differs:
 *
 * 1. ONLY IDENTITY IS REQUIRED. Account, Symbol and Direction. Risk at Entry,
 *    Final Net P&L, Trader Outcome, times and everything else may stay blank or
 *    Unanswered, and blank is never zero.
 * 2. NO DEFAULT BECOMES A HISTORICAL ANSWER. Entry time starts blank, Actual
 *    Risk starts Unanswered, and no Strategy or Exit Plan default is applied.
 * 3. THE TRADER CLASSIFIES THE OUTCOME. Win / BE / Loss is a choice, never
 *    derived from P&L or R; a sign contradiction is a quiet notice.
 * 4. MONEY IS THE RESULT; PRICE IS CONTEXT. Actual R = Final Net P&L / Risk at
 *    Entry when both are known. Exit rows are supporting history: adopting
 *    their subtotal is an explicit action, and a discrepancy never blocks.
 * 5. READY MEANS NO BLOCKING ERRORS, derived from the one error set Save uses.
 */
import Decimal from 'decimal.js';
import type { z } from 'zod';

import { isCanonicalEmotionKey, type EmotionKey } from '@/config/emotions';
import { actualR } from '@/lib/calc/trade';
import { reconcileExitHistory, traderOutcomeContradictsPnl } from '@/lib/trades/add-trade-contract';
import type { ExitHistoryCompleteness, OutcomeValue } from '@/lib/trades/constants';
import { HISTORICAL_EXIT_LIMIT, type CreateCompletedTradeSchema } from '@/lib/trades/schemas';
import type {
  TradeCreateOptions,
  TradeCreateSetupOption,
  TradeCreateStrategyOption,
} from '@/server/dal/trades';

import type {
  AnswerState,
  ContextDraft,
  EmotionsDraft,
  ExitPlanDraft,
  TargetDraft,
} from './at-entry-draft';
import { hasStaleSelection, staleSelections } from './stale-selection';
import { datetimeLocalToIso, parseTradeMoneyInput } from './trade-form-values';

export type Direction = '' | 'long' | 'short';
/** `unknown` is "Don't remember" — an answer, never a Not Met (contract §8). */
export type RecalledConditionStatus = 'met' | 'not_met' | 'unknown';
export type AfterTradeActualRiskAnswer = 'unanswered' | 'matched' | 'different' | 'unknown';
export type ExitScopeAnswer = '' | 'part' | 'all_remaining' | 'unknown';
export type CompletenessAnswer = 'unanswered' | ExitHistoryCompleteness;

export interface AfterTradeActualRiskDraft {
  readonly answer: AfterTradeActualRiskAnswer;
  /** Kept through any other answer, so returning to Different restores it. */
  readonly amount: string;
}

export interface AfterTradeExitDraft {
  readonly id: string;
  /** '' is Unanswered; `unknown` is an explicit "Don't know". */
  readonly scope: ExitScopeAnswer;
  readonly pnl: string;
  readonly closedPercent: string;
  readonly exitedAt: string;
  /** Context only. */
  readonly price: string;
  readonly reason: string;
}

export interface AfterTradeClassificationDraft {
  readonly strategy: AnswerState;
  readonly strategyId: string;
  readonly setupByStrategy: Readonly<
    Record<string, { readonly answer: AnswerState; readonly setupId: string }>
  >;
  /** Answers per Strategy and Setup; an absent key is Unanswered. */
  readonly conditions: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, RecalledConditionStatus>>>>>
  >;
}

export interface AfterTradeDraft {
  readonly tradingAccountId: string;
  readonly symbol: string;
  readonly direction: Direction;
  /** A `datetime-local` wall clock in the trader's zone; '' is not recorded. */
  readonly enteredAt: string;
  readonly exitedAt: string;
  /** Risk at Entry — the 1R baseline; '' is not recorded. */
  readonly risk: string;
  readonly actualRisk: AfterTradeActualRiskDraft;
  readonly target: TargetDraft;
  /** Same shape as At Entry's; `inherit` never arises, because nothing is inherited. */
  readonly exitPlan: ExitPlanDraft;
  /** The authoritative whole-Trade result; '' is not recorded. */
  readonly finalPnl: string;
  /**
   * Present only after "Use recorded exits as final result" (contract §11): the
   * Final Net P&L was explicitly adopted from the exit subtotal. Typing Final
   * Net P&L removes it. The Save sends it only while the adopted figure is
   * still the Complete, fully priced subtotal, and the server checks again.
   */
  readonly finalPnlAdopted?: true | undefined;
  /** `null` is Unanswered. */
  readonly outcome: OutcomeValue | null;
  readonly exits: readonly AfterTradeExitDraft[];
  readonly completeness: CompletenessAnswer;
  readonly classification: AfterTradeClassificationDraft;
  /** Recalled Entry Confidence; no default. */
  readonly confidence: number | null;
  /** Recalled Entry Emotion. */
  readonly emotions: EmotionsDraft;
  /** Post-Trade Emotion — separate, never merged into Entry Emotion. */
  readonly postTradeEmotions: EmotionsDraft;
  readonly context: ContextDraft;
}

export function createAfterTradeDraft(tradingAccountId: string): AfterTradeDraft {
  return {
    tradingAccountId,
    symbol: '',
    direction: '',
    enteredAt: '',
    exitedAt: '',
    risk: '',
    actualRisk: { answer: 'unanswered', amount: '' },
    target: { state: 'unanswered', profit: '', price: '' },
    exitPlan: { choice: { kind: 'unanswered' }, customText: '', customBaseId: null },
    finalPnl: '',
    outcome: null,
    exits: [],
    completeness: 'unanswered',
    classification: { strategy: 'unanswered', strategyId: '', setupByStrategy: {}, conditions: {} },
    confidence: null,
    emotions: { answer: 'unanswered', keys: [] },
    postTradeEmotions: { answer: 'unanswered', keys: [] },
    context: {
      entryPrice: '',
      stopPrice: '',
      positionSize: '',
      timeframe: '',
      session: '',
      reason: '',
      tradingviewUrl: '',
      notes: '',
    },
  };
}

// ---------------------------------------------------------------------------
// Risk, Target and result
// ---------------------------------------------------------------------------

export function setActualRiskAnswer(
  draft: AfterTradeDraft,
  answer: AfterTradeActualRiskAnswer,
): AfterTradeDraft {
  return { ...draft, actualRisk: { ...draft.actualRisk, answer } };
}

/** Typing an amount answers Different; a blank amount is Different, amount unknown. */
export function setActualRiskAmount(draft: AfterTradeDraft, amount: string): AfterTradeDraft {
  return { ...draft, actualRisk: { answer: 'different', amount } };
}

export function setTargetState(
  draft: AfterTradeDraft,
  state: TargetDraft['state'],
): AfterTradeDraft {
  return { ...draft, target: { ...draft.target, state } };
}

/** Typing a Target value answers the question as a Fixed Target. */
export function setTargetValue(
  draft: AfterTradeDraft,
  field: 'profit' | 'price',
  value: string,
): AfterTradeDraft {
  return { ...draft, target: { ...draft.target, [field]: value, state: 'fixed' } };
}

/** `null` is "Remove answer". */
export function setOutcome(draft: AfterTradeDraft, outcome: OutcomeValue | null): AfterTradeDraft {
  return { ...draft, outcome };
}

// ---------------------------------------------------------------------------
// Exit history
// ---------------------------------------------------------------------------

export function blankExit(id: string): AfterTradeExitDraft {
  return { id, scope: '', pnl: '', closedPercent: '', exitedAt: '', price: '', reason: '' };
}

export function meaningfulExit(exit: AfterTradeExitDraft): boolean {
  return (
    exit.scope !== '' ||
    exit.pnl.trim() !== '' ||
    exit.closedPercent.trim() !== '' ||
    exit.exitedAt !== '' ||
    exit.price.trim() !== '' ||
    exit.reason.trim() !== ''
  );
}

/** Whether another exit row may be added: the server's own historical limit, never a looser one. */
export function canAddExit(draft: AfterTradeDraft): boolean {
  return draft.exits.length < HISTORICAL_EXIT_LIMIT;
}

export function addExit(draft: AfterTradeDraft, id: string): AfterTradeDraft {
  if (!canAddExit(draft)) return draft;
  return { ...draft, exits: [...draft.exits, blankExit(id)] };
}

export function updateExit(
  draft: AfterTradeDraft,
  id: string,
  patch: Partial<Omit<AfterTradeExitDraft, 'id'>>,
): AfterTradeDraft {
  return {
    ...draft,
    exits: draft.exits.map((exit) => (exit.id === id ? { ...exit, ...patch } : exit)),
  };
}

/** Removing the last exit also returns completeness to Unanswered: the question needs an exit. */
export function removeExit(draft: AfterTradeDraft, id: string): AfterTradeDraft {
  const exits = draft.exits.filter((exit) => exit.id !== id);
  return {
    ...draft,
    exits,
    completeness: exits.some(meaningfulExit) ? draft.completeness : 'unanswered',
  };
}

export function setCompleteness(
  draft: AfterTradeDraft,
  completeness: CompletenessAnswer,
): AfterTradeDraft {
  return { ...draft, completeness };
}

// ---------------------------------------------------------------------------
// Strategy, Setup and conditions
// ---------------------------------------------------------------------------

export function selectStrategy(draft: AfterTradeDraft, strategyId: string): AfterTradeDraft {
  return {
    ...draft,
    classification: { ...draft.classification, strategy: 'selected', strategyId },
  };
}

export function answerNoStrategy(draft: AfterTradeDraft): AfterTradeDraft {
  return { ...draft, classification: { ...draft.classification, strategy: 'none' } };
}

export function removeStrategyAnswer(draft: AfterTradeDraft): AfterTradeDraft {
  return { ...draft, classification: { ...draft.classification, strategy: 'unanswered' } };
}

export function currentSetupAnswer(draft: AfterTradeDraft): {
  readonly answer: AnswerState;
  readonly setupId: string;
} {
  const { classification } = draft;
  if (classification.strategy !== 'selected') return { answer: 'unanswered', setupId: '' };
  return (
    classification.setupByStrategy[classification.strategyId] ?? {
      answer: 'unanswered',
      setupId: '',
    }
  );
}

function withSetup(
  draft: AfterTradeDraft,
  setup: { readonly answer: AnswerState; readonly setupId: string },
): AfterTradeDraft {
  const { classification } = draft;
  if (classification.strategy !== 'selected') return draft;
  return {
    ...draft,
    classification: {
      ...classification,
      setupByStrategy: { ...classification.setupByStrategy, [classification.strategyId]: setup },
    },
  };
}

export function selectSetup(draft: AfterTradeDraft, setupId: string): AfterTradeDraft {
  return withSetup(draft, { answer: 'selected', setupId });
}

export function answerNoSetup(draft: AfterTradeDraft): AfterTradeDraft {
  return withSetup(draft, { answer: 'none', setupId: currentSetupAnswer(draft).setupId });
}

export function removeSetupAnswer(draft: AfterTradeDraft): AfterTradeDraft {
  return withSetup(draft, { answer: 'unanswered', setupId: currentSetupAnswer(draft).setupId });
}

/** Answers one condition of the current Setup; `null` is "Remove answer". */
export function answerCondition(
  draft: AfterTradeDraft,
  conditionKey: string,
  status: RecalledConditionStatus | null,
): AfterTradeDraft {
  const { classification } = draft;
  const setup = currentSetupAnswer(draft);
  if (classification.strategy !== 'selected' || setup.answer !== 'selected') return draft;
  const byStrategy = classification.conditions[classification.strategyId] ?? {};
  const answers = { ...(byStrategy[setup.setupId] ?? {}) };
  if (status === null) delete answers[conditionKey];
  else answers[conditionKey] = status;
  return {
    ...draft,
    classification: {
      ...classification,
      conditions: {
        ...classification.conditions,
        [classification.strategyId]: { ...byStrategy, [setup.setupId]: answers },
      },
    },
  };
}

export interface AfterTradeActiveClassification {
  readonly strategy: TradeCreateStrategyOption | null;
  readonly setup: TradeCreateSetupOption | null;
  readonly strategyAnswer: AnswerState;
  readonly setupAnswer: AnswerState;
  /** Answers for the current Setup's conditions only; stale keys never leak out. */
  readonly conditionAnswers: Readonly<Record<string, RecalledConditionStatus>>;
}

export function activeAfterTradeClassification(
  draft: AfterTradeDraft,
  options: Pick<TradeCreateOptions, 'strategies'>,
): AfterTradeActiveClassification {
  const { classification } = draft;
  const strategy =
    classification.strategy === 'selected'
      ? (options.strategies.find((item) => item.strategyId === classification.strategyId) ?? null)
      : null;
  const setupAnswer = currentSetupAnswer(draft);
  const setup =
    strategy !== null && setupAnswer.answer === 'selected'
      ? (strategy.setups.find((item) => item.setupId === setupAnswer.setupId) ?? null)
      : null;
  const stored =
    strategy !== null && setup !== null
      ? (classification.conditions[strategy.strategyId]?.[setup.setupId] ?? {})
      : {};
  const conditionAnswers: Record<string, RecalledConditionStatus> = {};
  for (const condition of setup?.conditions ?? []) {
    const status = stored[condition.conditionKey];
    if (status !== undefined) conditionAnswers[condition.conditionKey] = status;
  }
  return {
    strategy,
    setup,
    // A Strategy that is no longer offered reads as Unanswered, never kept silently.
    strategyAnswer:
      classification.strategy === 'selected' && strategy === null
        ? 'unanswered'
        : classification.strategy,
    setupAnswer:
      strategy === null
        ? 'unanswered'
        : setupAnswer.answer === 'selected' && setup === null
          ? 'unanswered'
          : setupAnswer.answer,
    conditionAnswers,
  };
}

// ---------------------------------------------------------------------------
// Psychology
// ---------------------------------------------------------------------------

export function setConfidence(draft: AfterTradeDraft, confidence: number | null): AfterTradeDraft {
  return { ...draft, confidence };
}

export type EmotionPhase = 'emotions' | 'postTradeEmotions';

/**
 * Removing the LAST selected emotion is refused: it would silently turn "I
 * felt X" into Unanswered or None. The trader chooses "None of these" or
 * "Remove answer" instead.
 */
export function canDeselectEmotion(answer: EmotionsDraft, key: string): boolean {
  return !(answer.answer === 'selected' && answer.keys.length === 1 && answer.keys[0] === key);
}

export function toggleEmotion(
  draft: AfterTradeDraft,
  phase: EmotionPhase,
  key: string,
): AfterTradeDraft {
  const current = draft[phase];
  const selected = current.answer === 'selected' ? current.keys : [];
  if (selected.includes(key)) {
    if (!canDeselectEmotion(current, key)) return draft;
    return {
      ...draft,
      [phase]: { answer: 'selected', keys: selected.filter((item) => item !== key) },
    };
  }
  return { ...draft, [phase]: { answer: 'selected', keys: [...selected, key] } };
}

export function answerNoEmotions(draft: AfterTradeDraft, phase: EmotionPhase): AfterTradeDraft {
  return { ...draft, [phase]: { answer: 'none', keys: [] } };
}

export function removeEmotionsAnswer(draft: AfterTradeDraft, phase: EmotionPhase): AfterTradeDraft {
  return { ...draft, [phase]: { answer: 'unanswered', keys: [] } };
}

// ---------------------------------------------------------------------------
// Entry timestamp — one stored value, asked as two questions
// ---------------------------------------------------------------------------

/**
 * ENTRY DATE AND ENTRY TIME ARE ONE FIELD, ASKED TWICE, IN EITHER ORDER.
 *
 * `enteredAt` is still the one stored field, and what it sends is still what
 * it always sent: a complete `datetime-local` instant, or nothing. What it may
 * also REST in, while the trader is part-way through, is either half on its
 * own — and either half can be the first one given, because a trader recalling
 * a closed trade may remember the day, or the minute, and it is not this
 * form's business which.
 *
 * FOUR SHAPES, ONE ENCODING: the two halves joined by `T`, with an empty side
 * where an answer is missing.
 *
 *   ``                       nothing recorded
 *   `2026-09-18`             a day, time not recorded
 *   `T09:30`                 a minute, day not recorded
 *   `2026-09-18T09:30`       both — the only shape that leaves this browser
 *
 * A partial persists and recovers like any other draft text, is never shared
 * with At Entry (which has one datetime control and no use for half of one),
 * and never reaches the server: Save asks for the missing half first. That is
 * what keeps a partial from being either fabricated into a whole or quietly
 * dropped — the two things a single `entered_at` column would otherwise force.
 * Nothing about the database changes to hold this; it is a draft state.
 */
const ENTRY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ENTRY_TIME_PATTERN = /^T\d{2}:\d{2}$/;
const ENTRY_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface EntryTimestampParts {
  /** `YYYY-MM-DD`, or empty when no date is recorded. */
  readonly date: string;
  /** `HH:mm`, or empty when no time is recorded. */
  readonly time: string;
}

/** Reads a stored entry timestamp as the two answers it is made of. */
export function entryTimestampParts(value: string): EntryTimestampParts {
  if (ENTRY_DATETIME_PATTERN.test(value)) {
    return { date: value.slice(0, 10), time: value.slice(11, 16) };
  }
  if (ENTRY_DATE_PATTERN.test(value)) return { date: value, time: '' };
  if (ENTRY_TIME_PATTERN.test(value)) return { date: '', time: value.slice(1, 6) };
  // Anything else is a value no picker can produce; validation names it.
  return { date: '', time: '' };
}

/** Joins the two halves back into the one stored value. */
export function composeEntryTimestamp(date: string, time: string): string {
  if (date === '' && time === '') return '';
  if (time === '') return date;
  return `${date}T${time}`;
}

/** True once the stored value is a complete instant a Trade could carry. */
export function isCompleteEntryTimestamp(value: string): boolean {
  return ENTRY_DATETIME_PATTERN.test(value);
}

/** True while a date is recorded and its time is not. */
export function isEntryDateWithoutTime(value: string): boolean {
  return ENTRY_DATE_PATTERN.test(value);
}

/** True while a time is recorded and the day it belongs to is not. */
export function isEntryTimeWithoutDate(value: string): boolean {
  return ENTRY_TIME_PATTERN.test(value);
}

/**
 * Records the entry date, keeping any time already given. Clearing it leaves
 * the time standing: each half is the trader's own answer, and clearing one is
 * not an instruction to discard the other.
 */
export function setEntryDate(draft: AfterTradeDraft, date: string): AfterTradeDraft {
  const { time } = entryTimestampParts(draft.enteredAt);
  return { ...draft, enteredAt: composeEntryTimestamp(date, time) };
}

/** Records the entry time, keeping any date already given. */
export function setEntryTime(draft: AfterTradeDraft, time: string): AfterTradeDraft {
  const { date } = entryTimestampParts(draft.enteredAt);
  return { ...draft, enteredAt: composeEntryTimestamp(date, time) };
}

/** Removes both halves — the one action that discards the whole answer. */
export function clearEntryTimestamp(draft: AfterTradeDraft): AfterTradeDraft {
  return { ...draft, enteredAt: '' };
}

// ---------------------------------------------------------------------------
// Validation, notices and derived figures
// ---------------------------------------------------------------------------

export const AFTER_TRADE_STATIC_FIELDS = [
  'tradingAccountId',
  'symbol',
  'direction',
  'enteredAt',
  'exitedAt',
  'finalPnl',
  'risk',
  'actualRisk',
  'targetProfit',
  'targetPrice',
  'exits',
  'contextEntryPrice',
  'contextStopPrice',
  'contextPositionSize',
] as const;
export type AfterTradeStaticField = (typeof AFTER_TRADE_STATIC_FIELDS)[number];
export type AfterTradeExitField = 'pnl' | 'closedPercent' | 'exitedAt' | 'price';
/** A per-exit field is keyed `exit:<id>:<field>`. */
export type AfterTradeField = AfterTradeStaticField | `exit:${string}:${AfterTradeExitField}`;

export type AfterTradeSection = 'trade' | 'result' | 'plan' | 'exits' | 'context';

export function afterTradeFieldSection(field: AfterTradeField): AfterTradeSection {
  if (field.startsWith('exit:') || field === 'exits') return 'exits';
  switch (field) {
    case 'finalPnl':
      return 'result';
    case 'risk':
    case 'actualRisk':
    case 'targetProfit':
    case 'targetPrice':
      return 'plan';
    case 'contextEntryPrice':
    case 'contextStopPrice':
    case 'contextPositionSize':
      return 'context';
    default:
      return 'trade';
  }
}

export type AfterTradeErrorCode =
  | 'required'
  | 'invalid_money'
  | 'must_be_positive'
  | 'invalid_datetime'
  /**
   * A DATE WITH NO TIME. Entry time is optional as a whole, but a Trade holds
   * ONE `entered_at` instant — there is no date-only column — so a date the
   * trader chose can be neither saved on its own nor quietly dropped. Rather
   * than invent midnight or lose the answer, Save asks for the time that
   * completes it, or for the date to be cleared.
   */
  | 'entry_time_required'
  /** The mirror of the above: a minute recorded without the day it falls on. */
  | 'entry_date_required'
  | 'future_time'
  | 'exit_before_entry'
  | 'exit_outside_trade'
  | 'invalid_price'
  | 'invalid_percent'
  /** Exits cannot close more than the whole position. */
  | 'percent_over_total'
  | 'fixed_target_requires_value'
  | 'matched_requires_risk_at_entry'
  | 'actual_risk_equals_risk_at_entry'
  /** Server-side only: a field the server refused that no specific code describes. */
  | 'not_accepted';

export type AfterTradeErrors = Partial<Record<AfterTradeField, AfterTradeErrorCode>>;

export type AfterTradeNotice =
  | { readonly kind: 'outcome_contradicts_pnl' }
  | {
      readonly kind: 'exit_discrepancy';
      readonly subtotalMinor: string;
      readonly finalPnlMinor: string;
    }
  | { readonly kind: 'stop_wrong_side' }
  | { readonly kind: 'target_wrong_side' };

/** Why Actual R cannot be shown — never `0`, never a guess. */
export type ActualRUnavailableReason = 'needs_pnl_and_risk' | 'needs_risk' | 'needs_pnl';

export interface AfterTradeValidation {
  readonly errors: AfterTradeErrors;
  readonly notices: readonly AfterTradeNotice[];
  readonly riskMinor: string | null;
  readonly finalPnlMinor: string | null;
  readonly actualR:
    | { readonly status: 'known'; readonly value: string }
    | { readonly status: 'unavailable'; readonly reason: ActualRUnavailableReason };
  /** The recorded exit subtotal, only when every recorded exit has a valid P&L. */
  readonly exitSubtotalMinor: string | null;
  /** "Use recorded exits as final result" may be offered (contract §11). */
  readonly canAdoptExitSubtotal: boolean;
}

const POSITIVE_DECIMAL = /^\d+(\.\d+)?$/;
const PERCENT = /^\d{1,3}(?:\.\d{1,2})?$/;

function parsePositiveDecimal(input: string): Decimal | 'invalid' | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!POSITIVE_DECIMAL.test(trimmed)) return 'invalid';
  const value = new Decimal(trimmed);
  return value.greaterThan(0) ? value : 'invalid';
}

/** Percent of the original position as basis points, or why it is not one. */
export function percentToBps(input: string): number | 'invalid' | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!PERCENT.test(trimmed)) return 'invalid';
  const bps = new Decimal(trimmed).times(100).toNumber();
  return bps > 0 && bps <= 10_000 ? bps : 'invalid';
}

function moneyError(code: string): AfterTradeErrorCode {
  return code === 'zero_not_allowed' || code === 'negative_not_allowed'
    ? 'must_be_positive'
    : 'invalid_money';
}

export function exitField(id: string, field: AfterTradeExitField): AfterTradeField {
  return `exit:${id}:${field}`;
}

export function validateAfterTradeDraft(
  draft: AfterTradeDraft,
  context: { readonly currency: string; readonly timezone: string; readonly now: Date },
): AfterTradeValidation {
  const errors: AfterTradeErrors = {};
  if (draft.tradingAccountId === '') errors.tradingAccountId = 'required';
  if (draft.symbol.trim() === '') errors.symbol = 'required';
  if (draft.direction === '') errors.direction = 'required';

  // Times: optional, but a typed time must be a real one, in the past, in order.
  const instant = (value: string, field: 'enteredAt' | 'exitedAt'): number | null => {
    if (value === '') return null;
    /*
      HALF AN ANSWER IS STILL AN ANSWER THE TRADER GAVE, so it is never
      discarded — and it cannot be saved either, because a Trade holds one
      instant and there is no column for half of one. Save stops and asks for
      the other half, or for this one to be cleared. Either half can be the
      one that is missing; neither is more legitimate than the other.
    */
    if (field === 'enteredAt' && isEntryDateWithoutTime(value)) {
      errors[field] = 'entry_time_required';
      return null;
    }
    if (field === 'enteredAt' && isEntryTimeWithoutDate(value)) {
      errors[field] = 'entry_date_required';
      return null;
    }
    const parsed = datetimeLocalToIso(value, context.timezone);
    if (!parsed.ok) {
      errors[field] = 'invalid_datetime';
      return null;
    }
    const time = Date.parse(parsed.value);
    if (time > context.now.getTime()) errors[field] = 'future_time';
    return time;
  };
  const entered = instant(draft.enteredAt, 'enteredAt');
  const exited = instant(draft.exitedAt, 'exitedAt');
  if (entered !== null && exited !== null && exited < entered) {
    errors.exitedAt ??= 'exit_before_entry';
  }

  let riskMinor: string | null = null;
  if (draft.risk.trim() !== '') {
    const risk = parseTradeMoneyInput(draft.risk, context.currency);
    if (risk.ok) riskMinor = risk.value;
    else errors.risk = moneyError(risk.code);
  }

  if (draft.actualRisk.answer === 'matched' && riskMinor === null && errors.risk === undefined) {
    // "Matched Risk at Entry" needs a Risk at Entry to match (contract §4).
    errors.actualRisk = 'matched_requires_risk_at_entry';
  }
  if (draft.actualRisk.answer === 'different' && draft.actualRisk.amount.trim() !== '') {
    const amount = parseTradeMoneyInput(draft.actualRisk.amount, context.currency);
    if (!amount.ok) errors.actualRisk = moneyError(amount.code);
    // Blocking, never rewritten to Matched: the trader said it differed.
    else if (riskMinor !== null && amount.value === riskMinor) {
      errors.actualRisk = 'actual_risk_equals_risk_at_entry';
    }
  }

  if (draft.target.state === 'fixed') {
    const profitBlank = draft.target.profit.trim() === '';
    const priceBlank = draft.target.price.trim() === '';
    if (!profitBlank) {
      const profit = parseTradeMoneyInput(draft.target.profit, context.currency);
      if (!profit.ok) errors.targetProfit = moneyError(profit.code);
    }
    if (!priceBlank && parsePositiveDecimal(draft.target.price) === 'invalid') {
      errors.targetPrice = 'invalid_price';
    }
    if (profitBlank && priceBlank) errors.targetProfit = 'fixed_target_requires_value';
  }

  let finalPnlMinor: string | null = null;
  if (draft.finalPnl.trim() !== '') {
    const final = parseTradeMoneyInput(draft.finalPnl, context.currency, {
      allowNegative: true,
      allowZero: true,
    });
    if (final.ok) finalPnlMinor = final.value;
    else errors.finalPnl = 'invalid_money';
  }

  const recorded = draft.exits.filter(meaningfulExit);
  const exitPnl: (bigint | null)[] = [];
  let knownBps = 0;
  for (const exit of recorded) {
    let pnl: bigint | null = null;
    if (exit.pnl.trim() !== '') {
      const parsed = parseTradeMoneyInput(exit.pnl, context.currency, {
        allowNegative: true,
        allowZero: true,
      });
      if (parsed.ok) pnl = BigInt(parsed.value);
      else errors[exitField(exit.id, 'pnl')] = 'invalid_money';
    }
    exitPnl.push(pnl);
    const bps = percentToBps(exit.closedPercent);
    if (bps === 'invalid') errors[exitField(exit.id, 'closedPercent')] = 'invalid_percent';
    else if (bps !== null) {
      knownBps += bps;
      // Flagged on the exit that crosses 100%; percentages short of it are fine.
      if (knownBps > 10_000) errors[exitField(exit.id, 'closedPercent')] = 'percent_over_total';
    }
    if (parsePositiveDecimal(exit.price) === 'invalid') {
      errors[exitField(exit.id, 'price')] = 'invalid_price';
    }
    if (exit.exitedAt !== '') {
      const parsed = datetimeLocalToIso(exit.exitedAt, context.timezone);
      if (!parsed.ok) errors[exitField(exit.id, 'exitedAt')] = 'invalid_datetime';
      else {
        const time = Date.parse(parsed.value);
        if (time > context.now.getTime()) errors[exitField(exit.id, 'exitedAt')] = 'future_time';
        else if ((entered !== null && time < entered) || (exited !== null && time > exited)) {
          errors[exitField(exit.id, 'exitedAt')] = 'exit_outside_trade';
        }
      }
    }
  }

  const entry = parsePositiveDecimal(draft.context.entryPrice);
  const stop = parsePositiveDecimal(draft.context.stopPrice);
  const size = parsePositiveDecimal(draft.context.positionSize);
  if (entry === 'invalid') errors.contextEntryPrice = 'invalid_price';
  if (stop === 'invalid') errors.contextStopPrice = 'invalid_price';
  if (size === 'invalid') errors.contextPositionSize = 'invalid_price';

  const reconciliation = reconcileExitHistory({
    completeness: draft.completeness === 'unanswered' ? null : draft.completeness,
    exitPnlMinor: exitPnl,
    finalNetPnlMinor: finalPnlMinor === null ? null : BigInt(finalPnlMinor),
  });

  const notices: AfterTradeNotice[] = [];
  if (
    traderOutcomeContradictsPnl(
      draft.outcome,
      finalPnlMinor === null ? null : BigInt(finalPnlMinor),
    )
  ) {
    notices.push({ kind: 'outcome_contradicts_pnl' });
  }
  if (
    reconciliation.discrepancy &&
    reconciliation.subtotalMinor !== null &&
    finalPnlMinor !== null
  ) {
    notices.push({
      kind: 'exit_discrepancy',
      subtotalMinor: reconciliation.subtotalMinor.toString(),
      finalPnlMinor,
    });
  }
  const targetPrice =
    draft.target.state === 'fixed' ? parsePositiveDecimal(draft.target.price) : null;
  if (entry instanceof Decimal && draft.direction !== '') {
    const long = draft.direction === 'long';
    if (stop instanceof Decimal && (long ? stop.gte(entry) : stop.lte(entry))) {
      notices.push({ kind: 'stop_wrong_side' });
    }
    if (
      targetPrice instanceof Decimal &&
      (long ? targetPrice.lte(entry) : targetPrice.gte(entry))
    ) {
      notices.push({ kind: 'target_wrong_side' });
    }
  }

  let actual: AfterTradeValidation['actualR'];
  if (finalPnlMinor === null || riskMinor === null) {
    actual = {
      status: 'unavailable',
      reason:
        finalPnlMinor === null && riskMinor === null
          ? 'needs_pnl_and_risk'
          : riskMinor === null
            ? 'needs_risk'
            : 'needs_pnl',
    };
  } else {
    const measured = actualR(BigInt(finalPnlMinor), BigInt(riskMinor));
    actual = measured.ok
      ? { status: 'known', value: measured.value }
      : { status: 'unavailable', reason: 'needs_risk' };
  }

  return {
    errors,
    notices,
    riskMinor,
    finalPnlMinor,
    actualR: actual,
    exitSubtotalMinor:
      reconciliation.subtotalMinor === null ? null : reconciliation.subtotalMinor.toString(),
    canAdoptExitSubtotal: reconciliation.adoptable,
  };
}

/** Error fields in reading order: static fields first, then each exit in list order. */
export function orderedAfterTradeErrorFields(
  draft: AfterTradeDraft,
  errors: AfterTradeErrors,
): readonly AfterTradeField[] {
  const exitFields: AfterTradeField[] = draft.exits.flatMap((exit) =>
    (['pnl', 'closedPercent', 'exitedAt', 'price'] as const).map((field) =>
      exitField(exit.id, field),
    ),
  );
  const order: readonly AfterTradeField[] = [
    'tradingAccountId',
    'symbol',
    'direction',
    'enteredAt',
    'exitedAt',
    'finalPnl',
    'risk',
    'actualRisk',
    'targetProfit',
    'targetPrice',
    ...exitFields,
    'contextEntryPrice',
    'contextStopPrice',
    'contextPositionSize',
  ];
  return order.filter((field) => errors[field] !== undefined);
}

export type AfterTradeReadiness =
  | { readonly status: 'ready' }
  | {
      readonly status: 'blocked';
      readonly count: number;
      readonly fields: readonly AfterTradeField[];
    };

/** Ready only when the error set Save itself uses is empty. */
export function afterTradeReadiness(
  draft: AfterTradeDraft,
  validation: AfterTradeValidation,
): AfterTradeReadiness {
  const fields = orderedAfterTradeErrorFields(draft, validation.errors);
  return fields.length === 0
    ? { status: 'ready' }
    : { status: 'blocked', count: fields.length, fields };
}

/**
 * "Use recorded exits as final result" (contract §11): an explicit copy of a
 * Complete, fully priced exit subtotal into Final Net P&L. Never automatic.
 */
export function adoptExitSubtotal(
  draft: AfterTradeDraft,
  validation: AfterTradeValidation,
  format: (minor: string) => string,
): AfterTradeDraft {
  if (!validation.canAdoptExitSubtotal || validation.exitSubtotalMinor === null) return draft;
  return { ...draft, finalPnl: format(validation.exitSubtotalMinor), finalPnlAdopted: true };
}

/** A typed Final Net P&L is the trader's own figure: any earlier adoption no longer describes it. */
export function setFinalPnl(draft: AfterTradeDraft, finalPnl: string): AfterTradeDraft {
  const { finalPnlAdopted: _adopted, ...rest } = draft;
  return { ...rest, finalPnl };
}

/**
 * Whether the Final Net P&L a Save sends is still the adopted exit subtotal:
 * adopted explicitly, and still equal to a Complete, fully priced history.
 * An exit edited after adoption makes it the trader's figure again (manual).
 */
export function finalPnlStillAdopted(
  draft: AfterTradeDraft,
  validation: AfterTradeValidation,
): boolean {
  return (
    draft.finalPnlAdopted === true &&
    draft.completeness === 'complete' &&
    validation.exitSubtotalMinor !== null &&
    validation.finalPnlMinor === validation.exitSubtotalMinor
  );
}

export interface AfterTradeAnalysisSummary {
  readonly strategy: { readonly answer: AnswerState; readonly name: string | null };
  readonly setup: { readonly answer: AnswerState; readonly name: string | null };
  readonly conditions: {
    readonly total: number;
    readonly answered: number;
  } | null;
  readonly confidence: number | null;
  readonly emotions: { readonly answer: AnswerState; readonly count: number };
  readonly postTradeEmotions: { readonly answer: AnswerState; readonly count: number };
}

export function afterTradeAnalysisSummary(
  draft: AfterTradeDraft,
  options: Pick<TradeCreateOptions, 'strategies'>,
): AfterTradeAnalysisSummary {
  const active = activeAfterTradeClassification(draft, options);
  const conditionTotal = active.setup?.conditions.length ?? 0;
  return {
    strategy: { answer: active.strategyAnswer, name: active.strategy?.name ?? null },
    setup: { answer: active.setupAnswer, name: active.setup?.name ?? null },
    conditions:
      active.setup === null || conditionTotal === 0
        ? null
        : { total: conditionTotal, answered: Object.keys(active.conditionAnswers).length },
    confidence: draft.confidence,
    emotions: { answer: draft.emotions.answer, count: draft.emotions.keys.length },
    postTradeEmotions: {
      answer: draft.postTradeEmotions.answer,
      count: draft.postTradeEmotions.keys.length,
    },
  };
}

/**
 * Whether the trader has put anything into this draft. After Trade has no
 * defaults, so any difference from the pristine draft is work — except an
 * exit row added but left empty.
 */
export function hasAfterTradeWork(draft: AfterTradeDraft, pristine: AfterTradeDraft): boolean {
  const withoutBlankExits = (value: AfterTradeDraft) => ({
    ...value,
    exits: value.exits.filter(meaningfulExit),
  });
  return JSON.stringify(withoutBlankExits(draft)) !== JSON.stringify(withoutBlankExits(pristine));
}

// ---------------------------------------------------------------------------
// The Save payload
// ---------------------------------------------------------------------------

export type CreateCompletedTradePayload = z.input<typeof CreateCompletedTradeSchema>;

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function emotionKeys(answer: EmotionsDraft): EmotionKey[] | undefined {
  if (answer.answer === 'unanswered') return undefined;
  return answer.answer === 'none' ? [] : answer.keys.filter(isCanonicalEmotionKey);
}

/**
 * Save Closed Trade. Returns `null` while any blocking error exists, so a
 * payload can never be built from a draft that is not ready. Every answer is
 * sent exactly as the trader left it: Unanswered is omitted, blank is null.
 */
export function buildAfterTradePayload(
  draft: AfterTradeDraft,
  context: {
    readonly currency: string;
    readonly timezone: string;
    readonly now: Date;
    readonly mutationKey: string;
    readonly options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  },
): CreateCompletedTradePayload | null {
  const validation = validateAfterTradeDraft(draft, context);
  if (afterTradeReadiness(draft, validation).status !== 'ready') return null;
  // A chosen answer whose source went away is resolved by the trader, never dropped.
  if (hasStaleSelection(staleSelections(draft, context.options))) return null;
  if (draft.direction === '') return null;

  const iso = (value: string): string | null => {
    if (value === '') return null;
    const parsed = datetimeLocalToIso(value, context.timezone);
    return parsed.ok ? parsed.value : null;
  };
  const money = (value: string, signed: boolean): string | null => {
    if (value.trim() === '') return null;
    const parsed = parseTradeMoneyInput(value, context.currency, {
      allowNegative: signed,
      allowZero: signed,
    });
    return parsed.ok ? parsed.value : null;
  };

  const active = activeAfterTradeClassification(draft, context.options);
  const recordedExits = draft.exits.filter(meaningfulExit);
  const actualRiskAmount =
    draft.actualRisk.answer === 'different' ? money(draft.actualRisk.amount, false) : null;

  const payload: CreateCompletedTradePayload = {
    mutationKey: context.mutationKey,
    tradingAccountId: draft.tradingAccountId,
    recordingTiming: 'after_trade',
    recordingContract: 'add_trade_v1',
    symbol: draft.symbol.trim().toUpperCase(),
    direction: draft.direction,
    enteredAt: iso(draft.enteredAt),
    exitedAt: iso(draft.exitedAt),
    plannedRiskMinor: validation.riskMinor,
    ...(draft.actualRisk.answer === 'unanswered'
      ? {}
      : { actualRiskAnswer: draft.actualRisk.answer }),
    ...(actualRiskAmount === null ? {} : { actualInitialRiskMinor: actualRiskAmount }),
    ...(draft.target.state === 'unanswered' ? {} : { targetState: draft.target.state }),
    ...(draft.target.state === 'fixed'
      ? {
          plannedRewardMinor: money(draft.target.profit, false),
          targetPrice: trimmedOrUndefined(draft.target.price) ?? null,
        }
      : {}),
    finalPnlMinor: validation.finalPnlMinor,
    ...(finalPnlStillAdopted(draft, validation) ? { finalPnlAdoptedFromExits: true } : {}),
    ...(draft.outcome === null ? {} : { traderOutcome: draft.outcome }),
    ...(recordedExits.length === 0 || draft.completeness === 'unanswered'
      ? {}
      : { exitHistoryCompleteness: draft.completeness }),
    exits: recordedExits.map((exit) => {
      const bps = percentToBps(exit.closedPercent);
      return {
        closedBps: typeof bps === 'number' ? bps : null,
        exitScope: exit.scope === '' ? null : exit.scope,
        exitPrice: trimmedOrUndefined(exit.price) ?? null,
        realizedPnlMinor: money(exit.pnl, true),
        ...(trimmedOrUndefined(exit.reason) === undefined
          ? {}
          : { exitReason: exit.reason.trim() }),
        exitedAt: iso(exit.exitedAt),
      };
    }),
    timeframe: draft.context.timeframe,
    session: draft.context.session,
    confirmationNotes: draft.context.reason,
    tradingviewUrl: draft.context.tradingviewUrl,
    notes: draft.context.notes,
    chartAttachmentStorageKey: null,
    ...(draft.confidence === null ? {} : { confidence: draft.confidence }),
  };
  const entryEmotions = emotionKeys(draft.emotions);
  if (entryEmotions !== undefined) payload.emotionKeys = entryEmotions;
  const postTrade = emotionKeys(draft.postTradeEmotions);
  if (postTrade !== undefined) payload.postTradeEmotionKeys = postTrade;

  if (draft.classification.strategy === 'none') {
    payload.noStrategy = true;
  } else if (active.strategy !== null) {
    payload.strategyId = active.strategy.strategyId;
    if (active.setupAnswer === 'none') payload.noSetup = true;
    else if (active.setup !== null) {
      payload.setupId = active.setup.setupId;
      payload.conditionSetToken = active.setup.conditionSetToken;
      payload.conditionAnswers = Object.entries(active.conditionAnswers).map(
        ([conditionKey, status]) => ({ conditionKey, status }),
      );
    }
  }

  // Selected during reconstruction — never an inherited default (contract §5).
  const { choice } = draft.exitPlan;
  if (choice.kind === 'saved') {
    const plan = context.options.exitPlans.find((item) => item.exitPlanId === choice.exitPlanId);
    if (plan !== undefined) {
      payload.exitPlan = { state: 'saved', exitPlanId: plan.exitPlanId, provenance: 'selected' };
    }
  } else if (choice.kind === 'customized' && draft.exitPlan.customText.trim() !== '') {
    const base =
      draft.exitPlan.customBaseId === null
        ? undefined
        : context.options.exitPlans.find((item) => item.exitPlanId === draft.exitPlan.customBaseId);
    payload.exitPlan = {
      state: 'customized',
      baseExitPlanId: base?.exitPlanId ?? null,
      instructions: draft.exitPlan.customText,
    };
  } else if (choice.kind === 'no_rule') {
    payload.exitPlan = { state: 'no_rule' };
  }

  const contextPrice = (value: string) => trimmedOrUndefined(value);
  if (contextPrice(draft.context.entryPrice) !== undefined) {
    payload.contextEntryPrice = draft.context.entryPrice.trim();
  }
  if (contextPrice(draft.context.stopPrice) !== undefined) {
    payload.contextStopPrice = draft.context.stopPrice.trim();
  }
  if (contextPrice(draft.context.positionSize) !== undefined) {
    payload.contextPositionSize = draft.context.positionSize.trim();
  }

  return payload;
}
