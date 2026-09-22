/**
 * AT ENTRY DRAFT — the pure state model behind "Record an open trade".
 *
 * Add Trade contract v1 (docs/product-contracts/add-trade.md) and UX Rules
 * (docs/UX_RULES.md) decide what each answer means; this module decides how a
 * draft holds those answers while the trader works, and nothing here renders.
 *
 * FOUR RULES SHAPE EVERY FUNCTION BELOW.
 *
 * 1. UNANSWERED, NONE AND A SELECTION ARE DIFFERENT ANSWERS. Target, Exit Plan,
 *    Strategy, Setup, each condition, Confidence and Emotions each keep an
 *    explicit Unanswered, and the only way back to it is a named "remove
 *    answer" transition — never a side effect of another control.
 * 2. DRAFT PRESERVATION PRESERVES USER WORK, NOT SYSTEM ASSUMPTIONS. A value
 *    the trader typed survives while its question is inactive: an Actual Risk
 *    amount through Matched, Target values through No Fixed Target, custom
 *    Exit Plan text through another choice, and Setup/condition answers
 *    through a different Strategy. A default (entry time "now", Matched Actual
 *    Risk, an inherited Exit Plan) stays visibly a default until it is changed.
 * 3. BROWSING IS STATE-NEUTRAL. The Exit Plan editor works on a session; only a
 *    real change commits, and Discard always restores what was there.
 * 4. READY MEANS NO BLOCKING ERRORS. Readiness is derived from the one error set
 *    Save uses, so the two can never disagree.
 */
import Decimal from 'decimal.js';
import type { z } from 'zod';

import { isCanonicalEmotionKey } from '@/config/emotions';
import type { PlannedStopMethod } from '@/lib/trades/add-trade-contract';
import type { CreateTradeSchema } from '@/lib/trades/schemas';
import { isValidTradingViewUrl } from '@/lib/trades/validation';
import type {
  TradeCreateExitPlanOption,
  TradeCreateOptions,
  TradeCreateSetupOption,
  TradeCreateStrategyOption,
} from '@/server/dal/trades';

import { hasStaleSelection, staleSelections } from './stale-selection';
import { datetimeLocalToIso, parseTradeMoneyInput } from './trade-form-values';

export type Direction = '' | 'long' | 'short';
export type ConditionStatus = 'met' | 'not_met';

/** The entry time follows the clock until the trader edits, confirms or clears it. */
export interface EntryTimeDraft {
  readonly source: 'default_now' | 'trader' | 'cleared';
  /** A `datetime-local` wall clock in the trader's zone; '' until known. */
  readonly value: string;
}

/**
 * WHAT THE TRADER SAID ABOUT THE RISK THEY ACTUALLY CARRIED.
 *
 * `unanswered` is the default, and it is a state of its own: nobody has said
 * whether the risk taken matched Risk at Entry. It is NOT `matched` — an
 * unanswered observation is never a positive one (Add Trade contract §2, §8),
 * and a Save from this state records no answer at all rather than a match the
 * trader never stated. `matched` is reached only by saying so.
 */
export type ActualRiskMode = 'unanswered' | 'matched' | 'different' | 'different_unknown';

export interface ActualRiskDraft {
  readonly mode: ActualRiskMode;
  /** Kept while another answer is chosen, so switching back restores it. */
  readonly amount: string;
}

/**
 * How the trader planned to protect the Trade, as the draft holds it:
 * `unanswered` until they say, then one of the canonical methods. Unanswered
 * is never `no_stop` (contract §2, §8, decision 53).
 */
export type StopMethodDraft = 'unanswered' | PlannedStopMethod;

export interface TargetDraft {
  readonly state: 'unanswered' | 'fixed' | 'no_fixed';
  /** Kept while the Target is not Fixed; sent only for a Fixed Target. */
  readonly profit: string;
  readonly price: string;
}

/**
 * The trader's Exit Plan choice. `inherit` follows the selected Strategy's
 * default when it has one and is Not recorded when it has none; `unanswered`
 * is an explicit removal that also declines any inheritance.
 */
export type ExitPlanChoice =
  | { readonly kind: 'inherit' }
  | { readonly kind: 'unanswered' }
  | { readonly kind: 'saved'; readonly exitPlanId: string }
  | { readonly kind: 'customized' }
  | { readonly kind: 'no_rule' };

