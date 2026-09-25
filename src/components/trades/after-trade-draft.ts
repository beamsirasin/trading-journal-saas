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
import { traderOutcomeContradictsPnl } from '@/lib/trades/add-trade-contract';
import type { ExitHistoryCompleteness, OutcomeValue } from '@/lib/trades/constants';
import type { PlanOutcome, PlanOutcomePlan } from '@/lib/trades/plan-outcome';
import { HISTORICAL_EXIT_LIMIT, type CreateCompletedTradeSchema } from '@/lib/trades/schemas';
import { isValidTradingViewUrl } from '@/lib/trades/validation';
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
  RiskStateDraft,
  StopMethodDraft,
  TargetDraft,
} from './at-entry-draft';
import {
  choosePlanOutcome,
  resolvePlanOutcomeDraft,
  setPlanOutcomeAmount,
  UNANSWERED_PLAN_OUTCOME,
  type PlanOutcomeDraft,
  type PlanOutcomeDraftError,
} from './plan-outcome-draft';
import { hasStaleSelection, staleSelections } from './stale-selection';
import { datetimeLocalToIso, parseTradeMoneyInput } from './trade-form-values';

export type Direction = '' | 'long' | 'short';
/** `unknown` is "Don't remember" — an answer, never a Not Met (contract §8). */
export type RecalledConditionStatus = 'met' | 'not_met' | 'unknown';
export type ExitScopeAnswer = '' | 'part' | 'all_remaining' | 'unknown';
export type CompletenessAnswer = 'unanswered' | ExitHistoryCompleteness;

/**
 * HOW THE TRADE WAS CLOSED — Step 5's one result source (contract §11 as
 * amended by decision 57). Not persisted as a field of its own: the saved
 * exit records say it. "All at once" is one All remaining exit; "in parts" is
 * a sequence of exit legs. The whole-Trade Final Net P&L is derived from the
 * close, never typed beside it.
 */
export type CloseMode = 'unanswered' | 'all_at_once' | 'in_parts';

/**
 * HOW A CLOSE IN PARTS IS RECORDED (decision 58) — the result's one source:
 * each exit (the result is their sum once they prove the close), or only the
 * final result the trader knows (a stated total; no exits are made up).
 */
export type PartsResult = 'unanswered' | 'each_exit' | 'total_only';

/** The single close of "Closed all at once": one All remaining exit. */
export interface FullCloseDraft {
  readonly pnl: string;
  /** Context only. */
  readonly price: string;
  readonly reason: string;
}

/** The id the full close's one exit carries, so its field errors have a home. */
export const FULL_CLOSE_EXIT_ID = 'full-close';

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
  /** The same risk decision At Entry records, reconstructed (decision 54). */
  readonly riskState: RiskStateDraft;
  /** Retired from capture (decision 54); kept so older drafts still parse. */
  readonly stopMethod: StopMethodDraft;
  readonly target: TargetDraft;
  /** Same shape as At Entry's; `inherit` never arises, because nothing is inherited. */
  readonly exitPlan: ExitPlanDraft;
  /** `null` is Unanswered. */
  readonly outcome: OutcomeValue | null;
  /** How the Trade was closed; the result is derived from it. */
  readonly closeMode: CloseMode;
  /** "Closed all at once": the one close. Kept while "in parts" is chosen. */
  readonly fullClose: FullCloseDraft;
  /** "Closed in parts": the exit legs. Kept while another way is chosen. */
  readonly exits: readonly AfterTradeExitDraft[];
  /** "Closed in parts": how its result is recorded. */
  readonly partsResult: PartsResult;
  /** "I only know the final result": the trader's stated whole-Trade total. */
  readonly statedTotal: string;
  readonly classification: AfterTradeClassificationDraft;
  /** Recalled Entry Confidence; no default. */
  readonly confidence: number | null;
  /** Recalled Entry Emotion. */
  readonly emotions: EmotionsDraft;
  /** Post-Trade Emotion — separate, never merged into Entry Emotion. Stage 6. */
  readonly postTradeEmotions: EmotionsDraft;
  readonly context: ContextDraft;
  /** Stage 6 After-Trade Context: never the entry notes or link. '' is Unanswered. */
  readonly afterTradeNote: string;
  readonly afterTradeTradingviewUrl: string;
  /**
   * Stage 6 System Result: what the original plan would have produced
   * (decision 55). `outcome: null` is Unanswered; never Can't determine.
   */
  readonly planOutcome: PlanOutcomeDraft;
}

