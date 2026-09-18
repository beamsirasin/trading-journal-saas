/**
 * THE ADD TRADE RECORDING DRAFT — one draft across At Entry and After Trade.
 *
 * Add Trade contract §23 and UX Rules §5: Type → Draft · Save → Persist ·
 * Discard → Destroy. This module is the pure model of that one draft; storage
 * lives in `recording-draft-storage.ts` and nothing here renders or touches I/O.
 *
 * ONE ENVELOPE, ONE SECTION PER MODE. A trader who starts At Entry and switches
 * to After Trade still has ONE draft: each section keeps its own mode's answers
 * as draft data, and only the ACTIVE mode's section is ever turned into a Save
 * payload. Mode-specific work — Final Net P&L, Trader Outcome, exit history,
 * Post-Trade Emotion on one side; the At Entry "now" and Matched assumptions on
 * the other — stays in its section, hidden while inactive, never deleted.
 *
 * WHAT CROSSES MODES: EXPLICIT ANSWERS WHOSE MEANING IS THE SAME IN BOTH
 * (contract §23, decision 40; UX Rules §5.5). `SharedRecordingValues` lists
 * them: identity, an explicit entry time, Risk at Entry, the Strategy and Setup
 * answers (including No Strategy / No Setup), Met / Not Met condition answers,
 * the Target, an explicitly chosen Exit Plan, an explicit Actual Risk
 * "Different", Confidence, Entry Emotion and the context fields.
 *
 * DEFAULTS NEVER CROSS. An untouched At Entry entry time ("now"), the At Entry
 * Matched Actual Risk assumption and an automatically inherited Strategy Exit
 * Plan are not shared values, so After Trade shows each of them Unanswered. An
 * After Trade "Don't remember" condition and "Don't know" Actual Risk have no
 * At Entry answer; they stay in the After Trade section and are never turned
 * into something At Entry can show.
 *
 * ONLY WHAT WAS CHANGED CROSSES BACK. After the first switch the envelope
 * remembers the shared values it last handed over. Switching again carries only
 * the shared fields the trader changed since then, so an answer only one mode
 * can hold is never overwritten by the other mode's blank.
 *
 * PROVENANCE IS NOT DECIDED HERE. A mode switch rewrites no capture origin: the
 * origin a Save writes reflects the recording context at Save (UX Rules §5.5).
 */
import { z } from 'zod';

import {
  createAfterTradeDraft,
  hasAfterTradeWork,
  type AfterTradeDraft,
  type RecalledConditionStatus,
} from './after-trade-draft';
import {
  createAtEntryDraft,
  hasUserWork,
  type AnswerState,
  type AtEntryDraft,
  type ConditionStatus,
  type TargetDraft,
} from './at-entry-draft';

/**
 * v2 (2026-09-18): the After Trade section follows the Add Trade contract. A v1
 * draft is upgraded by `upgradeV1Envelope`, which keeps the At Entry section
 * whole and carries only the legacy After Trade values whose meaning did not
 * change. Any other version is never guessed.
 */
export const RECORDING_DRAFT_VERSION = 2;

/**
 * Conservative automatic retention: a draft untouched for 30 days is dropped
 * on the next read. Successful Save, explicit discard and sign-out remain the
 * authoritative cleanup events; this only stops abandoned work from lingering
 * forever on a shared device (contract §23 Draft privacy).
 */
export const RECORDING_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type RecordingMode = 'at_entry' | 'after_trade';

/** Condition answers both modes hold: Met / Not Met, per Strategy and Setup. */
export type SharedConditionAnswers = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, ConditionStatus>>>>>
>;

/** An Exit Plan the trader chose. An inherited default is never one. */
export type SharedExitPlan =
  | { readonly kind: 'saved'; readonly exitPlanId: string }
  | {
      readonly kind: 'customized';
      readonly customText: string;
      readonly customBaseId: string | null;
    }
  | { readonly kind: 'no_rule' };

export interface SharedRecordingValues {
  readonly tradingAccountId: string;
  readonly symbol: string;
  readonly direction: '' | 'long' | 'short';
  /** An explicit entry time only; '' is Unanswered, never "now". */
  readonly enteredAt: string;
  /** A manually entered Risk at Entry. */
  readonly riskAtEntry: string;
  readonly classification: {
    readonly strategy: AnswerState;
    readonly strategyId: string;
    readonly setup: AnswerState;
    readonly setupId: string;
  };
  readonly conditions: SharedConditionAnswers;
  readonly target: TargetDraft;
  /** `null` when no explicit Exit Plan answer exists. */
  readonly exitPlan: SharedExitPlan | null;
  /** An explicit "Actual risk differed", with its amount or ''; `null` otherwise. */
  readonly actualRiskDifferent: { readonly amount: string } | null;
  readonly confidence: number | null;
  /** `null` Unanswered, `[]` None of these, or the chosen Entry emotions. */
  readonly emotions: readonly string[] | null;
  readonly entryPrice: string;
  readonly stopPrice: string;
  readonly positionSize: string;
  readonly reason: string;
  readonly tradingviewUrl: string;
  readonly notes: string;
  readonly timeframe: string;
  readonly session: string;
}

