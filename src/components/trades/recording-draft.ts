/**
 * THE ADD TRADE RECORDING DRAFT — one draft across At Entry and After Trade.
 *
 * Add Trade contract §23 and UX Rules §5: Type → Draft · Save → Persist ·
 * Discard → Destroy. This module is the pure model of that one draft; storage
 * lives in `recording-draft-storage.ts` and nothing here renders or touches I/O.
 *
 * ONE ENVELOPE, ONE SECTION PER MODE. A trader who starts At Entry and switches
 * to After Trade still has ONE draft: the At Entry section keeps every At Entry
 * answer (Exit Plan, Target states, condition answers, Actual Risk) as draft
 * data, and the After Trade section holds that form's own state. Only the
 * ACTIVE mode's section is ever turned into a Save payload.
 *
 * WHAT CROSSES MODES: IDENTICAL MEANING ONLY. `SharedRecordingValues` lists the
 * explicit values whose meaning is the same in both current forms. Everything
 * else stays in its own section, never deleted and never activated in the other
 * mode (product decision 2026-09-17: current After Trade cannot represent an
 * Unanswered condition, an Exit Plan, a Target state or an Actual Risk answer
 * without falsifying it — its checklist would save Unanswered as Not Met).
 *
 * DEFAULTS NEVER CROSS. An untouched At Entry entry time ("now") is not a shared
 * value, so After Trade shows Entry time unanswered; the At Entry Matched Actual
 * Risk assumption and an automatically inherited Strategy Exit Plan are not
 * shared values at all (contract §23 Recording mode switch).
 *
 * ONLY WHAT WAS CHANGED CROSSES BACK. After the first switch the envelope
 * remembers the shared values it last handed over. Switching again carries only
 * the shared fields the trader changed since then, so a richer answer the other
 * mode cannot represent — "No Strategy", "No Setup", "None of these" emotions
 * already recorded — is never overwritten by that mode's blank.
 *
 * PROVENANCE IS NOT DECIDED HERE. A mode switch rewrites no capture origin: the
 * origin a Save writes reflects the recording context at Save (UX Rules §5.5),
 * and an untouched default has no observation provenance to carry.
 */
import { z } from 'zod';

import {
  createAfterTradeDraft,
  emptyAfterTradeValues,
  hasAfterTradeWork,
  type AfterTradeDraft,
} from './after-trade-draft';
import { createAtEntryDraft, hasUserWork, type AtEntryDraft } from './at-entry-draft';

export const RECORDING_DRAFT_VERSION = 1;

/**
 * Conservative automatic retention: a draft untouched for 30 days is dropped
 * on the next read. Successful Save, explicit discard and sign-out remain the
 * authoritative cleanup events; this only stops abandoned work from lingering
 * forever on a shared device (contract §23 Draft privacy).
 */
export const RECORDING_DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type RecordingMode = 'at_entry' | 'after_trade';

