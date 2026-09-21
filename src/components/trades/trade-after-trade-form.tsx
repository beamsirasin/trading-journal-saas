'use client';

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  CalendarClock,
  ChartCandlestick,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  History,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';

import { shiftCalendarMonth } from '@/lib/dashboard/calendar-grid';
import { buildDateRangePickerMonth } from '@/lib/dashboard/date-range-calendar';
import {
  formatCalendarDateLabel,
  formatCalendarMonthLabel,
} from '@/lib/dashboard/date-range-presentation';
import { generateId } from '@/lib/identifiers';
import { calendarDateIn } from '@/lib/time';
import { CONFIDENCE_LEVELS, confidenceLevelKey, type OutcomeValue } from '@/lib/trades/constants';
import { HISTORICAL_EXIT_LIMIT } from '@/lib/trades/schemas';
import { cn } from '@/lib/utils';
import { createCompletedTradeAction } from '@/server/actions/trades';
import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';
import { DateRangeMonthGrid } from '@/components/dashboard/toolbar/date-range-month-grid';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

import {
  activeAfterTradeClassification,
  addExit,
  adoptExitSubtotal,
  afterTradeAnalysisSummary,
  afterTradeFieldSection,
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
  entryTimestampParts,
  exitField,
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
  type EmotionPhase,
  type RecalledConditionStatus,
} from './after-trade-draft';
import { createAtEntryDraft } from './at-entry-draft';
import { hasStaleSelection, staleSelections, UNAVAILABLE_OPTION } from './stale-selection';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import {
  Chip,
  ChoiceGroup,
  Disclosure,
  FieldError,
  Helper,
  InlineAction,
  Legend,
  Notice,
  SelectField,
  StateText,
  Tag,
  TextAreaField,
  TextField,
  type ChoiceTone,
} from './trade-at-entry-controls';
import { AtEntryExitPlan } from './trade-at-entry-exit-plan';
import { TradeChoiceList } from './trade-choice-list';
import { datetimeLocalToIso, tradeMoneyInputValue } from './trade-form-values';
import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';
import type { RecordingSaveControls } from './trade-recording-form';
import { TradeRecordingModeChange } from './trade-recording-mode-change';
import { groupEmotionCatalog } from './trade-recording-primitives';
import { useKeyboardObscuringViewport } from './trade-recording-surface';
import { TradeSaveReplayConflict } from './trade-save-replay';
import { TradeSymbolPicker } from './trade-symbol-picker';
import { TradeTimeWheel } from './trade-time-wheel';
import { useSavedSymbols } from './use-saved-symbols';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

const NONE = '__none';

/**
 * THE FOUR THINGS STEP 1 RECORDS, each its own concept and its own editor.
 * `enteredAt` is the only optional one; the other three are everything Save
 * needs. The key is the draft field, so a blocked Save maps straight onto the
 * row that holds the problem.
 */
type TradeConcept = 'tradingAccountId' | 'symbol' | 'direction' | 'enteredAt';

/** The trader's calendar date, in THEIR zone — never the browser's (CLAUDE.md §7). */
function todayIn(now: Date, timezone: string): string | null {
  const resolved = calendarDateIn(now, timezone);
  return resolved.ok ? resolved.value : null;
}

/**
 * The month the entry-date calendar opens on: the recorded date's, else the
 * trader's current month, else the epoch — never the browser's month, which
 * may be a different day from the trader's own (CLAUDE.md §7).
 */
function monthOf(
  date: string,
  todayDate: string | null,
): { readonly year: number; readonly month: number } {
  const anchor = date !== '' ? date : (todayDate ?? '1970-01-01');
  return {
    year: Number.parseInt(anchor.slice(0, 4), 10),
    month: Number.parseInt(anchor.slice(5, 7), 10),
  };
}

/** The launcher row for a Step 1 concept — what a failed Save focuses. */
function conceptRowId(concept: TradeConcept): string {
  return `after-row-${concept}`;
}

/**
 * THE FIVE STEPS OF A CLOSED-TRADE RECORDING. One topic at a time: the trade,
 * its result (the moment's question), the plan as remembered, the trader's
 * read, then lower-priority details and Save. Only Step 1 holds anything Save
 * needs; every other step can be left unanswered and still advanced.
 */
const STEPS = ['trade', 'result', 'plan', 'context', 'details'] as const;
type StepKey = (typeof STEPS)[number];
const STEP_INDEX: Readonly<Record<StepKey, number>> = {
  trade: 0,
  result: 1,
  plan: 2,
  context: 3,
  details: 4,
};
const LAST_STEP = STEPS.length - 1;