export interface RecordingDraftEnvelope {
  readonly version: typeof RECORDING_DRAFT_VERSION;
  readonly activeMode: RecordingMode;
  /**
   * The idempotency key a Save sends. It lives in the draft so a retry after a
   * reload, a network failure or a lost response replays the same key and can
   * never create a second Trade.
   */
  readonly mutationKey: string;
  readonly updatedAt: string;
  readonly atEntry: AtEntryDraft | null;
  readonly afterTrade: AfterTradeDraft | null;
  /** The shared values handed across at the last switch; `null` before any switch. */
  readonly lastCarried: SharedRecordingValues | null;
}

// ---------------------------------------------------------------------------
// Shared values
// ---------------------------------------------------------------------------

function emotionsShared(answer: { answer: AnswerState; keys: readonly string[] }) {
  return answer.answer === 'selected' ? answer.keys : answer.answer === 'none' ? [] : null;
}

function emotionsFromShared(
  emotions: readonly string[] | null,
  previousKeys: readonly string[],
): { answer: AnswerState; keys: readonly string[] } {
  return emotions === null
    ? { answer: 'unanswered', keys: previousKeys }
    : emotions.length === 0
      ? { answer: 'none', keys: previousKeys }
      : { answer: 'selected', keys: emotions };
}

/** The Met / Not Met answers only; "Don't remember" stays in After Trade. */
function metOrNotMet(
  conditions: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, RecalledConditionStatus>>>>>
  >,
): SharedConditionAnswers {
  const result: Record<string, Record<string, Record<string, ConditionStatus>>> = {};
  for (const [strategyId, bySetup] of Object.entries(conditions)) {
    for (const [setupId, answers] of Object.entries(bySetup)) {
      for (const [key, status] of Object.entries(answers)) {
        if (status === 'unknown') continue;
        ((result[strategyId] ??= {})[setupId] ??= {})[key] = status;
      }
    }
  }
  return result;
}

export function sharedFromAtEntry(draft: AtEntryDraft): SharedRecordingValues {
  const { classification } = draft;
  const setup =
    classification.strategy === 'selected'
      ? classification.setupByStrategy[classification.strategyId]
      : undefined;
  const { choice } = draft.exitPlan;
  return {
    tradingAccountId: draft.tradingAccountId,
    symbol: draft.symbol,
    direction: draft.direction,
    enteredAt: draft.entryTime.source === 'trader' ? draft.entryTime.value : '',
    riskAtEntry: draft.risk,
    classification: {
      strategy: classification.strategy,
      strategyId: classification.strategy === 'selected' ? classification.strategyId : '',
      setup: setup?.answer ?? 'unanswered',
      setupId: setup?.answer === 'selected' ? setup.setupId : '',
    },
    conditions: classification.conditions,
    target: draft.target,
    // `inherit` is the Strategy default applying without a choice: never shared.
    exitPlan:
      choice.kind === 'saved'
        ? { kind: 'saved', exitPlanId: choice.exitPlanId }
        : choice.kind === 'customized'
          ? {
              kind: 'customized',
              customText: draft.exitPlan.customText,
              customBaseId: draft.exitPlan.customBaseId,
            }
          : choice.kind === 'no_rule'
            ? { kind: 'no_rule' }
            : null,
    // Matched is At Entry's visible assumption, not an After Trade answer.
    actualRiskDifferent:
      draft.actualRisk.mode === 'different'
        ? { amount: draft.actualRisk.amount }
        : draft.actualRisk.mode === 'different_unknown'
          ? { amount: '' }
          : null,
    confidence: draft.confidence,
    emotions: emotionsShared(draft.emotions),
    entryPrice: draft.context.entryPrice,
    stopPrice: draft.context.stopPrice,
    positionSize: draft.context.positionSize,
    reason: draft.context.reason,
    tradingviewUrl: draft.context.tradingviewUrl,
    notes: draft.context.notes,
    timeframe: draft.context.timeframe,
    session: draft.context.session,
  };
}