export interface ExitPlanDraft {
  readonly choice: ExitPlanChoice;
  /** The trader's own wording, kept through any other choice. */
  readonly customText: string;
  /** The library plan the custom wording started from, as provenance. */
  readonly customBaseId: string | null;
}

export type AnswerState = 'unanswered' | 'none' | 'selected';

export interface ClassificationDraft {
  readonly strategy: AnswerState;
  readonly strategyId: string;
  /** Setup answer per Strategy, so returning to a Strategy restores it. */
  readonly setupByStrategy: Readonly<
    Record<string, { readonly answer: AnswerState; readonly setupId: string }>
  >;
  /** Condition answers per Strategy and Setup; an absent key is Unanswered. */
  readonly conditions: Readonly<
    Record<string, Readonly<Record<string, Readonly<Record<string, ConditionStatus>>>>>
  >;
}

export interface EmotionsDraft {
  readonly answer: AnswerState;
  readonly keys: readonly string[];
}

export interface ContextDraft {
  readonly entryPrice: string;
  readonly stopPrice: string;
  readonly positionSize: string;
  readonly timeframe: string;
  readonly session: string;
  readonly reason: string;
  readonly tradingviewUrl: string;
  readonly notes: string;
}

export interface AtEntryDraft {
  readonly tradingAccountId: string;
  readonly symbol: string;
  readonly direction: Direction;
  readonly entryTime: EntryTimeDraft;
  readonly risk: string;
  /** Plan & Risk's second plan answer: how the stop was to be held. */
  readonly stopMethod: StopMethodDraft;
  readonly actualRisk: ActualRiskDraft;
  readonly target: TargetDraft;
  readonly exitPlan: ExitPlanDraft;
  readonly classification: ClassificationDraft;
  readonly confidence: number | null;
  readonly emotions: EmotionsDraft;
  readonly context: ContextDraft;
}

export function createAtEntryDraft(tradingAccountId: string): AtEntryDraft {
  return {
    tradingAccountId,
    symbol: '',
    direction: '',
    entryTime: { source: 'default_now', value: '' },
    risk: '',
    stopMethod: 'unanswered',
    actualRisk: { mode: 'unanswered', amount: '' },
    target: { state: 'unanswered', profit: '', price: '' },
    exitPlan: { choice: { kind: 'inherit' }, customText: '', customBaseId: null },
    classification: { strategy: 'unanswered', strategyId: '', setupByStrategy: {}, conditions: {} },
    confidence: null,
    emotions: { answer: 'unanswered', keys: [] },
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
// Entry time
// ---------------------------------------------------------------------------

/** Keeps a still-defaulted entry time on the clock; a trader's time never moves. */
export function followClock(draft: AtEntryDraft, nowLocal: string): AtEntryDraft {
  if (draft.entryTime.source !== 'default_now' || draft.entryTime.value === nowLocal) return draft;
  return { ...draft, entryTime: { source: 'default_now', value: nowLocal } };
}

export function editEntryTime(draft: AtEntryDraft, value: string): AtEntryDraft {
  return { ...draft, entryTime: { source: 'trader', value } };
}

/** "Keep this time" — the default becomes the trader's answer without changing. */
export function confirmEntryTime(draft: AtEntryDraft): AtEntryDraft {
  if (draft.entryTime.source !== 'default_now' || draft.entryTime.value === '') return draft;
  return { ...draft, entryTime: { source: 'trader', value: draft.entryTime.value } };
}

export function clearEntryTime(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, entryTime: { source: 'cleared', value: '' } };
}

export function resetEntryTimeToNow(draft: AtEntryDraft, nowLocal: string): AtEntryDraft {
  return { ...draft, entryTime: { source: 'default_now', value: nowLocal } };
}

// ---------------------------------------------------------------------------
// Actual Risk and Target
// ---------------------------------------------------------------------------

export function setStopMethod(draft: AtEntryDraft, stopMethod: StopMethodDraft): AtEntryDraft {
  return { ...draft, stopMethod };
}

export function setActualRiskMode(draft: AtEntryDraft, mode: ActualRiskMode): AtEntryDraft {
  return { ...draft, actualRisk: { ...draft.actualRisk, mode } };
}

export function setActualRiskAmount(draft: AtEntryDraft, amount: string): AtEntryDraft {
  return { ...draft, actualRisk: { mode: 'different', amount } };
}

export function setTargetState(draft: AtEntryDraft, state: TargetDraft['state']): AtEntryDraft {
  return { ...draft, target: { ...draft.target, state } };
}

/** Typing a Target value answers the question as a Fixed Target. */
export function setTargetValue(
  draft: AtEntryDraft,
  field: 'profit' | 'price',
  value: string,
): AtEntryDraft {
  return { ...draft, target: { ...draft.target, [field]: value, state: 'fixed' } };
}

// ---------------------------------------------------------------------------
// Strategy, Setup and conditions
// ---------------------------------------------------------------------------

export function selectStrategy(draft: AtEntryDraft, strategyId: string): AtEntryDraft {
  return {
    ...draft,
    classification: { ...draft.classification, strategy: 'selected', strategyId },
  };
}

export function answerNoStrategy(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, classification: { ...draft.classification, strategy: 'none' } };
}

