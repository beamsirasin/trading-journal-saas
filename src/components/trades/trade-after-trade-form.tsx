'use client';

import { ArrowLeft, ArrowRight, CircleAlert, History, Plus, Trash2 } from 'lucide-react';
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
import { CONFIDENCE_LEVELS, confidenceLevelKey, type OutcomeValue } from '@/lib/trades/constants';
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
  afterTradeReadiness,
  answerCondition,
  answerNoEmotions,
  answerNoSetup,
  answerNoStrategy,
  buildAfterTradePayload,
  canAddExit,
  canDeselectEmotion,
  createAfterTradeDraft,
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
import {
  Chip,
  ChoiceGroup,
  Disclosure,
  Helper,
  InlineAction,
  Legend,
  Notice,
  RequirementRow,
  SelectField,
  StateText,
  Tag,
  TextAreaField,
  TextField,
} from './trade-at-entry-controls';
import { AtEntryExitPlan } from './trade-at-entry-exit-plan';
import { datetimeLocalToIso, tradeMoneyInputValue } from './trade-form-values';
import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';
import type { RecordingSaveControls } from './trade-recording-form';
import { TradeRecordingModeChange } from './trade-recording-mode-change';
import { groupEmotionCatalog } from './trade-recording-primitives';
import { useKeyboardObscuringViewport } from './trade-recording-surface';
import { TradeSaveReplayConflict } from './trade-save-replay';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

const NONE = '__none';
const RECENT_SYMBOL_LIMIT = 3;

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