export function sharedFromAfterTrade(draft: AfterTradeDraft): SharedRecordingValues {
  const { classification } = draft;
  const setup =
    classification.strategy === 'selected'
      ? classification.setupByStrategy[classification.strategyId]
      : undefined;
  const { choice } = draft.exitPlan;
  return {
    tradingAccountId: draft.tradingAccountId,
    symbol: draft.symbol,
    direction: draft.direction,
    enteredAt: draft.enteredAt,
    riskAtEntry: draft.risk,
    classification: {
      strategy: classification.strategy,
      strategyId: classification.strategy === 'selected' ? classification.strategyId : '',
      setup: setup?.answer ?? 'unanswered',
      setupId: setup?.answer === 'selected' ? setup.setupId : '',
    },
    conditions: metOrNotMet(classification.conditions),
    target: draft.target,
    exitPlan:
      choice.kind === 'saved'
        ? { kind: 'saved', exitPlanId: choice.exitPlanId }
        : choice.kind === 'customized'
          ? {
              kind: 'customized',
              customText: draft.exitPlan.customText,
              customBaseId: draft.exitPlan.customBaseId,
            }
          : choice.kind === 'no_rule'
            ? { kind: 'no_rule' }
            : null,
    actualRiskDifferent:
      draft.actualRisk.answer === 'different' ? { amount: draft.actualRisk.amount } : null,
    confidence: draft.confidence,
    emotions: emotionsShared(draft.emotions),
    entryPrice: draft.context.entryPrice,
    stopPrice: draft.context.stopPrice,
    positionSize: draft.context.positionSize,
    reason: draft.context.reason,
    tradingviewUrl: draft.context.tradingviewUrl,
    notes: draft.context.notes,
    timeframe: draft.context.timeframe,
    session: draft.context.session,
  };
}

type SharedField = keyof SharedRecordingValues;
const SHARED_FIELDS: readonly SharedField[] = [
  'tradingAccountId',
  'symbol',
  'direction',
  'enteredAt',
  'riskAtEntry',
  'classification',
  'conditions',
  'target',
  'exitPlan',
  'actualRiskDifferent',
  'confidence',
  'emotions',
  'entryPrice',
  'stopPrice',
  'positionSize',
  'reason',
  'tradingviewUrl',
  'notes',
  'timeframe',
  'session',
];