export function removeStrategyAnswer(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, classification: { ...draft.classification, strategy: 'unanswered' } };
}

function withSetup(
  draft: AtEntryDraft,
  setup: { readonly answer: AnswerState; readonly setupId: string },
): AtEntryDraft {
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

export function selectSetup(draft: AtEntryDraft, setupId: string): AtEntryDraft {
  return withSetup(draft, { answer: 'selected', setupId });
}

export function answerNoSetup(draft: AtEntryDraft): AtEntryDraft {
  const current = currentSetupAnswer(draft);
  return withSetup(draft, { answer: 'none', setupId: current.setupId });
}

export function removeSetupAnswer(draft: AtEntryDraft): AtEntryDraft {
  const current = currentSetupAnswer(draft);
  return withSetup(draft, { answer: 'unanswered', setupId: current.setupId });
}

export function currentSetupAnswer(draft: AtEntryDraft): {
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

/** Answers one condition of the current Setup; `null` is "Remove answer". */
export function answerCondition(
  draft: AtEntryDraft,
  conditionKey: string,
  status: ConditionStatus | null,
): AtEntryDraft {
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

export interface ActiveClassification {
  readonly strategy: TradeCreateStrategyOption | null;
  readonly setup: TradeCreateSetupOption | null;
  readonly setupAnswer: AnswerState;
  /** Answers for the current Setup's conditions only; stale keys never leak out. */
  readonly conditionAnswers: Readonly<Record<string, ConditionStatus>>;
}

export function activeClassification(
  draft: AtEntryDraft,
  options: Pick<TradeCreateOptions, 'strategies'>,
): ActiveClassification {
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
  const conditionAnswers: Record<string, ConditionStatus> = {};
  for (const condition of setup?.conditions ?? []) {
    const status = stored[condition.conditionKey];
    if (status !== undefined) conditionAnswers[condition.conditionKey] = status;
  }
  return {
    strategy,
    setup,
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
// Confidence and Emotions
// ---------------------------------------------------------------------------

export function setConfidence(draft: AtEntryDraft, confidence: number | null): AtEntryDraft {
  return { ...draft, confidence };
}

/**
 * Removing the LAST selected emotion is refused: it would silently turn "I
 * felt X" into Unanswered or None. The trader chooses "None of these" or
 * "Remove answer" instead.
 */
export function canDeselectEmotion(draft: AtEntryDraft, key: string): boolean {
  return !(
    draft.emotions.answer === 'selected' &&
    draft.emotions.keys.length === 1 &&
    draft.emotions.keys[0] === key
  );
}

export function toggleEmotion(draft: AtEntryDraft, key: string): AtEntryDraft {
  const selected = draft.emotions.answer === 'selected' ? draft.emotions.keys : [];
  if (selected.includes(key)) {
    if (!canDeselectEmotion(draft, key)) return draft;
    return {
      ...draft,
      emotions: { answer: 'selected', keys: selected.filter((item) => item !== key) },
    };
  }
  return { ...draft, emotions: { answer: 'selected', keys: [...selected, key] } };
}

export function answerNoEmotions(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, emotions: { answer: 'none', keys: [] } };
}

export function removeEmotionsAnswer(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, emotions: { answer: 'unanswered', keys: [] } };
}

// ---------------------------------------------------------------------------
// Exit Plan
// ---------------------------------------------------------------------------

export type ResolvedExitPlan =
  | { readonly status: 'not_recorded' }
  | { readonly status: 'inherited'; readonly plan: TradeCreateExitPlanOption }
  | { readonly status: 'saved'; readonly plan: TradeCreateExitPlanOption }
  | {
      readonly status: 'customized';
      readonly base: TradeCreateExitPlanOption | null;
      readonly instructions: string;
    }
  | { readonly status: 'no_rule' }
  /**
   * A saved plan the trader chose that is no longer in the library (archived
   * or removed). The answer is kept, never read as Not recorded; Save waits
   * until the trader chooses another plan or removes the answer.
   */
  | { readonly status: 'unavailable'; readonly exitPlanId: string };

export interface ExitPlanResolution {
  readonly resolved: ResolvedExitPlan;
  /** The selected Strategy's default plan, whether or not it applies now. */
  readonly strategyDefault: TradeCreateExitPlanOption | null;
  /** A default exists and the trader's answer is something else. */
  readonly inheritanceDeclined: boolean;
}

export function strategyDefaultExitPlan(
  draft: AtEntryDraft,
  options: Pick<TradeCreateOptions, 'exitPlans'>,
): TradeCreateExitPlanOption | null {
  const { classification } = draft;
  if (classification.strategy !== 'selected') return null;
  return options.exitPlans.find((plan) => plan.strategyId === classification.strategyId) ?? null;
}

export function resolveExitPlan(
  draft: AtEntryDraft,
  options: Pick<TradeCreateOptions, 'exitPlans'>,
): ExitPlanResolution {
  const strategyDefault = strategyDefaultExitPlan(draft, options);
  const { choice } = draft.exitPlan;
  const planById = (id: string | null) =>
    id === null ? null : (options.exitPlans.find((plan) => plan.exitPlanId === id) ?? null);
  let resolved: ResolvedExitPlan;
  switch (choice.kind) {
    case 'inherit':
      resolved =
        strategyDefault === null
          ? { status: 'not_recorded' }
          : { status: 'inherited', plan: strategyDefault };
      break;
    case 'unanswered':
      resolved = { status: 'not_recorded' };
      break;
    case 'saved': {
      const plan = planById(choice.exitPlanId);
      resolved =
        plan === null
          ? { status: 'unavailable', exitPlanId: choice.exitPlanId }
          : { status: 'saved', plan };
      break;
    }
    case 'customized':
      resolved = {
        status: 'customized',
        base: planById(draft.exitPlan.customBaseId),
        instructions: draft.exitPlan.customText,
      };
      break;
    case 'no_rule':
      resolved = { status: 'no_rule' };
      break;
  }
  return {
    resolved,
    strategyDefault,
    inheritanceDeclined: strategyDefault !== null && resolved.status !== 'inherited',
  };
}

/** Choosing the plan inheritance already supplies is the inheritance, not a new override. */
export function chooseSavedExitPlan(
  draft: AtEntryDraft,
  exitPlanId: string,
  options: Pick<TradeCreateOptions, 'exitPlans'>,
): AtEntryDraft {
  const strategyDefault = strategyDefaultExitPlan(draft, options);
  const choice: ExitPlanChoice =
    strategyDefault?.exitPlanId === exitPlanId
      ? { kind: 'inherit' }
      : { kind: 'saved', exitPlanId };
  return { ...draft, exitPlan: { ...draft.exitPlan, choice } };
}

export function chooseNoExitRule(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, exitPlan: { ...draft.exitPlan, choice: { kind: 'no_rule' } } };
}

/** "Use strategy default" — restores inheritance after any override. */
export function restoreStrategyDefault(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, exitPlan: { ...draft.exitPlan, choice: { kind: 'inherit' } } };
}

/** "Remove answer" — Not recorded, which also declines an available default. */
export function removeExitPlanAnswer(draft: AtEntryDraft): AtEntryDraft {
  return { ...draft, exitPlan: { ...draft.exitPlan, choice: { kind: 'unanswered' } } };
}

/** Returns to the trader's preserved custom wording. */
export function chooseCustomExitPlan(draft: AtEntryDraft): AtEntryDraft {
  if (draft.exitPlan.customText.trim() === '') return draft;
  return { ...draft, exitPlan: { ...draft.exitPlan, choice: { kind: 'customized' } } };
}

/**
 * Commits text from the Customize view. Wording identical to the plan it
 * started from is that plan, not a customization; blank wording changes nothing.
 */
export function commitCustomExitPlanText(
  draft: AtEntryDraft,
  text: string,
  baseExitPlanId: string | null,
  options: Pick<TradeCreateOptions, 'exitPlans'>,
): AtEntryDraft {
  const trimmed = text.trim();
  if (trimmed === '') return draft;
  const base =
    baseExitPlanId === null
      ? null
      : (options.exitPlans.find((plan) => plan.exitPlanId === baseExitPlanId) ?? null);
  if (base !== null && base.instructions.trim() === trimmed) {
    const next = chooseSavedExitPlan(draft, base.exitPlanId, options);
    return exitPlanChoicesEqual(next.exitPlan.choice, draft.exitPlan.choice) ? draft : next;
  }
  return {
    ...draft,
    exitPlan: {
      choice: { kind: 'customized' },
      customText: text,
      customBaseId: base?.exitPlanId ?? null,
    },
  };
}

export function exitPlanChoicesEqual(a: ExitPlanChoice, b: ExitPlanChoice): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind !== 'saved' || a.exitPlanId === (b as { exitPlanId: string }).exitPlanId;
}