export interface SharedRecordingValues {
  readonly tradingAccountId: string;
  readonly symbol: string;
  readonly direction: '' | 'long' | 'short';
  /** An explicit entry time only; '' is Unanswered, never "now". */
  readonly enteredAt: string;
  /** A manually entered Risk at Entry (After Trade's Money plan risk). */
  readonly riskAtEntry: string;
  readonly strategyId: string;
  readonly setupId: string;
  readonly confidence: number | null;
  /** `null` Unanswered, `[]` None of these, or the chosen emotions. */
  readonly emotions: readonly string[] | null;
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

export function sharedFromAtEntry(draft: AtEntryDraft): SharedRecordingValues {
  const { classification } = draft;
  const strategyId = classification.strategy === 'selected' ? classification.strategyId : '';
  const setup = strategyId === '' ? undefined : classification.setupByStrategy[strategyId];
  return {
    tradingAccountId: draft.tradingAccountId,
    symbol: draft.symbol,
    direction: draft.direction,
    enteredAt: draft.entryTime.source === 'trader' ? draft.entryTime.value : '',
    riskAtEntry: draft.risk,
    strategyId,
    setupId: setup?.answer === 'selected' ? setup.setupId : '',
    confidence: draft.confidence,
    emotions:
      draft.emotions.answer === 'selected'
        ? draft.emotions.keys
        : draft.emotions.answer === 'none'
          ? []
          : null,
    reason: draft.context.reason,
    tradingviewUrl: draft.context.tradingviewUrl,
    notes: draft.context.notes,
    timeframe: draft.context.timeframe,
    session: draft.context.session,
  };
}

function confidenceFromText(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return [0, 25, 50, 75, 100].includes(parsed) ? parsed : null;
}

export function sharedFromAfterTrade(draft: AfterTradeDraft): SharedRecordingValues {
  const { values } = draft;
  return {
    tradingAccountId: values.tradingAccountId,
    symbol: values.symbol,
    direction: values.direction,
    enteredAt: values.enteredAt,
    riskAtEntry: draft.planBasis === 'money' ? values.plannedRisk : '',
    strategyId: values.strategyId,
    setupId: values.strategyId === '' ? '' : values.setupId,
    confidence: confidenceFromText(values.confidence),
    emotions: draft.emotions,
    reason: values.confirmationNotes,
    tradingviewUrl: values.tradingviewUrl,
    notes: values.notes,
    timeframe: values.timeframe,
    session: values.session,
  };
}

type SharedField = keyof SharedRecordingValues;
const SHARED_FIELDS: readonly SharedField[] = [
  'tradingAccountId',
  'symbol',
  'direction',
  'enteredAt',
  'riskAtEntry',
  'strategyId',
  'setupId',
  'confidence',
  'emotions',
  'reason',
  'tradingviewUrl',
  'notes',
  'timeframe',
  'session',
];

function sameValue(a: SharedRecordingValues[SharedField], b: SharedRecordingValues[SharedField]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Which shared fields a switch carries: every answered one the first time, then only changed ones. */
function fieldsToCarry(
  source: SharedRecordingValues,
  lastCarried: SharedRecordingValues | null,
): readonly SharedField[] {
  if (lastCarried === null) {
    return SHARED_FIELDS.filter((field) => {
      const value = source[field];
      return value !== '' && value !== null;
    });
  }
  return SHARED_FIELDS.filter((field) => !sameValue(source[field], lastCarried[field]));
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
  if (has('strategyId') || has('setupId')) {
    const { classification } = next;
    if (shared.strategyId === '') {
      if (has('strategyId')) {
        next = { ...next, classification: { ...classification, strategy: 'unanswered' } };
      }
    } else {
      const previous = classification.setupByStrategy[shared.strategyId];
      next = {
        ...next,
        classification: {
          ...classification,
          strategy: 'selected',
          strategyId: shared.strategyId,
          setupByStrategy: has('setupId')
            ? {
                ...classification.setupByStrategy,
                [shared.strategyId]:
                  shared.setupId === ''
                    ? { answer: 'unanswered', setupId: previous?.setupId ?? '' }
                    : { answer: 'selected', setupId: shared.setupId },
              }
            : classification.setupByStrategy,
        },
      };
    }
  }
  if (has('confidence')) next = { ...next, confidence: shared.confidence };
  if (has('emotions')) {
    next = {
      ...next,
      emotions:
        shared.emotions === null
          ? { answer: 'unanswered', keys: next.emotions.keys }
          : shared.emotions.length === 0
            ? { answer: 'none', keys: next.emotions.keys }
            : { answer: 'selected', keys: shared.emotions },
    };
  }
  const context = { ...next.context };
  if (has('reason')) context.reason = shared.reason;
  if (has('tradingviewUrl')) context.tradingviewUrl = shared.tradingviewUrl;
  if (has('notes')) context.notes = shared.notes;
  if (has('timeframe')) context.timeframe = shared.timeframe;
  if (has('session')) context.session = shared.session;
  return { ...next, context };
}

export function applySharedToAfterTrade(
  draft: AfterTradeDraft,
  shared: SharedRecordingValues,
  fields: readonly SharedField[],
): AfterTradeDraft {
  const has = (field: SharedField) => fields.includes(field);
  const values = { ...draft.values };
  if (has('tradingAccountId')) values.tradingAccountId = shared.tradingAccountId;
  if (has('symbol')) values.symbol = shared.symbol;
  if (has('direction')) values.direction = shared.direction;
  if (has('enteredAt')) values.enteredAt = shared.enteredAt;
  // Risk at Entry is After Trade's Money plan risk. The plan basis is the
  // trader's own choice and is never switched to make the value active.
  if (has('riskAtEntry')) values.plannedRisk = shared.riskAtEntry;
  if (has('strategyId')) values.strategyId = shared.strategyId;
  if (has('setupId') || has('strategyId')) values.setupId = shared.setupId;
  if (has('confidence')) {
    values.confidence = shared.confidence === null ? '' : String(shared.confidence);
  }
  if (has('reason')) values.confirmationNotes = shared.reason;
  if (has('tradingviewUrl')) values.tradingviewUrl = shared.tradingviewUrl;
  if (has('notes')) values.notes = shared.notes;
  if (has('timeframe')) values.timeframe = shared.timeframe;
  if (has('session')) values.session = shared.session;
  return {
    ...draft,
    values,
    emotions: has('emotions') ? shared.emotions : draft.emotions,
  };
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
      hasAfterTradeWork(envelope.afterTrade, emptyAfterTradeValues(defaultTradingAccountId)))
  );
}