function sameValue(a: SharedRecordingValues[SharedField], b: SharedRecordingValues[SharedField]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function hasAnyCondition(conditions: SharedConditionAnswers): boolean {
  return Object.values(conditions).some((bySetup) =>
    Object.values(bySetup).some((answers) => Object.keys(answers).length > 0),
  );
}

/** Whether a shared value holds no answer at all — the first switch never carries one. */
function isUnanswered(field: SharedField, source: SharedRecordingValues): boolean {
  switch (field) {
    case 'classification':
      return source.classification.strategy === 'unanswered';
    case 'conditions':
      return !hasAnyCondition(source.conditions);
    case 'target':
      return (
        source.target.state === 'unanswered' &&
        source.target.profit === '' &&
        source.target.price === ''
      );
    default: {
      const value = source[field];
      return value === '' || value === null;
    }
  }
}

/** Which shared fields a switch carries: every answered one the first time, then only changed ones. */
function fieldsToCarry(
  source: SharedRecordingValues,
  lastCarried: SharedRecordingValues | null,
): readonly SharedField[] {
  if (lastCarried === null) return SHARED_FIELDS.filter((field) => !isUnanswered(field, source));
  return SHARED_FIELDS.filter((field) => !sameValue(source[field], lastCarried[field]));
}

function withSharedClassification<
  C extends {
    readonly strategy: AnswerState;
    readonly strategyId: string;
    readonly setupByStrategy: Readonly<
      Record<string, { readonly answer: AnswerState; readonly setupId: string }>
    >;
  },
>(classification: C, shared: SharedRecordingValues['classification']): C {
  if (shared.strategy !== 'selected') return { ...classification, strategy: shared.strategy };
  const previous = classification.setupByStrategy[shared.strategyId];
  return {
    ...classification,
    strategy: 'selected',
    strategyId: shared.strategyId,
    setupByStrategy: {
      ...classification.setupByStrategy,
      [shared.strategyId]: {
        answer: shared.setup,
        setupId: shared.setup === 'selected' ? shared.setupId : (previous?.setupId ?? ''),
      },
    },
  };
}

export function applySharedToAtEntry(
  draft: AtEntryDraft,
  shared: SharedRecordingValues,
  fields: readonly SharedField[],
): AtEntryDraft {
  let next = draft;
  const has = (field: SharedField) => fields.includes(field);
  if (has('tradingAccountId')) next = { ...next, tradingAccountId: shared.tradingAccountId };
  if (has('symbol')) next = { ...next, symbol: shared.symbol };
  if (has('direction')) next = { ...next, direction: shared.direction };
  if (has('enteredAt')) {
    next = {
      ...next,
      // A time the trader entered stays theirs; clearing it returns At Entry to
      // its own "now" default rather than inventing an answer.
      entryTime:
        shared.enteredAt === ''
          ? { source: 'default_now', value: '' }
          : { source: 'trader', value: shared.enteredAt },
    };
  }
  if (has('riskAtEntry')) next = { ...next, risk: shared.riskAtEntry };
  if (has('classification')) {
    next = {
      ...next,
      classification: withSharedClassification(next.classification, shared.classification),
    };
  }
  if (has('conditions')) {
    next = { ...next, classification: { ...next.classification, conditions: shared.conditions } };
  }
  if (has('target')) next = { ...next, target: shared.target };
  if (has('exitPlan')) {
    const plan = shared.exitPlan;
    next = {
      ...next,
      exitPlan:
        plan === null
          ? // Withdrawn in After Trade: At Entry returns to its own default.
            { ...next.exitPlan, choice: { kind: 'inherit' } }
          : plan.kind === 'customized'
            ? {
                choice: { kind: 'customized' },
                customText: plan.customText,
                customBaseId: plan.customBaseId,
              }
            : { ...next.exitPlan, choice: plan },
    };
  }
  if (has('actualRiskDifferent')) {
    const different = shared.actualRiskDifferent;
    next = {
      ...next,
      actualRisk:
        different === null
          ? { ...next.actualRisk, mode: 'matched' }
          : different.amount === ''
            ? { ...next.actualRisk, mode: 'different_unknown' }
            : { mode: 'different', amount: different.amount },
    };
  }
  if (has('confidence')) next = { ...next, confidence: shared.confidence };
  if (has('emotions')) {
    next = { ...next, emotions: emotionsFromShared(shared.emotions, next.emotions.keys) };
  }
  const context = { ...next.context };
  if (has('entryPrice')) context.entryPrice = shared.entryPrice;
  if (has('stopPrice')) context.stopPrice = shared.stopPrice;
  if (has('positionSize')) context.positionSize = shared.positionSize;
  if (has('reason')) context.reason = shared.reason;
  if (has('tradingviewUrl')) context.tradingviewUrl = shared.tradingviewUrl;
  if (has('notes')) context.notes = shared.notes;
  if (has('timeframe')) context.timeframe = shared.timeframe;
  if (has('session')) context.session = shared.session;
  return { ...next, context };
}

/** Met / Not Met answers from At Entry, keeping each "Don't remember" At Entry could not see. */
function mergeConditions(
  own: AfterTradeDraft['classification']['conditions'],
  shared: SharedConditionAnswers,
): AfterTradeDraft['classification']['conditions'] {
  const result: Record<string, Record<string, Record<string, RecalledConditionStatus>>> = {};
  for (const [strategyId, bySetup] of Object.entries(own)) {
    for (const [setupId, answers] of Object.entries(bySetup)) {
      for (const [key, status] of Object.entries(answers)) {
        if (status === 'unknown') ((result[strategyId] ??= {})[setupId] ??= {})[key] = status;
      }
    }
  }
  for (const [strategyId, bySetup] of Object.entries(shared)) {
    for (const [setupId, answers] of Object.entries(bySetup)) {
      for (const [key, status] of Object.entries(answers)) {
        ((result[strategyId] ??= {})[setupId] ??= {})[key] = status;
      }
    }
  }
  return result;
}

export function applySharedToAfterTrade(
  draft: AfterTradeDraft,
  shared: SharedRecordingValues,
  fields: readonly SharedField[],
): AfterTradeDraft {
  let next = draft;
  const has = (field: SharedField) => fields.includes(field);
  if (has('tradingAccountId')) next = { ...next, tradingAccountId: shared.tradingAccountId };
  if (has('symbol')) next = { ...next, symbol: shared.symbol };
  if (has('direction')) next = { ...next, direction: shared.direction };
  if (has('enteredAt')) next = { ...next, enteredAt: shared.enteredAt };
  if (has('riskAtEntry')) next = { ...next, risk: shared.riskAtEntry };
  if (has('classification')) {
    next = {
      ...next,
      classification: withSharedClassification(next.classification, shared.classification),
    };
  }
  if (has('conditions')) {
    next = {
      ...next,
      classification: {
        ...next.classification,
        conditions: mergeConditions(next.classification.conditions, shared.conditions),
      },
    };
  }
  if (has('target')) next = { ...next, target: shared.target };
  if (has('exitPlan')) {
    const plan = shared.exitPlan;
    next = {
      ...next,
      exitPlan:
        plan === null
          ? { ...next.exitPlan, choice: { kind: 'unanswered' } }
          : plan.kind === 'customized'
            ? {
                choice: { kind: 'customized' },
                customText: plan.customText,
                customBaseId: plan.customBaseId,
              }
            : { ...next.exitPlan, choice: plan },
    };
  }
  if (has('actualRiskDifferent')) {
    const different = shared.actualRiskDifferent;
    next = {
      ...next,
      actualRisk:
        different !== null
          ? { answer: 'different', amount: different.amount }
          : // Withdrawn in At Entry. At Entry's Matched is an assumption, not
            // an After Trade answer, so this returns to Unanswered.
            next.actualRisk.answer === 'different'
            ? { ...next.actualRisk, answer: 'unanswered' }
            : next.actualRisk,
    };
  }
  if (has('confidence')) next = { ...next, confidence: shared.confidence };
  if (has('emotions')) {
    next = { ...next, emotions: emotionsFromShared(shared.emotions, next.emotions.keys) };
  }
  const context = { ...next.context };
  if (has('entryPrice')) context.entryPrice = shared.entryPrice;
  if (has('stopPrice')) context.stopPrice = shared.stopPrice;
  if (has('positionSize')) context.positionSize = shared.positionSize;
  if (has('reason')) context.reason = shared.reason;
  if (has('tradingviewUrl')) context.tradingviewUrl = shared.tradingviewUrl;
  if (has('notes')) context.notes = shared.notes;
  if (has('timeframe')) context.timeframe = shared.timeframe;
  if (has('session')) context.session = shared.session;
  return { ...next, context };
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export function createRecordingDraft(params: {
  readonly mode: RecordingMode;
  readonly tradingAccountId: string;
  readonly mutationKey: string;
  readonly now: Date;
}): RecordingDraftEnvelope {
  return {
    version: RECORDING_DRAFT_VERSION,
    activeMode: params.mode,
    mutationKey: params.mutationKey,
    updatedAt: params.now.toISOString(),
    atEntry: params.mode === 'at_entry' ? createAtEntryDraft(params.tradingAccountId) : null,
    afterTrade:
      params.mode === 'after_trade' ? createAfterTradeDraft(params.tradingAccountId) : null,
    lastCarried: null,
  };
}

/**
 * SWITCHING MODE IS NAVIGATION, NEVER DISCARD.
 *
 * The leaving mode's section is kept whole. The arriving mode's section is its
 * own earlier work when there is some, or a fresh section otherwise, and it
 * receives only the shared values the carry rules allow.
 */
export function switchRecordingMode(
  envelope: RecordingDraftEnvelope,
  to: RecordingMode,
  context: { readonly defaultTradingAccountId: string; readonly now: Date },
): RecordingDraftEnvelope {
  if (envelope.activeMode === to) return envelope;
  const source =
    envelope.activeMode === 'at_entry'
      ? envelope.atEntry === null
        ? null
        : sharedFromAtEntry(envelope.atEntry)
      : envelope.afterTrade === null
        ? null
        : sharedFromAfterTrade(envelope.afterTrade);
  const updatedAt = context.now.toISOString();

  if (to === 'after_trade') {
    const fresh = envelope.afterTrade === null;
    const base = envelope.afterTrade ?? createAfterTradeDraft(context.defaultTradingAccountId);
    const fields =
      source === null ? [] : fieldsToCarry(source, fresh ? null : envelope.lastCarried);
    const arrived = source === null ? base : applySharedToAfterTrade(base, source, fields);
    return {
      ...envelope,
      activeMode: 'after_trade',
      updatedAt,
      afterTrade: arrived,
      lastCarried: sharedFromAfterTrade(arrived),
    };
  }

  const fresh = envelope.atEntry === null;
  const base = envelope.atEntry ?? createAtEntryDraft(context.defaultTradingAccountId);
  const fields = source === null ? [] : fieldsToCarry(source, fresh ? null : envelope.lastCarried);
  const arrived = source === null ? base : applySharedToAtEntry(base, source, fields);
  return {
    ...envelope,
    activeMode: 'at_entry',
    updatedAt,
    atEntry: arrived,
    lastCarried: sharedFromAtEntry(arrived),
  };
}

/** Whether anything in either section is the trader's work, judged against each mode's pristine form. */
export function recordingDraftHasWork(
  envelope: RecordingDraftEnvelope,
  defaultTradingAccountId: string,
): boolean {
  return (
    (envelope.atEntry !== null &&
      hasUserWork(envelope.atEntry, createAtEntryDraft(defaultTradingAccountId))) ||
    (envelope.afterTrade !== null &&
      hasAfterTradeWork(envelope.afterTrade, createAfterTradeDraft(defaultTradingAccountId)))
  );
}

/** A short, trader-recognisable label for what a draft holds — used to name what sign-out would remove. */
export function recordingDraftSymbol(envelope: RecordingDraftEnvelope): string | null {
  const symbol =
    envelope.activeMode === 'at_entry' ? envelope.atEntry?.symbol : envelope.afterTrade?.symbol;
  const trimmed = symbol?.trim().toUpperCase() ?? '';
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

const text = z.string().max(20_000);
const direction = z.enum(['', 'long', 'short']);
const answerState = z.enum(['unanswered', 'none', 'selected']);
const targetSchema = z.object({
  state: z.enum(['unanswered', 'fixed', 'no_fixed']),
  profit: text,
  price: text,
});
const exitPlanSchema = z.object({
  choice: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('inherit') }),
    z.object({ kind: z.literal('unanswered') }),
    z.object({ kind: z.literal('saved'), exitPlanId: text }),
    z.object({ kind: z.literal('customized') }),
    z.object({ kind: z.literal('no_rule') }),
  ]),
  customText: text,
  customBaseId: text.nullable(),
});
const setupByStrategySchema = z.record(text, z.object({ answer: answerState, setupId: text }));
const emotionsSchema = z.object({ answer: answerState, keys: z.array(text) });
const contextSchema = z.object({
  entryPrice: text,
  stopPrice: text,
  positionSize: text,
  timeframe: text,
  session: text,
  reason: text,
  tradingviewUrl: text,
  notes: text,
});