/**
 * THE EXIT PLAN EDITOR SESSION. Opening, browsing "Choose another" or
 * "Customize", and closing without a change leave the draft exactly as it was.
 */
export interface ExitPlanEditorSession {
  readonly original: AtEntryDraft;
  readonly working: AtEntryDraft;
  readonly view: 'overview' | 'choose' | 'customize';
}

export function openExitPlanEditor(draft: AtEntryDraft): ExitPlanEditorSession {
  return { original: draft, working: draft, view: 'overview' };
}

export function setExitPlanEditorView(
  session: ExitPlanEditorSession,
  view: ExitPlanEditorSession['view'],
): ExitPlanEditorSession {
  return { ...session, view };
}

export function updateExitPlanEditor(
  session: ExitPlanEditorSession,
  change: (draft: AtEntryDraft) => AtEntryDraft,
): ExitPlanEditorSession {
  return { ...session, working: change(session.working) };
}

export function exitPlanEditorHasChange(session: ExitPlanEditorSession): boolean {
  const before = session.original.exitPlan;
  const after = session.working.exitPlan;
  return (
    !exitPlanChoicesEqual(before.choice, after.choice) ||
    before.customText !== after.customText ||
    before.customBaseId !== after.customBaseId
  );
}

/**
 * Done, X, Escape and an outside click all keep a real change — routine
 * navigation is non-destructive — and return the untouched draft otherwise.
 * Only Discard throws a change away.
 */
