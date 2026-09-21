'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { composePlannedR } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
import { confidenceLevelKey } from '@/lib/trades/constants';
import { createTradeAction } from '@/server/actions/trades';
import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';
import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { useRouter } from '@/i18n/navigation';

import { composeEntryTimestamp, entryTimestampParts } from './after-trade-draft';
import {
  activeClassification,
  analysisSummary,
  answerCondition,
  answerNoEmotions,
  answerNoSetup,
  answerNoStrategy,
  atEntryReadiness,
  buildAtEntryPayload,
  canDeselectEmotion,
  clearEntryTime,
  confirmEntryTime,
  createAtEntryDraft,
  editEntryTime,
  followClock,
  removeEmotionsAnswer,
  removeSetupAnswer,
  removeStrategyAnswer,
  resetEntryTimeToNow,
  resolveExitPlan,
  selectSetup,
  selectStrategy,
  setActualRiskAmount,
  setActualRiskMode,
  setConfidence,
  setTargetState,
  setTargetValue,
  toggleEmotion,
  validateAtEntryDraft,
  type AtEntryDraft,
  type AtEntryErrorCode,
  type AtEntryErrors,
  type AtEntryField,
} from './at-entry-draft';
import { hasStaleSelection, staleSelections } from './stale-selection';
import { InlineAction, TextField } from './trade-at-entry-controls';
import { tradeDetailsRowId, TradeDetailsStep, type EntryErrorCode } from './trade-details-step';
import { TradeEntryContextStep } from './trade-entry-context-step';
import { instantToDatetimeLocal, parseTradeMoneyInput } from './trade-form-values';
import { formatR, formatTradeMoney } from './trade-format';
import { TradePlanRiskStep, type PlanRiskField, type PlanStepId } from './trade-plan-risk-step';
import type { RecordingSaveControls } from './trade-recording-form';
import { useKeyboardObscuringViewport } from './trade-recording-surface';
import { TradeAlreadySaved, TradeSaveReplayConflict } from './trade-save-replay';
import { TradeSetupChecklistStep } from './trade-setup-checklist-step';
import { TradeStepFlow, TradeStepSection } from './trade-step-flow';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

/**
 * RECORD OPEN TRADE — canonical lifecycle stages 1 → 2 → 3 → 4, then Save Open
 * Trade (Add Trade contract §1 Recording lifecycle, §6; UX Rules §11, §20.4).
 */
const STEPS = ['trade', 'plan', 'setup', 'context'] as const;
type StepKey = (typeof STEPS)[number];
const STEP_INDEX: Readonly<Record<StepKey, number>> = { trade: 0, plan: 1, setup: 2, context: 3 };
const LAST_STEP = STEPS.length - 1;

/** The step that asks a field — where a blocked Save goes to reach it. */
function fieldStep(field: AtEntryField): number {
  switch (field) {
    case 'tradingAccountId':
    case 'symbol':
    case 'direction':
    case 'enteredAt':
      return STEP_INDEX.trade;
    default:
      return STEP_INDEX.plan;
  }
}

/** Where a blocked Save sends focus for each field — always a real, focusable control. */
const FIELD_TARGET_ID: Readonly<Record<AtEntryField, string>> = {
  // Step 1's controls live in editors; its launcher row names the concept and opens it.
  tradingAccountId: tradeDetailsRowId('entry', 'tradingAccountId'),
  symbol: tradeDetailsRowId('entry', 'symbol'),
  direction: tradeDetailsRowId('entry', 'direction'),
  enteredAt: tradeDetailsRowId('entry', 'enteredAt'),
  risk: 'entry-risk',
  actualRiskAmount: 'entry-actual-risk',
  targetProfit: 'entry-target-profit',
  targetPrice: 'entry-target-price',
  contextEntryPrice: 'entry-context-entry-price',
  contextStopPrice: 'entry-context-stop-price',
  contextPositionSize: 'entry-context-size',
};

/** The Plan & Risk step's ids for Record Open. */
const PLAN_STEP_IDS: Readonly<Record<PlanStepId, string>> = {
  risk: FIELD_TARGET_ID.risk,
  targetState: 'entry-target',
  targetProfit: FIELD_TARGET_ID.targetProfit,
  targetPrice: FIELD_TARGET_ID.targetPrice,
  entryPrice: FIELD_TARGET_ID.contextEntryPrice,
  stopPrice: FIELD_TARGET_ID.contextStopPrice,
  positionSize: FIELD_TARGET_ID.contextPositionSize,
  priceContextToggle: 'entry-plan-price',
};