const atEntrySchema = z.object({
  tradingAccountId: text,
  symbol: text,
  direction,
  entryTime: z.object({ source: z.enum(['default_now', 'trader', 'cleared']), value: text }),
  risk: text,
  actualRisk: z.object({
    mode: z.enum(['matched', 'different', 'different_unknown']),
    amount: text,
  }),
  target: targetSchema,
  exitPlan: exitPlanSchema,
  classification: z.object({
    strategy: answerState,
    strategyId: text,
    setupByStrategy: setupByStrategySchema,
    conditions: z.record(text, z.record(text, z.record(text, z.enum(['met', 'not_met'])))),
  }),
  confidence: z.number().int().nullable(),
  emotions: emotionsSchema,
  context: contextSchema,
}) satisfies z.ZodType<AtEntryDraft>;

const afterTradeSchema = z.object({
  tradingAccountId: text,
  symbol: text,
  direction,
  enteredAt: text,
  exitedAt: text,
  risk: text,
  actualRisk: z.object({
    answer: z.enum(['unanswered', 'matched', 'different', 'unknown']),
    amount: text,
  }),
  target: targetSchema,
  exitPlan: exitPlanSchema,
  finalPnl: text,
  outcome: z.enum(['win', 'loss', 'break_even']).nullable(),
  exits: z
    .array(
      z.object({
        id: text,
        scope: z.enum(['', 'part', 'all_remaining', 'unknown']),
        pnl: text,
        closedPercent: text,
        exitedAt: text,
        price: text,
        reason: text,
      }),
    )
    .max(200),
  completeness: z.enum(['unanswered', 'unknown', 'incomplete', 'complete']),
  classification: z.object({
    strategy: answerState,
    strategyId: text,
    setupByStrategy: setupByStrategySchema,
    conditions: z.record(
      text,
      z.record(text, z.record(text, z.enum(['met', 'not_met', 'unknown']))),
    ),
  }),
  confidence: z.number().int().nullable(),
  emotions: emotionsSchema,
  postTradeEmotions: emotionsSchema,
  context: contextSchema,
}) satisfies z.ZodType<AfterTradeDraft>;