export function closeExitPlanEditor(
  session: ExitPlanEditorSession,
  intent: 'keep' | 'discard',
): AtEntryDraft {
  if (intent === 'discard' || !exitPlanEditorHasChange(session)) return session.original;
  return { ...session.original, exitPlan: session.working.exitPlan };
}

// ---------------------------------------------------------------------------
// Validation, readiness and the Save payload
// ---------------------------------------------------------------------------

export const AT_ENTRY_FIELD_ORDER = [
  'tradingAccountId',
  'symbol',
  'direction',
  'risk',
  'actualRiskAmount',
  'enteredAt',
  'targetProfit',
  'targetPrice',
  'contextEntryPrice',
  'contextStopPrice',
  'contextPositionSize',
  'tradingviewUrl',
] as const;
export type AtEntryField = (typeof AT_ENTRY_FIELD_ORDER)[number];

export type AtEntrySection = 'trade' | 'target' | 'context';

export const AT_ENTRY_FIELD_SECTION: Readonly<Record<AtEntryField, AtEntrySection>> = {
  tradingAccountId: 'trade',
  symbol: 'trade',
  direction: 'trade',
  risk: 'trade',
  actualRiskAmount: 'trade',
  enteredAt: 'trade',
  targetProfit: 'target',
  targetPrice: 'target',
  contextEntryPrice: 'context',
  contextStopPrice: 'context',
  contextPositionSize: 'context',
  tradingviewUrl: 'context',
};