/** The Plan & Risk step's fields, as this draft names them. */
const PLAN_STEP_FIELD: Readonly<Record<PlanRiskField, AtEntryField>> = {
  risk: 'risk',
  targetProfit: 'targetProfit',
  targetPrice: 'targetPrice',
  entryPrice: 'contextEntryPrice',
  stopPrice: 'contextStopPrice',
  positionSize: 'contextPositionSize',
};

/**
 * What a field-level refusal from the server says. Only a price field can be
 * "not a valid price" and only a money field "not a valid amount"; anything
 * else is named honestly as not accepted rather than as a price problem.
 */
function serverFieldErrorCode(field: AtEntryField): AtEntryErrorCode {
  switch (field) {
    case 'targetPrice':
    case 'contextEntryPrice':
    case 'contextStopPrice':
    case 'contextPositionSize':
      return 'invalid_price';
    case 'risk':
    case 'actualRiskAmount':
    case 'targetProfit':
      return 'invalid_money';
    case 'enteredAt':
      return 'invalid_datetime';
    default:
      return 'not_accepted';
  }
}

/** Server field names mapped onto the fields a trader can see and correct. */
const SERVER_FIELD: Readonly<Record<string, AtEntryField>> = {
  tradingAccountId: 'tradingAccountId',
  symbol: 'symbol',
  direction: 'direction',
  plannedRiskMinor: 'risk',
  actualInitialRiskMinor: 'actualRiskAmount',
  enteredAt: 'enteredAt',
  targetState: 'targetProfit',
  plannedRewardMinor: 'targetProfit',
  targetPrice: 'targetPrice',
  contextEntryPrice: 'contextEntryPrice',
  contextStopPrice: 'contextStopPrice',
  contextPositionSize: 'contextPositionSize',
};

/** Inside the step being shown, rather than one kept mounted but hidden. */
function isShown(element: Element): boolean {
  return element.closest('[hidden]') === null;
}

const WIDE_VIEWPORT_QUERY = '(min-width: 64rem)';