const sharedSchema = z.object({
  tradingAccountId: text,
  symbol: text,
  direction,
  enteredAt: text,
  riskAtEntry: text,
  classification: z.object({
    strategy: answerState,
    strategyId: text,
    setup: answerState,
    setupId: text,
  }),
  conditions: z.record(text, z.record(text, z.record(text, z.enum(['met', 'not_met'])))),
  target: targetSchema,
  exitPlan: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('saved'), exitPlanId: text }),
      z.object({
        kind: z.literal('customized'),
        customText: text,
        customBaseId: text.nullable(),
      }),
      z.object({ kind: z.literal('no_rule') }),
    ])
    .nullable(),
  actualRiskDifferent: z.object({ amount: text }).nullable(),
  confidence: z.number().int().nullable(),
  emotions: z.array(text).nullable(),
  entryPrice: text,
  stopPrice: text,
  positionSize: text,
  reason: text,
  tradingviewUrl: text,
  notes: text,
  timeframe: text,
  session: text,
}) satisfies z.ZodType<SharedRecordingValues>;

const envelopeSchema = z.object({
  version: z.literal(RECORDING_DRAFT_VERSION),
  activeMode: z.enum(['at_entry', 'after_trade']),
  mutationKey: z.string().uuid(),
  updatedAt: z.string().datetime({ offset: true }),
  atEntry: atEntrySchema.nullable(),
  afterTrade: afterTradeSchema.nullable(),
  lastCarried: sharedSchema.nullable(),
});