export type AtEntryErrorCode =
  | 'required'
  | 'invalid_money'
  | 'must_be_positive'
  | 'invalid_datetime'
  | 'invalid_price'
  | 'fixed_target_requires_value'
  | 'actual_risk_equals_risk_at_entry'
  /** The server's own chart-link rule, checked before Save rather than after it. */
  | 'invalid_tradingview_url'
  /** Server-side only: a field the server refused that no specific code describes. */
  | 'not_accepted';

export type AtEntryNotice = 'stop_wrong_side' | 'target_wrong_side';

export type AtEntryErrors = Partial<Record<AtEntryField, AtEntryErrorCode>>;

export type CreateTradePayload = z.input<typeof CreateTradeSchema>;

export interface AtEntryValidation {
  readonly errors: AtEntryErrors;
  readonly notices: readonly AtEntryNotice[];
  /** The parsed Risk at Entry in minor units, when valid — gates the Matched assumption. */
  readonly riskMinor: string | null;
}

const POSITIVE_DECIMAL = /^\d+(\.\d+)?$/;

function parsePositiveDecimal(input: string): Decimal | 'invalid' | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!POSITIVE_DECIMAL.test(trimmed)) return 'invalid';
  const value = new Decimal(trimmed);
  return value.greaterThan(0) ? value : 'invalid';
}

function moneyError(code: string): AtEntryErrorCode {
  return code === 'zero_not_allowed' || code === 'negative_not_allowed'
    ? 'must_be_positive'
    : 'invalid_money';
}