function subscribeWideViewport(onChange: () => void): () => void {
  const media = window.matchMedia(WIDE_VIEWPORT_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Desktop-first on the server, matching the analytics posture in CLAUDE.md §8. */
function useIsWideViewport(): boolean {
  return useSyncExternalStore(
    subscribeWideViewport,
    () => window.matchMedia(WIDE_VIEWPORT_QUERY).matches,
    () => true,
  );
}

/**
 * RECORD OPEN TRADE — "Record an open trade", Add Trade contract v1 (§6).
 *
 * THE MOMENT'S QUESTION IS "WHAT AM I DOING AND WHY?" (UX Rules §11). Four
 * canonical stages, one at a time, in the shared recording frame: Trade
 * Details, Plan & Risk, Setup & Checklist, Entry Context & Evidence. Each is
 * the canonical component in its At Entry mode; this form owns only the
 * draft, the current step, validation and Save.
 *
 * FAST SAVE, NOT A TOLL ROAD. Save Open Trade needs Account, Symbol,
 * Direction and Risk at Entry, which the first two stages ask. From Plan &
 * Risk on, Save now is always there — secondary to going on, and the very
 * same Save as the last step's button; if something is missing it says what
 * and takes the trader to it (UX Rules §6.5, §11.2, §20.4).
 *
 * ALL SEMANTICS LIVE IN `at-entry-draft`: the "now" entry time that follows
 * the clock until touched, the visible Actual Risk assumption, Target and
 * Exit Plan states with visible Strategy-default inheritance, Strategy /
 * Setup / condition answers, psychology, context — and readiness derived
 * from the same error set Save uses. The current step is view state: it is
 * never stored in the draft, and a reload recovers every answer from Step 1.
 */
export function TradeAtEntryForm({
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
  initialDraft?: AtEntryDraft | null;
  /** The Recording Draft's idempotency key, so a retry after reload cannot duplicate a Trade. */
  mutationKey?: string;
  /** Type → Draft: called with every change. */
  onDraftChange?: (draft: AtEntryDraft) => void;
  /** Called only after the server has confirmed the Trade. */
  onSaved?: () => void;
  /** The Recording Draft's Save safeguards: inactive-mode confirmation and "Save as new". */
  saveControls?: RecordingSaveControls;
  /** Set while there is work in the draft but nothing restored to announce: Discard lives in the mode line. */
  onDiscardDraft?: (() => void) | null;
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const s = useTranslations('trades.create.recording.contractEntry.steps');
  const router = useRouter();
  /*
    THE LIBRARY A TRADER JUST CHANGED WINS OVER THE PAGE'S COPY OF IT. A
    saved-plan action returns the active library it produced; the adopted list
    lasts for this form's life, which ends when the Trade is saved.
  */
  const [adoptedExitPlans, setAdoptedExitPlans] = useState<
    readonly TradeCreateExitPlanOption[] | null
  >(null);
  const options = useMemo<TradeCreateOptions>(
    () =>
      adoptedExitPlans === null ? serverOptions : { ...serverOptions, exitPlans: adoptedExitPlans },
    [serverOptions, adoptedExitPlans],
  );
  const hydrated = useIsHydrated();
  const keyboardOpen = useKeyboardObscuringViewport();
  const wide = useIsWideViewport();
  const symbolFavorites = useTradePlanFavorites('symbol', options.workspaceId);
  const [fallbackMutationKey] = useState(generateId);
  const mutationKey = draftMutationKey ?? fallbackMutationKey;
  const submitting = useRef(false);
  const formId = useId();
  const headingId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /*
    The active Account first, then the sole Account, then nothing. The active id
    is checked against the offered options rather than trusted: it is a per-user
    preference that can name an Account since archived.
  */
  const initialAccount =
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((item) => item.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '');
  const pristine = useMemo(() => createAtEntryDraft(initialAccount), [initialAccount]);
  const [storedDraft, setStoredDraft] = useState(initialDraft ?? pristine);
  /*
    TYPE → DRAFT. The stored draft, not the clock-followed view of it, is what
    persists: an untouched entry time stays a default in storage too, so a
    reload keeps following the clock instead of freezing a stale "now".
  */
  useEffect(() => {
    onDraftChange?.(storedDraft);
  }, [storedDraft, onDraftChange]);

  /*
    THE CURRENT STEP IS VIEW STATE, NOT DRAFT STATE. Every step stays mounted
    and only the current one is shown, so moving between steps can never drop
    an answer; a reload recovers the draft and starts again from Step 1.
  */
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AtEntryErrors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  /** The Trade a reused Save key already created from different answers. */
  const [replayConflict, setReplayConflict] = useState<{
    readonly tradeId: string;
    readonly reason: 'different' | 'unverifiable';
  } | null>(null);
  /** An honest replay: these exact answers were already saved. */
  const [alreadySaved, setAlreadySaved] = useState<string | null>(null);
  const alreadySavedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (alreadySaved !== null) alreadySavedHeading.current?.focus();
  }, [alreadySaved]);
  const [pending, setPending] = useState(false);

  /*
    ENTRY TIME FOLLOWS THE CLOCK UNTIL THE TRADER TOUCHES IT — resolved after
    hydration only, so the server never renders a time the browser immediately
    contradicts.
  */
  const nowLocal = () =>
    hydrated ? instantToDatetimeLocal(new Date().toISOString(), timezone) : '';
  const draft = followClock(storedDraft, nowLocal());
  const apply = (change: (current: AtEntryDraft) => AtEntryDraft) => {
    setStoredDraft((current) => change(followClock(current, nowLocal())));
    setServerMessage(null);
  };

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === draft.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const validation = validateAtEntryDraft(draft, { currency, timezone });
  const readiness = atEntryReadiness(validation);
  const active = activeClassification(draft, options);
  const exitPlan = resolveExitPlan(draft, options);
  const stale = staleSelections(draft, options);
  const summary = analysisSummary(draft, options);

  /*
    WHICH ERRORS SPEAK. Before a Save attempt, only a malformed value the trader
    already typed is flagged — a blank required field is not shouted at. After
    an attempt, every blocking error is shown. Readiness never depends on this:
    it always counts every blocking error.
  */
  const typed: Partial<Record<AtEntryField, string>> = {
    risk: draft.risk,
    actualRiskAmount: draft.actualRisk.mode === 'different' ? draft.actualRisk.amount : '',
    enteredAt: draft.entryTime.source === 'trader' ? draft.entryTime.value : '',
    targetProfit: draft.target.state === 'fixed' ? draft.target.profit : '',
    targetPrice: draft.target.state === 'fixed' ? draft.target.price : '',
    contextEntryPrice: draft.context.entryPrice,
    contextStopPrice: draft.context.stopPrice,
    contextPositionSize: draft.context.positionSize,
  };
  const visibleErrors: AtEntryErrors = { ...serverErrors };
  for (const [field, code] of Object.entries(validation.errors) as [
    AtEntryField,
    AtEntryErrorCode,
  ][]) {
    if (attempted || (typed[field] ?? '').trim() !== '') visibleErrors[field] = code;
  }

  /*
    HALF AN ENTRY STAMP SAYS WHICH HALF IS MISSING. At Entry records one
    complete instant, and a draft only rests on half of one after a cleared
    time is partly given again. Validation calls that not a valid date and
    time; the trader is told the half that would complete it.
  */
  const entryParts = entryTimestampParts(draft.entryTime.value);
  const entryHalf: EntryErrorCode =
    entryParts.date !== '' && entryParts.time === ''
      ? 'entry_time_required'
      : entryParts.time !== '' && entryParts.date === ''
        ? 'entry_date_required'
        : null;

  function errorText(field: AtEntryField): string | undefined {
    const code = visibleErrors[field];
    if (code === undefined) return undefined;
    switch (code) {
      case 'required':
        return field === 'tradingAccountId'
          ? c('errors.requiredAccount')
          : field === 'symbol'
            ? c('errors.requiredSymbol')
            : field === 'direction'
              ? c('errors.requiredDirection')
              : field === 'actualRiskAmount'
                ? c('errors.requiredActualRisk')
                : c('errors.requiredRisk');
      case 'invalid_money':
        return c('errors.invalidMoney');
      case 'must_be_positive':
        return c('errors.mustBePositive');
      case 'invalid_datetime':
        return field === 'enteredAt' && entryHalf === 'entry_time_required'
          ? a('errors.entryTimeRequired')
          : field === 'enteredAt' && entryHalf === 'entry_date_required'
            ? a('errors.entryDateRequired')
            : c('errors.invalidDatetime');
      case 'invalid_price':
        return c('errors.invalidPrice');
      case 'fixed_target_requires_value':
        return c('errors.fixedTargetRequiresValue');
      case 'actual_risk_equals_risk_at_entry':
        return c('errors.actualRiskEqualsRiskAtEntry');
      case 'not_accepted':
        return c('errors.notAccepted');
    }
  }

  const requirements = [
    { key: 'account', field: 'tradingAccountId', step: 0, done: draft.tradingAccountId !== '' },
    { key: 'symbol', field: 'symbol', step: 0, done: draft.symbol.trim() !== '' },
    { key: 'direction', field: 'direction', step: 0, done: draft.direction !== '' },
    { key: 'risk', field: 'risk', step: 1, done: validation.riskMinor !== null },
  ] as const;
  const missingRequirements = requirements.filter(
    (item) => !item.done || visibleErrors[item.field] !== undefined,
  );
  const remaining = requirements.filter((item) => !item.done).length;
  const blockedCount = readiness.status === 'blocked' ? readiness.count : 0;
  const statusBlocked = readiness.status === 'blocked' && (attempted || remaining === 0);
  const statusLine = pending
    ? c('save.saving')
    : (serverMessage ??
      (readiness.status === 'ready'
        ? c('save.ready')
        : statusBlocked
          ? c('save.blocked', { count: blockedCount })
          : c('save.remaining', { count: remaining })));
  const statusTone =
    serverMessage !== null || (attempted && readiness.status === 'blocked')
      ? 'text-destructive'
      : 'text-muted-foreground';

  /**
   * Show one step. With targets, the first rendered one is brought into view
   * and focused — a blocked Save uses this to land on the control that needs
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
  function focusFirstError(fields: readonly AtEntryField[]) {
    if (fields.length === 0) return;
    const index = Math.min(...fields.map(fieldStep));
    showStep(
      index,
      fields
        .filter((field) => fieldStep(field) === index)
        .map((field) => () => document.getElementById(FIELD_TARGET_ID[field])),
    );
  }

  async function submit(saveAsNewKey?: string) {
    // One Save at a time: a second press while one is in flight is ignored.
    if (submitting.current || alreadySaved !== null) return;
    setAttempted(true);
    setServerErrors({});
    const current = followClock(storedDraft, nowLocal());
    const currentValidation = validateAtEntryDraft(current, { currency, timezone });
    const currentReadiness = atEntryReadiness(currentValidation);
    if (currentReadiness.status === 'blocked') {
      setServerMessage(null);
      focusFirstError(currentReadiness.fields);
      return;
    }
    // A chosen answer whose source went away waits for the trader's choice.
    const staleNow = staleSelections(current, options);
    if (hasStaleSelection(staleNow)) {
      setServerMessage(c('save.staleBlocked'));
      if (staleNow.strategy || staleNow.setup) {
        const target = staleNow.strategy ? 'entry-strategy' : 'entry-setup';
        showStep(STEP_INDEX.setup, [() => document.getElementById(target)]);
      } else {
        showStep(STEP_INDEX.plan, [
          () => document.querySelector<HTMLElement>('[data-exit-plan-unavailable]'),
        ]);
      }
      return;
    }
    const payload = buildAtEntryPayload(current, {
      currency,
      timezone,
      mutationKey: saveAsNewKey ?? mutationKey,
      options,
    });
    if (payload === null) return;

    submitting.current = true;
    // Saving clears the whole draft: first, the trader agrees to lose any
    // After Trade answer an open Trade cannot hold (contract §23).
    if (saveControls !== undefined && !(await saveControls.confirmBeforeSave())) {
      submitting.current = false;
      return;
    }
    setPending(true);
    setServerMessage(null);
    setReplayConflict(null);
    let result: Awaited<ReturnType<typeof createTradeAction>>;
    try {
      result = await createTradeAction(payload);
    } catch {
      // A network failure keeps the draft exactly as entered; the same
      // mutation key makes the retry safe.
      submitting.current = false;
      setPending(false);
      setServerMessage(t('errors.unexpected_error'));
      return;
    }
    // Released once the server has answered: only an in-flight Save is guarded.
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
      const mapped: AtEntryErrors = {};
      for (const key of Object.keys(result.error.fieldErrors ?? {})) {
        const field = SERVER_FIELD[key];
        if (field !== undefined) mapped[field] = serverFieldErrorCode(field);
      }
      setServerErrors(mapped);
      setServerMessage(t(`errors.${result.error.code}`));
      focusFirstError(Object.keys(mapped) as AtEntryField[]);
      return;
    }
    symbolFavorites.recordUse(payload.symbol);
    // Save → Persist: only now, with the Trade confirmed, does the draft go.
    onSaved?.();
    if (result.data.alreadyCreated) {
      // An honest replay: say so, rather than present it as a new Save.
      setAlreadySaved(result.data.tradeId);
      return;
    }
    // Save Open Trade offers no Review (contract §20): it opens the Trade.
    router.push(`/app/trades?trade=${result.data.tradeId}`);
  }

  if (alreadySaved !== null) {
    return (
      <TradeAlreadySaved
        headingRef={alreadySavedHeading}
        onOpen={() => router.push(`/app/trades?trade=${alreadySaved}`)}
      />
    );
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

  // At Entry's money-based R for a Target Profit: context for the plan, never a result.
  const targetR = (() => {
    if (draft.direction === '' || validation.riskMinor === null) return null;
    if (draft.target.state !== 'fixed' || draft.target.profit.trim() === '') return null;
    const profit = parseTradeMoneyInput(draft.target.profit, currency);
    if (!profit.ok) return null;
    const composed = composePlannedR({
      direction: draft.direction,
      plannedEntry: null,
      plannedStop: null,
      plannedTarget: null,
      plannedRiskMinor: BigInt(validation.riskMinor),
      plannedRewardMinor: BigInt(profit.value),
    });
    return composed.ok ? formatR(composed.value.plannedR) : null;
  })();

  /*
    WHAT EACH STEP HOLDS, IN A LINE. Read-only restatements of answers already
    given — never a derived answer. A step with nothing recorded says so.
  */
  const joinParts = (parts: readonly (string | null | false | undefined)[]): string | null => {
    const kept = parts.filter((part): part is string => typeof part === 'string' && part !== '');
    return kept.length === 0 ? null : kept.join(' · ');
  };
  const formatMoney = (minor: string) => formatTradeMoney(minor, currency) ?? minor;
  const priceLevelsRecorded = [
    draft.context.entryPrice,
    draft.context.stopPrice,
    draft.context.positionSize,
  ].some((value) => value.trim() !== '');
  const setupLine = (() => {
    if (summary.strategy.answer === 'none') return c('summary.noStrategy');
    if (summary.strategy.answer !== 'selected' || summary.strategy.name === null) return null;
    const setupPart =
      summary.setup.answer === 'none'
        ? c('summary.noSetup')
        : summary.setup.answer === 'selected'
          ? summary.setup.name
          : null;
    return joinParts([
      summary.strategy.name,
      setupPart,
      summary.conditions === null
        ? null
        : c('summary.conditions', {
            answered: summary.conditions.answered,
            total: summary.conditions.total,
          }),
    ]);
  })();
  const contextFilled = [
    draft.context.reason,
    draft.context.timeframe,
    draft.context.session,
    draft.context.notes,
    draft.context.tradingviewUrl,
  ].filter((value) => value.trim() !== '').length;
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
    plan: joinParts([
      validation.riskMinor === null
        ? null
        : `${c('risk.label')} ${formatMoney(validation.riskMinor)}`,
      draft.target.state === 'fixed'
        ? c('target.fixed')
        : draft.target.state === 'no_fixed'
          ? c('target.noFixed')
          : null,
      priceLevelsRecorded ? a('steps.groups.price') : null,
    ]),
    setup: setupLine,
    context: joinParts([
      summary.confidence === null
        ? null
        : c('summary.confidence', {
            level: t(`create.confidence.level.${confidenceLevelKey(summary.confidence)}`),
          }),
      summary.emotions.answer === 'none'
        ? c('summary.emotionsNone')
        : summary.emotions.answer === 'selected'
          ? c('summary.emotionsCount', { count: summary.emotions.count })
          : null,
      contextFilled === 0 ? null : c('summary.contextFilled', { count: contextFilled }),
    ]),
  };
  /** Blocking errors each step holds, so a step with one is marked wherever it is listed. */
  const stepErrorCounts = STEPS.map(
    (_, index) =>
      Object.keys(visibleErrors).filter((field) => fieldStep(field as AtEntryField) === index)
        .length,
  );
  const currentKey = STEPS[step] ?? 'trade';
  const onLastStep = step === LAST_STEP;
  const stepAttention = stepErrorCounts[step] ?? 0;
  const stepLabel = (key: StepKey) => s(`${key}.label`);

  return (
    <TradeStepFlow
      recordingMode="at_entry"
      formRef={formRef}
      formId={formId}
      formData={{ 'data-record-open-form': '', 'data-record-open-step': currentKey }}
      onSubmit={(event) => {
        event.preventDefault();
        // Save Open Trade lives on the last step; Enter elsewhere never saves early.
        if (onLastStep) void submit();
      }}
      wide={wide}
      keyboardOpen={keyboardOpen}
      modeSentence={c('subtitle')}
      modeShort={s('modeShort')}
      onDiscardDraft={onDiscardDraft}
      steps={STEPS.map((key, index) => {
        const missing = missingRequirements.filter((item) => item.step === index).length;
        return {
          key,
          label: stepLabel(key),
          summary: stepSummaries[key],
          errors: stepErrorCounts[index] ?? 0,
          // Only the first two steps hold anything Save needs.
          pending: missing === 0 ? null : a('steps.requiredMissing', { count: missing }),
        };
      })}
      step={step}
      onShowStep={(index) => showStep(index)}
      headingId={headingId}
      headingRef={stepHeading}
      title={s(`${currentKey}.title`)}
      description={s(`${currentKey}.description`)}
      attention={stepAttention === 0 ? null : a('steps.attention', { count: stepAttention })}
      copy={{
        navLabel: a('steps.navLabel'),
        progress: a('steps.progress', { current: step + 1, total: STEPS.length }),
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
      /*
        SAVE NOW, FROM PLAN & RISK ON. Step 1 cannot hold the whole Save
        minimum — Risk at Entry is Step 2's — so the short way out starts
        there, and stays offered after: pressing it with something missing is
        how a trader finds out what (UX Rules §6.5, §20.4).
      */
      quickSave={
        step >= STEP_INDEX.plan && !pending
          ? {
              id: 'entry-quick-save',
              label: a('steps.quickSave'),
              ariaLabel: c('save.action'),
              hint: a('steps.quickSaveHint'),
              onClick: () => void submit(),
            }
          : null
      }
      save={{ label: c('save.action'), pendingLabel: c('save.saving'), pending }}
      footerNote={null}
      replayPanel={replayConflictPanel}
      requirements={{
        ready: missingRequirements.length === 0,
        readyText: c('save.ready'),
        missing: a('steps.requiredMissing', { count: missingRequirements.length }),
        list: missingRequirements.map((item) => c(`save.requirement.${item.key}`)).join(' · '),
      }}
    >
      {/* 1 — TRADE DETAILS: the protected Step 1, with At Entry's "now" entry time. */}
      <TradeStepSection
        stepKey="trade"
        current={currentKey === 'trade'}
        headingId={headingId}
        className="gap-3"
      >
        <TradeDetailsStep
          mode="at_entry"
          idPrefix="entry"
          options={options}
          timezone={timezone}
          now={new Date()}
          tradingAccountId={draft.tradingAccountId}
          symbol={draft.symbol}
          direction={draft.direction}
          enteredAt={draft.entryTime.value}
          entrySource={draft.entryTime.source}
          errors={{
            tradingAccountId: errorText('tradingAccountId'),
            symbol: errorText('symbol'),
            direction: errorText('direction'),
          }}
          entryError={{
            code: visibleErrors.enteredAt === undefined ? null : (entryHalf ?? 'other'),
            text: errorText('enteredAt'),
          }}
          attempted={attempted}
          onTradingAccount={(tradingAccountId) =>
            apply((current) => ({ ...current, tradingAccountId }))
          }
          onSymbol={(symbol) => apply((current) => ({ ...current, symbol }))}
          onDirection={(direction) => apply((current) => ({ ...current, direction }))}
          // Either half, changed, keeps the other: the answer is now the trader's.
          onEntryDate={(date) =>
            apply((current) =>
              editEntryTime(
                current,
                composeEntryTimestamp(date, entryTimestampParts(current.entryTime.value).time),
              ),
            )
          }
          onEntryTime={(time) =>
            apply((current) =>
              editEntryTime(
                current,
                composeEntryTimestamp(entryTimestampParts(current.entryTime.value).date, time),
              ),
            )
          }
          onClearEntry={() => apply(clearEntryTime)}
          onConfirmEntry={() => apply(confirmEntryTime)}
          onUseNowEntry={() => apply((current) => resetEntryTimeToNow(current, nowLocal()))}
        />
      </TradeStepSection>

      {/* 2 — PLAN & RISK: Risk at Entry required, Actual Risk as At Entry asks it. */}
      <TradeStepSection
        stepKey="plan"
        current={currentKey === 'plan'}
        headingId={headingId}
        className="gap-4"
      >
        <TradePlanRiskStep
          mode="at_entry"
          ids={PLAN_STEP_IDS}
          currency={currency}
          risk={draft.risk}
          target={draft.target}
          exitPlan={draft.exitPlan}
          classification={draft.classification}
          priceContext={draft.context}
          options={options}
          errorText={(field) => errorText(PLAN_STEP_FIELD[field])}
          notices={{
            stopWrongSide: validation.notices.includes('stop_wrong_side'),
            targetWrongSide: validation.notices.includes('target_wrong_side'),
          }}
          riskFollowUp={
            <ActualRiskField
              draft={draft}
              currency={currency}
              riskIsValid={validation.riskMinor !== null}
              error={errorText('actualRiskAmount')}
              onMode={(mode) => apply((current) => setActualRiskMode(current, mode))}
              onAmount={(amount) => apply((current) => setActualRiskAmount(current, amount))}
            />
          }
          targetR={targetR}
          onRiskChange={(risk) => apply((current) => ({ ...current, risk }))}
          onTargetStateChange={(state) => apply((current) => setTargetState(current, state))}
          onTargetValueChange={(field, value) =>
            apply((current) => setTargetValue(current, field, value))
          }
          onExitPlanChange={(next) => apply((current) => ({ ...current, exitPlan: next }))}
          onPriceContextChange={(patch) =>
            apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
          }
          onLibraryChanged={setAdoptedExitPlans}
        />
      </TradeStepSection>

      {/* 3 — SETUP & CHECKLIST: an inherited Exit Plan is announced where the Strategy is chosen. */}
      <TradeStepSection
        stepKey="setup"
        current={currentKey === 'setup'}
        headingId={headingId}
        className="gap-4"
      >
        <TradeSetupChecklistStep
          mode="at_entry"
          idPrefix="entry"
          strategies={options.strategies}
          classification={{
            strategyAnswer: draft.classification.strategy,
            strategy: active.strategy,
            setupAnswer: active.setupAnswer,
            setup: active.setup,
            stale,
          }}
          conditionAnswers={active.conditionAnswers}
          inheritedExitPlanName={
            exitPlan.resolved.status === 'inherited' ? exitPlan.resolved.plan.name : null
          }
          onSelectStrategy={(id) => apply((current) => selectStrategy(current, id))}
          onNoStrategy={() => apply(answerNoStrategy)}
          onRemoveStrategy={() => apply(removeStrategyAnswer)}
          onSelectSetup={(id) => apply((current) => selectSetup(current, id))}
          onNoSetup={() => apply(answerNoSetup)}
          onRemoveSetup={() => apply(removeSetupAnswer)}
          onCondition={(key, status) => apply((current) => answerCondition(current, key, status))}
        />
      </TradeStepSection>

      {/* 4 — ENTRY CONTEXT & EVIDENCE: what the trader knows, thinks and feels as they enter. */}
      <TradeStepSection
        stepKey="context"
        current={currentKey === 'context'}
        headingId={headingId}
        className="gap-4"
      >
        <TradeEntryContextStep
          mode="at_entry"
          idPrefix="entry"
          confidence={draft.confidence}
          emotions={draft.emotions}
          catalog={options.emotionCatalog}
          values={draft.context}
          canDeselectEmotion={(key) => canDeselectEmotion(draft, key)}
          onConfidence={(value) => apply((current) => setConfidence(current, value))}
          onToggleEmotion={(key) => apply((current) => toggleEmotion(current, key))}
          onNoEmotions={() => apply(answerNoEmotions)}
          onRemoveEmotions={() => apply(removeEmotionsAnswer)}
          onChange={(patch) =>
            apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
          }
        />
      </TradeStepSection>
    </TradeStepFlow>
  );
}

/**
 * ACTUAL RISK, AS AT ENTRY ASKS IT (contract §4; UX Rules §3.4). Unopened, it
 * says plainly that actual risk matches Risk at Entry — a visible assumption,
 * never a silent server inference. Opening "Actual risk differed" records
 * Different, with an amount or with the amount unknown, and never reverts to
 * Matched except through its own named action.
 */
function ActualRiskField({
  draft,
  currency,
  riskIsValid,
  error,
  onMode,
  onAmount,
}: {
  draft: AtEntryDraft;
  currency: string;
  riskIsValid: boolean;
  error?: string | undefined;
  onMode: (mode: AtEntryDraft['actualRisk']['mode']) => void;
  onAmount: (amount: string) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry.actualRisk');
  const { mode, amount } = draft.actualRisk;
  if (mode === 'matched') {
    // The Matched assumption only makes sense beside a real, positive Risk at Entry.
    if (!riskIsValid) return null;
    return (
      <div
        data-actual-risk="matched"
        className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
      >
        <span className="text-foreground">{c('matched')}</span>
        <span>{c('assumption')}</span>
        <InlineAction onClick={() => onMode('different')}>{c('different')}</InlineAction>
      </div>
    );
  }
  if (mode === 'different_unknown') {
    return (
      <div
        data-actual-risk="different_unknown"
        className="border-control-border flex min-w-0 flex-col gap-1 border-l-2 pl-4"
      >
        <p className="text-foreground text-sm font-medium">{c('unknownState')}</p>
        <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
          <InlineAction onClick={() => onMode('different')}>{c('enterAmount')}</InlineAction>
          <InlineAction onClick={() => onMode('matched')}>{c('matchedAfterAll')}</InlineAction>
        </div>
      </div>
    );
  }
  return (
    <div
      data-actual-risk="different"
      className="border-control-border flex min-w-0 flex-col gap-2 border-l-2 pl-4"
    >
      <TextField
        id="entry-actual-risk"
        label={c('amount')}
        value={amount}
        onChange={onAmount}
        suffix={currency}
        inputMode="decimal"
        figure
        hint={c('amountHint')}
        error={error}
      />
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        <InlineAction onClick={() => onMode('different_unknown')}>{c('unknown')}</InlineAction>
        <InlineAction onClick={() => onMode('matched')}>{c('matchedAfterAll')}</InlineAction>
      </div>
    </div>
  );
}