// ---------------------------------------------------------------------------
// v1 → v2
// ---------------------------------------------------------------------------

/** The pre-contract After Trade section, exactly as v1 stored it. */
const v1AfterTradeSchema = z.object({
  values: z.object({
    tradingAccountId: text,
    symbol: text,
    direction,
    enteredAt: text,
    exitedAt: text,
    strategyId: text,
    setupId: text,
    timeframe: text,
    session: text,
    plannedEntry: text,
    plannedStop: text,
    plannedTarget: text,
    plannedPositionSize: text,
    plannedRisk: text,
    plannedReward: text,
    actualEntry: text,
    actualStop: text,
    actualPositionSize: text,
    actualRisk: text,
    finalPnl: text,
    confirmationNotes: text,
    tradingviewUrl: text,
    notes: text,
    confidence: text,
  }),
  planBasis: z.enum(['money', 'price']),
  actualBasis: z.enum(['money', 'price']),
  exits: z.array(
    z.object({
      id: text,
      closedPercent: text,
      scope: z.enum(['', 'part', 'all_remaining']),
      value: text,
      exitedAt: text,
      reason: text,
    }),
  ),
  completeness: z.enum(['unknown', 'incomplete', 'complete']),
  conditionMet: z.record(text, z.boolean()),
  emotions: z.array(text).nullable(),
});

const v1SharedSchema = z.object({
  tradingAccountId: text,
  symbol: text,
  direction,
  enteredAt: text,
  riskAtEntry: text,
  strategyId: text,
  setupId: text,
  confidence: z.number().int().nullable(),
  emotions: z.array(text).nullable(),
  reason: text,
  tradingviewUrl: text,
  notes: text,
  timeframe: text,
  session: text,
});

const v1EnvelopeSchema = z.object({
  version: z.literal(1),
  activeMode: z.enum(['at_entry', 'after_trade']),
  mutationKey: z.string().uuid(),
  updatedAt: z.string().datetime({ offset: true }),
  atEntry: atEntrySchema.nullable(),
  afterTrade: v1AfterTradeSchema.nullable(),
  lastCarried: v1SharedSchema.nullable(),
});

function confidenceFromText(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return [0, 25, 50, 75, 100].includes(parsed) ? parsed : null;
}

/**
 * THE ONE EXPLICIT UPGRADE. Only values whose meaning is unchanged cross:
 * identity, times, a Money Risk at Entry and Final Net P&L, exit rows (a Price
 * exit value becomes the exit's price context), Strategy / Setup, Confidence,
 * emotions and the context text. Left behind, because the old form could not
 * say what they now mean: the boolean condition checklist (an unchecked box was
 * saved as Not Met), the pre-selected "Not sure" completeness, the old Actual
 * Risk denominator and the Price plan. Nothing is inferred from them.
 */