export function validateAtEntryDraft(
  draft: AtEntryDraft,
  context: { readonly currency: string; readonly timezone: string },
): AtEntryValidation {
  const errors: AtEntryErrors = {};
  if (draft.tradingAccountId === '') errors.tradingAccountId = 'required';
  if (draft.symbol.trim() === '') errors.symbol = 'required';
  if (draft.direction === '') errors.direction = 'required';

  let riskMinor: string | null = null;
  if (draft.risk.trim() === '') errors.risk = 'required';
  else {
    const risk = parseTradeMoneyInput(draft.risk, context.currency);
    if (risk.ok) riskMinor = risk.value;
    else errors.risk = moneyError(risk.code);
  }

  if (draft.actualRisk.mode === 'different') {
    if (draft.actualRisk.amount.trim() === '') errors.actualRiskAmount = 'required';
    else {
      const amount = parseTradeMoneyInput(draft.actualRisk.amount, context.currency);
      if (!amount.ok) errors.actualRiskAmount = moneyError(amount.code);
      // Blocking, never rewritten to Matched: the trader said Actual Risk
      // differed, so the same amount is a contradiction for them to resolve.
      else if (riskMinor !== null && amount.value === riskMinor) {
        errors.actualRiskAmount = 'actual_risk_equals_risk_at_entry';
      }
    }
  }

  if (draft.entryTime.source !== 'cleared' && draft.entryTime.value !== '') {
    if (!datetimeLocalToIso(draft.entryTime.value, context.timezone).ok) {
      errors.enteredAt = 'invalid_datetime';
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
    // The missing representation is the Target Profit the trader can fill in;
    // it is never attached to "No fixed target".
    if (profitBlank && priceBlank) errors.targetProfit = 'fixed_target_requires_value';
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

  const notices: AtEntryNotice[] = [];
  const targetPrice =
    draft.target.state === 'fixed' ? parsePositiveDecimal(draft.target.price) : null;
  if (entry instanceof Decimal && draft.direction !== '') {
    const long = draft.direction === 'long';
    if (stop instanceof Decimal && (long ? stop.gte(entry) : stop.lte(entry))) {
      notices.push('stop_wrong_side');
    }
    if (
      targetPrice instanceof Decimal &&
      (long ? targetPrice.lte(entry) : targetPrice.gte(entry))
    ) {
      notices.push('target_wrong_side');
    }
  }

  return { errors, notices, riskMinor };
}

export function orderedErrorFields(errors: AtEntryErrors): readonly AtEntryField[] {
  return AT_ENTRY_FIELD_ORDER.filter((field) => errors[field] !== undefined);
}

export function sectionErrorCount(errors: AtEntryErrors, section: AtEntrySection): number {
  return orderedErrorFields(errors).filter((field) => AT_ENTRY_FIELD_SECTION[field] === section)
    .length;
}

export type AtEntryReadiness =
  | { readonly status: 'ready' }
  | {
      readonly status: 'blocked';
      readonly count: number;
      readonly fields: readonly AtEntryField[];
    };

/** Ready only when the error set Save itself uses is empty. */
export function atEntryReadiness(validation: AtEntryValidation): AtEntryReadiness {
  const fields = orderedErrorFields(validation.errors);
  return fields.length === 0
    ? { status: 'ready' }
    : { status: 'blocked', count: fields.length, fields };
}

export interface AnalysisSummary {
  readonly strategy: { readonly answer: AnswerState; readonly name: string | null };
  readonly setup: { readonly answer: AnswerState; readonly name: string | null };
  /** `null` when no Setup with conditions is selected. */
  readonly conditions: {
    readonly total: number;
    readonly answered: number;
    readonly met: number;
  } | null;
  readonly confidence: number | null;
  readonly emotions: { readonly answer: AnswerState; readonly count: number };
  /** How many of the analytical questions have an answer of any kind. */
  readonly answeredCount: number;
  readonly questionCount: number;
}

export function analysisSummary(
  draft: AtEntryDraft,
  options: Pick<TradeCreateOptions, 'strategies'>,
): AnalysisSummary {
  const active = activeClassification(draft, options);
  const strategyAnswer: AnswerState =
    draft.classification.strategy === 'selected' && active.strategy === null
      ? 'unanswered'
      : draft.classification.strategy;
  const conditionTotal = active.setup?.conditions.length ?? 0;
  const answeredConditions = Object.values(active.conditionAnswers);
  const conditions =
    active.setup === null || conditionTotal === 0
      ? null
      : {
          total: conditionTotal,
          answered: answeredConditions.length,
          met: answeredConditions.filter((status) => status === 'met').length,
        };
  const answers = [
    strategyAnswer !== 'unanswered',
    draft.confidence !== null,
    draft.emotions.answer !== 'unanswered',
  ];
  return {
    strategy: { answer: strategyAnswer, name: active.strategy?.name ?? null },
    setup: { answer: active.setupAnswer, name: active.setup?.name ?? null },
    conditions,
    confidence: draft.confidence,
    emotions: { answer: draft.emotions.answer, count: draft.emotions.keys.length },
    answeredCount: answers.filter(Boolean).length,
    questionCount: answers.length,
  };
}

/**
 * Whether the trader has done any work a mode switch or navigation would lose.
 * Defaults (entry time now, Matched Actual Risk, an inherited Exit Plan) are
 * not work.
 */
export function hasUserWork(draft: AtEntryDraft, pristine: AtEntryDraft): boolean {
  const { entryTime, actualRisk, exitPlan, ...rest } = draft;
  const { entryTime: _t, actualRisk: _a, exitPlan: _e, ...pristineRest } = pristine;
  return (
    entryTime.source !== 'default_now' ||
    draft.stopMethod !== 'unanswered' ||
    actualRisk.mode !== 'unanswered' ||
    actualRisk.amount !== '' ||
    exitPlan.choice.kind !== 'inherit' ||
    exitPlan.customText !== '' ||
    JSON.stringify(rest) !== JSON.stringify(pristineRest)
  );
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The contract At Entry write. Returns `null` while any blocking error exists,
 * so a payload can never be built from a draft that is not ready.
 */
export function buildAtEntryPayload(
  draft: AtEntryDraft,
  context: {
    readonly currency: string;
    readonly timezone: string;
    readonly mutationKey: string;
    readonly options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  },
): CreateTradePayload | null {
  const validation = validateAtEntryDraft(draft, context);
  if (atEntryReadiness(validation).status !== 'ready' || validation.riskMinor === null) return null;
  // A chosen answer whose source went away is resolved by the trader, never dropped.
  if (hasStaleSelection(staleSelections(draft, context.options))) return null;
  if (draft.direction === '') return null;

  const active = activeClassification(draft, context.options);
  const exitPlan = resolveExitPlan(draft, context.options);
  const entered =
    draft.entryTime.source === 'cleared' || draft.entryTime.value === ''
      ? null
      : datetimeLocalToIso(draft.entryTime.value, context.timezone);
  const actualRiskAmount =
    draft.actualRisk.mode === 'different'
      ? parseTradeMoneyInput(draft.actualRisk.amount, context.currency)
      : null;
  const targetProfit =
    draft.target.state === 'fixed' && draft.target.profit.trim() !== ''
      ? parseTradeMoneyInput(draft.target.profit, context.currency)
      : null;

  const payload: CreateTradePayload = {
    mutationKey: context.mutationKey,
    tradingAccountId: draft.tradingAccountId,
    recordingTiming: 'at_entry',
    recordingContract: 'add_trade_v1',
    systemPlanBasis: 'money',
    symbol: draft.symbol.trim().toUpperCase(),
    direction: draft.direction,
    plannedRiskMinor: validation.riskMinor,
    ...(draft.actualRisk.mode === 'unanswered'
      ? {}
      : { actualRiskAnswer: draft.actualRisk.mode === 'matched' ? 'matched' : 'different' }),
    ...(actualRiskAmount?.ok ? { actualInitialRiskMinor: actualRiskAmount.value } : {}),
    ...(entered?.ok
      ? {
          enteredAt: entered.value,
          enteredAtSource: draft.entryTime.source === 'trader' ? 'trader' : 'default_now',
        }
      : {}),
    ...(draft.stopMethod === 'unanswered' ? {} : { plannedStopMethod: draft.stopMethod }),
    ...(draft.target.state === 'unanswered' ? {} : { targetState: draft.target.state }),
    ...(targetProfit?.ok ? { plannedRewardMinor: targetProfit.value } : {}),
    ...(draft.target.state === 'fixed' && trimmedOrUndefined(draft.target.price) !== undefined
      ? { targetPrice: draft.target.price.trim() }
      : {}),
    ...(trimmedOrUndefined(draft.context.entryPrice) === undefined
      ? {}
      : { contextEntryPrice: draft.context.entryPrice.trim() }),
    ...(trimmedOrUndefined(draft.context.stopPrice) === undefined
      ? {}
      : { contextStopPrice: draft.context.stopPrice.trim() }),
    ...(trimmedOrUndefined(draft.context.positionSize) === undefined
      ? {}
      : { contextPositionSize: draft.context.positionSize.trim() }),
    timeframe: draft.context.timeframe,
    session: draft.context.session,
    confirmationNotes: draft.context.reason,
    tradingviewUrl: draft.context.tradingviewUrl,
    notes: draft.context.notes,
    chartAttachmentStorageKey: null,
    ...(draft.confidence === null ? {} : { confidence: draft.confidence }),
    ...(draft.emotions.answer === 'unanswered'
      ? {}
      : {
          emotionKeys:
            draft.emotions.answer === 'none'
              ? []
              : draft.emotions.keys.filter(isCanonicalEmotionKey),
        }),
  };

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

  const { resolved } = exitPlan;
  if (resolved.status === 'inherited') {
    payload.exitPlan = {
      state: 'saved',
      exitPlanId: resolved.plan.exitPlanId,
      provenance: 'strategy_default',
    };
  } else if (resolved.status === 'saved') {
    payload.exitPlan = {
      state: 'saved',
      exitPlanId: resolved.plan.exitPlanId,
      provenance: 'selected',
    };
  } else if (resolved.status === 'customized') {
    payload.exitPlan = {
      state: 'customized',
      baseExitPlanId: resolved.base?.exitPlanId ?? null,
      instructions: resolved.instructions,
    };
  } else if (resolved.status === 'no_rule') {
    payload.exitPlan = { state: 'no_rule' };
  }
  if (exitPlan.inheritanceDeclined) payload.exitPlanInheritanceDeclined = true;

  return payload;
}