/** The step that shows a field — where a failed Save goes to reach it. */
function fieldStep(field: AfterTradeField): number {
  /*
    The final exit time is read on the Result step: it says how the trade
    ended, not which trade it was. `afterTradeFieldSection` still groups it
    with the trade — that grouping belongs to the draft module and to Save's
    own disclosure handling, and is not this step map.
  */
  if (field === 'exitedAt') return STEP_INDEX.result;
  switch (afterTradeFieldSection(field)) {
    case 'result':
    case 'exits':
      return STEP_INDEX.result;
    case 'plan':
      return STEP_INDEX.plan;
    case 'context':
      return STEP_INDEX.details;
    default:
      return STEP_INDEX.trade;
  }
}

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
      return conceptRowId(field);
    case 'actualRisk':
      return 'after-actual-risk-amount';
    default:
      return `after-${field}`;
  }
}

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
};

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
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const cx = useTranslations('trades.create.recording.contractEntry.context');
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
  const savedSymbols = useSavedSymbols(options.savedSymbols, options.workspaceId);
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

  /*
    WHICH STEP 1 EDITOR IS OPEN — view state, never draft state. Step 1 shows
    what has been recorded; an editing control exists only while the trader has
    one open, and every change inside it lands in the draft as it is made, so
    closing by Done, Escape, the backdrop or the system back gesture keeps the
    work (UX Rules §5.2, §17.4).
  */
  const [editor, setEditor] = useState<TradeConcept | null>(null);
  /*
    WHICH MONTH THE ENTRY-DATE CALENDAR SHOWS — view state, like the open
    editor. It opens on the recorded date's month, or on the trader's own
    current month, and every reopen re-anchors it, so paging never drifts away
    from the answer it is meant to be adjusting.
  */
  /**
   * Which half of the entry timestamp has its control open, if either. View
   * state inside one sheet, so the two answers never need a second overlay.
   */
  const [entryPane, setEntryPane] = useState<'date' | 'time' | null>(null);
  /**
   * The sheet has been closed at least once with only half an answer in it.
   * That is when the missing half starts saying so — not while the trader is
   * still part-way through giving it.
   */
  const [entryStampReviewed, setEntryStampReviewed] = useState(false);
  const [pickerMonth, setPickerMonth] = useState(() =>
    monthOf(entryTimestampParts(draft.enteredAt).date, todayIn(new Date(), timezone)),
  );
  const conceptRows: Readonly<Record<TradeConcept, RefObject<HTMLButtonElement | null>>> = {
    tradingAccountId: useRef<HTMLButtonElement>(null),
    symbol: useRef<HTMLButtonElement>(null),
    direction: useRef<HTMLButtonElement>(null),
    enteredAt: useRef<HTMLButtonElement>(null),
  };
  const [exitsOpen, setExitsOpen] = useState(draft.exits.some(meaningfulExit));
  const [emotionsOpen, setEmotionsOpen] = useState<Readonly<Record<EmotionPhase, boolean>>>({
    emotions: false,
    postTradeEmotions: false,
  });
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
  const [emotionHint, setEmotionHint] = useState<EmotionPhase | null>(null);
  const [adoptedMessage, setAdoptedMessage] = useState<string | null>(null);

  const apply = (change: (current: AfterTradeDraft) => AfterTradeDraft) => {
    setDraft((current) => change(current));
    setServerMessage(null);
    setAdoptedMessage(null);
  };

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === draft.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const now = new Date();
  const validation = validateAfterTradeDraft(draft, { currency, timezone, now });
  const readiness = afterTradeReadiness(draft, validation);
  const summary = afterTradeAnalysisSummary(draft, options);
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
      case 'exitedAt':
        return draft.exitedAt;
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
      fields
        .filter((field) => fieldStep(field) === index)
        .map((field) => () => document.getElementById(fieldTargetId(field))),
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
        showStep(STEP_INDEX.context, [() => document.getElementById(target)]);
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
    draft.context.entryPrice,
    draft.context.stopPrice,
    draft.context.positionSize,
    draft.context.notes,
  ].filter((value) => value.trim() !== '').length;
  const exitErrorCount = Object.keys(visibleErrors).filter(
    (field) => afterTradeFieldSection(field as AfterTradeField) === 'exits',
  ).length;
  /** Blocking errors each step holds, so a step with one is marked wherever it is listed. */
  const stepErrorCounts = STEPS.map(
    (_, index) =>
      Object.keys(visibleErrors).filter((field) => fieldStep(field as AfterTradeField) === index)
        .length,
  );

  const analysisLines: string[] = [];
  if (summary.strategy.answer === 'none') analysisLines.push(c('summary.noStrategy'));
  if (summary.strategy.answer === 'selected' && summary.strategy.name !== null) {
    const setupPart =
      summary.setup.answer === 'none'
        ? c('summary.noSetup')
        : summary.setup.answer === 'selected'
          ? summary.setup.name
          : null;
    analysisLines.push([summary.strategy.name, setupPart].filter(Boolean).join(' · '));
    if (summary.conditions !== null) {
      analysisLines.push(
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
  if (summary.postTradeEmotions.answer === 'none') analysisLines.push(a('summary.postTradeNone'));
  if (summary.postTradeEmotions.answer === 'selected') {
    analysisLines.push(a('summary.postTradeCount', { count: summary.postTradeEmotions.count }));
  }

  // The latest recorded exit time, offered — never applied — as the final exit time.
  const latestExitLocal = (() => {
    if (draft.exitedAt !== '') return null;
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
    STEP 1's EDITORS, ONE RULE. A single-choice editor — Trading Account,
    Symbol, Direction — commits on the choice and closes; a multi-part one —
    Entry date & time — keeps Done. Either way the answer is written to the
    draft as it is made, so closing by X, Escape or the backdrop changes
    nothing that was not already chosen.
  */
  const closeEditorOn = (next: boolean) => {
    if (!next) setEditor(null);
  };
  /*
    THE ENTRY TIMESTAMP, READ AS ITS TWO HALVES. One stored value still; these
    only say how it is shown and which row an error belongs beside. A date with
    no time is the time's problem, not the date's — the date is a perfectly
    good answer and the row must not mark it wrong.
  */
  const entryParts = entryTimestampParts(draft.enteredAt);
  const entryDateLabel =
    entryParts.date === ''
      ? null
      : (formatCalendarDateLabel(entryParts.date, locale) ?? entryParts.date);
  /*
    HALF AN ANSWER IS NOT AN ERROR WHILE IT IS BEING GIVEN. A trader who picks
    a day has not done anything wrong yet — they are mid-answer, and the other
    row is right there. The completion message appears once they have closed
    the sheet on it, or once a Save has stopped on it; until then the rows just
    say what is recorded.
  */
  const entryErrorCode = validation.errors.enteredAt;
  const entryIncomplete =
    entryErrorCode === 'entry_time_required' || entryErrorCode === 'entry_date_required';
  const showEntryIncomplete = entryIncomplete && (attempted || entryStampReviewed);
  const entryError = entryIncomplete
    ? showEntryIncomplete
      ? errorText('enteredAt')
      : undefined
    : errorText('enteredAt');
  const timeError = entryErrorCode === 'entry_time_required' ? entryError : undefined;
  const dateError = entryErrorCode === 'entry_date_required' ? entryError : undefined;
  /*
    HOW MUCH OF "WHEN" IS RECORDED, IN ONE LINE. A date whose time is unknown
    reads as the date plus that fact — never as a date pretending to be an
    instant, and never as nothing at all.
  */
  const entryStampLabel = (() => {
    const day = entryDateLabel ?? entryParts.date;
    if (entryParts.date !== '' && entryParts.time !== '') return `${day} · ${entryParts.time}`;
    // Half an answer reads as the half that is there, and what is not.
    if (entryParts.date !== '') return `${day} · ${a('times.entryTimeNotRecorded')}`;
    if (entryParts.time !== '') {
      return `${entryParts.time} · ${a('times.entryDateNotRecorded')}`;
    }
    return null;
  })();

  /*
    THE MONTH THE CALENDAR OPENS ON. The recorded date's month, or the trader's
    current month when nothing is recorded — resolved in THEIR timezone, never
    the browser's or the server's (CLAUDE.md §7). Paging is view state and is
    reset every time the editor opens, so it never drifts away from the answer.
  */
  const todayDate = todayIn(now, timezone);
  const pickerGrid = buildDateRangePickerMonth({
    year: pickerMonth.year,
    month: pickerMonth.month,
    // The range collapsed to one day: the builder reports it as `single`.
    draft: { datePreset: 'custom', from: entryParts.date, to: entryParts.date },
    todayDate,
    // An entry cannot be in the future, which validation already refuses.
    maxDate: todayDate,
  });

  const outcomeNotice = validation.notices.find(
    (notice) => notice.kind === 'outcome_contradicts_pnl',
  );
  const discrepancy = validation.notices.find((notice) => notice.kind === 'exit_discrepancy');

  // At Entry's Exit Plan editor, shown a draft with no Strategy selected: no
  // default exists to inherit, so nothing is ever inherited (contract §5).
  const exitPlanView = { ...createAtEntryDraft(''), exitPlan: draft.exitPlan };

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
    ]),
    context: joinParts(analysisLines),
    details: contextFilled === 0 ? null : c('summary.contextFilled', { count: contextFilled }),
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
  /** Step 1 has no earlier step, so its bar holds one action rather than a pair. */
  const noBack = step === 0;
  const nextKey = STEPS[step + 1];
  const progressText = a('steps.progress', { current: step + 1, total: STEPS.length });

  /** The step list, tappable: a segmented rail on a phone, a labelled list beside a wide form. */
  const stepNav = wide ? (
    <nav aria-label={a('steps.navLabel')}>
      <ol className="flex min-w-0 flex-col gap-1">
        {STEPS.map((key, index) => {
          const current = index === step;
          const errors = stepErrorCounts[index] ?? 0;
          const line = stepSummaries[key];
          return (
            <li key={key} className="min-w-0">
              <button
                type="button"
                data-step-link={key}
                aria-current={current ? 'step' : undefined}
                onClick={() => showStep(index)}
                className={cn(
                  'hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none focus-visible:ring-2',
                  current && 'bg-accent',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                    errors > 0
                      ? 'border-destructive text-destructive'
                      : current
                        ? 'border-primary bg-primary text-primary-foreground'
                        : line === null
                          ? 'border-control-border text-muted-foreground'
                          : 'border-primary text-primary',
                  )}
                >
                  {errors > 0 ? <CircleAlert className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-foreground block text-sm',
                      current ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {stepLabel(key)}
                  </span>
                  {/*
                    AN UNANSWERED OPTIONAL STEP IS OPTIONAL, NOT UNFINISHED.
                    Everything but the trade's identity can be left alone and
                    still saved, so an untouched step reads "Optional" rather
                    than as work outstanding. Step 1 says what is still needed
                    instead, because that is the only step that needs anything.
                  */}
                  <span
                    className={cn(
                      'block truncate text-xs',
                      errors > 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {errors > 0
                      ? a('steps.needsAttention')
                      : key === 'trade' && missingRequirements.length > 0
                        ? a('steps.requiredMissing', { count: missingRequirements.length })
                        : (line ?? a('steps.optional'))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  ) : (
    /*
      THE RAIL SITS CLOSE UNDER ITS LABEL. Each segment keeps its 32px hit
      area, but the bar rides near the top of it rather than in the middle, so
      the "Step 1 of 5" line and the segments that draw it read as one unit;
      and the rail gives back the header's gap beneath it, so the step heading
      starts right where the hit areas end — touching, never overlapping.
    */
    <nav aria-label={a('steps.navLabel')} className="-mb-2.5">
      <ol className="grid min-w-0 grid-cols-5 gap-1.5">
        {STEPS.map((key, index) => {
          const current = index === step;
          const errors = stepErrorCounts[index] ?? 0;
          return (
            <li key={key} className="min-w-0">
              <button
                type="button"
                data-step-link={key}
                aria-current={current ? 'step' : undefined}
                aria-label={a('steps.goTo', {
                  current: index + 1,
                  total: STEPS.length,
                  step: stepLabel(key),
                })}
                onClick={() => showStep(index)}
                className="focus-visible:ring-ring flex h-8 w-full items-start rounded-sm pt-1.5 outline-none focus-visible:ring-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-full rounded-full transition-colors motion-reduce:transition-none',
                    errors > 0
                      ? 'bg-destructive'
                      : current
                        ? 'bg-progress-active'
                        : index < step
                          ? 'bg-progress-complete'
                          : 'bg-progress-rail',
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  /** One emotion question, folded to its answer until the trader opens it. */
  const emotionQuestion = (phase: EmotionPhase) => {
    const answer = draft[phase];
    const legend = phase === 'emotions' ? a('emotions.entryLegend') : a('emotions.postLegend');
    return (
      <Disclosure
        id={`after-${phase}-toggle`}
        title={legend}
        summary={
          answer.answer === 'selected'
            ? answer.keys.map((key) => t(`emotions.${key}`)).join(', ')
            : answer.answer === 'none'
              ? c('emotions.none')
              : c('notAnswered')
        }
        open={emotionsOpen[phase]}
        onToggle={() => setEmotionsOpen((current) => ({ ...current, [phase]: !current[phase] }))}
      >
        <EmotionFields
          phase={phase}
          answer={answer}
          legend={legend}
          hint={phase === 'postTradeEmotions' ? a('emotions.postHint') : undefined}
          removeAria={
            phase === 'emotions' ? c('emotions.removeAria') : a('emotions.removePostAria')
          }
          catalog={options.emotionCatalog}
          showLastOneHint={emotionHint === phase}
          onToggle={(key) => {
            if (!canDeselectEmotion(draft[phase], key)) {
              setEmotionHint(phase);
              return;
            }
            setEmotionHint(null);
            apply((current) => toggleEmotion(current, phase, key));
          }}
          onNone={() => {
            setEmotionHint(null);
            apply((current) => answerNoEmotions(current, phase));
          }}
          onRemove={() => {
            setEmotionHint(null);
            apply((current) => removeEmotionsAnswer(current, phase));
          }}
        />
      </Disclosure>
    );
  };

  const stepAttention = stepErrorCounts[step] ?? 0;
  /** The steps a Save would stop on, named so the last step can point at them. */
  const attentionSteps = STEPS.map((key) => ({
    key,
    errors: stepErrorCounts[STEP_INDEX[key]] ?? 0,
  })).filter((item) => item.errors > 0);

  const section = (key: StepKey, className: string, children: ReactNode) => (
    <section
      key={key}
      aria-labelledby={ids.step}
      data-step={key}
      hidden={currentKey !== key}
      className={cn(
        // The shown step takes the space between the header and the action
        // bar, so the bar sits at the foot of the step rather than wherever
        // the step's content happened to stop.
        'min-w-0 flex-col px-0 pb-5 sm:px-6 lg:px-8',
        currentKey === key ? 'flex flex-1' : 'hidden',
        className,
      )}
    >
      {children}
    </section>
  );

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-3 lg:gap-6">
      {/*
        THE MODE, SAID ONCE AND BRIEFLY. On a wide screen the sentence
        explaining the mode sits above the flow, where it costs nothing. On a
        phone it would be a whole row of page furniture between the trader and
        the question, so it travels down into the step header as two words
        beside "Step 2 of 5" — the same element, in one place, either way.
      */}
      {wide ? (
        <p
          data-recording-mode="after_trade"
          className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
        >
          <span>{a('subtitle')}</span>
          <TradeRecordingModeChange />
        </p>
      ) : null}

      {/*
        THE WORKFLOW IS THE PAGE'S SUBJECT, NOT A WIDGET ON IT. 50rem of step
        beside 17.5rem of rail, centred, with room between them — the step card
        carries the reading measure and the rail stays a companion. The scale
        inside the card does the rest: a card this wide holding phone-sized
        type is what made the flow read as a small dialog adrift in a large
        workspace.
      */}
      <div className="grid min-w-0 flex-1 gap-6 lg:grid-cols-[minmax(0,50rem)_17.5rem] lg:justify-center lg:gap-8 xl:gap-10">
        <form
          ref={formRef}
          id={formId}
          data-after-trade-form=""
          data-after-trade-step={currentKey}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            // Save lives on the last step; Enter elsewhere never saves early.
            if (onLastStep) void submit();
          }}
          /*
            FLAT ON A PHONE, A CARD ON A WIDE SCREEN. One step at a time is
            already the container; a raised card around it only nests the
            step's own panels one level deeper.
          */
          className="lg:bg-card lg:shadow-card lg:border-border flex w-full min-w-0 scroll-mt-[calc(var(--shell-header-height,0px)+1rem)] flex-col lg:rounded-xl lg:border"
        >
          {/*
            ONE LAYER OF CONTEXT, THEN THE STEP. A phone reads down: where this
            is in the flow (mode, a way to change it, how far along), the
            progress itself, then the step's own question. Saying "Step 1 of 5"
            in its own row above the segments that already draw it, and the
            mode again under a page title that already names it, put three
            lines of furniture between the trader and the first answer.
          */}
          <header className="flex min-w-0 flex-col gap-2.5 px-0 pt-0.5 pb-4 sm:px-6 lg:pt-7 lg:pb-5 lg:pl-8">
            {wide ? null : (
              /*
                A 12px LINE IN A 44px BOX. `Change` keeps its full tap target,
                which leaves 14px of air above and below the words; the row
                gives most of it back — up into the space under the page title
                (still clear of the Back link) and down into the header's gap
                (meeting the rail's hit areas, not overlapping them).
              */
              <div className="text-muted-foreground -mt-3 -mb-2.5 flex min-w-0 items-baseline justify-between gap-3 text-xs font-medium">
                <p
                  data-recording-mode="after_trade"
                  className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                >
                  <span>{a('steps.modeShort')}</span>
                  <TradeRecordingModeChange />
                </p>
                <span data-step-progress="" className="shrink-0 tracking-wide tabular-nums">
                  {progressText}
                </span>
              </div>
            )}
            {wide ? null : stepNav}
            <div className="flex min-w-0 flex-col gap-1 pt-0.5 lg:gap-1.5">
              {wide ? (
                <span
                  data-step-progress=""
                  className="text-muted-foreground text-xs font-medium tracking-wide tabular-nums"
                >
                  {progressText}
                </span>
              ) : null}
              <h2
                id={ids.step}
                ref={stepHeading}
                tabIndex={-1}
                className="text-foreground text-[1.375rem] leading-tight font-semibold tracking-tight outline-none sm:text-2xl lg:text-[1.75rem]"
              >
                {a(`steps.${currentKey}.title`)}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed lg:text-base">
                {a(`steps.${currentKey}.description`)}
              </p>
            </div>
            {/*
              THE STEP SAYS WHAT IS WRONG WITH IT. A phone has no rail to read,
              so the count lives with the step; the error itself stays beside
              the control it belongs to.
            */}
            {stepAttention === 0 ? null : (
              <p
                data-step-attention=""
                role="status"
                className="text-destructive flex min-w-0 items-center gap-2 text-sm font-medium"
              >
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {a('steps.attention', { count: stepAttention })}
              </p>
            )}
          </header>

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
            <div className="grid min-w-0 gap-2.5 min-[560px]:grid-cols-2 lg:gap-3">
              <ConceptRow
                concept="tradingAccountId"
                rowRef={conceptRows.tradingAccountId}
                label={c('account.label')}
                marker={<RequiredTag />}
                /* The chosen account, or the same "Choose an account" the editor opens on. */
                value={
                  selectedAccount === undefined
                    ? null
                    : `${selectedAccount.name} · ${selectedAccount.baseCurrency}`
                }
                placeholder={c('account.choose')}
                raw={draft.tradingAccountId}
                error={errorText('tradingAccountId')}
                editLabel={a('trade.editAria', { field: c('account.label') })}
                icon={Wallet}
                iconTone={selectedAccount === undefined ? undefined : 'accent'}
                onOpen={() => setEditor('tradingAccountId')}
                data-account-context=""
              />
              <ConceptRow
                concept="symbol"
                rowRef={conceptRows.symbol}
                label={c('symbol.label')}
                marker={<RequiredTag />}
                value={draft.symbol.trim() === '' ? null : draft.symbol.trim().toUpperCase()}
                placeholder={c('notAnswered')}
                raw={draft.symbol}
                error={errorText('symbol')}
                editLabel={a('trade.editAria', { field: c('symbol.label') })}
                icon={ChartCandlestick}
                iconTone={draft.symbol.trim() === '' ? undefined : 'accent'}
                onOpen={() => setEditor('symbol')}
              />
              <ConceptRow
                concept="direction"
                rowRef={conceptRows.direction}
                label={c('direction.label')}
                marker={<RequiredTag />}
                value={
                  draft.direction === 'long'
                    ? c('direction.long')
                    : draft.direction === 'short'
                      ? c('direction.short')
                      : null
                }
                /*
                  A SCANNING AID, NOT A VERDICT. The word is always there and
                  always first; the hue only helps the eye find which way this
                  trade went in a column of rows. Nothing on this step shows a
                  result, so green here cannot be misread as a win.
                */
                valueTone={
                  draft.direction === 'long'
                    ? 'positive'
                    : draft.direction === 'short'
                      ? 'negative'
                      : undefined
                }
                placeholder={c('notAnswered')}
                raw={draft.direction}
                error={errorText('direction')}
                editLabel={a('trade.editAria', { field: c('direction.label') })}
                /*
                  THE SHAPE SAYS IT BEFORE THE HUE DOES: both ways while
                  unanswered, then the trend the trade took — so the icon
                  carries the direction in greyscale too, beside the word.
                */
                icon={
                  draft.direction === 'long'
                    ? TrendingUp
                    : draft.direction === 'short'
                      ? TrendingDown
                      : ArrowUpDown
                }
                iconTone={
                  draft.direction === 'long'
                    ? 'positive'
                    : draft.direction === 'short'
                      ? 'negative'
                      : undefined
                }
                onOpen={() => setEditor('direction')}
              />
              {/*
                WHEN, AS ONE CONCEPT ON THE STEP AND TWO ANSWERS INSIDE IT.
                "When did you enter?" is one question a trader either can or
                cannot answer, so it takes one row here and says how much of it
                is recorded; the day and the minute are separate answers only
                once the editor is open, because they are separately knowable.
                Blank is "Not recorded", never unanswered and never a zero (UX
                Rules §4); the final exit time belongs to how the trade ended,
                and stays on Step 2.
              */}
              <ConceptRow
                concept="enteredAt"
                rowRef={conceptRows.enteredAt}
                label={a('times.entryDateTime')}
                marker={<OptionalTag />}
                value={entryStampLabel}
                placeholder={a('times.notRecorded')}
                raw={draft.enteredAt}
                error={entryError}
                editLabel={a('trade.editAria', { field: a('times.entryDateTime') })}
                icon={CalendarClock}
                // Half a timestamp is not an answer yet: a date needs its time.
                iconTone={entryParts.date !== '' && entryParts.time !== '' ? 'accent' : undefined}
                onOpen={() => {
                  setPickerMonth(monthOf(entryParts.date, todayDate));
                  /*
                    THE SHEET OPENS SHOWING BOTH QUESTIONS AND ANSWERING
                    NEITHER. Opening one of them for the trader guesses which
                    half they came to give, and a calendar or a wheel unfolding
                    on arrival is a control they have to dismiss before they can
                    even read what the other row says.
                  */
                  setEntryPane(null);
                  setEditor('enteredAt');
                }}
              />
            </div>,
          )}

          {/* 2 — WHAT HAPPENED: the moment's question, and the strongest step */}
          {section(
            'result',
            'gap-4',
            <>
              <GroupCard filled data-result-panel="">
                <TimeField
                  id="after-exitedAt"
                  label={a('times.exit')}
                  value={draft.exitedAt}
                  error={errorText('exitedAt')}
                  onChange={(exitedAt) => apply((current) => ({ ...current, exitedAt }))}
                />
                {latestExitLocal === null ? null : (
                  <div className="-mt-2">
                    <InlineAction
                      onClick={() =>
                        apply((current) => ({ ...current, exitedAt: latestExitLocal.local }))
                      }
                    >
                      {a('times.useLatestExit', {
                        time:
                          formatTradeInstant(
                            new Date(latestExitLocal.time).toISOString(),
                            timezone,
                            locale,
                          ) ?? latestExitLocal.local,
                      })}
                    </InlineAction>
                  </div>
                )}
                <TextField
                  id="after-finalPnl"
                  label={a('result.finalPnl')}
                  value={draft.finalPnl}
                  onChange={(finalPnl) => apply((current) => setFinalPnl(current, finalPnl))}
                  suffix={currency}
                  inputMode="decimal"
                  size="lead"
                  figure
                  hint={a('result.finalPnlHint', { currency })}
                  error={errorText('finalPnl')}
                />
                {/*
                  ACTUAL R IS DERIVED, AND READS LIKE IT. It is not another
                  field: it is what the figures above it come to, so it carries
                  the group's largest number when it has one and says plainly
                  what is still missing when it does not. Never a fabricated 0R.
                */}
                <div
                  data-actual-r={validation.actualR.status}
                  className="border-border flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1 border-t pt-4"
                >
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-sm font-medium">
                      {a('result.actualR')}
                    </p>
                    <p className="text-subtle-foreground text-xs">{a('result.actualRBasis')}</p>
                  </div>
                  {validation.actualR.status === 'known' ? (
                    <p className="text-foreground text-3xl leading-none font-semibold tabular-nums">
                      {formatR(validation.actualR.value)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground min-w-0 text-sm">
                      {a(`result.unavailable.${validation.actualR.reason}`)}
                    </p>
                  )}
                </div>
              </GroupCard>

              <GroupCard
                title={a('result.outcome')}
                aside={
                  draft.outcome === null ? (
                    <StateText>{c('notAnswered')}</StateText>
                  ) : (
                    <InlineAction
                      ariaLabel={a('result.removeOutcomeAria')}
                      onClick={() => apply((current) => setOutcome(current, null))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  )
                }
              >
                <ChoiceGroup
                  idPrefix="after-outcome"
                  legend={a('result.outcome')}
                  hideLegend
                  value={draft.outcome}
                  columns={3}
                  fit="row"
                  onChange={(outcome: OutcomeValue) =>
                    apply((current) => setOutcome(current, outcome))
                  }
                  options={[
                    { value: 'win', label: a('result.win') },
                    { value: 'break_even', label: a('result.breakEven') },
                    { value: 'loss', label: a('result.loss') },
                  ]}
                />
                <Helper>{a('result.outcomeHint')}</Helper>
                {outcomeNotice === undefined ? null : (
                  <Notice>
                    {draft.outcome === 'win' ? a('result.winNegative') : a('result.lossPositive')}
                  </Notice>
                )}
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
                  canAdopt={validation.canAdoptExitSubtotal}
                  discrepancy={
                    discrepancy?.kind === 'exit_discrepancy'
                      ? {
                          subtotal: formatMoney(discrepancy.subtotalMinor),
                          final: formatMoney(discrepancy.finalPnlMinor),
                        }
                      : null
                  }
                  adoptedMessage={adoptedMessage}
                  formatMoney={formatMoney}
                  onAdd={() => apply((current) => addExit(current, generateId()))}
                  onRemove={(id) => apply((current) => removeExit(current, id))}
                  onChange={(id, patch) => apply((current) => updateExit(current, id, patch))}
                  onCompleteness={(value) => apply((current) => setCompleteness(current, value))}
                  onAdopt={() => {
                    if (validation.exitSubtotalMinor === null) return;
                    const amount = formatMoney(validation.exitSubtotalMinor);
                    setDraft((current) =>
                      adoptExitSubtotal(current, validation, (minor) =>
                        tradeMoneyInputValue(minor, currency),
                      ),
                    );
                    setServerMessage(null);
                    setAdoptedMessage(a('exits.adopted', { amount }));
                  }}
                />
              </FoldedGroup>
            </>,
          )}

          {/* 3 — RISK AND PLAN AT ENTRY, as remembered */}
          {section(
            'plan',
            'gap-4',
            <>
              {/* Intended risk and what was really at risk read as one idea. */}
              <GroupCard
                title={a('steps.cards.risk')}
                aside={<StateText>{a('steps.optional')}</StateText>}
              >
                <TextField
                  id="after-risk"
                  label={a('risk.label')}
                  value={draft.risk}
                  onChange={(risk) => apply((current) => ({ ...current, risk }))}
                  suffix={currency}
                  inputMode="decimal"
                  figure
                  hint={a('risk.hint')}
                  error={errorText('risk')}
                />
                <div className="flex min-w-0 flex-col gap-3">
                  <ChoiceGroup
                    idPrefix="after-actual-risk"
                    legend={a('actualRisk.legend')}
                    value={
                      draft.actualRisk.answer === 'unanswered' ? null : draft.actualRisk.answer
                    }
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
                        onClick={() =>
                          apply((current) => setActualRiskAnswer(current, 'unanswered'))
                        }
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
              </GroupCard>

              <GroupCard
                title={c('target.legend')}
                aside={
                  draft.target.state === 'unanswered' ? (
                    <StateText>{c('notAnswered')}</StateText>
                  ) : (
                    <InlineAction
                      ariaLabel={c('target.removeAria')}
                      onClick={() => apply((current) => setTargetState(current, 'unanswered'))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  )
                }
              >
                <div className="flex min-w-0 flex-col gap-3">
                  <ChoiceGroup
                    idPrefix="after-target"
                    legend={c('target.legend')}
                    hideLegend
                    value={draft.target.state === 'unanswered' ? null : draft.target.state}
                    onChange={(state) => apply((current) => setTargetState(current, state))}
                    options={[
                      {
                        value: 'fixed',
                        label: c('target.fixed'),
                        description: c('target.fixedDescription'),
                      },
                      {
                        value: 'no_fixed',
                        label: c('target.noFixed'),
                        description: c('target.noFixedDescription'),
                      },
                    ]}
                  />
                  {draft.target.state === 'fixed' ? (
                    <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
                      <TextField
                        id="after-targetProfit"
                        label={c('target.profit')}
                        value={draft.target.profit}
                        onChange={(value) =>
                          apply((current) => setTargetValue(current, 'profit', value))
                        }
                        suffix={currency}
                        inputMode="decimal"
                        figure
                        error={errorText('targetProfit')}
                      />
                      <TextField
                        id="after-targetPrice"
                        label={c('target.price')}
                        value={draft.target.price}
                        onChange={(value) =>
                          apply((current) => setTargetValue(current, 'price', value))
                        }
                        inputMode="decimal"
                        figure
                        labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
                        error={errorText('targetPrice')}
                      />
                    </div>
                  ) : null}
                </div>
              </GroupCard>

              <AtEntryExitPlan
                draft={exitPlanView}
                options={options}
                collapsible
                onChange={(next) => apply((current) => ({ ...current, exitPlan: next.exitPlan }))}
                onLibraryChanged={setAdoptedExitPlans}
                copy={{
                  notRecordedHint: a('exitPlan.notRecordedHint'),
                  editorDescription: a('exitPlan.editorDescription'),
                }}
              />
            </>,
          )}

          {/* 4 — THE TRADER'S READ: optional analysis, grouped by when it happened */}
          {section(
            'context',
            'gap-4',
            <>
              <GroupCard
                title={a('steps.cards.strategy')}
                aside={<StateText>{a('steps.optional')}</StateText>}
              >
                <StrategyFields
                  draft={draft}
                  options={options}
                  onSelectStrategy={(value) =>
                    apply((current) =>
                      value === UNAVAILABLE_OPTION
                        ? current
                        : value === ''
                          ? removeStrategyAnswer(current)
                          : value === NONE
                            ? answerNoStrategy(current)
                            : selectStrategy(current, value),
                    )
                  }
                  onSelectSetup={(value) =>
                    apply((current) =>
                      value === UNAVAILABLE_OPTION
                        ? current
                        : value === ''
                          ? removeSetupAnswer(current)
                          : value === NONE
                            ? answerNoSetup(current)
                            : selectSetup(current, value),
                    )
                  }
                  onCondition={(key, status) =>
                    apply((current) => answerCondition(current, key, status))
                  }
                />
              </GroupCard>

              {/* Entry mindset: how sure the trader was, and how they felt. */}
              <GroupCard
                title={a('steps.cards.mindset')}
                aside={<StateText>{a('steps.optional')}</StateText>}
              >
                <ChoiceGroup
                  idPrefix="after-confidence"
                  legend={a('confidence.label')}
                  value={draft.confidence === null ? null : String(draft.confidence)}
                  status={c('notAnswered')}
                  columns={5}
                  compact
                  fit="split"
                  aside={
                    <InlineAction
                      ariaLabel={c('confidence.removeAria')}
                      onClick={() => apply((current) => setConfidence(current, null))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
                  onChange={(value) =>
                    apply((current) => setConfidence(current, Number.parseInt(value, 10)))
                  }
                  options={CONFIDENCE_LEVELS.map((level) => ({
                    value: String(level.value),
                    label: t(`create.confidence.level.${level.key}`),
                  }))}
                />
                <Helper>{a('confidence.hint')}</Helper>
                <div className="border-border border-t pt-1">{emotionQuestion('emotions')}</div>
              </GroupCard>

              <GroupCard
                title={a('steps.cards.afterTrade')}
                aside={<StateText>{a('steps.optional')}</StateText>}
              >
                {emotionQuestion('postTradeEmotions')}
              </GroupCard>

              {/* The thesis belongs with the read on the trade, not with details. */}
              <GroupCard
                title={a('steps.cards.thesis')}
                aside={<StateText>{a('steps.optional')}</StateText>}
              >
                <TextAreaField
                  id="after-context-reason"
                  label={cx('reason')}
                  value={draft.context.reason}
                  onChange={(reason) =>
                    apply((current) => ({
                      ...current,
                      context: { ...current.context, reason },
                    }))
                  }
                  placeholder={cx('reasonPlaceholder')}
                />
              </GroupCard>
            </>,
          )}

          {/* 5 — DETAILS, THE SUMMARY, AND SAVE */}
          {section(
            'details',
            'gap-6',
            <>
              <ContextFields
                draft={draft}
                notices={validation.notices.map((notice) => notice.kind)}
                errorText={errorText}
                onChange={(patch) =>
                  apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
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
                    {(['trade', 'result', 'plan', 'context'] as const).map((key) => {
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

          {/*
            WHAT A SAVE SAID, WHERE THE TRADER IS. Quick Save can be pressed
            from any step, so its answer — a server refusal, or a Save key that
            already created a different Trade — belongs beside the action that
            was pressed, not inside a step that is not being shown.
          */}
          {replayConflict === null ? null : (
            <div className="min-w-0 px-0 pb-4 sm:px-6">{replayConflictPanel}</div>
          )}

          {/* STEP NAVIGATION — the last step's Save, and the quiet one before it */}
          <div
            data-step-actions=""
            {...(onLastStep ? { 'data-global-save': '' } : {})}
            data-action-bar={wide || keyboardOpen ? 'inline' : 'docked'}
            /*
              A SCREEN BAR ON A PHONE, A CARD FOOTER ON A WIDE ONE.

              Docked, it spans the viewport rather than the content column — a
              card-coloured strip inset inside the page's gutters reads as an
              empty card someone left a button in, which is exactly what it
              was. Full-bleed it reads as the bottom of the screen, while its
              CONTENT stays on the same left edge as the rows above, so the
              action still lines up with the stack it belongs to. The
              safe-area inset is the bar's own, which is why the page below it
              carries no bottom padding on a phone.
            */
            className={cn(
              'border-border bg-card flex min-w-0 flex-col gap-2 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 lg:gap-2.5 lg:rounded-b-xl lg:px-8 lg:pt-5 lg:pb-5',
              wide || keyboardOpen
                ? 'px-0'
                : 'sticky bottom-0 z-20 -mx-4 px-4 shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.45)] sm:-mx-6 sm:px-6',
            )}
          >
            {onLastStep || pending || serverMessage !== null ? (
              <p
                data-save-status=""
                tabIndex={-1}
                aria-live="polite"
                className={cn('min-w-0 text-sm leading-snug outline-none', statusTone)}
              >
                {statusLine}
              </p>
            ) : null}
            {/*
              THE SHORT WAY OUT, ONCE IT IS HONEST TO OFFER IT. Nothing beyond
              this step is required, so a trader who is done can save from
              here. It sits above the step's own Back/Next as a quiet line, and
              runs the very same Save as the last step's button — including
              every answer already given on steps further on.
            */}
            {onLastStep || !canQuickSave ? null : (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <InlineAction
                  id="after-quick-save"
                  ariaLabel={a('save.action')}
                  onClick={() => void submit()}
                >
                  {a('steps.quickSave')}
                </InlineAction>
                <span className="text-subtle-foreground text-xs">{a('steps.quickSaveHint')}</span>
              </div>
            )}
            {/*
              THE FIRST STEP HAS NOWHERE TO GO BACK TO, so it does not reserve
              half the bar for an action that is not there. On a phone the one
              forward action takes the width; from Step 2 on, Back and Next
              share the row as a pair. A wide card keeps the forward action at
              its natural size on the right — full width across 50rem would be
              a banner, not a button.
            */}
            <div
              data-step-actions-layout={noBack ? 'single' : 'paired'}
              className={cn(
                'flex min-w-0 items-center gap-3',
                noBack ? 'justify-end' : 'justify-between',
              )}
            >
              {noBack ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="min-h-12 shrink-0"
                  onClick={() => showStep(step - 1)}
                >
                  <ArrowLeft aria-hidden="true" />
                  {a('steps.back')}
                </Button>
              )}
              {onLastStep || nextKey === undefined ? (
                <Button
                  type="submit"
                  size="lg"
                  className={cn('min-h-12 min-w-0 shrink', noBack && 'w-full lg:w-auto')}
                  disabled={pending}
                >
                  {pending ? a('save.saving') : a('save.action')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className={cn('min-h-12 min-w-0 shrink', noBack && 'w-full lg:w-auto')}
                  onClick={() => showStep(step + 1)}
                >
                  <span className="truncate">
                    {a('steps.nextTo', { step: stepLabel(nextKey) })}
                  </span>
                  <ArrowRight aria-hidden="true" />
                </Button>
              )}
            </div>
            {onLastStep && promptMissing ? (
              <p data-save-prompt="" className="text-muted-foreground text-xs">
                {a('save.promptMissing')}
              </p>
            ) : null}
          </div>
        </form>

        {wide ? (
          <aside
            aria-label={a('steps.navLabel')}
            className="hidden lg:sticky lg:top-[calc(var(--shell-header-height)+1.5rem)] lg:block"
          >
            <div className="bg-card border-border shadow-card flex flex-col gap-3 rounded-xl border p-2">
              <p
                aria-hidden="true"
                className="text-muted-foreground px-3 pt-2 text-xs font-medium tabular-nums"
              >
                {progressText}
              </p>
              {stepNav}
              {/*
                WHAT SAVE IS STILL WAITING FOR — and nothing once it is waiting
                for nothing. Three permanent ticks beside a form that can
                already be saved are noise, not awareness.
              */}
              <div
                data-required-status={missingRequirements.length === 0 ? 'ready' : 'missing'}
                className="border-border flex flex-col gap-1 border-t px-3 pt-3 pb-2"
              >
                {missingRequirements.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{a('save.ready')}</p>
                ) : (
                  <>
                    <p className="text-foreground text-sm font-medium">
                      {a('steps.requiredMissing', { count: missingRequirements.length })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {missingRequirements
                        .map((item) => c(`save.requirement.${item.key}`))
                        .join(' · ')}
                    </p>
                  </>
                )}
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {/*
        STEP 1's EDITORS. One per concept, outside the form so nothing typed in
        one can submit the Trade (UX Rules §17.4), and each a centered dialog on
        a desktop and a reachable bottom sheet on a phone — the geometry this
        codebase already accepted for nested Trade editors. Every change is
        written to the draft as it is made, so X, Escape, the backdrop and the
        system back gesture never take one back; focus returns to the row that
        opened the editor.

        THE ACCOUNTS, LISTED. A trader has a handful of accounts at most — the
        plan limit is 15 — so every one is on screen as its own answer and one
        tap is the whole choice. No search: there is nothing to search through.
      */}
      <TradeAdaptiveOverlay
        open={editor === 'tradingAccountId'}
        onOpenChange={closeEditorOn}
        title={c('account.label')}
        description={a('trade.accountEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={conceptRows.tradingAccountId}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <TradeChoiceList
            label={c('account.label')}
            value={draft.tradingAccountId === '' ? null : draft.tradingAccountId}
            error={errorText('tradingAccountId')}
            errorId="after-account-error"
            onChoose={(tradingAccountId) => {
              apply((current) => ({ ...current, tradingAccountId }));
              setEditor(null);
            }}
            options={options.tradingAccounts.map((account) => ({
              value: account.tradingAccountId,
              label: `${account.name} · ${account.baseCurrency}`,
            }))}
          />
          {errorText('tradingAccountId') === undefined ? null : (
            <FieldError id="after-account-error">{errorText('tradingAccountId')}</FieldError>
          )}
        </div>
      </TradeAdaptiveOverlay>

      {/*
        SYMBOL IS STILL FREE TEXT. There is no instrument catalogue in this
        product, so "search" here searches what this browser has seen the trader
        use — the typed value filters the recents beneath it and is itself the
        answer. Typing something no recent matches is a perfectly good Symbol.
      */}
      <TradeAdaptiveOverlay
        open={editor === 'symbol'}
        onOpenChange={closeEditorOn}
        title={c('symbol.label')}
        description={a('trade.symbolEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={conceptRows.symbol}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {/*
            CHOOSING IS THE WHOLE INTERACTION, so the sheet closes on it. There
            is nothing to confirm afterwards and no second answer to give.
          */}
          <TradeSymbolPicker
            id="after-symbol"
            value={draft.symbol}
            saved={savedSymbols.symbols}
            onSelect={(symbol) => {
              apply((current) => ({ ...current, symbol }));
              setEditor(null);
            }}
            onSave={(symbol) => void savedSymbols.save(symbol)}
            onRemove={(symbol) => void savedSymbols.remove(symbol)}
            labels={{
              searchLabel: c('symbol.label'),
              searchPlaceholder: a('trade.symbolSearch'),
              savedHeading: a('trade.symbolSaved'),
              empty: a('trade.symbolEmpty'),
              noMatches: a('trade.symbolNoMatch'),
              addTyped: (symbol) => a('trade.symbolAddTyped', { symbol }),
              alreadySaved: (symbol) => a('trade.symbolAlreadySaved', { symbol }),
              remove: (symbol) => a('trade.symbolRemove', { symbol }),
              selected: a('trade.symbolSelected'),
            }}
          />
          {errorText('symbol') === undefined ? null : (
            <FieldError id="after-symbol-error">{errorText('symbol')}</FieldError>
          )}
        </div>
      </TradeAdaptiveOverlay>

      <TradeAdaptiveOverlay
        open={editor === 'direction'}
        onOpenChange={closeEditorOn}
        title={c('direction.label')}
        description={a('trade.directionEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={conceptRows.direction}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <TradeChoiceList
            label={c('direction.label')}
            columns={2}
            value={draft.direction === '' ? null : draft.direction}
            error={errorText('direction')}
            errorId="after-direction-error"
            onChoose={(direction) => {
              apply((current) => ({ ...current, direction }));
              setEditor(null);
            }}
            options={[
              { value: 'long', label: c('direction.long'), tone: 'positive' },
              { value: 'short', label: c('direction.short'), tone: 'negative' },
            ]}
          />
          {errorText('direction') === undefined ? null : (
            <FieldError id="after-direction-error">{errorText('direction')}</FieldError>
          )}
        </div>
      </TradeAdaptiveOverlay>

      {/*
        THE DASHBOARD'S CALENDAR, NOT A SECOND ONE. `DateRangeMonthGrid` and
        `buildDateRangePickerMonth` are the Dashboard and Trade Log date
        picker's own grid and month builder, used here with the range collapsed
        to a single day — `from` and `to` the same date, which that builder
        already reports as `single`. Two seven-column calendars in one product
        that disagreed about which column is Sunday, what today looks like or
        how a selected day reads would be a defect, so there is one.
      */}
      <TradeAdaptiveOverlay
        open={editor === 'enteredAt'}
        onOpenChange={closeEditorOn}
        title={a('times.entryDateTime')}
        description={a('trade.stampEditor', { timezone })}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={conceptRows.enteredAt}
        footer={
          <div className="flex min-w-0 flex-wrap-reverse items-center justify-between gap-3">
            {draft.enteredAt === '' ? (
              <span aria-hidden="true" />
            ) : (
              <InlineAction
                ariaLabel={a('times.clearStamp')}
                onClick={() => {
                  apply(clearEntryTimestamp);
                  setEntryStampReviewed(false);
                  setEntryPane(null);
                }}
              >
                {a('times.clearStamp')}
              </InlineAction>
            )}
            <Button
              type="button"
              size="lg"
              className="min-h-12"
              onClick={() => {
                // Closing on half an answer is when the other half speaks up.
                if (entryIncomplete) setEntryStampReviewed(true);
                setEditor(null);
              }}
            >
              {a('trade.done')}
            </Button>
          </div>
        }
      >
        {/*
          TWO ANSWERS, ONE SURFACE. The day and the minute are separately
          knowable, so each gets its own row and its own control — but they are
          one question, so they share one sheet. Only one control is open at a
          time and it opens under the row it belongs to: a second modal over
          this one would be two overlays deep, which this system does not do
          (DESIGN.md §3, L4).
        */}
        <div data-entry-stamp-editor="" className="flex min-w-0 flex-col gap-2">
          <EntryStampRow
            id="after-entry-date"
            label={a('times.entryDate')}
            value={entryDateLabel}
            placeholder={a('times.notRecorded')}
            raw={entryParts.date}
            error={dateError}
            open={entryPane === 'date'}
            onToggle={() => {
              setPickerMonth(monthOf(entryParts.date, todayDate));
              setEntryPane((current) => (current === 'date' ? null : 'date'));
            }}
          >
            <div data-entry-date-picker="" className="flex min-w-0 flex-col gap-2 pt-1">
              <nav
                aria-label={a('trade.monthNav')}
                className="flex min-w-0 items-center justify-between gap-2"
              >
                <MonthStepButton
                  direction="previous"
                  label={a('trade.previousMonth')}
                  onClick={() =>
                    setPickerMonth((current) => shiftCalendarMonth(current.year, current.month, -1))
                  }
                />
                <MonthStepButton
                  direction="next"
                  label={a('trade.nextMonth')}
                  onClick={() =>
                    setPickerMonth((current) => shiftCalendarMonth(current.year, current.month, 1))
                  }
                />
              </nav>
              <DateRangeMonthGrid
                month={pickerGrid}
                monthLabel={formatCalendarMonthLabel(pickerMonth.year, pickerMonth.month, locale)}
                onSelect={(date) => apply((current) => setEntryDate(current, date))}
                dateLocale={locale}
              />
              {entryParts.date === '' ? null : (
                <div>
                  <InlineAction
                    ariaLabel={a('times.clearDate')}
                    onClick={() => apply((current) => setEntryDate(current, ''))}
                  >
                    {a('times.clearDate')}
                  </InlineAction>
                </div>
              )}
            </div>
          </EntryStampRow>

          {/*
            EITHER HALF CAN COME FIRST. A trader recalling a closed trade may
            remember the minute and have to work out the day, so the time is
            not gated behind the date: both rows open on their own, and it is
            Save that insists on the pair, not the order of opening.
          */}
          <EntryStampRow
            id="after-entry-time"
            label={a('times.entryTime')}
            value={entryParts.time === '' ? null : entryParts.time}
            placeholder={a('times.notRecorded')}
            raw={entryParts.time}
            error={timeError}
            open={entryPane === 'time'}
            onToggle={() => setEntryPane((current) => (current === 'time' ? null : 'time'))}
          >
            <div className="flex min-w-0 flex-col gap-3 pt-1">
              <TradeTimeWheel
                id="after-enteredTime"
                value={entryParts.time}
                onChange={(time) => apply((current) => setEntryTime(current, time))}
                labels={{ hour: a('times.hour'), minute: a('times.minute') }}
              />
              {entryParts.time === '' ? null : (
                <div>
                  <InlineAction
                    ariaLabel={a('times.clearOnlyTime')}
                    onClick={() => apply((current) => setEntryTime(current, ''))}
                  >
                    {a('times.clearOnlyTime')}
                  </InlineAction>
                </div>
              )}
            </div>
          </EntryStampRow>
        </div>
      </TradeAdaptiveOverlay>
    </div>
  );
}

/**
 * ONE OF THE TWO ANSWERS INSIDE THE ENTRY-TIMESTAMP SHEET.
 *
 * A launcher row again — name, what is recorded, a chevron — but a disclosure
 * rather than a door: its control opens underneath it, inside the same sheet.
 * That is what keeps the day and the minute separately answerable without
 * stacking a second modal over the first (DESIGN.md §3, L4), and it is why the
 * chevron turns rather than pointing on.
 *
 * It sits one plane above the sheet it is on, by plane and not by a hairline,
 * which is the same step the Step 1 rows take against the step card.
 */
function EntryStampRow({
  id,
  label,
  value,
  placeholder,
  raw,
  error,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  value: string | null;
  placeholder: string;
  raw: string;
  error?: string | undefined;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `${id}-panel`;
  const errorId = `${id}-error`;
  /*
    A SECTION NOBODY OPENED COSTS NOTHING. The collapse animation needs the
    content to stay mounted once it has been shown — that is what gives the
    height something to travel to — but a wheel is eighty-four cells and a
    month is forty-two, and building both every time this sheet opens is work
    for a question the trader may never ask. So it mounts on first open and
    stays: the cost is paid by whoever actually opens the section.
  */
  const [opened, setOpened] = useState(open);
  // React’s sanctioned adjust-state-during-render: it re-renders before painting.
  if (open && !opened) setOpened(true);
  return (
    <div
      data-entry-stamp={id}
      data-value={raw}
      className={cn(
        'bg-muted/50 min-w-0 rounded-lg border px-3 py-1',
        error === undefined ? 'border-transparent' : 'border-destructive',
      )}
    >
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={error === undefined ? undefined : errorId}
        onClick={onToggle}
        className="focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2"
      >
        <span className="text-muted-foreground min-w-0 flex-1 text-[0.8125rem] font-medium">
          {label}
        </span>
        <span
          className={cn(
            'min-w-0 truncate text-base',
            value === null
              ? 'text-subtle-foreground'
              : 'text-foreground font-semibold tabular-nums',
          )}
        >
          {value ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'text-subtle-foreground size-4 shrink-0 transition-transform duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      {error === undefined ? null : (
        <div className="pb-2">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
      {/*
        HEIGHT, OPACITY AND A SHORT TRAVEL — on the surface-enter clock the
        sheets and dialogs already use, so a section opening inside a sheet
        moves at the same speed as the sheet that carries it.

        `grid-template-rows` is what animates the height: there is no CSS
        length to transition to "as tall as the content is", and measuring it
        in JS to set a pixel height would make the row re-measure on every
        locale, font and month change. `invisible` when closed is not
        decoration either — it takes the collapsed control out of the tab
        order and out of the accessibility tree, which `height: 0` alone does
        not. Reduced motion is handled centrally: `globals.css` rebinds these
        duration tokens rather than switching the transition off, so the
        section still changes state visibly, just without the travel.
      */}
      <div
        id={panelId}
        data-open={open ? '' : undefined}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility] duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        <div
          className={cn(
            'min-h-0 overflow-hidden transition-transform duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
            open ? 'translate-y-0' : '-translate-y-1',
          )}
        >
          <div className="pb-2">{opened ? children : null}</div>
        </div>
      </div>
    </div>
  );
}

/** Paging for the entry-date calendar: an icon with a name, never an icon alone. */
function MonthStepButton({
  direction,
  label,
  onClick,
}: {
  direction: 'previous' | 'next';
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      data-month-step={direction}
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * A LAUNCHER ROW: one concept, read first. The name, what is recorded — or a
 * neutral word for what is not — and a chevron; the control that records it
 * lives in the editor this row opens. `raw` exposes the stored value, so a
 * test or a capture can read what is recorded without opening an editor.
 *
 * THE ICON IS AN ANCHOR, NOT A STATUS. A small glyph in a quiet inset gives
 * the eye four fixed places to land; it is neutral until the concept is
 * answered, then takes the accent — or, for Direction, the restrained
 * positive/negative the value already carries. It never says anything on its
 * own: the value text says it first, and Direction's glyph changes shape as
 * well as hue. Decorative, so hidden from assistive technology.
 */
function ConceptRow({
  concept,
  rowRef,
  label,
  marker,
  value,
  valueTone,
  placeholder,
  raw,
  error,
  editLabel,
  icon: Icon,
  iconTone,
  onOpen,
  ...rest
}: {
  concept: TradeConcept;
  rowRef: RefObject<HTMLButtonElement | null>;
  label: string;
  /** Required or Optional, said here rather than in a paragraph below. */
  marker: ReactNode;
  /** What is recorded, or null when nothing is. */
  value: string | null;
  /** A direction the value itself carries, never the only way it is said. */
  valueTone?: ChoiceTone | undefined;
  /** The neutral word for nothing recorded — never a negative (UX Rules §4.3). */
  placeholder: string;
  raw: string;
  error?: string | undefined;
  editLabel: string;
  icon: LucideIcon;
  /** Unset while unanswered: the anchor stays neutral. */
  iconTone?: 'accent' | ChoiceTone | undefined;
  onOpen: () => void;
} & Record<`data-${string}`, string | undefined>) {
  const errorId = `${conceptRowId(concept)}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" {...rest}>
      <button
        type="button"
        id={conceptRowId(concept)}
        ref={rowRef}
        data-concept={concept}
        data-value={raw}
        aria-label={editLabel}
        aria-haspopup="dialog"
        /* A button role carries no aria-invalid; the error is named to it instead. */
        aria-describedby={error === undefined ? undefined : errorId}
        data-invalid={error === undefined ? undefined : 'true'}
        onClick={onOpen}
        /*
          THE DASHBOARD'S SURFACE LADDER, NOT A NEW ONE (DESIGN.md §3). A row
          lifts one step off whatever plane is behind it, by plane first and
          never by a hairline:

            phone   workspace (`background`) → row `card` + `shadow-card`
            lg      step card (`card`)       → row `muted/50`, no shadow

          Both pairs are the relationships the Dashboard already uses — page
          against panel, panel against inset — so Step 1 reads with the same
          depth in Light and in Dark without inventing a colour. The border
          stays in the box model and stays transparent until there is an error
          to show, exactly as `data-dashboard-panel` does, so nothing shifts.
        */
        className={cn(
          'shadow-card bg-card hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-3 rounded-lg border text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
          // 76px on a phone, 84px once the card has room: substantial enough to
          // read as a Trade concept, tight enough that four of them fit above
          // the fold with the step's heading.
          'min-h-[4.75rem] px-4 py-3 lg:min-h-[5.25rem] lg:px-5',
          /*
            THE DESKTOP GRID IS TWO ROWS ABREAST, so the value's width is what
            runs short: at 1280px and up "Main Trading Account · USD" needed
            243px and had 235px beside a 40px icon and 12px gaps. A 36px icon
            and 8px gaps give it 247px. The chevron does not move — the row's
            padding pins it — only the text box reaches 4px closer to it.
          */
          'lg:gap-2',
          'lg:bg-muted/50 lg:hover:bg-muted lg:shadow-none',
          error === undefined ? 'border-transparent' : 'border-destructive',
        )}
      >
        {/*
          40px on a phone and 36px on the desktop's two-abreast grid, one plane
          step off the row — `muted` on the phone's card row, `card` on the
          desktop's muted row — so it reads as an inset, not a badge. Answered
          tints stay at a tenth: a hint, never a coloured disc.
        */}
        <span
          aria-hidden="true"
          data-concept-icon={iconTone ?? 'neutral'}
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md transition-colors motion-reduce:transition-none lg:size-9',
            iconTone === 'accent'
              ? 'bg-primary/10 text-primary'
              : iconTone === 'positive'
                ? 'bg-positive/10 text-positive'
                : iconTone === 'negative'
                  ? 'bg-negative/10 text-negative'
                  : 'bg-muted text-muted-foreground lg:bg-card',
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-muted-foreground text-[0.8125rem] leading-5 font-medium">
              {label}
            </span>
            {marker}
          </span>
          {/*
            THE VALUE IS WHAT THE ROW IS FOR. It is the largest, heaviest thing
            in the row so a trader scans four answers before reading a single
            label; an unrecorded one drops to subtle weight and colour rather
            than shouting its absence.
          */}
          <span
            className={cn(
              'mt-0.5 block truncate text-[1.0625rem] leading-6 lg:text-lg',
              value === null
                ? 'text-subtle-foreground'
                : cn(
                    'font-semibold',
                    valueTone === 'positive'
                      ? 'text-positive'
                      : valueTone === 'negative'
                        ? 'text-negative'
                        : 'text-foreground',
                  ),
            )}
          >
            {value ?? placeholder}
          </span>
        </span>
        <ChevronRight className="text-subtle-foreground size-5 shrink-0" aria-hidden="true" />
      </button>
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * A CONCEPT, NOT A FIELD. One surface per idea the trader thinks in — the
 * account, what was traded, risk, the outcome — so a step reads as two or
 * three things instead of eight rows. Controls inside never add a second
 * border, and `filled` marks the one group a step is really about.
 */
function GroupCard({
  title,
  aside,
  filled = false,
  children,
  ...rest
}: {
  /** Left out where the step's own heading already names the group. */
  title?: string;
  aside?: ReactNode;
  /** The step's own subject, given a tint rather than a heavier border. */
  filled?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <section
      {...rest}
      className={cn(
        'border-border flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5',
        filled && 'bg-muted/30',
      )}
    >
      {title === undefined && aside === undefined ? null : (
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          {title === undefined ? (
            <span aria-hidden="true" />
          ) : (
            <h3 className="text-foreground text-sm font-semibold">{title}</h3>
          )}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** A group whose contents stay folded behind their own summary. */
function FoldedGroup({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-border min-w-0 rounded-lg border px-1 py-1 sm:px-1.5">
      <Disclosure id={id} title={title} summary={summary} open={open} onToggle={onToggle}>
        {children}
      </Disclosure>
    </div>
  );
}

/**
 * REQUIRED AND OPTIONAL, SAID QUIETLY. Both are words beside the concept, at
 * caption size and below the value in weight — a trader scans the values, and
 * a necessity marker that outshouts them is working against that. Required is
 * a shade stronger than Optional and neither is a filled pill or destructive
 * colour: nothing here is wrong yet (DESIGN.md §6, "Optional" in muted text
 * after the label).
 */
function RequiredTag() {
  const a = useTranslations('trades.create.recording.contractAfter');
  return <span className="text-muted-foreground text-xs font-medium">{a('steps.required')}</span>;
}

function OptionalTag() {
  const a = useTranslations('trades.create.recording.contractAfter');
  return <span className="text-subtle-foreground text-xs">{a('steps.optional')}</span>;
}

/** An optional historical time: blank is not recorded, and clearing it is always one action away. */
function TimeField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <TextField
        id={id}
        type="datetime-local"
        label={label}
        value={value}
        onChange={onChange}
        figure
        error={error}
        labelAside={value === '' ? <StateText>{a('times.notRecorded')}</StateText> : null}
      />
      {value === '' ? null : (
        <div>
          <InlineAction ariaLabel={`${a('times.clear')}: ${label}`} onClick={() => onChange('')}>
            {a('times.clear')}
          </InlineAction>
        </div>
      )}
    </div>
  );
}

function ExitHistoryFields({
  draft,
  currency,
  errorText,
  subtotal,
  canAdopt,
  discrepancy,
  adoptedMessage,
  formatMoney,
  onAdd,
  onRemove,
  onChange,
  onCompleteness,
  onAdopt,
}: {
  draft: AfterTradeDraft;
  currency: string;
  errorText: (field: AfterTradeField) => string | undefined;
  subtotal: string | null;
  canAdopt: boolean;
  discrepancy: { readonly subtotal: string; readonly final: string } | null;
  adoptedMessage: string | null;
  formatMoney: (minor: string) => string;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, patch: Partial<Omit<AfterTradeExitDraft, 'id'>>) => void;
  onCompleteness: (value: AfterTradeDraft['completeness']) => void;
  onAdopt: () => void;
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
          {canAdopt ? (
            <div>
              <InlineAction onClick={onAdopt}>{a('exits.adopt')}</InlineAction>
            </div>
          ) : null}
        </div>
      )}
      <p aria-live="polite" className="text-muted-foreground text-sm empty:hidden">
        {adoptedMessage ?? ''}
      </p>
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

function StrategyFields({
  draft,
  options,
  onSelectStrategy,
  onSelectSetup,
  onCondition,
}: {
  draft: AfterTradeDraft;
  options: TradeCreateOptions;
  onSelectStrategy: (value: string) => void;
  onSelectSetup: (value: string) => void;
  onCondition: (conditionKey: string, status: RecalledConditionStatus | null) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const active = activeAfterTradeClassification(draft, options);
  // A chosen Strategy or Setup that is no longer offered stays chosen, shown as unavailable.
  const stale = staleSelections(draft, options);
  const strategyValue =
    active.strategyAnswer === 'none'
      ? NONE
      : stale.strategy
        ? UNAVAILABLE_OPTION
        : active.strategy === null
          ? ''
          : active.strategy.strategyId;
  const setupValue =
    active.setupAnswer === 'none'
      ? NONE
      : stale.setup
        ? UNAVAILABLE_OPTION
        : active.setup === null
          ? ''
          : active.setup.setupId;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
        <SelectField
          id="after-strategy"
          label={c('strategy.label')}
          value={strategyValue}
          onChange={onSelectStrategy}
          aside={
            strategyValue === '' ? null : (
              <InlineAction
                ariaLabel={c('strategy.removeStrategyAria')}
                onClick={() => onSelectStrategy('')}
              >
                {c('removeAnswer')}
              </InlineAction>
            )
          }
          options={[
            { value: '', label: c('strategy.notAnswered') },
            { value: NONE, label: c('strategy.none') },
            ...(stale.strategy
              ? [{ value: UNAVAILABLE_OPTION, label: c('strategy.unavailableOption') }]
              : []),
            ...options.strategies.map((strategy) => ({
              value: strategy.strategyId,
              label: strategy.name,
            })),
          ]}
        />
        <SelectField
          id="after-setup"
          label={c('strategy.setup')}
          value={setupValue}
          disabled={active.strategy === null}
          onChange={onSelectSetup}
          aside={
            active.strategy === null || setupValue === '' ? null : (
              <InlineAction
                ariaLabel={c('strategy.removeSetupAria')}
                onClick={() => onSelectSetup('')}
              >
                {c('removeAnswer')}
              </InlineAction>
            )
          }
          options={[
            {
              value: '',
              label:
                active.strategy === null
                  ? c('strategy.setupNeedsStrategy')
                  : c('strategy.notAnswered'),
            },
            { value: NONE, label: c('strategy.noSetup') },
            ...(stale.setup
              ? [{ value: UNAVAILABLE_OPTION, label: c('strategy.unavailableOption') }]
              : []),
            ...(active.strategy?.setups ?? []).map((setup) => ({
              value: setup.setupId,
              label: setup.name,
            })),
          ]}
        />
      </div>

      {stale.strategy || stale.setup ? (
        <p role="alert" data-classification-unavailable="" className="text-warning text-sm">
          {stale.strategy ? c('strategy.strategyUnavailable') : c('strategy.setupUnavailable')}
        </p>
      ) : null}

      {active.setup === null || active.setup.conditions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-foreground text-sm font-medium">{c('strategy.conditions')}</p>
          <Helper>{a('conditions.hint')}</Helper>
          <ul className="divide-border mt-2 flex min-w-0 flex-col divide-y">
            {active.setup.conditions.map((condition) => (
              <li key={condition.conditionKey} className="min-w-0 py-3">
                <ChoiceGroup
                  idPrefix={`after-condition-${condition.conditionKey}`}
                  legend={condition.label}
                  value={active.conditionAnswers[condition.conditionKey] ?? null}
                  compact
                  columns={3}
                  status={c('notAnswered')}
                  aside={
                    <InlineAction
                      ariaLabel={c('strategy.removeConditionAria', {
                        condition: condition.label,
                      })}
                      onClick={() => onCondition(condition.conditionKey, null)}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
                  onChange={(status) => onCondition(condition.conditionKey, status)}
                  options={[
                    { value: 'met', label: c('strategy.met') },
                    { value: 'not_met', label: c('strategy.notMet') },
                    { value: 'unknown', label: a('conditions.dontRemember') },
                  ]}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmotionFields({
  phase,
  answer,
  legend,
  hint,
  removeAria,
  catalog,
  showLastOneHint,
  onToggle,
  onNone,
  onRemove,
}: {
  phase: EmotionPhase;
  answer: AfterTradeDraft['emotions'];
  legend: string;
  hint?: string | undefined;
  removeAria: string;
  catalog: TradeCreateOptions['emotionCatalog'];
  showLastOneHint: boolean;
  onToggle: (key: string) => void;
  onNone: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  return (
    <fieldset className="min-w-0" data-emotions-phase={phase} data-emotions-answer={answer.answer}>
      <Legend
        aside={
          answer.answer === 'unanswered' ? (
            <StateText>{c('notAnswered')}</StateText>
          ) : (
            <InlineAction ariaLabel={removeAria} onClick={onRemove}>
              {c('removeAnswer')}
            </InlineAction>
          )
        }
      >
        {/* The disclosure above already shows the question; the legend still names the group. */}
        <span className="sr-only">{legend}</span>
      </Legend>
      {hint === undefined ? null : <Helper>{hint}</Helper>}
      {/*
        ONE CALM LIST, NOT A TAXONOMY. The groups still carry their meaning and
        their order, but they read as quiet captions above larger choices
        rather than as fields of a database record.
      */}
      <div className="mt-3 grid min-w-0 gap-x-8 gap-y-4 min-[560px]:grid-cols-2">
        {groupEmotionCatalog(catalog).map((group) => (
          <div key={group.key} className="flex min-w-0 flex-col gap-2">
            <p className="text-subtle-foreground text-xs font-medium">
              {t(`create.recording.emotionGroups.${group.key}`)}
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.emotions.map((emotion) => (
                <Chip
                  key={emotion.key}
                  size="lg"
                  selected={answer.answer === 'selected' && answer.keys.includes(emotion.key)}
                  onClick={() => onToggle(emotion.key)}
                >
                  {t(`emotions.${emotion.key}`)}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-border mt-4 flex min-w-0 flex-wrap items-center gap-3 border-t pt-4">
        <Chip size="lg" selected={answer.answer === 'none'} onClick={onNone}>
          {c('emotions.none')}
        </Chip>
      </div>
      <p aria-live="polite" className="text-muted-foreground mt-2 text-sm empty:hidden">
        {showLastOneHint ? c('emotions.lastOne') : ''}
      </p>
    </fieldset>
  );
}

function ContextFields({
  draft,
  notices,
  errorText,
  onChange,
}: {
  draft: AfterTradeDraft;
  notices: readonly string[];
  errorText: (field: AfterTradeField) => string | undefined;
  onChange: (patch: Partial<AfterTradeDraft['context']>) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry.context');
  const a = useTranslations('trades.create.recording.contractAfter');
  const summary = useTranslations('trades.create.recording.contractEntry.summary');
  /*
    THREE FOLDED GROUPS, EACH SAYING WHAT IS IN IT. The last step is where a
    trader finishes, not another form to work through, so every group starts
    closed behind a summary of its own values. A group holding an error opens
    itself: nothing that stops a Save is ever folded away.
  */
  const preview = (value: string) =>
    value.trim().length > 60 ? `${value.trim().slice(0, 60)}…` : value.trim();
  const groups = [
    {
      key: 'market' as const,
      filled: [draft.context.timeframe, draft.context.session, draft.context.tradingviewUrl],
      summary: [
        draft.context.timeframe.trim(),
        draft.context.session.trim(),
        draft.context.tradingviewUrl.trim() === '' ? '' : c('chart'),
      ],
      errors: 0,
      fields: (
        <div className="flex min-w-0 flex-col gap-4 pb-2">
          <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
            <TextField
              id="after-context-timeframe"
              label={c('timeframe')}
              value={draft.context.timeframe}
              onChange={(timeframe) => onChange({ timeframe })}
              placeholder="15m"
            />
            <TextField
              id="after-context-session"
              label={c('session')}
              value={draft.context.session}
              onChange={(session) => onChange({ session })}
              placeholder="London"
            />
          </div>
          <TextField
            id="after-context-chart"
            label={c('chart')}
            value={draft.context.tradingviewUrl}
            onChange={(tradingviewUrl) => onChange({ tradingviewUrl })}
            inputMode="url"
            placeholder="https://www.tradingview.com/x/…"
          />
        </div>
      ),
    },
    {
      key: 'notes' as const,
      filled: [draft.context.notes],
      summary: [preview(draft.context.notes)],
      errors: 0,
      fields: (
        <div className="flex min-w-0 flex-col gap-4 pb-2">
          <TextAreaField
            id="after-context-notes"
            label={c('notes')}
            value={draft.context.notes}
            onChange={(notes) => onChange({ notes })}
          />
        </div>
      ),
    },
    {
      key: 'price' as const,
      filled: [draft.context.entryPrice, draft.context.stopPrice, draft.context.positionSize],
      summary: [
        draft.context.entryPrice.trim() === ''
          ? ''
          : `${c('entryPrice')} ${draft.context.entryPrice.trim()}`,
        draft.context.stopPrice.trim() === ''
          ? ''
          : `${c('stopPrice')} ${draft.context.stopPrice.trim()}`,
        draft.context.positionSize.trim() === ''
          ? ''
          : `${c('size')} ${draft.context.positionSize.trim()}`,
      ],
      errors: (['contextEntryPrice', 'contextStopPrice', 'contextPositionSize'] as const).filter(
        (field) => errorText(field) !== undefined,
      ).length,
      fields: (
        <div className="flex min-w-0 flex-col gap-3 pb-2">
          {/* Price is context, and the group says so where it is entered. */}
          <StateText>{c('pricesHint')}</StateText>
          <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-3">
            <TextField
              id="after-contextEntryPrice"
              label={c('entryPrice')}
              value={draft.context.entryPrice}
              onChange={(entryPrice) => onChange({ entryPrice })}
              inputMode="decimal"
              figure
              error={errorText('contextEntryPrice')}
            />
            <TextField
              id="after-contextStopPrice"
              label={c('stopPrice')}
              value={draft.context.stopPrice}
              onChange={(stopPrice) => onChange({ stopPrice })}
              inputMode="decimal"
              figure
              error={errorText('contextStopPrice')}
            />
            <TextField
              id="after-contextPositionSize"
              label={c('size')}
              value={draft.context.positionSize}
              onChange={(positionSize) => onChange({ positionSize })}
              inputMode="decimal"
              figure
              error={errorText('contextPositionSize')}
            />
          </div>
          {notices.includes('stop_wrong_side') ? <Notice>{c('stopWrongSide')}</Notice> : null}
          {notices.includes('target_wrong_side') ? <Notice>{c('targetWrongSide')}</Notice> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="border-border divide-border flex min-w-0 flex-col divide-y rounded-lg border">
      {groups.map((group) => {
        const count = group.filled.filter((value) => value.trim() !== '').length;
        return (
          <ContextGroup
            key={group.key}
            id={`after-details-${group.key}`}
            title={a(`steps.groups.${group.key}`)}
            summary={
              group.errors > 0 ? (
                <span className="text-destructive inline-flex min-w-0 items-center gap-1.5">
                  <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                  {summary('hasErrors', { count: group.errors })}
                </span>
              ) : count === 0 ? (
                summary('contextEmpty')
              ) : (
                group.summary.filter((part) => part !== '').join(' · ')
              )
            }
            forceOpen={group.errors > 0}
          >
            {group.fields}
          </ContextGroup>
        );
      })}
    </div>
  );
}

/**
 * One Step 5 group: folded behind its own summary, and never closed over an
 * error the trader has to reach.
 */
function ContextGroup({
  id,
  title,
  summary,
  forceOpen,
  children,
}: {
  id: string;
  title: string;
  summary: ReactNode;
  forceOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-w-0 px-1 py-1">
      <Disclosure
        id={id}
        title={title}
        summary={summary}
        open={open || forceOpen}
        onToggle={() => setOpen((current) => !current)}
      >
        {children}
      </Disclosure>
    </div>
  );
}