/** A short, trader-recognisable label for what a draft holds — used to name what sign-out would remove. */
export function recordingDraftSymbol(envelope: RecordingDraftEnvelope): string | null {
  const symbol =
    envelope.activeMode === 'at_entry'
      ? envelope.atEntry?.symbol
      : envelope.afterTrade?.values.symbol;
  const trimmed = symbol?.trim().toUpperCase() ?? '';
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Persisted shape
// ---------------------------------------------------------------------------

const text = z.string().max(20_000);
const direction = z.enum(['', 'long', 'short']);

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
  target: z.object({
    state: z.enum(['unanswered', 'fixed', 'no_fixed']),
    profit: text,
    price: text,
  }),
  exitPlan: z.object({
    choice: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('inherit') }),
      z.object({ kind: z.literal('unanswered') }),
      z.object({ kind: z.literal('saved'), exitPlanId: text }),
      z.object({ kind: z.literal('customized') }),
      z.object({ kind: z.literal('no_rule') }),
    ]),
    customText: text,
    customBaseId: text.nullable(),
  }),
  classification: z.object({
    strategy: z.enum(['unanswered', 'none', 'selected']),
    strategyId: text,
    setupByStrategy: z.record(
      text,
      z.object({ answer: z.enum(['unanswered', 'none', 'selected']), setupId: text }),
    ),
    conditions: z.record(text, z.record(text, z.record(text, z.enum(['met', 'not_met'])))),
  }),
  confidence: z.number().int().nullable(),
  emotions: z.object({ answer: z.enum(['unanswered', 'none', 'selected']), keys: z.array(text) }),
  context: z.object({
    entryPrice: text,
    stopPrice: text,
    positionSize: text,
    timeframe: text,
    session: text,
    reason: text,
    tradingviewUrl: text,
    notes: text,
  }),
}) satisfies z.ZodType<AtEntryDraft>;

const afterTradeSchema = z.object({
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
}) satisfies z.ZodType<AfterTradeDraft>;

const sharedSchema = z.object({
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

export type ParsedRecordingDraft =
  | { readonly status: 'recovered'; readonly envelope: RecordingDraftEnvelope }
  | { readonly status: 'expired' }
  | { readonly status: 'unrecoverable'; readonly reason: 'corrupt' | 'unsupported_version' };

/**
 * NEVER GUESSES. A draft from another version is not migrated field by field
 * or coerced into today's shape: its answers could mean something else now, so
 * it is reported unrecoverable and nothing is filled in. Malformed JSON and a
 * shape that no longer validates are reported the same way.
 */
export function parseRecordingDraft(raw: string, now: Date): ParsedRecordingDraft {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: 'unrecoverable', reason: 'corrupt' };
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    (value as { version: unknown }).version !== RECORDING_DRAFT_VERSION
  ) {
    return { status: 'unrecoverable', reason: 'unsupported_version' };
  }
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) return { status: 'unrecoverable', reason: 'corrupt' };
  const updated = Date.parse(parsed.data.updatedAt);
  if (now.getTime() - updated > RECORDING_DRAFT_RETENTION_MS) return { status: 'expired' };
  return { status: 'recovered', envelope: parsed.data };
}

export function serializeRecordingDraft(envelope: RecordingDraftEnvelope): string {
  return JSON.stringify(envelope);
}