/** Where a failed Save sends focus for each field — always a real, focusable control. */
function fieldTargetId(field: AfterTradeField): string {
  if (field.startsWith('exit:')) {
    const [, id, part] = field.split(':');
    return `after-exit-${id}-${part}`;
  }
  switch (field) {
    case 'tradingAccountId':
      return 'after-account';
    case 'direction':
      return 'after-direction-long';
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

  const [accountPickerOpen, setAccountPickerOpen] = useState(initialAccount === '');
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
      if (currentReadiness.fields.includes('tradingAccountId')) setAccountPickerOpen(true);
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

  const recentSymbols = symbolFavorites.recents.slice(0, RECENT_SYMBOL_LIMIT);
  const formatMoney = (minor: string) => formatTradeMoney(minor, currency) ?? minor;
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
  const stepLabel = (key: StepKey) => a(`steps.${key}.label`);
  const currentKey = STEPS[step] ?? 'trade';
  const onLastStep = step === LAST_STEP;
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
                  <span
                    className={cn(
                      'block truncate text-xs',
                      errors > 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {errors > 0 ? a('steps.needsAttention') : (line ?? c('summary.notAnswered'))}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  ) : (
    <nav aria-label={a('steps.navLabel')}>
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
                className="focus-visible:ring-ring flex h-8 w-full items-center rounded-sm outline-none focus-visible:ring-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-full rounded-full transition-colors motion-reduce:transition-none',
                    errors > 0
                      ? 'bg-destructive'
                      : current
                        ? 'bg-brand'
                        : index < step
                          ? 'bg-brand/45'
                          : 'bg-muted',
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  const section = (key: StepKey, className: string, children: ReactNode) => (
    <section
      key={key}
      aria-labelledby={ids.step}
      data-step={key}
      hidden={currentKey !== key}
      className={cn(
        'min-w-0 flex-col px-4 pb-6 sm:px-6',
        currentKey === key ? 'flex' : 'hidden',
        className,
      )}
    >
      {children}
    </section>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <p
        data-recording-mode="after_trade"
        className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
      >
        <span>{a('subtitle')}</span>
        <TradeRecordingModeChange />
      </p>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start lg:gap-8">
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
          className="bg-card border-border shadow-card flex w-full max-w-[47.5rem] min-w-0 scroll-mt-[calc(var(--shell-header-height,0px)+1rem)] flex-col rounded-xl border"
        >
          <header className="flex min-w-0 flex-col gap-3 px-4 pt-4 pb-5 sm:px-6 sm:pt-6">
            {wide ? null : stepNav}
            <div className="flex min-w-0 flex-col gap-1">
              <p
                data-step-progress=""
                className="text-muted-foreground text-xs font-medium tracking-wide tabular-nums"
              >
                {progressText}
              </p>
              <h2
                id={ids.step}
                ref={stepHeading}
                tabIndex={-1}
                className="text-foreground text-xl font-semibold tracking-tight outline-none"
              >
                {a(`steps.${currentKey}.title`)}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {a(`steps.${currentKey}.description`)}
              </p>
            </div>
          </header>

          {/* 1 — THE TRADE */}
          {section(
            'trade',
            'gap-5',
            <>
              {accountPickerOpen || selectedAccount === undefined ? (
                <SelectField
                  id="after-account"
                  label={c('account.label')}
                  value={draft.tradingAccountId}
                  error={errorText('tradingAccountId')}
                  onChange={(tradingAccountId) =>
                    apply((current) => ({ ...current, tradingAccountId }))
                  }
                  options={[
                    { value: '', label: c('account.choose') },
                    ...options.tradingAccounts.map((account) => ({
                      value: account.tradingAccountId,
                      label: `${account.name} · ${account.baseCurrency}`,
                    })),
                  ]}
                />
              ) : (
                <div
                  data-account-context=""
                  className="bg-muted/40 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md px-3 py-2"
                >
                  <p className="min-w-0 text-sm break-words">
                    <span className="text-muted-foreground">{c('account.label')} </span>
                    <span className="text-foreground font-semibold">{selectedAccount.name}</span>
                    <span className="text-muted-foreground"> · {selectedAccount.baseCurrency}</span>
                  </p>
                  <InlineAction
                    ariaLabel={c('account.changeAria')}
                    onClick={() => setAccountPickerOpen(true)}
                  >
                    {c('account.change')}
                  </InlineAction>
                </div>
              )}

              <div className="grid min-w-0 gap-5 min-[560px]:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <TextField
                    id="after-symbol"
                    label={c('symbol.label')}
                    value={draft.symbol}
                    onChange={(symbol) => apply((current) => ({ ...current, symbol }))}
                    placeholder={c('symbol.placeholder')}
                    autoCapitalize="characters"
                    error={errorText('symbol')}
                  />
                  {recentSymbols.length === 0 ? null : (
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-muted-foreground text-sm">{c('symbol.recent')}</span>
                      {recentSymbols.map((symbol) => (
                        <InlineAction
                          key={symbol}
                          ariaLabel={c('symbol.useRecent', { symbol })}
                          onClick={() => apply((current) => ({ ...current, symbol }))}
                        >
                          {symbol}
                        </InlineAction>
                      ))}
                    </div>
                  )}
                </div>
                <ChoiceGroup
                  idPrefix="after-direction"
                  legend={c('direction.label')}
                  value={draft.direction === '' ? null : draft.direction}
                  compact
                  fit
                  error={errorText('direction')}
                  onChange={(direction) => apply((current) => ({ ...current, direction }))}
                  options={[
                    { value: 'long', label: c('direction.long') },
                    { value: 'short', label: c('direction.short') },
                  ]}
                />
              </div>

              <div className="grid min-w-0 gap-5 min-[560px]:grid-cols-2">
                <TimeField
                  id="after-enteredAt"
                  label={a('times.entry')}
                  value={draft.enteredAt}
                  error={errorText('enteredAt')}
                  onChange={(enteredAt) => apply((current) => ({ ...current, enteredAt }))}
                />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <TimeField
                    id="after-exitedAt"
                    label={a('times.exit')}
                    value={draft.exitedAt}
                    error={errorText('exitedAt')}
                    onChange={(exitedAt) => apply((current) => ({ ...current, exitedAt }))}
                  />
                  {latestExitLocal === null ? null : (
                    <div>
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
                </div>
              </div>
              <Helper>{a('times.hint', { timezone })}</Helper>
            </>,
          )}

          {/* 2 — WHAT HAPPENED: the moment's question, and the strongest step */}
          {section(
            'result',
            'gap-6',
            <>
              <div
                data-result-panel=""
                className="border-border bg-muted/30 flex min-w-0 flex-col gap-4 rounded-lg border p-4 sm:p-5"
              >
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
                <div
                  data-actual-r={validation.actualR.status}
                  className="border-border flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-4"
                >
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">{a('result.actualR')}</p>
                    <p className="text-muted-foreground text-xs">{a('result.actualRBasis')}</p>
                  </div>
                  {validation.actualR.status === 'known' ? (
                    <p className="text-foreground text-2xl font-semibold tabular-nums">
                      {formatR(validation.actualR.value)}
                    </p>
                  ) : (
                    <p className="text-muted-foreground min-w-0 text-sm">
                      {a(`result.unavailable.${validation.actualR.reason}`)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <ChoiceGroup
                  idPrefix="after-outcome"
                  legend={a('result.outcome')}
                  value={draft.outcome}
                  status={c('notAnswered')}
                  columns={3}
                  compact
                  fit
                  aside={
                    <InlineAction
                      ariaLabel={a('result.removeOutcomeAria')}
                      onClick={() => apply((current) => setOutcome(current, null))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
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
              </div>

              {/* Exit history: optional supporting evidence, never the result */}
              <div className="border-border min-w-0 rounded-lg border px-1 py-1">
                <Disclosure
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
                  open={exitsOpen}
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
                </Disclosure>
              </div>
            </>,
          )}

          {/* 3 — RISK AND PLAN AT ENTRY, as remembered */}
          {section(
            'plan',
            'gap-6',
            <>
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
                  value={draft.actualRisk.answer === 'unanswered' ? null : draft.actualRisk.answer}
                  status={c('notAnswered')}
                  columns={3}
                  compact
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

              <div className="flex min-w-0 flex-col gap-3">
                <ChoiceGroup
                  idPrefix="after-target"
                  legend={c('target.legend')}
                  value={draft.target.state === 'unanswered' ? null : draft.target.state}
                  status={c('notAnswered')}
                  aside={
                    <InlineAction
                      ariaLabel={c('target.removeAria')}
                      onClick={() => apply((current) => setTargetState(current, 'unanswered'))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
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

              <AtEntryExitPlan
                draft={exitPlanView}
                options={options}
                onChange={(next) => apply((current) => ({ ...current, exitPlan: next.exitPlan }))}
                onLibraryChanged={setAdoptedExitPlans}
                copy={{
                  notRecordedHint: a('exitPlan.notRecordedHint'),
                  editorDescription: a('exitPlan.editorDescription'),
                }}
              />
            </>,
          )}

          {/* 4 — THE TRADER'S READ (core analytical data, optional to save) */}
          {section(
            'context',
            'gap-0',
            <>
              <div className="pb-5">
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
              </div>
              <div className="border-border border-t py-5">
                <ChoiceGroup
                  idPrefix="after-confidence"
                  legend={a('confidence.label')}
                  value={draft.confidence === null ? null : String(draft.confidence)}
                  status={c('notAnswered')}
                  columns={5}
                  compact
                  fit
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
              </div>
              {(['emotions', 'postTradeEmotions'] as const).map((phase) => {
                const answer = draft[phase];
                const legend =
                  phase === 'emotions' ? a('emotions.entryLegend') : a('emotions.postLegend');
                return (
                  <div key={phase} className="border-border -mx-3 border-t px-0 pt-2 pb-1">
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
                      onToggle={() =>
                        setEmotionsOpen((current) => ({ ...current, [phase]: !current[phase] }))
                      }
                    >
                      <EmotionFields
                        phase={phase}
                        answer={answer}
                        legend={legend}
                        hint={phase === 'postTradeEmotions' ? a('emotions.postHint') : undefined}
                        removeAria={
                          phase === 'emotions'
                            ? c('emotions.removeAria')
                            : a('emotions.removePostAria')
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
                  </div>
                );
              })}
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
              <div
                data-trade-summary=""
                className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 rounded-lg border p-4"
              >
                <p className="text-foreground text-sm font-semibold">{a('steps.summaryTitle')}</p>
                <dl className="divide-border flex min-w-0 flex-col divide-y">
                  {(['trade', 'result', 'plan', 'context'] as const).map((key) => {
                    const errors = stepErrorCounts[STEP_INDEX[key]] ?? 0;
                    const entered = key === 'trade' ? localTime(draft.enteredAt) : null;
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
                            {errors > 0
                              ? a('steps.needsAttention')
                              : (stepSummaries[key] ?? a('steps.summaryNotRecorded'))}
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
              {replayConflictPanel}
            </>,
          )}

          {/* STEP NAVIGATION — Save exists only on the last step */}
          <div
            data-step-actions=""
            {...(onLastStep ? { 'data-global-save': '' } : {})}
            data-action-bar={wide || keyboardOpen ? 'inline' : 'docked'}
            className={cn(
              'border-border bg-card flex min-w-0 flex-col gap-2 rounded-b-xl border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6',
              !wide &&
                !keyboardOpen &&
                'sticky bottom-0 z-20 shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.45)]',
            )}
          >
            {onLastStep ? (
              <p
                data-save-status=""
                tabIndex={-1}
                aria-live="polite"
                className={cn('min-w-0 text-sm leading-snug outline-none', statusTone)}
              >
                {statusLine}
              </p>
            ) : null}
            <div className="flex min-w-0 items-center justify-between gap-3">
              {step === 0 ? (
                <span aria-hidden="true" />
              ) : (
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
                  className="min-h-12 min-w-0 shrink"
                  disabled={pending}
                >
                  {pending ? a('save.saving') : a('save.action')}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  className="min-h-12 min-w-0 shrink"
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
              <div className="border-border flex flex-col gap-2.5 border-t px-3 pt-3 pb-2">
                <p className="text-foreground text-sm font-medium">{a('save.panelTitle')}</p>
                <ul className="flex flex-col gap-2">
                  {requirements.map((item) => (
                    <RequirementRow
                      key={item.key}
                      label={c(`save.requirement.${item.key}`)}
                      done={item.done && visibleErrors[item.field] === undefined}
                      addedLabel={c('save.added')}
                      neededLabel={c('save.needed')}
                    />
                  ))}
                </ul>
                <p className="text-muted-foreground text-xs">{a('save.panelDescription')}</p>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
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
      {draft.exits.length === 0 ? (
        <p className="text-muted-foreground text-sm">{a('exits.empty')}</p>
      ) : (
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
      <div className="mt-2 grid min-w-0 gap-x-6 gap-y-3 min-[560px]:grid-cols-2">
        {groupEmotionCatalog(catalog).map((group) => (
          <div key={group.key} className="flex min-w-0 flex-col gap-1.5">
            <p className="text-muted-foreground text-sm">
              {t(`create.recording.emotionGroups.${group.key}`)}
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.emotions.map((emotion) => (
                <Chip
                  key={emotion.key}
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
      <div className="border-border mt-3 flex min-w-0 flex-wrap items-center gap-3 border-t pt-3">
        <Chip selected={answer.answer === 'none'} onClick={onNone}>
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
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-3">
      <TextAreaField
        id="after-context-reason"
        label={c('reason')}
        value={draft.context.reason}
        onChange={(reason) => onChange({ reason })}
        placeholder={c('reasonPlaceholder')}
      />
      <TextField
        id="after-context-chart"
        label={c('chart')}
        value={draft.context.tradingviewUrl}
        onChange={(tradingviewUrl) => onChange({ tradingviewUrl })}
        inputMode="url"
        placeholder="https://www.tradingview.com/x/…"
      />
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
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-foreground text-sm font-medium">{c('prices')}</p>
          <StateText>{c('pricesHint')}</StateText>
        </div>
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
      <TextAreaField
        id="after-context-notes"
        label={c('notes')}
        value={draft.context.notes}
        onChange={(notes) => onChange({ notes })}
      />
    </div>
  );
}