export function upgradeV1AfterTrade(legacy: z.infer<typeof v1AfterTradeSchema>): AfterTradeDraft {
  const { values } = legacy;
  const base = createAfterTradeDraft(values.tradingAccountId);
  const money = legacy.actualBasis === 'money';
  const emotions = legacy.emotions;
  return {
    ...base,
    symbol: values.symbol,
    direction: values.direction,
    enteredAt: values.enteredAt,
    exitedAt: values.exitedAt,
    risk: legacy.planBasis === 'money' ? values.plannedRisk : '',
    finalPnl: money ? values.finalPnl : '',
    exits: legacy.exits.map((exit) => ({
      id: exit.id,
      scope: exit.scope,
      pnl: money ? exit.value : '',
      closedPercent: exit.closedPercent,
      exitedAt: exit.exitedAt,
      price: money ? '' : exit.value,
      reason: exit.reason,
    })),
    classification:
      values.strategyId === ''
        ? base.classification
        : {
            strategy: 'selected',
            strategyId: values.strategyId,
            setupByStrategy:
              values.setupId === ''
                ? {}
                : { [values.strategyId]: { answer: 'selected', setupId: values.setupId } },
            conditions: {},
          },
    confidence: confidenceFromText(values.confidence),
    emotions:
      emotions === null
        ? base.emotions
        : emotions.length === 0
          ? { answer: 'none', keys: [] }
          : { answer: 'selected', keys: emotions },
    context: {
      ...base.context,
      entryPrice: money ? '' : values.actualEntry,
      stopPrice: money ? '' : values.actualStop,
      positionSize: money ? '' : values.actualPositionSize,
      timeframe: values.timeframe,
      session: values.session,
      reason: values.confirmationNotes,
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
    },
  };
}

function upgradeV1Shared(legacy: z.infer<typeof v1SharedSchema>): SharedRecordingValues {
  return {
    tradingAccountId: legacy.tradingAccountId,
    symbol: legacy.symbol,
    direction: legacy.direction,
    enteredAt: legacy.enteredAt,
    riskAtEntry: legacy.riskAtEntry,
    classification: {
      strategy: legacy.strategyId === '' ? 'unanswered' : 'selected',
      strategyId: legacy.strategyId,
      setup: legacy.setupId === '' ? 'unanswered' : 'selected',
      setupId: legacy.setupId,
    },
    // Never handed over in v1: an answer in either section now carries once.
    conditions: {},
    target: { state: 'unanswered', profit: '', price: '' },
    exitPlan: null,
    actualRiskDifferent: null,
    confidence: legacy.confidence,
    emotions: legacy.emotions,
    entryPrice: '',
    stopPrice: '',
    positionSize: '',
    reason: legacy.reason,
    tradingviewUrl: legacy.tradingviewUrl,
    notes: legacy.notes,
    timeframe: legacy.timeframe,
    session: legacy.session,
  };
}

function upgradeV1Envelope(legacy: z.infer<typeof v1EnvelopeSchema>): RecordingDraftEnvelope {
  return {
    version: RECORDING_DRAFT_VERSION,
    activeMode: legacy.activeMode,
    mutationKey: legacy.mutationKey,
    updatedAt: legacy.updatedAt,
    atEntry: legacy.atEntry,
    afterTrade: legacy.afterTrade === null ? null : upgradeV1AfterTrade(legacy.afterTrade),
    lastCarried: legacy.lastCarried === null ? null : upgradeV1Shared(legacy.lastCarried),
  };
}

export type ParsedRecordingDraft =
  | { readonly status: 'recovered'; readonly envelope: RecordingDraftEnvelope }
  | { readonly status: 'expired' }
  | { readonly status: 'unrecoverable'; readonly reason: 'corrupt' | 'unsupported_version' };

/**
 * NEVER GUESSES. A draft from an unknown version is not coerced into today's
 * shape: its answers could mean something else now, so it is reported
 * unrecoverable and nothing is filled in. Version 1 is the one exception, and
 * it is upgraded by an explicit, reviewed rule (`upgradeV1AfterTrade`), not by
 * guessing. Malformed JSON and a shape that no longer validates are reported
 * as corrupt.
 */
export function parseRecordingDraft(raw: string, now: Date): ParsedRecordingDraft {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'unrecoverable', reason: 'corrupt' };
  }
  const version =
    typeof value === 'object' && value !== null && 'version' in value
      ? (value as { version: unknown }).version
      : undefined;
  let envelope: RecordingDraftEnvelope;
  if (version === 1) {
    const parsed = v1EnvelopeSchema.safeParse(value);
    if (!parsed.success) return { status: 'unrecoverable', reason: 'corrupt' };
    envelope = upgradeV1Envelope(parsed.data);
  } else if (version === undefined || version === RECORDING_DRAFT_VERSION) {
    const parsed = envelopeSchema.safeParse(value);
    if (!parsed.success) return { status: 'unrecoverable', reason: 'corrupt' };
    envelope = parsed.data;
  } else {
    return { status: 'unrecoverable', reason: 'unsupported_version' };
  }
  const updated = Date.parse(envelope.updatedAt);
  if (now.getTime() - updated > RECORDING_DRAFT_RETENTION_MS) return { status: 'expired' };
  return { status: 'recovered', envelope };
}

export function serializeRecordingDraft(envelope: RecordingDraftEnvelope): string {
  return JSON.stringify(envelope);
}
