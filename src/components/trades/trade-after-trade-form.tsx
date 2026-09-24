'use client';

import { CircleAlert, History, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { generateId } from '@/lib/identifiers';
import { confidenceLevelKey } from '@/lib/trades/constants';
import { HISTORICAL_EXIT_LIMIT } from '@/lib/trades/schemas';
import { cn } from '@/lib/utils';
import { createCompletedTradeAction } from '@/server/actions/trades';
import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

import {
  activeAfterTradeClassification,
  addExit,
  adoptExitSubtotal,
  afterTradeAnalysisSummary,
  afterTradeFieldSection,
  afterTradePlanOutcomePlan,
  afterTradeReadiness,
  answerCondition,
  answerNoEmotions,
  answerNoSetup,
  answerNoStrategy,
  buildAfterTradePayload,
  canAddExit,
  canDeselectEmotion,
  clearEntryTimestamp,
  createAfterTradeDraft,
  exitField,
  finalPnlStillAdopted,
  isCompleteEntryTimestamp,
  meaningfulExit,
  removeEmotionsAnswer,
  removeExit,
  removeSetupAnswer,
  removeStrategyAnswer,
  selectSetup,
  selectStrategy,
  setActualRiskAmount,
  setActualRiskAnswer,
  setCompleteness,
  setConfidence,
  setEntryDate,
  setEntryTime,
  setFinalPnl,
  setOutcome,
  setPlanOutcomeAmountText,
  setPlanOutcomeAnswer,
  setRiskState,
  setTargetState,
  setTargetValue,
  toggleEmotion,
  updateExit,
  validateAfterTradeDraft,
  type AfterTradeDraft,
  type AfterTradeErrorCode,
  type AfterTradeErrors,
  type AfterTradeExitDraft,
  type AfterTradeField,
} from './after-trade-draft';
import type { PlanOutcomeDraftError } from './plan-outcome-draft';
import { hasStaleSelection, staleSelections } from './stale-selection';
import { afterTradeContextIds, TradeAfterTradeContextStep } from './trade-after-trade-context-step';
import {
  ChoiceGroup,
  Helper,
  InlineAction,
  Notice,
  Tag,
  TextField,
} from './trade-at-entry-controls';
import { formatEntryStamp, tradeDetailsRowId, TradeDetailsStep } from './trade-details-step';
import { TradeEntryContextStep } from './trade-entry-context-step';
import {
  ActualRReadoutRow,
  ExitTimeField,
  FinalPnlField,
  TraderOutcomeField,
} from './trade-exit-result-step';
import { datetimeLocalToIso, tradeMoneyInputValue } from './trade-form-values';
import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';
import { planOutcomeIds, TradePlanOutcomeSection } from './trade-plan-outcome-section';
import { TradePlanRiskStep, type PlanRiskField, type PlanStepId } from './trade-plan-risk-step';
import type { RecordingSaveControls } from './trade-recording-form';
import { FoldedGroup, GroupCard } from './trade-recording-step-parts';
import { useKeyboardObscuringViewport } from './trade-recording-surface';
import { TradeSaveReplayConflict } from './trade-save-replay';
import { TradeSetupChecklistStep } from './trade-setup-checklist-step';
import { TradeStepFlow, TradeStepSection } from './trade-step-flow';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

/**
 * THE SIX STEPS OF A CLOSED-TRADE RECORDING — the canonical stages in their
 * canonical order (contract decision 55): Trade (1), Risk & Target (2),
 * Strategy & Setup (3) and Entry Context (4) — the same four Record Open
 * asks, with the same components — then Trader Result (5) and After Trade
 * (6), which ends with Save. Save is the last step's action, not a stage of
 * its own. Only Step 1 holds anything Save needs; every other step can be left
 * unanswered and still advanced.
 */
const STEPS = ['trade', 'plan', 'setup', 'context', 'result', 'after'] as const;
type StepKey = (typeof STEPS)[number];
const STEP_INDEX: Readonly<Record<StepKey, number>> = {
  trade: 0,
  plan: 1,
  setup: 2,
  context: 3,
  result: 4,
  after: 5,
};
const LAST_STEP = STEPS.length - 1;

/** The step that shows a field — where a failed Save goes to reach it. */
function fieldStep(field: AfterTradeField): number {
  /*
    The final exit time is read on the Trader Result step: it says how the trade
    ended, not which trade it was. `afterTradeFieldSection` still groups it
    with the trade — that grouping belongs to the draft module and to Save's
    own disclosure handling, and is not this step map.
  */
  if (field === 'exitedAt') return STEP_INDEX.result;
  /*
    Price levels are part of canonical Plan & Risk, so they are asked on the
    Plan step beside the TP price their notices compare against. The draft
    module's own grouping still files them under context — that grouping is
    not this step map either.
  */
  if (
    field === 'contextEntryPrice' ||
    field === 'contextStopPrice' ||
    field === 'contextPositionSize'
  ) {
    return STEP_INDEX.plan;
  }
  switch (afterTradeFieldSection(field)) {
    case 'result':
    case 'exits':
      return STEP_INDEX.result;
    case 'plan':
      return STEP_INDEX.plan;
    case 'context':
      return STEP_INDEX.context;
    case 'after':
      return STEP_INDEX.after;
    default:
      return STEP_INDEX.trade;
  }
}

/** Stage 6's control ids on this form (`fieldTargetId` focuses them). */
const AFTER_CONTEXT_PREFIX = 'after-stage6';
const AFTER_CONTEXT_IDS = afterTradeContextIds(AFTER_CONTEXT_PREFIX);
const PLAN_OUTCOME_IDS = planOutcomeIds(AFTER_CONTEXT_PREFIX);

/** One Save in the document at a time — see `trade-at-entry-form.tsx`. */
const WIDE_VIEWPORT_QUERY = '(min-width: 64rem)';

function subscribeWideViewport(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function useIsWideViewport(): boolean {
  return useSyncExternalStore(
    subscribeWideViewport,
    () => window.matchMedia(WIDE_VIEWPORT_QUERY).matches,
    () => true,
  );
}

/**
 * Where a failed Save sends focus for each field — always a real, focusable
 * control that is on screen at the time.
 *
 * STEP 1 FOCUSES ITS ROW, NOT THE INPUT. The account, symbol, direction and
 * entry-time controls only exist while their editor is open, and no Save can
 * be pressed while one is (the editor is modal). So the honest target is the
 * launcher row itself: it names the concept, carries the error, and opens the
 * control in one press.
 */
function fieldTargetId(field: AfterTradeField): string {
  if (field.startsWith('exit:')) {
    const [, id, part] = field.split(':');
    return `after-exit-${id}-${part}`;
  }
  switch (field) {
    case 'tradingAccountId':
    case 'symbol':
    case 'direction':
    case 'enteredAt':
      return tradeDetailsRowId('after', field);
    case 'risk':
      return PLAN_ROW_ID.risk;
    // Actual Risk moved to Entry Context & Evidence (contract decision 53).
    case 'actualRisk':
      return 'after-actual-risk-row';
    case 'targetProfit':
    case 'targetPrice':
      return PLAN_ROW_ID.target;
    case 'contextEntryPrice':
    case 'contextStopPrice':
    case 'contextPositionSize':
      return PLAN_ROW_ID.price;
    case 'tradingviewUrl':
      return 'after-context-chart';
    case 'planOutcome':
      return PLAN_OUTCOME_IDS.amount;
    case 'afterTradeNote':
      return AFTER_CONTEXT_IDS.note;
    case 'afterTradeTradingviewUrl':
      return AFTER_CONTEXT_IDS.tradingviewUrl;
    default:
      return `after-${field}`;
  }
}

/** Plan & Risk's launcher rows — the concept a blocked Save lands on. */
const PLAN_ROW_ID = {
  risk: 'after-risk-row',
  target: 'after-target-row',
  exitPlan: 'after-exit-plan-row',
  price: 'after-price-row',
} as const;

/**
 * The Plan & Risk step's ids: its four launcher rows, and the inputs inside
 * the editors those rows open. The input ids are the ones this form always
 * used; only the focus targets moved to the rows (`fieldTargetId`).
 */
const PLAN_STEP_IDS: Readonly<Record<PlanStepId, string>> = {
  riskRow: PLAN_ROW_ID.risk,
  targetRow: PLAN_ROW_ID.target,
  exitPlanRow: PLAN_ROW_ID.exitPlan,
  priceRow: PLAN_ROW_ID.price,
  risk: 'after-risk',
  riskState: 'after-risk-state',
  targetState: 'after-target',
  targetProfit: 'after-targetProfit',
  targetPrice: 'after-targetPrice',
  entryPrice: 'after-contextEntryPrice',
  stopPrice: 'after-contextStopPrice',
  positionSize: 'after-contextPositionSize',
};

/** The Plan & Risk step's fields, as this draft names them. */
const PLAN_STEP_FIELD: Readonly<Record<PlanRiskField, AfterTradeField>> = {
  risk: 'risk',
  targetProfit: 'targetProfit',
  targetPrice: 'targetPrice',
  entryPrice: 'contextEntryPrice',
  stopPrice: 'contextStopPrice',
  positionSize: 'contextPositionSize',
};

/** Server field names mapped onto the fields a trader can see and correct. */
const SERVER_FIELD: Readonly<Record<string, AfterTradeField>> = {
  tradingAccountId: 'tradingAccountId',
  symbol: 'symbol',
  direction: 'direction',
  enteredAt: 'enteredAt',
  exitedAt: 'exitedAt',
  plannedRiskMinor: 'risk',
  actualRiskAnswer: 'actualRisk',
  actualInitialRiskMinor: 'actualRisk',
  targetState: 'targetProfit',
  plannedRewardMinor: 'targetProfit',
  targetPrice: 'targetPrice',
  finalPnlMinor: 'finalPnl',
  exits: 'exits',
  exitHistoryCompleteness: 'exits',
  contextEntryPrice: 'contextEntryPrice',
  contextStopPrice: 'contextStopPrice',
  contextPositionSize: 'contextPositionSize',
  tradingviewUrl: 'tradingviewUrl',
  afterTradeNote: 'afterTradeNote',
  afterTradeTradingviewUrl: 'afterTradeTradingviewUrl',
  planOutcome: 'planOutcome',
  planOutcomeMinor: 'planOutcome',
};

/**
 * The control a blocked Save lands on. The System Result's amount exists only
 * while its answer needs one; otherwise the answer group itself takes focus.
 */
function fieldTarget(field: AfterTradeField): HTMLElement | null {
  const target = document.getElementById(fieldTargetId(field));
  if (target !== null || field !== 'planOutcome') return target;
  return document.getElementById(PLAN_OUTCOME_IDS.choice);
}

/** Inside the step being shown, rather than one kept mounted but hidden. */
function isShown(element: Element): boolean {
  return element.closest('[hidden]') === null;
}

interface SavedTrade {
  readonly tradeId: string;
  readonly symbol: string;
  /** An honest replay: these exact answers were already saved earlier. */
  readonly alreadyCreated: boolean;
}

/**
 * What a field-level refusal from the server says. Only a price field can be
 * "not a valid price" and only a money field "not a valid amount"; anything
 * else is named honestly as not accepted rather than as a price problem.
 */
function serverFieldErrorCode(field: AfterTradeField): AfterTradeErrorCode {
  switch (field) {
    case 'targetPrice':
    case 'contextEntryPrice':
    case 'contextStopPrice':
    case 'contextPositionSize':
      return 'invalid_price';
    case 'tradingviewUrl':
    case 'afterTradeTradingviewUrl':
      return 'invalid_tradingview_url';
    case 'risk':
    case 'actualRisk':
    case 'targetProfit':
    case 'finalPnl':
      return 'invalid_money';
    case 'enteredAt':
    case 'exitedAt':
      return 'invalid_datetime';
    default:
      return 'not_accepted';
  }
}

/**
 * AFTER TRADE — "Record a closed trade", Add Trade contract v1 (§13).
 *
 * THE MOMENT'S QUESTION IS "WHAT ACTUALLY HAPPENED?" (UX Rules §12). The trade,
 * then its result and the trader's own classification of it, then risk and
 * plan as remembered, then optional exit history, the trader's read and
 * context. Only Account, Symbol and Direction are needed to save; Final Net
 * P&L and the outcome are prompted, never required.
 *
 * ALL SEMANTICS LIVE IN `after-trade-draft`. This component renders a draft and
 * applies that module's transitions. Nothing is preselected, nothing is
 * derived into an answer, and a notice never blocks.
 *
 * AFTER A SAVE the trader chooses: Review Trade or Done (contract §20). The
 * Recording Draft is cleared only after the server confirms the Trade.
 */
export function TradeAfterTradeForm({
  options: serverOptions,
  activeTradingAccountId = null,
  timezone,
  initialDraft = null,
  mutationKey: draftMutationKey,
  onDraftChange,
  onSaved,
  saveControls,
  onDiscardDraft = null,
}: {
  options: TradeCreateOptions;
  activeTradingAccountId?: string | null;
  timezone: string;
  /** This mode's section of the Recording Draft, when one exists. */
  initialDraft?: AfterTradeDraft | null;
  /** The Recording Draft's idempotency key, so a retry after reload cannot duplicate a Trade. */
  mutationKey?: string;
  /** Type → Draft: called with every change. */
  onDraftChange?: (draft: AfterTradeDraft) => void;
  /** Called only after the server has confirmed the Trade. */
  onSaved?: () => void;
  /** The Recording Draft's Save safeguards: inactive-mode confirmation and "Save as new". */
  saveControls?: RecordingSaveControls;
  /**
   * Set while there is work in the draft but nothing restored to announce:
   * this form's own header carries Discard then — after Change, in the phone's
   * mode row or the wide screen's mode sentence — and the page leaves out its
   * standalone Discard row, so Discard never costs a row of its own.
   */
  onDiscardDraft?: (() => void) | null;
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const s6 = useTranslations('trades.stage6');
  const r = useTranslations('trades.create.replay');
  const locale = useLocale();
  const router = useRouter();
  const [adoptedExitPlans, setAdoptedExitPlans] = useState<
    readonly TradeCreateExitPlanOption[] | null
  >(null);
  const options = useMemo<TradeCreateOptions>(
    () =>
      adoptedExitPlans === null ? serverOptions : { ...serverOptions, exitPlans: adoptedExitPlans },
    [serverOptions, adoptedExitPlans],
  );
  const keyboardOpen = useKeyboardObscuringViewport();
  const wide = useIsWideViewport();
  // Recents still feed At Entry's chips; the Saved Symbol library lives on the server.
  const symbolFavorites = useTradePlanFavorites('symbol', options.workspaceId);
  const [fallbackMutationKey] = useState(generateId);
  const mutationKey = draftMutationKey ?? fallbackMutationKey;
  const submitting = useRef(false);
  const formId = useId();
  const ids = { step: useId(), saved: useId() };
  const savedHeading = useRef<HTMLHeadingElement>(null);

  const initialAccount =
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((item) => item.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '');
  const pristine = useMemo(() => createAfterTradeDraft(initialAccount), [initialAccount]);
  const [draft, setDraft] = useState(initialDraft ?? pristine);
  const [saved, setSaved] = useState<SavedTrade | null>(null);
  // Type → Draft, until the Trade exists: a saved Trade has no draft left to keep.
  useEffect(() => {
    if (saved === null) onDraftChange?.(draft);
  }, [draft, onDraftChange, saved]);
  useEffect(() => {
    if (saved !== null) savedHeading.current?.focus();
  }, [saved]);

  const [exitsOpen, setExitsOpen] = useState(draft.exits.some(meaningfulExit));
  /*
    THE CURRENT STEP IS VIEW STATE, NOT DRAFT STATE. Every step stays mounted
    and only the current one is shown, so moving between steps can never drop
    an answer or an editor's local state; the draft itself is untouched by
    navigation and a reload recovers it exactly as before, from Step 1.
  */
  const [step, setStep] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AfterTradeErrors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  /** The Trade a reused Save key already created from different answers. */
  const [replayConflict, setReplayConflict] = useState<{
    readonly tradeId: string;
    readonly reason: 'different' | 'unverifiable';
  } | null>(null);
  const [pending, setPending] = useState(false);

  const apply = (change: (current: AfterTradeDraft) => AfterTradeDraft) => {
    setDraft((current) => change(current));
    setServerMessage(null);
  };

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === draft.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const now = new Date();
  const validation = validateAfterTradeDraft(draft, { currency, timezone, now });
  const readiness = afterTradeReadiness(draft, validation);
  const summary = afterTradeAnalysisSummary(draft, options);
  // Strategy, Setup and conditions as resolved against what is still offered.
  const activeRead = activeAfterTradeClassification(draft, options);
  const staleRead = staleSelections(draft, options);
  const recordedExits = draft.exits.filter(meaningfulExit);

  /*
    WHICH ERRORS SPEAK. Before a Save attempt only a malformed value the trader
    already typed is flagged; after an attempt every blocking error is shown.
  */
  const typed = (field: AfterTradeField): string => {
    if (field.startsWith('exit:')) {
      const [, id, part] = field.split(':') as [string, string, keyof AfterTradeExitDraft];
      const exit = draft.exits.find((item) => item.id === id);
      return exit === undefined ? '' : String(exit[part] ?? '');
    }
    switch (field) {
      case 'enteredAt':
        return draft.enteredAt;
      // Half a final exit time waits for Save before it speaks, like Step 1's entry time.
      case 'exitedAt':
        return isCompleteEntryTimestamp(draft.exitedAt) ? draft.exitedAt : '';
      case 'finalPnl':
        return draft.finalPnl;
      case 'risk':
        return draft.risk;
      case 'actualRisk':
        return draft.actualRisk.answer === 'matched' ? 'matched' : draft.actualRisk.amount;
      case 'targetProfit':
        return draft.target.state === 'fixed' ? draft.target.profit : '';
      case 'targetPrice':
        return draft.target.state === 'fixed' ? draft.target.price : '';
      case 'contextEntryPrice':
        return draft.context.entryPrice;
      case 'contextStopPrice':
        return draft.context.stopPrice;
      case 'contextPositionSize':
        return draft.context.positionSize;
      case 'tradingviewUrl':
        return draft.context.tradingviewUrl;
      case 'afterTradeNote':
        return draft.afterTradeNote;
      case 'afterTradeTradingviewUrl':
        return draft.afterTradeTradingviewUrl;
      default:
        return '';
    }
  };
  const visibleErrors: AfterTradeErrors = { ...serverErrors };
  for (const [field, code] of Object.entries(validation.errors) as [
    AfterTradeField,
    AfterTradeErrorCode,
  ][]) {
    if (attempted || typed(field).trim() !== '') visibleErrors[field] = code;
  }

  function errorText(field: AfterTradeField): string | undefined {
    const code = visibleErrors[field];
    if (code === undefined) return undefined;
    switch (code) {
      case 'required':
        return field === 'tradingAccountId'
          ? c('errors.requiredAccount')
          : field === 'symbol'
            ? c('errors.requiredSymbol')
            : c('errors.requiredDirection');
      case 'invalid_money':
        return c('errors.invalidMoney');
      case 'must_be_positive':
        return c('errors.mustBePositive');
      case 'invalid_datetime':
        return a('errors.invalidDatetime');
      case 'entry_time_required':
        return a('errors.entryTimeRequired');
      case 'entry_date_required':
        return a('errors.entryDateRequired');
      case 'exit_time_required':
        return a('errors.exitTimeRequired');
      case 'exit_date_required':
        return a('errors.exitDateRequired');
      case 'future_time':
        return a('errors.futureTime');
      case 'exit_before_entry':
        return a('errors.exitBeforeEntry');
      case 'exit_outside_trade':
        return a('errors.exitOutsideTrade');
      case 'invalid_price':
        return c('errors.invalidPrice');
      case 'invalid_percent':
        return a('errors.invalidPercent');
      case 'percent_over_total':
        return a('errors.percentOverTotal');
      case 'fixed_target_requires_value':
        return c('errors.fixedTargetRequiresValue');
      case 'matched_requires_risk_at_entry':
        return a('errors.matchedRequiresRisk');
      case 'actual_risk_equals_risk_at_entry':
        return a('errors.actualRiskEqualsRiskAtEntry');
      case 'invalid_tradingview_url':
        return t('validation.invalidTradingViewUrl');
      case 'not_accepted':
        return c('errors.notAccepted');
    }
  }

  const requirements = [
    { key: 'account', field: 'tradingAccountId', done: draft.tradingAccountId !== '' },
    { key: 'symbol', field: 'symbol', done: draft.symbol.trim() !== '' },
    { key: 'direction', field: 'direction', done: draft.direction !== '' },
  ] as const;
  const remaining = requirements.filter((item) => !item.done).length;
  const blockedCount = readiness.status === 'blocked' ? readiness.count : 0;
  const statusBlocked = readiness.status === 'blocked' && (attempted || remaining === 0);
  const statusLine = pending
    ? a('save.saving')
    : (serverMessage ??
      (readiness.status === 'ready'
        ? a('save.ready')
        : statusBlocked
          ? a('save.blocked', { count: blockedCount })
          : a('save.remaining', { count: remaining })));
  const statusTone =
    serverMessage !== null || (attempted && readiness.status === 'blocked')
      ? 'text-destructive'
      : 'text-muted-foreground';
  const recommended = [
    { key: 'finalPnl', done: validation.finalPnlMinor !== null },
    { key: 'outcome', done: draft.outcome !== null },
  ] as const;
  const promptMissing = recommended.some((item) => !item.done);

  /**
   * Show one step. With targets, the first rendered one is brought into view
   * and focused — a failed Save uses this to land on the control that needs
   * attention; plain navigation focuses the step's heading.
   */
  function showStep(index: number, targets: readonly (() => HTMLElement | null)[] = []) {
    setStep(index);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const form = formRef.current;
        if (
          form !== null &&
          typeof form.scrollIntoView === 'function' &&
          form.getBoundingClientRect().top < 0
        ) {
          form.scrollIntoView({ block: 'start' });
        }
        for (const find of targets) {
          const target = find();
          if (target === null || !isShown(target)) continue;
          if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'center' });
          }
          target.focus();
          if (document.activeElement === target) return;
          break;
        }
        stepHeading.current?.focus({ preventScroll: true });
      }),
    );
  }

  /** Open the earliest step holding a blocking error, and focus its control. */
  function focusFirstError(fields: readonly AfterTradeField[]) {
    if (fields.length === 0) return;
    const index = Math.min(...fields.map(fieldStep));
    showStep(
      index,
      fields.filter((field) => fieldStep(field) === index).map((field) => () => fieldTarget(field)),
    );
  }

  async function submit(saveAsNewKey?: string) {
    // One Save at a time: a second press while one is in flight is ignored.
    if (submitting.current || saved !== null) return;
    setAttempted(true);
    setServerErrors({});
    const current = draft;
    const currentNow = new Date();
    const currentValidation = validateAfterTradeDraft(current, {
      currency,
      timezone,
      now: currentNow,
    });
    const currentReadiness = afterTradeReadiness(current, currentValidation);
    if (currentReadiness.status === 'blocked') {
      setServerMessage(null);
      const sections = new Set(currentReadiness.fields.map(afterTradeFieldSection));
      if (sections.has('exits')) setExitsOpen(true);
      focusFirstError(currentReadiness.fields);
      return;
    }
    // A chosen answer whose source went away waits for the trader's choice.
    const stale = staleSelections(current, options);
    if (hasStaleSelection(stale)) {
      setServerMessage(c('save.staleBlocked'));
      const target = stale.strategy ? 'after-strategy' : stale.setup ? 'after-setup' : null;
      if (target === null) {
        showStep(STEP_INDEX.plan, [
          () => document.querySelector<HTMLElement>('[data-exit-plan-unavailable]'),
        ]);
      } else {
        showStep(STEP_INDEX.setup, [() => document.getElementById(target)]);
      }
      return;
    }
    const payload = buildAfterTradePayload(current, {
      currency,
      timezone,
      now: currentNow,
      mutationKey: saveAsNewKey ?? mutationKey,
      options,
    });
    if (payload === null) return;

    submitting.current = true;
    if (saveControls !== undefined && !(await saveControls.confirmBeforeSave())) {
      submitting.current = false;
      return;
    }
    setPending(true);
    setServerMessage(null);
    setReplayConflict(null);
    let result: Awaited<ReturnType<typeof createCompletedTradeAction>>;
    try {
      result = await createCompletedTradeAction(payload);
    } catch {
      // A network failure keeps the draft exactly as entered; the same
      // mutation key makes the retry safe.
      submitting.current = false;
      setPending(false);
      setServerMessage(t('errors.unexpected_error'));
      return;
    }
    submitting.current = false;
    setPending(false);
    if (!result.ok) {
      if (
        result.error.code === 'mutation_replay_conflict' &&
        result.error.existingTradeId !== undefined
      ) {
        // Nothing was written: the draft stays exactly as it is.
        setReplayConflict({
          tradeId: result.error.existingTradeId,
          reason: result.error.replayConflict ?? 'different',
        });
        setServerMessage(t('errors.mutation_replay_conflict'));
        return;
      }
      const mapped: AfterTradeErrors = {};
      for (const key of Object.keys(result.error.fieldErrors ?? {})) {
        const field = SERVER_FIELD[key];
        if (field !== undefined && field !== 'exits') mapped[field] = serverFieldErrorCode(field);
      }
      setServerErrors(mapped);
      setServerMessage(t(`errors.${result.error.code}`));
      focusFirstError(Object.keys(mapped) as AfterTradeField[]);
      return;
    }
    symbolFavorites.recordUse(payload.symbol);
    // Save → Persist: only now, with the Trade confirmed, does the draft go.
    onSaved?.();
    setSaved({
      tradeId: result.data.tradeId,
      symbol: payload.symbol,
      alreadyCreated: result.data.alreadyCreated,
    });
  }

  const replayConflictPanel =
    replayConflict === null ? null : (
      <TradeSaveReplayConflict
        existingTradeId={replayConflict.tradeId}
        reason={replayConflict.reason}
        pending={pending}
        onSaveAsNew={() => {
          if (saveControls === undefined) return;
          // Only this explicit press issues a new Save key.
          const key = saveControls.rotateMutationKey();
          setReplayConflict(null);
          void submit(key);
        }}
      />
    );

  if (saved !== null) {
    return (
      <section
        aria-labelledby={ids.saved}
        data-after-trade-saved=""
        className="bg-card border-border shadow-card mx-auto flex w-full max-w-xl min-w-0 flex-col gap-4 rounded-xl border px-5 py-6 sm:px-7"
      >
        <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-1">
          <h2
            id={ids.saved}
            ref={savedHeading}
            tabIndex={-1}
            className="text-foreground text-xl font-semibold outline-none"
          >
            {saved.alreadyCreated ? r('alreadyTitle') : a('saved.title')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {saved.alreadyCreated
              ? r('alreadyDescription')
              : a('saved.description', { symbol: saved.symbol })}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="min-h-12"
            onClick={() => router.push(`/app/trades?trade=${saved.tradeId}&tab=review`)}
          >
            {a('saved.review')}
          </Button>
          <Button
            type="button"
            size="lg"
            className="min-h-12"
            onClick={() => router.push('/app/trades')}
          >
            {a('saved.done')}
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">{a('saved.hint')}</p>
      </section>
    );
  }

  const contextFilled = [
    draft.context.reason,
    draft.context.tradingviewUrl,
    draft.context.timeframe,
    draft.context.session,
    draft.context.notes,
  ].filter((value) => value.trim() !== '').length;
  const priceLevelsRecorded = [
    draft.context.entryPrice,
    draft.context.stopPrice,
    draft.context.positionSize,
  ].some((value) => value.trim() !== '');
  const exitErrorCount = Object.keys(visibleErrors).filter(
    (field) => afterTradeFieldSection(field as AfterTradeField) === 'exits',
  ).length;
  /** Blocking errors each step holds, so a step with one is marked wherever it is listed. */
  const stepErrorCounts = STEPS.map(
    (_, index) =>
      Object.keys(visibleErrors).filter((field) => fieldStep(field as AfterTradeField) === index)
        .length,
  );

  const setupLines: string[] = [];
  const analysisLines: string[] = [];
  if (summary.strategy.answer === 'none') setupLines.push(c('summary.noStrategy'));
  if (summary.strategy.answer === 'selected' && summary.strategy.name !== null) {
    const setupPart =
      summary.setup.answer === 'none'
        ? c('summary.noSetup')
        : summary.setup.answer === 'selected'
          ? summary.setup.name
          : null;
    setupLines.push([summary.strategy.name, setupPart].filter(Boolean).join(' · '));
    if (summary.conditions !== null) {
      setupLines.push(
        c('summary.conditions', {
          answered: summary.conditions.answered,
          total: summary.conditions.total,
        }),
      );
    }
  }
  if (summary.confidence !== null) {
    analysisLines.push(
      c('summary.confidence', {
        level: t(`create.confidence.level.${confidenceLevelKey(summary.confidence)}`),
      }),
    );
  }
  if (summary.emotions.answer === 'none') analysisLines.push(c('summary.emotionsNone'));
  if (summary.emotions.answer === 'selected') {
    analysisLines.push(c('summary.emotionsCount', { count: summary.emotions.count }));
  }
  const afterTradeLines: string[] = [];
  if (summary.postTradeEmotions.answer === 'none') afterTradeLines.push(a('summary.postTradeNone'));
  if (summary.postTradeEmotions.answer === 'selected') {
    afterTradeLines.push(a('summary.postTradeCount', { count: summary.postTradeEmotions.count }));
  }
  if (draft.afterTradeNote.trim() !== '') afterTradeLines.push(s6('note.title'));
  if (draft.afterTradeTradingviewUrl.trim() !== '') afterTradeLines.push(s6('evidence.title'));

  /*
    STAGE 6 SYSTEM RESULT, asked of the plan this Save records — the same
    facts the payload sends, so the question is the one the server checks.
  */
  const planOutcomePlan = afterTradePlanOutcomePlan(draft, validation.riskMinor, currency);
  const planOutcomeCode = visibleErrors.planOutcome;
  const planOutcomeError: PlanOutcomeDraftError | null =
    planOutcomeCode === 'plan_outcome_stale' ||
    planOutcomeCode === 'plan_outcome_amount_required' ||
    planOutcomeCode === 'plan_outcome_invalid_money' ||
    planOutcomeCode === 'plan_outcome_amount_positive'
      ? planOutcomeCode
      : // A stale answer is said at once, not only after a Save attempt.
        validation.errors.planOutcome === 'plan_outcome_stale'
        ? 'plan_outcome_stale'
        : null;
  const recordedExitPlan = (() => {
    const { choice } = draft.exitPlan;
    if (choice.kind === 'saved') {
      const plan = options.exitPlans.find((item) => item.exitPlanId === choice.exitPlanId);
      return plan === undefined ? null : { name: plan.name, instructions: plan.instructions };
    }
    if (choice.kind === 'customized' && draft.exitPlan.customText.trim() !== '') {
      return { name: null, instructions: draft.exitPlan.customText.trim() };
    }
    return null;
  })();
  const planOutcomeSummary =
    draft.planOutcome.outcome === null
      ? null
      : draft.planOutcome.outcome === 'cannot_determine'
        ? `${s6('planOutcome.title')}: ${s6('planOutcome.cannotDetermine')}`
        : s6('planOutcome.title');

  // The latest recorded exit time, offered — never applied — as the final exit time.
  const latestExitLocal = (() => {
    let latest: { local: string; time: number } | null = null;
    for (const exit of recordedExits) {
      if (exit.exitedAt === '') continue;
      const iso = datetimeLocalToIso(exit.exitedAt, timezone);
      if (!iso.ok) continue;
      const time = Date.parse(iso.value);
      if (latest === null || time > latest.time) latest = { local: exit.exitedAt, time };
    }
    return latest;
  })();

  const formatMoney = (minor: string) => formatTradeMoney(minor, currency) ?? minor;

  /*
    STEP 1 ASKS ITS OWN QUESTIONS (`TradeDetailsStep`); this form only says
    which entry-time error is blocking, and reads the stamp back in the phone
    summary.
  */
  const entryErrorCode = validation.errors.enteredAt;
  const entryStampLabel = formatEntryStamp(draft.enteredAt, locale, {
    timeNotRecorded: a('times.entryTimeNotRecorded'),
    dateNotRecorded: a('times.entryDateNotRecorded'),
  });

  const outcomeNotice = validation.notices.find(
    (notice) => notice.kind === 'outcome_contradicts_pnl',
  );
  const discrepancy = validation.notices.find((notice) => notice.kind === 'exit_discrepancy');

  /*
    WHAT EACH STEP HOLDS, IN A LINE. Read-only restatements of answers already
    given — never a derived answer. A step with nothing recorded says so.
  */
  const localTime = (local: string): string | null => {
    if (local === '') return null;
    const iso = datetimeLocalToIso(local, timezone);
    return iso.ok ? (formatTradeInstant(iso.value, timezone, locale) ?? local) : local;
  };
  const outcomeLabel =
    draft.outcome === 'win'
      ? a('result.win')
      : draft.outcome === 'break_even'
        ? a('result.breakEven')
        : draft.outcome === 'loss'
          ? a('result.loss')
          : null;
  const joinParts = (parts: readonly (string | null | false | undefined)[]): string | null => {
    const kept = parts.filter((part): part is string => typeof part === 'string' && part !== '');
    return kept.length === 0 ? null : kept.join(' · ');
  };
  const stepSummaries: Readonly<Record<StepKey, string | null>> = {
    trade: joinParts([
      draft.symbol.trim().toUpperCase(),
      draft.direction === 'long'
        ? c('direction.long')
        : draft.direction === 'short'
          ? c('direction.short')
          : null,
      selectedAccount?.name,
    ]),
    result: joinParts([
      validation.finalPnlMinor === null ? null : formatMoney(validation.finalPnlMinor),
      outcomeLabel,
      validation.actualR.status === 'known' ? formatR(validation.actualR.value) : null,
      recordedExits.length === 0 ? null : a('exits.summaryCount', { count: recordedExits.length }),
    ]),
    plan: joinParts([
      validation.riskMinor === null
        ? null
        : `${a('risk.label')} ${formatMoney(validation.riskMinor)}`,
      draft.actualRisk.answer === 'matched'
        ? a('actualRisk.matched')
        : draft.actualRisk.answer === 'different'
          ? a('actualRisk.different')
          : draft.actualRisk.answer === 'unknown'
            ? `${a('actualRisk.legend')}: ${a('actualRisk.unknown')}`
            : null,
      draft.target.state === 'fixed'
        ? c('target.fixed')
        : draft.target.state === 'no_fixed'
          ? c('target.noFixed')
          : null,
      priceLevelsRecorded ? a('steps.groups.price') : null,
    ]),
    setup: joinParts(setupLines),
    context: joinParts([
      ...analysisLines,
      contextFilled === 0 ? null : c('summary.contextFilled', { count: contextFilled }),
    ]),
    after: joinParts([planOutcomeSummary, ...afterTradeLines]),
  };
  const missingRequirements = requirements.filter(
    (item) => !item.done || visibleErrors[item.field] !== undefined,
  );
  /*
    QUICK SAVE. Account, Symbol and Direction are everything Save needs, so
    once they are answered the trader can stop here — from any step. It is the
    SAME `submit()`: the same validation, the same inactive-mode confirmation,
    the same Save key and replay handling, the same server confirmation and
    draft clearing, and it saves the whole current draft, including answers on
    steps the trader never walked back to. It stays a quiet secondary action;
    Next remains the step's primary one.
  */
  const canQuickSave = missingRequirements.length === 0 && !pending;
  const stepLabel = (key: StepKey) => a(`steps.${key}.label`);
  const currentKey = STEPS[step] ?? 'trade';
  const onLastStep = step === LAST_STEP;
  const progressText = a('steps.progress', { current: step + 1, total: STEPS.length });

  const stepAttention = stepErrorCounts[step] ?? 0;
  /** The steps a Save would stop on, named so the last step can point at them. */
  const attentionSteps = STEPS.map((key) => ({
    key,
    errors: stepErrorCounts[STEP_INDEX[key]] ?? 0,
  })).filter((item) => item.errors > 0);

  const section = (key: StepKey, className: string, children: ReactNode) => (
    <TradeStepSection
      key={key}
      stepKey={key}
      current={currentKey === key}
      headingId={ids.step}
      className={className}
    >
      {children}
    </TradeStepSection>
  );

  return (
    <TradeStepFlow
      recordingMode="after_trade"
      formRef={formRef}
      formId={formId}
      formData={{ 'data-after-trade-form': '', 'data-after-trade-step': currentKey }}
      onSubmit={(event) => {
        event.preventDefault();
        // Save lives on the last step; Enter elsewhere never saves early.
        if (onLastStep) void submit();
      }}
      wide={wide}
      keyboardOpen={keyboardOpen}
      modeSentence={a('subtitle')}
      modeShort={a('steps.modeShort')}
      onDiscardDraft={onDiscardDraft}
      steps={STEPS.map((key, index) => ({
        key,
        label: stepLabel(key),
        summary: stepSummaries[key],
        errors: stepErrorCounts[index] ?? 0,
        // Step 1 is the only step holding anything Save needs.
        pending:
          key === 'trade' && missingRequirements.length > 0
            ? a('steps.requiredMissing', { count: missingRequirements.length })
            : null,
      }))}
      step={step}
      onShowStep={(index) => showStep(index)}
      headingId={ids.step}
      headingRef={stepHeading}
      title={a(`steps.${currentKey}.title`)}
      description={a(`steps.${currentKey}.description`)}
      attention={stepAttention === 0 ? null : a('steps.attention', { count: stepAttention })}
      copy={{
        navLabel: a('steps.navLabel'),
        progress: progressText,
        goTo: (index, label) =>
          a('steps.goTo', { current: index + 1, total: STEPS.length, step: label }),
        needsAttention: a('steps.needsAttention'),
        optional: a('steps.optional'),
        back: a('steps.back'),
        nextTo: (label) => a('steps.nextTo', { step: label }),
      }}
      status={{
        show: onLastStep || pending || serverMessage !== null,
        text: statusLine,
        tone: statusTone,
      }}
      quickSave={
        canQuickSave
          ? {
              id: 'after-quick-save',
              label: a('steps.quickSave'),
              ariaLabel: a('save.action'),
              hint: a('steps.quickSaveHint'),
              onClick: () => void submit(),
            }
          : null
      }
      save={{ label: a('save.action'), pendingLabel: a('save.saving'), pending }}
      footerNote={
        promptMissing ? (
          <p data-save-prompt="" className="text-muted-foreground text-xs">
            {a('save.promptMissing')}
          </p>
        ) : null
      }
      replayPanel={replayConflict === null ? null : replayConflictPanel}
      requirements={{
        ready: missingRequirements.length === 0,
        readyText: a('save.ready'),
        missing: a('steps.requiredMissing', { count: missingRequirements.length }),
        list: missingRequirements.map((item) => c(`save.requirement.${item.key}`)).join(' · '),
      }}
    >
      {/*
            1 — THE TRADE, READ FIRST. Four concepts, four rows: which account,
            what was traded, which way, and when it was entered. A row SHOWS the
            answer — the input that records it exists only inside the editor the
            row opens (DESIGN.md §6, "a disclosure that opens an editor surface
            looks like a launcher row"). Required or Optional is said once, on
            the row, so no helper paragraph repeats it.
          */}
      {section(
        'trade',
        'gap-3',
        <TradeDetailsStep
          mode="after_trade"
          idPrefix="after"
          options={options}
          timezone={timezone}
          now={now}
          tradingAccountId={draft.tradingAccountId}
          symbol={draft.symbol}
          direction={draft.direction}
          enteredAt={draft.enteredAt}
          errors={{
            tradingAccountId: errorText('tradingAccountId'),
            symbol: errorText('symbol'),
            direction: errorText('direction'),
          }}
          entryError={{
            code:
              entryErrorCode === undefined
                ? null
                : entryErrorCode === 'entry_time_required' ||
                    entryErrorCode === 'entry_date_required'
                  ? entryErrorCode
                  : 'other',
            text: errorText('enteredAt'),
          }}
          attempted={attempted}
          onTradingAccount={(tradingAccountId) =>
            apply((current) => ({ ...current, tradingAccountId }))
          }
          onSymbol={(symbol) => apply((current) => ({ ...current, symbol }))}
          onDirection={(direction) => apply((current) => ({ ...current, direction }))}
          onEntryDate={(date) => apply((current) => setEntryDate(current, date))}
          onEntryTime={(time) => apply((current) => setEntryTime(current, time))}
          onClearEntry={() => apply(clearEntryTimestamp)}
        />,
      )}

      {/* 2 — RISK & TARGET: the plan at entry, as remembered (canonical Stage 2) */}
      {section(
        'plan',
        'gap-4',
        <>
          {/*
                CANONICAL PLAN & RISK — the same component and order Record
                Open uses. Actual Risk is not here: it is an entry-time
                execution fact, asked in Entry Context (decision 53).
              */}
          <TradePlanRiskStep
            mode="after_trade"
            ids={PLAN_STEP_IDS}
            currency={currency}
            risk={draft.risk}
            target={draft.target}
            exitPlan={draft.exitPlan}
            priceContext={draft.context}
            options={options}
            errorText={(field) => errorText(PLAN_STEP_FIELD[field])}
            notices={{
              stopWrongSide: validation.notices.some((notice) => notice.kind === 'stop_wrong_side'),
              targetWrongSide: validation.notices.some(
                (notice) => notice.kind === 'target_wrong_side',
              ),
            }}
            onRiskChange={(risk) => apply((current) => ({ ...current, risk }))}
            onTargetStateChange={(state) => apply((current) => setTargetState(current, state))}
            onTargetValueChange={(field, value) =>
              apply((current) => setTargetValue(current, field, value))
            }
            onExitPlanChange={(exitPlan) => apply((current) => ({ ...current, exitPlan }))}
            onPriceContextChange={(patch) =>
              apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
            }
            onLibraryChanged={setAdoptedExitPlans}
            riskState={draft.riskState}
            onRiskStateChange={(next) => apply((current) => setRiskState(current, next))}
          />
        </>,
      )}

      {/* 3 — STRATEGY & SETUP (canonical Stage 3) */}
      {section(
        'setup',
        'gap-4',
        <>
          {/*
                CANONICAL SETUP & CHECKLIST — the same component Record Open
                uses. Record Closed mode: conditions may be Don't remember, and
                no Strategy default ever reaches the Exit Plan.
              */}
          <TradeSetupChecklistStep
            mode="after_trade"
            idPrefix="after"
            strategies={options.strategies}
            classification={{
              strategyAnswer: activeRead.strategyAnswer,
              strategy: activeRead.strategy,
              setupAnswer: activeRead.setupAnswer,
              setup: activeRead.setup,
              stale: staleRead,
            }}
            conditionAnswers={activeRead.conditionAnswers}
            onSelectStrategy={(id) => apply((current) => selectStrategy(current, id))}
            onNoStrategy={() => apply(answerNoStrategy)}
            onRemoveStrategy={() => apply(removeStrategyAnswer)}
            onSelectSetup={(id) => apply((current) => selectSetup(current, id))}
            onNoSetup={() => apply(answerNoSetup)}
            onRemoveSetup={() => apply(removeSetupAnswer)}
            onCondition={(key, status) => apply((current) => answerCondition(current, key, status))}
          />
        </>,
      )}

      {/* 4 — ENTRY CONTEXT (canonical Stage 4) */}
      {section(
        'context',
        'gap-4',
        <>
          {/*
                CANONICAL ENTRY CONTEXT & EVIDENCE — the same component Record
                Open uses: what the trader knew, thought and felt at entry, as
                remembered, with Actual Risk as its entry-time execution fact.
              */}
          <TradeEntryContextStep
            mode="after_trade"
            idPrefix="after"
            currency={currency}
            plannedRiskState={draft.riskState}
            /*
              EVERY ANSWER HERE IS THE TRADER'S OWN. This draft starts at
              `unanswered` and only a selection moves it, so `matched` reaching
              the row really does mean they said it matched.
            */
            actualRisk={
              draft.actualRisk.answer === 'matched'
                ? { kind: 'matched' }
                : draft.actualRisk.answer === 'different'
                  ? { kind: 'different', amount: draft.actualRisk.amount }
                  : draft.actualRisk.answer === 'unknown'
                    ? { kind: 'unknown' }
                    : { kind: 'not_recorded' }
            }
            actualRiskError={errorText('actualRisk')}
            actualRiskEditor={
              <div className="flex min-w-0 flex-col gap-3">
                <ChoiceGroup
                  idPrefix="after-actual-risk"
                  legend={a('actualRisk.legend')}
                  value={draft.actualRisk.answer === 'unanswered' ? null : draft.actualRisk.answer}
                  status={c('notAnswered')}
                  columns={3}
                  compact
                  fit="split"
                  error={
                    draft.actualRisk.answer === 'matched' ? errorText('actualRisk') : undefined
                  }
                  aside={
                    <InlineAction
                      ariaLabel={a('actualRisk.removeAria')}
                      onClick={() => apply((current) => setActualRiskAnswer(current, 'unanswered'))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
                  onChange={(answer) => apply((current) => setActualRiskAnswer(current, answer))}
                  options={[
                    { value: 'matched', label: a('actualRisk.matched') },
                    { value: 'different', label: a('actualRisk.different') },
                    { value: 'unknown', label: a('actualRisk.unknown') },
                  ]}
                />
                {draft.actualRisk.answer === 'different' ? (
                  <div className="border-control-border border-l-2 pl-4">
                    <TextField
                      id="after-actual-risk-amount"
                      label={a('actualRisk.amount')}
                      value={draft.actualRisk.amount}
                      onChange={(amount) =>
                        apply((current) => setActualRiskAmount(current, amount))
                      }
                      suffix={currency}
                      inputMode="decimal"
                      figure
                      hint={a('actualRisk.amountHint')}
                      error={errorText('actualRisk')}
                    />
                  </div>
                ) : null}
              </div>
            }
            confidence={draft.confidence}
            emotions={draft.emotions}
            catalog={options.emotionCatalog}
            values={draft.context}
            errors={{ tradingviewUrl: errorText('tradingviewUrl') }}
            canDeselectEmotion={(key) => canDeselectEmotion(draft.emotions, key)}
            onConfidence={(value) => apply((current) => setConfidence(current, value))}
            onToggleEmotion={(key) => apply((current) => toggleEmotion(current, 'emotions', key))}
            onNoEmotions={() => apply((current) => answerNoEmotions(current, 'emotions'))}
            onRemoveEmotions={() => apply((current) => removeEmotionsAnswer(current, 'emotions'))}
            onChange={(patch) =>
              apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
            }
          />
        </>,
      )}

      {/* 5 — TRADER RESULT: what the trader actually did (canonical Stage 5) */}
      {section(
        'result',
        'gap-4',
        <>
          <GroupCard filled data-result-panel="">
            {/*
                  CANONICAL STAGE 5 — the same final exit time, Final Net P&L,
                  Trader R and outcome controls Close Trade uses. Record Closed
                  never asks for a Part / All Remaining scope here: it
                  reconstructs a trade that is already closed.
                */}
            <ExitTimeField
              id="after-exitedAt"
              label={a('times.exit')}
              value={draft.exitedAt}
              timezone={timezone}
              locale={locale}
              error={errorText('exitedAt')}
              lastRecordedExit={
                latestExitLocal === null ? null : new Date(latestExitLocal.time).toISOString()
              }
              onChange={(exitedAt) => apply((current) => ({ ...current, exitedAt }))}
            />
            <FinalPnlField
              id="after-finalPnl"
              value={draft.finalPnl}
              currency={currency}
              error={errorText('finalPnl')}
              source={
                draft.finalPnl.trim() === ''
                  ? null
                  : finalPnlStillAdopted(draft, validation)
                    ? 'adopted'
                    : 'typed'
              }
              adoptable={validation.canAdoptExitSubtotal}
              subtotal={
                validation.exitSubtotalMinor === null
                  ? null
                  : formatMoney(validation.exitSubtotalMinor)
              }
              subtotalBlocked={null}
              onChange={(finalPnl) => apply((current) => setFinalPnl(current, finalPnl))}
              onAdopt={() => {
                if (validation.exitSubtotalMinor === null) return;
                setDraft((current) =>
                  adoptExitSubtotal(current, validation, (minor) =>
                    tradeMoneyInputValue(minor, currency),
                  ),
                );
                setServerMessage(null);
              }}
            />
            {/*
                  ACTUAL R IS DERIVED, AND READS LIKE IT. It is not another
                  field: it is what the figures above it come to, so it carries
                  the group's largest number when it has one and says plainly
                  what is still missing when it does not. Never a fabricated 0R.
                */}
            <ActualRReadoutRow readout={validation.actualR} />
          </GroupCard>

          <GroupCard data-result-outcome="">
            <TraderOutcomeField
              idPrefix="after-outcome"
              value={draft.outcome}
              contradicts={outcomeNotice !== undefined}
              onChange={(outcome) => apply((current) => setOutcome(current, outcome))}
            />
          </GroupCard>

          {/* Exit history: optional supporting evidence, never the result */}
          <FoldedGroup
            id="after-exits-toggle"
            title={a('sections.exits')}
            summary={
              exitErrorCount > 0 ? (
                <span className="text-destructive inline-flex min-w-0 items-center gap-1.5">
                  <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                  {c('summary.hasErrors', { count: exitErrorCount })}
                </span>
              ) : recordedExits.length === 0 ? (
                a('exits.summaryEmpty')
              ) : (
                a('exits.summaryCount', { count: recordedExits.length })
              )
            }
            open={exitsOpen || exitErrorCount > 0}
            onToggle={() => setExitsOpen((open) => !open)}
          >
            <ExitHistoryFields
              draft={draft}
              currency={currency}
              errorText={errorText}
              subtotal={validation.exitSubtotalMinor}
              discrepancy={
                discrepancy?.kind === 'exit_discrepancy'
                  ? {
                      subtotal: formatMoney(discrepancy.subtotalMinor),
                      final: formatMoney(discrepancy.finalPnlMinor),
                    }
                  : null
              }
              formatMoney={formatMoney}
              onAdd={() => apply((current) => addExit(current, generateId()))}
              onRemove={(id) => apply((current) => removeExit(current, id))}
              onChange={(id, patch) => apply((current) => updateExit(current, id, patch))}
              onCompleteness={(value) => apply((current) => setCompleteness(current, value))}
            />
          </FoldedGroup>
        </>,
      )}

      {/* 6 — AFTER TRADE (canonical Stage 6): System Result, then context; then the read-back and Save */}
      {section(
        'after',
        'gap-6',
        <>
          <TradeAfterTradeContextStep
            idPrefix={AFTER_CONTEXT_PREFIX}
            task="record_closed"
            systemResult={
              <TradePlanOutcomeSection
                idPrefix={AFTER_CONTEXT_PREFIX}
                plan={planOutcomePlan}
                currency={currency}
                exitPlan={recordedExitPlan}
                value={draft.planOutcome}
                error={planOutcomeError}
                onOutcome={(outcome) => apply((current) => setPlanOutcomeAnswer(current, outcome))}
                onAmount={(amount) => apply((current) => setPlanOutcomeAmountText(current, amount))}
              />
            }
            emotions={draft.postTradeEmotions}
            catalog={options.emotionCatalog}
            note={draft.afterTradeNote}
            tradingviewUrl={draft.afterTradeTradingviewUrl}
            errors={{ tradingviewUrl: errorText('afterTradeTradingviewUrl') }}
            canDeselectEmotion={(key) => canDeselectEmotion(draft.postTradeEmotions, key)}
            onToggleEmotion={(key) =>
              apply((current) => toggleEmotion(current, 'postTradeEmotions', key))
            }
            onNoEmotions={() => apply((current) => answerNoEmotions(current, 'postTradeEmotions'))}
            onRemoveEmotions={() =>
              apply((current) => removeEmotionsAnswer(current, 'postTradeEmotions'))
            }
            onNote={(afterTradeNote) => apply((current) => ({ ...current, afterTradeNote }))}
            onTradingviewUrl={(afterTradeTradingviewUrl) =>
              apply((current) => ({ ...current, afterTradeTradingviewUrl }))
            }
          />
          {/*
                THE FINAL READ-BACK, WHERE THERE IS NOTHING ELSE SAYING IT. On
                a wide screen the rail already restates every step beside the
                form, so this narrows to what would stop the Save. On a phone
                there is no rail, so the whole read-back belongs here.
              */}
          {wide ? (
            <div
              data-trade-summary="compact"
              className="border-border flex min-w-0 flex-col gap-2 rounded-lg border p-4"
            >
              {attentionSteps.length === 0 ? (
                <p className="text-muted-foreground text-sm">{a('save.helper')}</p>
              ) : (
                <>
                  <p className="text-destructive flex min-w-0 items-center gap-2 text-sm font-medium">
                    <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                    {a('steps.attention', {
                      count: attentionSteps.reduce((total, item) => total + item.errors, 0),
                    })}
                  </p>
                  <ul className="flex min-w-0 flex-col gap-1.5">
                    {attentionSteps.map((item) => (
                      <li
                        key={item.key}
                        className="flex min-w-0 items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="text-foreground min-w-0">{stepLabel(item.key)}</span>
                        <InlineAction
                          ariaLabel={a('steps.editAria', { step: stepLabel(item.key) })}
                          onClick={() => showStep(STEP_INDEX[item.key])}
                        >
                          {a('steps.edit')}
                        </InlineAction>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <div
              data-trade-summary="full"
              className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 rounded-lg border p-4"
            >
              <p className="text-foreground text-sm font-semibold">{a('steps.summaryTitle')}</p>
              <dl className="divide-border flex min-w-0 flex-col divide-y">
                {/* The steps before this one, in the task's own canonical order. */}
                {(['trade', 'plan', 'setup', 'context', 'result'] as const).map((key) => {
                  const errors = stepErrorCounts[STEP_INDEX[key]] ?? 0;
                  /*
                        THE ENTRY TIMESTAMP SAYS HOW MUCH OF IT IS RECORDED.
                        A date whose time is not recorded reads as the date
                        plus that fact, never as a date pretending to be an
                        instant and never as nothing at all.
                      */
                  const entered = key === 'trade' ? entryStampLabel : null;
                  const exited = key === 'trade' ? localTime(draft.exitedAt) : null;
                  const times =
                    entered !== null && exited !== null
                      ? `${entered} → ${exited}`
                      : entered !== null
                        ? `${a('times.entry')} ${entered}`
                        : exited !== null
                          ? `${a('times.exit')} ${exited}`
                          : null;
                  return (
                    <div
                      key={key}
                      className="flex min-w-0 items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <dt className="text-muted-foreground text-xs font-medium">
                          {stepLabel(key)}
                        </dt>
                        <dd
                          className={cn(
                            'text-sm break-words',
                            errors > 0
                              ? 'text-destructive'
                              : stepSummaries[key] === null
                                ? 'text-subtle-foreground'
                                : 'text-foreground',
                          )}
                        >
                          {/* Nothing recorded is a choice, not a shortfall. */}
                          {errors > 0
                            ? a('steps.needsAttention')
                            : (stepSummaries[key] ??
                              (key === 'trade'
                                ? a('steps.summaryNotRecorded')
                                : a('steps.optional')))}
                          {times === null ? null : (
                            <span className="text-muted-foreground block text-xs tabular-nums">
                              {times}
                            </span>
                          )}
                        </dd>
                      </div>
                      <InlineAction
                        ariaLabel={a('steps.editAria', { step: stepLabel(key) })}
                        onClick={() => showStep(STEP_INDEX[key])}
                      >
                        {a('steps.edit')}
                      </InlineAction>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
        </>,
      )}
    </TradeStepFlow>
  );
}

function ExitHistoryFields({
  draft,
  currency,
  errorText,
  subtotal,
  discrepancy,
  formatMoney,
  onAdd,
  onRemove,
  onChange,
  onCompleteness,
}: {
  draft: AfterTradeDraft;
  currency: string;
  errorText: (field: AfterTradeField) => string | undefined;
  subtotal: string | null;
  discrepancy: { readonly subtotal: string; readonly final: string } | null;
  formatMoney: (minor: string) => string;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<Omit<AfterTradeExitDraft, 'id'>>) => void;
  onCompleteness: (value: AfterTradeDraft['completeness']) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const c = useTranslations('trades.create.recording.contractEntry');
  const hasExits = draft.exits.some(meaningfulExit);
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-3">
      <Helper>{a('exits.description')}</Helper>
      {/* The disclosure's own summary already says there are none. */}
      {draft.exits.length === 0 ? null : (
        <ol className="flex min-w-0 flex-col gap-3">
          {draft.exits.map((exit, index) => {
            const number = index + 1;
            const prefix = `after-exit-${exit.id}`;
            return (
              <li
                key={exit.id}
                data-after-exit=""
                className="border-border flex min-w-0 flex-col gap-4 rounded-md border px-3 py-3 sm:px-4"
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-foreground text-sm font-semibold">
                    {a('exits.exitNumber', { number })}
                  </p>
                  <InlineAction
                    ariaLabel={a('exits.removeAria', { number })}
                    onClick={() => onRemove(exit.id)}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      {a('exits.remove')}
                    </span>
                  </InlineAction>
                </div>
                <ChoiceGroup
                  idPrefix={`${prefix}-scope`}
                  legend={a('exits.scope')}
                  value={exit.scope === '' ? null : exit.scope}
                  status={c('notAnswered')}
                  columns={3}
                  compact
                  aside={
                    <InlineAction
                      ariaLabel={a('exits.removeScopeAria', { number })}
                      onClick={() => onChange(exit.id, { scope: '' })}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
                  onChange={(scope) => onChange(exit.id, { scope })}
                  options={[
                    { value: 'part', label: a('exits.scopePart') },
                    { value: 'all_remaining', label: a('exits.scopeAll') },
                    { value: 'unknown', label: a('exits.scopeUnknown') },
                  ]}
                />
                <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
                  <TextField
                    id={`${prefix}-pnl`}
                    label={a('exits.pnl')}
                    value={exit.pnl}
                    onChange={(pnl) => onChange(exit.id, { pnl })}
                    suffix={currency}
                    inputMode="decimal"
                    figure
                    error={errorText(exitField(exit.id, 'pnl'))}
                  />
                  <TextField
                    id={`${prefix}-closedPercent`}
                    label={a('exits.percent')}
                    value={exit.closedPercent}
                    onChange={(closedPercent) => onChange(exit.id, { closedPercent })}
                    suffix="%"
                    inputMode="decimal"
                    figure
                    error={errorText(exitField(exit.id, 'closedPercent'))}
                  />
                  <TextField
                    id={`${prefix}-exitedAt`}
                    type="datetime-local"
                    label={a('exits.time')}
                    value={exit.exitedAt}
                    onChange={(exitedAt) => onChange(exit.id, { exitedAt })}
                    figure
                    error={errorText(exitField(exit.id, 'exitedAt'))}
                  />
                  <TextField
                    id={`${prefix}-price`}
                    label={a('exits.price')}
                    value={exit.price}
                    onChange={(price) => onChange(exit.id, { price })}
                    inputMode="decimal"
                    figure
                    labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
                    error={errorText(exitField(exit.id, 'price'))}
                  />
                </div>
                <TextField
                  id={`${prefix}-reason`}
                  label={a('exits.reason')}
                  value={exit.reason}
                  onChange={(reason) => onChange(exit.id, { reason })}
                />
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdd}
            disabled={!canAddExit(draft)}
          >
            <Plus aria-hidden="true" />
            {a('exits.add')}
          </Button>
        </div>
        {canAddExit(draft) ? null : (
          <p className="text-muted-foreground text-xs">
            {a('exits.limitReached', { limit: HISTORICAL_EXIT_LIMIT })}
          </p>
        )}
      </div>

      {hasExits ? (
        <ChoiceGroup
          idPrefix="after-completeness"
          legend={a('exits.completeness')}
          value={draft.completeness === 'unanswered' ? null : draft.completeness}
          status={c('notAnswered')}
          columns={3}
          compact
          aside={
            <InlineAction
              ariaLabel={a('exits.removeCompletenessAria')}
              onClick={() => onCompleteness('unanswered')}
            >
              {c('removeAnswer')}
            </InlineAction>
          }
          onChange={onCompleteness}
          options={[
            { value: 'complete', label: a('exits.complete') },
            { value: 'incomplete', label: a('exits.incomplete') },
            { value: 'unknown', label: a('exits.unknown') },
          ]}
        />
      ) : null}

      {subtotal === null ? null : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-foreground text-sm tabular-nums">
            {a('exits.subtotal', { amount: formatMoney(subtotal) })}
          </p>
          <p className="text-muted-foreground text-xs">{a('exits.subtotalSupporting')}</p>
        </div>
      )}
      {discrepancy === null ? null : (
        <Notice
          icon={
            <History className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
          }
        >
          {a('exits.discrepancy', discrepancy)}
        </Notice>
      )}
    </div>
  );
}