export function createAfterTradeDraft(tradingAccountId: string): AfterTradeDraft {
  return {
    tradingAccountId,
    symbol: '',
    direction: '',
    enteredAt: '',
    exitedAt: '',
    risk: '',
    riskState: 'unanswered',
    stopMethod: 'unanswered',
    target: { state: 'unanswered', profit: '', price: '' },
    exitPlan: { choice: { kind: 'unanswered' }, customText: '', customBaseId: null },
    outcome: null,
    closeMode: 'unanswered',
    fullClose: { pnl: '', price: '', reason: '' },
    exits: [],
    partsResult: 'unanswered',
    statedTotal: '',
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
    afterTradeNote: '',
    afterTradeTradingviewUrl: '',
    planOutcome: UNANSWERED_PLAN_OUTCOME,
  };
}

// ---------------------------------------------------------------------------
// Risk, Target and result
// ---------------------------------------------------------------------------

/** The risk decision, reconstructed: Unanswered until the trader says (decision 54). */
export function setRiskState(draft: AfterTradeDraft, riskState: RiskStateDraft): AfterTradeDraft {
  if (riskState === draft.riskState) return draft;
  return {
    ...draft,
    riskState,
    risk: riskState === 'defined' ? draft.risk : '',
  };
}

/** Retired from capture (decision 54); kept for drafts that still hold one. */
export function setStopMethod(
  draft: AfterTradeDraft,
  stopMethod: StopMethodDraft,
): AfterTradeDraft {
  return { ...draft, stopMethod };
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

export function removeExit(draft: AfterTradeDraft, id: string): AfterTradeDraft {
  return { ...draft, exits: draft.exits.filter((exit) => exit.id !== id) };
}

/**
 * Choosing how the Trade closed. Each way keeps its own answers, so switching
 * back and forth never throws work away; only the chosen way is saved.
 * `unanswered` is "Remove answer".
 */
export function setCloseMode(draft: AfterTradeDraft, closeMode: CloseMode): AfterTradeDraft {
  return { ...draft, closeMode };
}

/** Choosing how a close in parts is recorded; each way keeps its own answers. */
export function setPartsResult(draft: AfterTradeDraft, partsResult: PartsResult): AfterTradeDraft {
  return { ...draft, partsResult };
}

export function setStatedTotal(draft: AfterTradeDraft, statedTotal: string): AfterTradeDraft {
  return { ...draft, statedTotal };
}

export function updateFullClose(
  draft: AfterTradeDraft,
  patch: Partial<FullCloseDraft>,
): AfterTradeDraft {
  return { ...draft, fullClose: { ...draft.fullClose, ...patch } };
}

function fullCloseRecorded(full: FullCloseDraft): boolean {
  return full.pnl.trim() !== '' || full.price.trim() !== '' || full.reason.trim() !== '';
}

/**
 * THE CLOSE AS EXIT RECORDS — what a Save sends and what validation reads.
 * "All at once" is one All remaining exit (its P&L, price and reason); "in
 * parts" is every leg with something in it; Unanswered is no exit at all.
 */
export function closingExits(draft: AfterTradeDraft): readonly AfterTradeExitDraft[] {
  if (draft.closeMode === 'all_at_once') {
    return [
      {
        id: FULL_CLOSE_EXIT_ID,
        scope: 'all_remaining',
        pnl: draft.fullClose.pnl,
        closedPercent: '',
        exitedAt: '',
        price: draft.fullClose.price,
        reason: draft.fullClose.reason,
      },
    ];
  }
  // Only "Record each exit" saves exit legs; a stated total makes none up.
  if (draft.closeMode === 'in_parts' && draft.partsResult === 'each_exit') {
    return draft.exits.filter(meaningfulExit);
  }
  return [];
}

/**
 * A DRAFT SAVED BEFORE THE CLOSING MODEL (decisions 57–58), read once. Every
 * typed value is kept; no way of closing is chosen that the trader did not:
 *
 * - exits and no typed total: a close in parts recorded exit by exit — the
 *   only thing those exits could have been;
 * - exits beside a typed total: a close in parts whose recording is left
 *   Unanswered, holding both the exits and the total until the trader picks;
 * - a typed total alone: Unanswered, the total kept in both places a trader
 *   could put it (the full close's P&L and the stated total);
 * - nothing: Unanswered.
 */
export function closingFromLegacy(legacy: {
  readonly finalPnl: string;
  readonly exits: readonly AfterTradeExitDraft[];
}): Pick<AfterTradeDraft, 'closeMode' | 'fullClose' | 'exits' | 'partsResult' | 'statedTotal'> {
  const blank: FullCloseDraft = { pnl: '', price: '', reason: '' };
  const total = legacy.finalPnl.trim() === '' ? '' : legacy.finalPnl;
  if (legacy.exits.some(meaningfulExit)) {
    return {
      closeMode: 'in_parts',
      fullClose: blank,
      exits: legacy.exits,
      partsResult: total === '' ? 'each_exit' : 'unanswered',
      statedTotal: total,
    };
  }
  return {
    closeMode: 'unanswered',
    fullClose: { ...blank, pnl: total },
    exits: legacy.exits,
    partsResult: 'unanswered',
    statedTotal: total,
  };
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
  'targetProfit',
  'targetPrice',
  'exits',
  'contextEntryPrice',
  'contextStopPrice',
  'contextPositionSize',
  'tradingviewUrl',
  'planOutcome',
  'afterTradeNote',
  'afterTradeTradingviewUrl',
] as const;
export type AfterTradeStaticField = (typeof AFTER_TRADE_STATIC_FIELDS)[number];
export type AfterTradeExitField = 'pnl' | 'closedPercent' | 'exitedAt' | 'price';
/** A per-exit field is keyed `exit:<id>:<field>`. */
export type AfterTradeField = AfterTradeStaticField | `exit:${string}:${AfterTradeExitField}`;

export type AfterTradeSection = 'trade' | 'result' | 'plan' | 'exits' | 'context' | 'after';

export function afterTradeFieldSection(field: AfterTradeField): AfterTradeSection {
  if (field.startsWith('exit:') || field === 'exits') return 'exits';
  switch (field) {
    case 'finalPnl':
      return 'result';
    case 'risk':
    case 'targetProfit':
    case 'targetPrice':
      return 'plan';
    case 'contextEntryPrice':
    case 'contextStopPrice':
    case 'contextPositionSize':
    case 'tradingviewUrl':
      return 'context';
    case 'planOutcome':
    case 'afterTradeNote':
    case 'afterTradeTradingviewUrl':
      return 'after';
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
  /** The final exit time uses the same two-half editor (Stage 5), so the same rule. */
  | 'exit_time_required'
  | 'exit_date_required'
  | 'future_time'
  | 'exit_before_entry'
  | 'exit_outside_trade'
  | 'invalid_price'
  | 'invalid_percent'
  /** Exits cannot close more than the whole position. */
  | 'percent_over_total'
  | 'fixed_target_requires_value'
  /** The server's own chart-link rule, checked before Save rather than after it. */
  | 'invalid_tradingview_url'
  /** Server-side only: a field the server refused that no specific code describes. */
  | 'not_accepted'
  /** Stage 6 System Result (decision 55): see `PlanOutcomeDraftError`. */
  | PlanOutcomeDraftError;

export type AfterTradeErrors = Partial<Record<AfterTradeField, AfterTradeErrorCode>>;

export type AfterTradeNotice =
  | { readonly kind: 'outcome_contradicts_pnl' }
  | { readonly kind: 'stop_wrong_side' }
  | { readonly kind: 'target_wrong_side' };

/**
 * Why Actual R cannot be shown — never `0`, never a guess.
 *
 * `no_defined_risk` is not a missing input: the trader said this Trade had no
 * planned 1R, so no R exists to show and none ever will (decision 54). Saying
 * "needs your risk at entry" there would ask for something they already
 * answered.
 */
export type ActualRUnavailableReason =
  'needs_pnl_and_risk' | 'needs_risk' | 'needs_pnl' | 'no_defined_risk';

export interface AfterTradeValidation {
  readonly errors: AfterTradeErrors;
  readonly notices: readonly AfterTradeNotice[];
  readonly riskMinor: string | null;
  readonly finalPnlMinor: string | null;
  readonly actualR:
    | { readonly status: 'known'; readonly value: string }
    | { readonly status: 'unavailable'; readonly reason: ActualRUnavailableReason };
  /** Where the close stands — the one source of the Final Net P&L. */
  readonly closing: ClosingState;
}

/**
 * WHERE THE CLOSE STANDS (decision 57).
 *
 * - `closed`: the recorded exits prove the whole position closed — an All
 *   remaining exit, or stated percentages totalling 100%. Never assumed.
 * - `finalPnlMinor` (on the validation): the sum of the exit P&Ls, only once
 *   closed AND every exit states its P&L. Otherwise there is no final result.
 * - `recordedSoFarMinor`: the known exit P&L while there is no final result —
 *   a running figure, never called the Final Net P&L.
 * - `missingPnl`: closed, but some exit has no P&L, so no final result yet.
 */
export interface ClosingState {
  readonly mode: CloseMode;
  readonly partsResult: PartsResult;
  /** Where the Final Net P&L comes from, when there is one. */
  readonly source: 'full_close' | 'exit_legs' | 'stated_total' | null;
  readonly exitCount: number;
  /** Share of the position the exits account for; `null` is unknown. */
  readonly accountedBps: number | null;
  readonly closed: boolean;
  readonly missingPnl: boolean;
  readonly recordedSoFarMinor: string | null;
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

/**
 * HOW COMPLETE THE EXIT HISTORY IS — never whether the Trade is open.
 *
 * Record Closed reconstructs a Trade that is already closed; its exit history
 * is optional supporting detail under an authoritative Final Net P&L. This
 * reads what the recorded exits themselves say, so Step 5 can show it without
 * being expanded:
 *
 * - `kind` tells a full close in one exit apart from partial / several exits;
 * - `accountedBps` is the share of the original position the exits account
 *   for — an All remaining exit closes whatever was left, so it accounts for
 *   the whole position; otherwise every exit must state its percentage, and a
 *   single unstated one makes the share unknown (`null`) rather than a guess;
 *
 * Nothing here is stored or sent; it is presentation of the draft.
 */
export interface ExitHistoryStatus {
  readonly count: number;
  readonly kind: 'none' | 'single_full' | 'partial';
  readonly accountedBps: number | null;
}

export function exitHistoryStatus(exits: readonly AfterTradeExitDraft[]): ExitHistoryStatus {
  const recorded = exits.filter(meaningfulExit);
  if (recorded.length === 0) {
    return { count: 0, kind: 'none', accountedBps: null };
  }
  let accountedBps: number | null;
  if (recorded.some((exit) => exit.scope === 'all_remaining')) {
    accountedBps = 10_000;
  } else {
    let sum = 0;
    let known = true;
    for (const exit of recorded) {
      const bps = percentToBps(exit.closedPercent);
      if (typeof bps !== 'number') {
        known = false;
        break;
      }
      sum += bps;
    }
    accountedBps = known ? sum : null;
  }
  return {
    count: recorded.length,
    kind: recorded.length === 1 && accountedBps === 10_000 ? 'single_full' : 'partial',
    accountedBps,
  };
}

/** A share in basis points as a percentage, with no trailing zeros: 6000 → "60", 3333 → "33.33". */
export function formatShare(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
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
    if (isEntryDateWithoutTime(value)) {
      errors[field] = field === 'enteredAt' ? 'entry_time_required' : 'exit_time_required';
      return null;
    }
    if (isEntryTimeWithoutDate(value)) {
      errors[field] = field === 'enteredAt' ? 'entry_date_required' : 'exit_date_required';
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

  const recorded = closingExits(draft);
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
  // The same rule the Save schema applies (HTTPS, tradingview.com): malformed input
  // is an error as entered, caught here so it is named at the link (UX Rules §6.1).
  if (
    draft.context.tradingviewUrl.trim() !== '' &&
    !isValidTradingViewUrl(draft.context.tradingviewUrl)
  ) {
    errors.tradingviewUrl = 'invalid_tradingview_url';
  }
  // Stage 6 evidence follows the same rule, at its own field.
  if (
    draft.afterTradeTradingviewUrl.trim() !== '' &&
    !isValidTradingViewUrl(draft.afterTradeTradingviewUrl)
  ) {
    errors.afterTradeTradingviewUrl = 'invalid_tradingview_url';
  }
  // Stage 6 System Result: only what the plan as recorded now can answer.
  const planOutcome = resolvePlanOutcomeDraft(
    draft.planOutcome,
    afterTradePlanOutcomePlan(draft, riskMinor, context.currency),
    context.currency,
  );
  if (!planOutcome.ok) errors.planOutcome = planOutcome.error;

  /*
    ONE SOURCE (decision 57). The Final Net P&L is what the close adds up to:
    only once the exits prove the whole position closed, and only when every
    exit states its P&L. Anything less is a running figure, not a result.
  */
  const coverage = exitHistoryStatus(recorded);
  const closed = coverage.accountedBps === 10_000;
  const everyPnl = exitPnl.length > 0 && exitPnl.every((pnl) => pnl !== null);
  const knownPnl = exitPnl.filter((pnl): pnl is bigint => pnl !== null);
  const sum = knownPnl.reduce((total, pnl) => total + pnl, 0n);
  let finalPnlMinor = closed && everyPnl ? sum.toString() : null;
  let source: ClosingState['source'] =
    finalPnlMinor === null ? null : draft.closeMode === 'all_at_once' ? 'full_close' : 'exit_legs';
  // "I only know the final result": the trader's own total, and nothing else.
  if (draft.closeMode === 'in_parts' && draft.partsResult === 'total_only') {
    finalPnlMinor = null;
    source = null;
    if (draft.statedTotal.trim() !== '') {
      const stated = parseTradeMoneyInput(draft.statedTotal, context.currency, {
        allowNegative: true,
        allowZero: true,
      });
      if (stated.ok) {
        finalPnlMinor = stated.value;
        source = 'stated_total';
      } else errors.finalPnl = 'invalid_money';
    }
  }
  const closing: ClosingState = {
    mode: draft.closeMode,
    partsResult: draft.partsResult,
    source,
    exitCount: recorded.length,
    accountedBps: coverage.accountedBps,
    closed,
    missingPnl: closed && !everyPnl,
    recordedSoFarMinor: finalPnlMinor === null && knownPnl.length > 0 ? sum.toString() : null,
  };

  const notices: AfterTradeNotice[] = [];
  if (
    traderOutcomeContradictsPnl(
      draft.outcome,
      finalPnlMinor === null ? null : BigInt(finalPnlMinor),
    )
  ) {
    notices.push({ kind: 'outcome_contradicts_pnl' });
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
        draft.riskState === 'no_defined'
          ? 'no_defined_risk'
          : finalPnlMinor === null && riskMinor === null
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
    closing,
  };
}

/** Error fields in reading order: static fields first, then each exit in list order. */
export function orderedAfterTradeErrorFields(
  draft: AfterTradeDraft,
  errors: AfterTradeErrors,
): readonly AfterTradeField[] {
  const exitFields: AfterTradeField[] = closingExits(draft).flatMap((exit) =>
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
    'targetProfit',
    'targetPrice',
    'exits',
    ...exitFields,
    'contextEntryPrice',
    'contextStopPrice',
    'contextPositionSize',
    'tradingviewUrl',
    // Stage 6 comes last in the reading order, as it does in the flow:
    // its System Result, then its context.
    'planOutcome',
    'afterTradeNote',
    'afterTradeTradingviewUrl',
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
    fullClose: fullCloseRecorded(value.fullClose) ? value.fullClose : null,
  });
  return JSON.stringify(withoutBlankExits(draft)) !== JSON.stringify(withoutBlankExits(pristine));
}

// ---------------------------------------------------------------------------
// Stage 6 System Result (decision 55)
// ---------------------------------------------------------------------------

/**
 * The plan this Save would record, as the Plan Outcome rule reads it — the
 * same facts the payload sends, so the question asked is the question the
 * server will check. A saved Exit Plan counts as recorded; one that is no
 * longer offered already stops the Save on its own.
 */
export function afterTradePlanOutcomePlan(
  draft: AfterTradeDraft,
  riskMinor: string | null,
  currency: string,
): PlanOutcomePlan {
  const profit =
    draft.target.state === 'fixed' && draft.target.profit.trim() !== ''
      ? parseTradeMoneyInput(draft.target.profit, currency)
      : null;
  const { choice } = draft.exitPlan;
  return {
    plannedRiskMinor:
      draft.riskState === 'no_defined' || riskMinor === null ? null : BigInt(riskMinor),
    plannedRiskState: draft.riskState === 'unanswered' ? null : draft.riskState,
    targetState: draft.target.state === 'unanswered' ? null : draft.target.state,
    plannedRewardMinor: profit?.ok === true ? BigInt(profit.value) : null,
    exitPlanState:
      choice.kind === 'saved'
        ? 'saved'
        : choice.kind === 'customized' && draft.exitPlan.customText.trim() !== ''
          ? 'customized'
          : choice.kind === 'no_rule'
            ? 'no_rule'
            : null,
  };
}

function planOutcomePayload(
  draft: AfterTradeDraft,
  riskMinor: string | null,
  currency: string,
): Pick<CreateCompletedTradePayload, 'planOutcome' | 'planOutcomeMinor'> {
  const resolved = resolvePlanOutcomeDraft(
    draft.planOutcome,
    afterTradePlanOutcomePlan(draft, riskMinor, currency),
    currency,
  );
  if (!resolved.ok || resolved.value === null) return {};
  return {
    planOutcome: resolved.value.outcome,
    ...(resolved.value.amountMinor === null
      ? {}
      : { planOutcomeMinor: resolved.value.amountMinor }),
  };
}

export function setPlanOutcomeAnswer(
  draft: AfterTradeDraft,
  outcome: PlanOutcome | null,
): AfterTradeDraft {
  return { ...draft, planOutcome: choosePlanOutcome(draft.planOutcome, outcome) };
}

export function setPlanOutcomeAmountText(draft: AfterTradeDraft, amount: string): AfterTradeDraft {
  return { ...draft, planOutcome: setPlanOutcomeAmount(draft.planOutcome, amount) };
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
  const recordedExits = closingExits(draft);

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
    // Actual Risk is retired from capture (decision 56): never part of a Save.
    ...(draft.riskState === 'unanswered' ? {} : { plannedRiskState: draft.riskState }),
    ...(draft.target.state === 'unanswered' ? {} : { targetState: draft.target.state }),
    ...(draft.target.state === 'fixed'
      ? {
          plannedRewardMinor: money(draft.target.profit, false),
          targetPrice: trimmedOrUndefined(draft.target.price) ?? null,
        }
      : {}),
    /*
      ONE SOURCE (decision 57): the Final Net P&L is the close's own sum, sent
      as adopted from the exits so the server checks it against them; the
      history is Complete exactly when the exits prove the position closed.
    */
    finalPnlMinor: validation.finalPnlMinor,
    ...(validation.closing.source === 'stated_total'
      ? { finalPnlStatedTotal: true }
      : validation.finalPnlMinor === null
        ? {}
        : { finalPnlAdoptedFromExits: true }),
    ...(draft.outcome === null ? {} : { traderOutcome: draft.outcome }),
    ...(recordedExits.length > 0 && validation.closing.closed
      ? { exitHistoryCompleteness: 'complete' }
      : {}),
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
    // Stage 6, saved with the Closed Trade it describes.
    afterTradeNote: draft.afterTradeNote,
    afterTradeTradingviewUrl: draft.afterTradeTradingviewUrl,
    ...planOutcomePayload(draft, validation.riskMinor, context.currency),
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
