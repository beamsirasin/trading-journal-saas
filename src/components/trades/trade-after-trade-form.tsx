'use client';

import { Check, HeartPulse, Lightbulb, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { composePlannedR, composeTraderCloseV2 } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
import { confidenceLevelKey } from '@/lib/trades/constants';
import { deriveHistoricalExecutionSnapshot } from '@/lib/trades/historical-execution';
import { cn } from '@/lib/utils';
import { createCompletedTradeAction } from '@/server/actions/trades';
import type { TradeCreateOptions } from '@/server/dal/trades';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/i18n/navigation';

import {
  emptyAfterTradeValues,
  meaningfulAfterTradeExit,
  type AfterTradeBasis,
  type AfterTradeCompleteness,
  type AfterTradeExitDraft,
  type AfterTradeExitScope,
  type AfterTradeValues,
} from './after-trade-draft';
import { NativeSelect } from './trade-action-form';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { TradeConfidenceChoice } from './trade-confidence-choice';
import { TradeEmotionChips } from './trade-emotion-chips';
import { datetimeLocalToIso, parseTradeMoneyInput } from './trade-form-values';
import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';
import { TradeRecordingModeChange } from './trade-recording-mode-change';
import { confidenceOf } from './trade-recording-primitives';
import {
  Band,
  ContextLine,
  FieldPair,
  FormFooter,
  InlineNote,
  JournalLauncherSurface,
  PrimaryAmountField,
  QuietAction,
  ResultLine,
  SectionLabel,
  SegmentedChoice,
  SelectField,
  TaskSurface,
  TextInputField,
} from './trade-recording-surface';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

type Basis = AfterTradeBasis;
type ExitScope = AfterTradeExitScope;
type Completeness = AfterTradeCompleteness;
type ExitDraft = AfterTradeExitDraft;
type Values = AfterTradeValues;
type JournalArea = 'idea' | 'feelings';
type ErrorMap = Record<string, string>;

/** Everything the two journal overlays edit, held as a working copy until Done. */
interface JournalDraft {
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
  strategyId: string;
  setupId: string;
  timeframe: string;
  session: string;
  conditionMet: Record<string, boolean>;
  confidence: string;
  emotions: readonly string[] | null;
}

function blankExit(): ExitDraft {
  return {
    id: generateId(),
    closedPercent: '',
    scope: '',
    value: '',
    exitedAt: '',
    reason: '',
  };
}

function percentToBps(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(trimmed)) return undefined;
  const bps = Math.round(Number(trimmed) * 100);
  return bps > 0 && bps <= 10_000 ? bps : undefined;
}

function signedMoney(minor: string | null, currency: string): string | null {
  const formatted = formatTradeMoney(minor, currency);
  if (formatted === null || minor === null) return null;
  return BigInt(minor) > 0n ? `+${formatted}` : formatted;
}

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 64 ? trimmed : `${trimmed.slice(0, 63)}…`;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

const RECENT_SYMBOL_LIMIT = 3;
const PLAN_FIELDS = [
  'plannedEntry',
  'plannedStop',
  'plannedTarget',
  'plannedPositionSize',
  'plannedRisk',
  'plannedReward',
] as const;
const ACTUAL_FIELDS = [
  'actualEntry',
  'actualStop',
  'actualPositionSize',
  'actualRisk',
  'finalPnl',
] as const;

/**
 * AFTER TRADE — a finished trade, written up from memory, in the same task-surface
 * language as At Entry.
 *
 * ONE SURFACE, FOUR BANDS: the account as context, the trade (Symbol, Direction,
 * and two independently optional timestamps that start blank), a compact plan at
 * entry, and the Actual Result — the one band this lifecycle exists for. Strategy,
 * Setup, the checklist, timeframe, session, the chart and notes live in the Trade
 * idea, exactly as At Entry places them, so they describe the trade instead of
 * competing with its result.
 *
 * THE ACTUAL RESULT KEEPS EVERY ACCEPTED RULE. The final whole-trade net P&L is the
 * authority and may stay unknown; Actual R is unavailable without a recorded risk;
 * the outcome is derived, never chosen; exit reconstruction is optional supporting
 * evidence with explicit completeness, reconciliation that picks neither figure, and
 * adoption only after save. None of that moved — only its presentation did.
 *
 * THE ONE CAPTURE ALIGNMENT is Feelings: emotions are recorded only when chosen, or
 * when "None of these" is chosen, so opening Feelings to set a confidence no longer
 * records "no emotions" — the same contract At Entry uses.
 */
export function TradeAfterTradeForm({
  options,
  activeTradingAccountId = null,
  timezone,
}: {
  options: TradeCreateOptions;
  activeTradingAccountId?: string | null;
  timezone: string;
}) {
  const t = useTranslations('trades');
  const r = useTranslations('trades.create.recording');
  const a = useTranslations('trades.create.recording.after');
  const tConfidence = useTranslations('trades.create.confidence');
  const tMode = useTranslations('trades.create.mode');
  const locale = useLocale();
  const router = useRouter();
  const symbolFavorites = useTradePlanFavorites('symbol', options.workspaceId);
  const [mutationKey] = useState(generateId);
  const initialAccount =
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((item) => item.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '');
  const pristine = useMemo(() => emptyAfterTradeValues(initialAccount), [initialAccount]);
  const [values, setValues] = useState(pristine);
  const [accountPickerOpen, setAccountPickerOpen] = useState(initialAccount === '');
  const [planBasis, setPlanBasis] = useState<Basis>('money');
  const [actualBasis, setActualBasis] = useState<Basis>('money');
  const [exits, setExits] = useState<ExitDraft[]>([]);
  const [exitsOpen, setExitsOpen] = useState(false);
  const [editingExitId, setEditingExitId] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<Completeness>('unknown');
  const [conditionMet, setConditionMet] = useState<Record<string, boolean>>({});
  /* `null` = never answered; `[]` = explicitly none of these. */
  const [emotions, setEmotions] = useState<readonly string[] | null>(null);
  const [journalArea, setJournalArea] = useState<JournalArea | null>(null);
  const [journalDraft, setJournalDraft] = useState<JournalDraft>({
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
    strategyId: '',
    setupId: '',
    timeframe: '',
    session: '',
    conditionMet: {},
    confidence: '',
    emotions: null,
  });
  const ideaTrigger = useRef<HTMLButtonElement>(null);
  const feelingsTrigger = useRef<HTMLButtonElement>(null);
  const [errors, setErrors] = useState<ErrorMap>({});
  /* Only a server refusal is held; the "check the highlighted fields" banner is derived. */
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmUnmetOpen, setConfirmUnmetOpen] = useState(false);

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const selectedStrategy = options.strategies.find((item) => item.strategyId === values.strategyId);
  const selectedSetup = selectedStrategy?.setups.find((item) => item.setupId === values.setupId);
  const draftStrategy = options.strategies.find(
    (item) => item.strategyId === journalDraft.strategyId,
  );
  const draftSetup = draftStrategy?.setups.find((item) => item.setupId === journalDraft.setupId);
  const recordedExits = exits.filter(meaningfulAfterTradeExit);
  const recentSymbols = symbolFavorites.recents.slice(0, RECENT_SYMBOL_LIMIT);
  const emotionLabel = new Map(options.emotionCatalog.map((item) => [item.key, item.label]));

  function clearErrors(fields: readonly string[]) {
    setErrors((current) => {
      if (!fields.some((field) => field in current)) return current;
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  const setField = <K extends keyof Values>(field: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    clearErrors([field]);
  };

  /*
    SWITCHING BASIS CLEARS THE FIELDS THE PREVIOUS BASIS OWNED (Phase 15 §62), so
    no hidden value from the other representation survives to be saved — or, for
    an exit, to be saved under the other basis's meaning: the leg's one value is
    a realized P&L in Money and an exit price in Price, and a P&L of 150 must not
    quietly become an exit at 150. Basis-neutral leg facts (allocation, scope,
    time, reason) stay.
  */
  function changePlanBasis(next: Basis) {
    setPlanBasis(next);
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(PLAN_FIELDS.map((field) => [field, ''])),
    }));
    clearErrors(PLAN_FIELDS);
  }

  function changeActualBasis(next: Basis) {
    setActualBasis(next);
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(ACTUAL_FIELDS.map((field) => [field, ''])),
    }));
    setExits((current) => current.map((exit) => ({ ...exit, value: '' })));
    setErrors({});
  }

  const parsedRisk =
    values.actualRisk.trim() === ''
      ? null
      : parseTradeMoneyInput(values.actualRisk, currency, { allowZero: false });
  const parsedFinal =
    values.finalPnl.trim() === ''
      ? null
      : parseTradeMoneyInput(values.finalPnl, currency, {
          allowNegative: true,
          allowZero: true,
        });
  const monetarySnapshot = deriveHistoricalExecutionSnapshot({
    actualInitialRiskMinor: parsedRisk?.ok ? BigInt(parsedRisk.value) : null,
    finalPnlMinor: parsedFinal?.ok ? BigInt(parsedFinal.value) : null,
    finalPnlSource: parsedFinal?.ok ? 'manual_total' : null,
    exitHistoryCompleteness: recordedExits.length === 0 ? null : completeness,
    exits: recordedExits.map((exit) => {
      const parsed =
        exit.value.trim() === ''
          ? null
          : parseTradeMoneyInput(exit.value, currency, {
              allowNegative: true,
              allowZero: true,
            });
      return { realizedPnlMinor: parsed?.ok ? BigInt(parsed.value) : null };
    }),
  });

  const priceActual = (() => {
    if (actualBasis !== 'price' || values.direction === '') return null;
    const priceExits = recordedExits.map((exit) => ({
      closedBps: percentToBps(exit.closedPercent) ?? 0,
      exitPrice: exit.value.trim(),
      realizedPnlMinor: null,
    }));
    /*
      THE PREVIEW ASKS WHAT THE SERVICE ASKS. `composeActualSnapshot` derives no
      Price result while any exit lacks its allocation, price or time, so a
      preview that ignored the time promised an outcome the saved trade would
      not carry.
    */
    if (
      values.actualEntry.trim() === '' ||
      values.actualStop.trim() === '' ||
      priceExits.length === 0 ||
      recordedExits.some((exit) => exit.exitedAt === '') ||
      priceExits.some((exit) => exit.closedBps === 0 || exit.exitPrice === '') ||
      priceExits.reduce((sum, exit) => sum + exit.closedBps, 0) !== 10_000
    )
      return null;
    const result = composeTraderCloseV2({
      actualResultMode: 'price',
      direction: values.direction,
      actualEntry: values.actualEntry,
      actualInitialStop: values.actualStop,
      exits: priceExits,
    });
    return result.ok ? result.value : null;
  })();

  const plannedRisk =
    values.plannedRisk.trim() === ''
      ? null
      : parseTradeMoneyInput(values.plannedRisk, currency, { allowZero: false });
  const plannedReward =
    values.plannedReward.trim() === ''
      ? null
      : parseTradeMoneyInput(values.plannedReward, currency, { allowZero: true });
  const planHasData =
    planBasis === 'money'
      ? values.plannedRisk.trim() !== '' || values.plannedReward.trim() !== ''
      : [
          values.plannedEntry,
          values.plannedStop,
          values.plannedTarget,
          values.plannedPositionSize,
        ].some((value) => value.trim() !== '');
  const plannedPreview =
    values.direction === '' || !planHasData
      ? null
      : composePlannedR({
          direction: values.direction,
          plannedEntry: planBasis === 'price' ? values.plannedEntry.trim() || null : null,
          plannedStop: planBasis === 'price' ? values.plannedStop.trim() || null : null,
          plannedTarget: planBasis === 'price' ? values.plannedTarget.trim() || null : null,
          plannedRiskMinor:
            planBasis === 'money' && plannedRisk?.ok ? BigInt(plannedRisk.value) : null,
          plannedRewardMinor:
            planBasis === 'money' && plannedReward?.ok ? BigInt(plannedReward.value) : null,
        });
  const targetR =
    plannedPreview?.ok && plannedPreview.value.plannedR !== null
      ? plannedPreview.value.plannedR
      : null;

  const actualR =
    actualBasis === 'money' ? monetarySnapshot.actualR : (priceActual?.actualR ?? null);
  const outcome =
    actualBasis === 'money' ? monetarySnapshot.traderOutcome : (priceActual?.traderOutcome ?? null);
  /*
    A LEG'S TIME MAY STAND FOR THE TRADE'S ONLY IF THAT LEG CLOSED IT. An `All
    remaining` exit is the one leg that says nothing was left afterwards, so the
    latest such leg's time is OFFERED for Final exit time — never written — and a
    disagreement between the two is stated without choosing either or refusing
    the save. A partial leg's time is a mid-trade timestamp and is never offered.
  */
  let closingExit: { local: string; iso: string } | null = null;
  for (const exit of recordedExits) {
    if (exit.scope !== 'all_remaining' || exit.exitedAt === '') continue;
    const iso = datetimeLocalToIso(exit.exitedAt, timezone);
    if (iso.ok && (closingExit === null || iso.value > closingExit.iso))
      closingExit = { local: exit.exitedAt, iso: iso.value };
  }
  const finalExit = values.exitedAt === '' ? null : datetimeLocalToIso(values.exitedAt, timezone);
  const closingExitLabel =
    closingExit === null
      ? null
      : (formatTradeInstant(closingExit.iso, timezone, locale) ?? closingExit.local);
  const finalMatchesClosingExit =
    closingExit !== null && finalExit?.ok === true && finalExit.value === closingExit.iso;
  const exitTimesDiffer =
    closingExit !== null && finalExit?.ok === true && !finalMatchesClosingExit;

  const isDirty =
    recordedExits.length > 0 ||
    emotions !== null ||
    (Object.keys(pristine) as (keyof Values)[]).some((key) => values[key] !== pristine[key]);

  const confidenceStep = confidenceOf(values.confidence);
  const ideaPreview = [
    values.confirmationNotes.trim() === '' ? null : excerpt(values.confirmationNotes),
    selectedStrategy === undefined
      ? null
      : [selectedStrategy.name, selectedSetup?.name].filter(Boolean).join(' · '),
  ].filter(isPresent);
  if (
    ideaPreview.length === 0 &&
    [values.tradingviewUrl, values.notes, values.timeframe, values.session].some(
      (value) => value.trim() !== '',
    )
  ) {
    ideaPreview.push(a('journal.idea.detailsAdded'));
  }
  const feelingsParts = [
    confidenceStep === undefined
      ? null
      : a('journal.feelings.confidencePreview', {
          level: t(`create.confidence.level.${confidenceLevelKey(confidenceStep)}`),
        }),
    emotions === null
      ? null
      : emotions.length === 0
        ? a('journal.feelings.noneOfThese')
        : emotions.map((key) => emotionLabel.get(key) ?? key).join(', '),
  ].filter(isPresent);
  const feelingsPreview = feelingsParts.length === 0 ? [] : [feelingsParts.join(' · ')];

  function openJournal(area: JournalArea) {
    setJournalDraft({
      confirmationNotes: values.confirmationNotes,
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
      strategyId: values.strategyId,
      setupId: values.setupId,
      timeframe: values.timeframe,
      session: values.session,
      conditionMet: { ...conditionMet },
      confidence: values.confidence,
      emotions,
    });
    setJournalArea(area);
  }

  function commitJournal() {
    if (journalArea === 'idea') {
      setValues((current) => ({
        ...current,
        confirmationNotes: journalDraft.confirmationNotes,
        tradingviewUrl: journalDraft.tradingviewUrl,
        notes: journalDraft.notes,
        strategyId: journalDraft.strategyId,
        setupId: journalDraft.setupId,
        timeframe: journalDraft.timeframe,
        session: journalDraft.session,
      }));
      setConditionMet(journalDraft.conditionMet);
    } else if (journalArea === 'feelings') {
      setValues((current) => ({ ...current, confidence: journalDraft.confidence }));
      setEmotions(journalDraft.emotions);
    }
    setJournalArea(null);
  }

  function collectErrors(): ErrorMap {
    const next: ErrorMap = {};
    if (values.tradingAccountId === '') next.tradingAccountId = t('validation.requiredAccount');
    if (values.symbol.trim() === '') next.symbol = t('validation.requiredSymbol');
    if (values.direction === '') next.direction = t('validation.requiredDirection');

    const entered = values.enteredAt === '' ? null : datetimeLocalToIso(values.enteredAt, timezone);
    const exited = values.exitedAt === '' ? null : datetimeLocalToIso(values.exitedAt, timezone);
    if (entered !== null && !entered.ok) next.enteredAt = t('lifecycle.validation.time');
    if (exited !== null && !exited.ok) next.exitedAt = t('lifecycle.validation.time');
    if (entered?.ok && exited?.ok && exited.value < entered.value)
      next.exitedAt = r('validation.exitBeforeEntry');

    if (planBasis === 'money') {
      if (plannedRisk !== null && !plannedRisk.ok)
        next.plannedRisk = t('lifecycle.validation.money');
      if (plannedReward !== null && !plannedReward.ok)
        next.plannedReward = t('lifecycle.validation.money');
      if (values.plannedReward.trim() !== '' && values.plannedRisk.trim() === '')
        next.plannedRisk = t('validation.incompleteMoneyPlan');
    } else if (planHasData) {
      if (values.plannedEntry.trim() === '') next.plannedEntry = t('validation.requiredEntry');
      if (values.plannedStop.trim() === '') next.plannedStop = t('validation.requiredStop');
      if (plannedPreview !== null && !plannedPreview.ok)
        next.plannedEntry = t('errors.invalid_plan');
    }

    if (actualBasis === 'money') {
      if (parsedRisk !== null && !parsedRisk.ok) next.actualRisk = t('lifecycle.validation.money');
      if (parsedFinal !== null && !parsedFinal.ok) next.finalPnl = t('lifecycle.validation.money');
    } else {
      const hasActualContext = values.actualEntry.trim() !== '' || values.actualStop.trim() !== '';
      if (hasActualContext && values.actualEntry.trim() === '')
        next.actualEntry = r('validation.actualEntry');
      if (hasActualContext && values.actualStop.trim() === '')
        next.actualStop = r('validation.actualStop');
    }

    let totalBps = 0;
    for (const exit of recordedExits) {
      const bps = percentToBps(exit.closedPercent);
      if (bps === undefined) next[`exit-${exit.id}-percent`] = a('validation.allocation');
      else totalBps += bps ?? 0;
      if (exit.value.trim() !== '') {
        if (actualBasis === 'money') {
          const amount = parseTradeMoneyInput(exit.value, currency, {
            allowNegative: true,
            allowZero: true,
          });
          if (!amount.ok) next[`exit-${exit.id}-value`] = t('lifecycle.validation.money');
        }
      }
      if (exit.exitedAt !== '' && !datetimeLocalToIso(exit.exitedAt, timezone).ok)
        next[`exit-${exit.id}-time`] = t('lifecycle.validation.time');
    }
    if (totalBps > 10_000) next.exits = a('validation.coverage');
    if (actualBasis === 'money' && monetarySnapshot.reconciliation === 'conflict')
      next.exits = t('errors.historical_exit_conflict');
    return next;
  }

  async function submit(unmetConfirmed = false) {
    const next = collectErrors();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      if (next.tradingAccountId !== undefined) setAccountPickerOpen(true);
      if (Object.keys(next).some((key) => key.startsWith('exit'))) setExitsOpen(true);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            '[data-after-trade-linear-form] :is([aria-invalid="true"], [data-invalid="true"])',
          )
          ?.focus(),
      );
      return;
    }

    const conditionAnswers = (selectedSetup?.conditions ?? []).map((condition) => ({
      conditionKey: condition.conditionKey,
      status: conditionMet[condition.conditionKey] ? ('met' as const) : ('not_met' as const),
    }));
    if (!unmetConfirmed && conditionAnswers.some((answer) => answer.status === 'not_met')) {
      setConfirmUnmetOpen(true);
      return;
    }

    const entered = values.enteredAt === '' ? null : datetimeLocalToIso(values.enteredAt, timezone);
    const exited = values.exitedAt === '' ? null : datetimeLocalToIso(values.exitedAt, timezone);
    const completedExits = recordedExits.map((exit) => {
      const exitTime = exit.exitedAt === '' ? null : datetimeLocalToIso(exit.exitedAt, timezone);
      const parsedValue =
        exit.value.trim() === ''
          ? null
          : actualBasis === 'money'
            ? parseTradeMoneyInput(exit.value, currency, {
                allowNegative: true,
                allowZero: true,
              })
            : null;
      return {
        closedBps: percentToBps(exit.closedPercent),
        exitScope: exit.scope === '' ? null : exit.scope,
        exitPrice: actualBasis === 'price' ? exit.value.trim() || null : null,
        realizedPnlMinor: actualBasis === 'money' && parsedValue?.ok ? parsedValue.value : null,
        ...(exit.reason.trim() === '' ? {} : { exitReason: exit.reason.trim() }),
        exitedAt: exitTime?.ok ? exitTime.value : null,
      };
    });
    const symbol = values.symbol.trim().toUpperCase();

    setPending(true);
    setServerError(null);
    const result = await createCompletedTradeAction({
      mutationKey,
      tradingAccountId: values.tradingAccountId,
      recordingTiming: 'after_trade',
      systemPlanBasis: planHasData ? planBasis : null,
      ...(values.strategyId === '' ? {} : { strategyId: values.strategyId }),
      ...(values.setupId === '' ? {} : { setupId: values.setupId }),
      ...(selectedSetup === undefined
        ? {}
        : { conditionSetToken: selectedSetup.conditionSetToken, conditionAnswers }),
      symbol,
      direction: values.direction,
      plannedEntry: planHasData && planBasis === 'price' ? values.plannedEntry.trim() : null,
      plannedStop: planHasData && planBasis === 'price' ? values.plannedStop.trim() : null,
      plannedTarget:
        planHasData && planBasis === 'price' ? values.plannedTarget.trim() || null : null,
      plannedPositionSize:
        planHasData && planBasis === 'price' ? values.plannedPositionSize.trim() || null : null,
      plannedRiskMinor:
        planHasData && planBasis === 'money' && plannedRisk?.ok ? plannedRisk.value : null,
      plannedRewardMinor:
        planHasData && planBasis === 'money' && plannedReward?.ok ? plannedReward.value : null,
      ...(values.timeframe.trim() === '' ? {} : { timeframe: values.timeframe.trim() }),
      ...(values.session.trim() === '' ? {} : { session: values.session.trim() }),
      ...(values.confirmationNotes.trim() === ''
        ? {}
        : { confirmationNotes: values.confirmationNotes.trim() }),
      ...(confidenceStep === undefined ? {} : { confidence: confidenceStep }),
      ...(emotions === null ? {} : { emotionKeys: [...emotions] }),
      ...(values.tradingviewUrl.trim() === ''
        ? {}
        : { tradingviewUrl: values.tradingviewUrl.trim() }),
      ...(values.notes.trim() === '' ? {} : { notes: values.notes.trim() }),
      chartAttachmentStorageKey: null,
      actualResultBasis: actualBasis,
      actualEntry: actualBasis === 'price' ? values.actualEntry.trim() || null : null,
      actualInitialStop: actualBasis === 'price' ? values.actualStop.trim() || null : null,
      actualInitialRiskMinor: actualBasis === 'money' && parsedRisk?.ok ? parsedRisk.value : null,
      actualPositionSize: actualBasis === 'price' ? values.actualPositionSize.trim() || null : null,
      finalPnlMinor: actualBasis === 'money' && parsedFinal?.ok ? parsedFinal.value : null,
      enteredAt: entered?.ok ? entered.value : null,
      exitedAt: exited?.ok ? exited.value : null,
      ...(completedExits.length === 0 ? {} : { exitHistoryCompleteness: completeness }),
      exits: completedExits,
    });
    setPending(false);
    if (!result.ok) {
      setServerError(t(`errors.${result.error.code}`));
      return;
    }
    symbolFavorites.recordUse(symbol);
    router.push(`/app/trades?trade=${result.data.tradeId}&tab=review`);
  }

  const formError =
    serverError ?? (Object.keys(errors).length > 0 ? r('validation.fixFields') : null);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <p
        data-recording-mode="after_trade"
        className="text-muted-foreground mx-auto max-w-prose text-center text-sm text-pretty"
      >
        {tMode('after_trade.description')} <TradeRecordingModeChange isDirty={isDirty} />
      </p>

      <div
        role="status"
        aria-live="polite"
        className={
          formError === null
            ? 'sr-only'
            : 'border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm'
        }
      >
        {formError ?? r('ready')}
      </div>

      <form
        data-after-trade-linear-form=""
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="flex min-w-0 flex-col gap-3 md:gap-4"
      >
        <TaskSurface>
          <Band className="gap-3 py-3.5 sm:py-3.5">
            {accountPickerOpen || selectedAccount === undefined ? (
              <SelectField
                id="after-account"
                label={t('field.account')}
                error={errors.tradingAccountId}
              >
                <NativeSelect
                  id="after-account"
                  value={values.tradingAccountId}
                  aria-invalid={errors.tradingAccountId !== undefined}
                  aria-describedby={
                    errors.tradingAccountId === undefined ? undefined : 'after-account-error'
                  }
                  onChange={(event) => setField('tradingAccountId', event.target.value)}
                >
                  <option value="">{t('create.chooseAccount')}</option>
                  {options.tradingAccounts.map((account) => (
                    <option key={account.tradingAccountId} value={account.tradingAccountId}>
                      {account.name} · {account.baseCurrency}
                    </option>
                  ))}
                </NativeSelect>
              </SelectField>
            ) : (
              <ContextLine
                primary={selectedAccount.name}
                secondary={selectedAccount.baseCurrency}
                {...(options.tradingAccounts.length > 1
                  ? {
                      action: (
                        <QuietAction onClick={() => setAccountPickerOpen(true)}>
                          {a('trade.change')}{' '}
                          <span className="sr-only">{a('trade.changeAccountSr')}</span>
                        </QuietAction>
                      ),
                    }
                  : {})}
              />
            )}
          </Band>

          {/* THE TRADE — what was traded, which way, and when it ran, if remembered. */}
          <Band>
            <SectionLabel>{a('trade.title')}</SectionLabel>
            <FieldPair>
              <div className="flex min-w-0 flex-col gap-1.5">
                <TextInputField
                  id="after-symbol"
                  label={t('field.symbol')}
                  value={values.symbol}
                  onChange={(value) => setField('symbol', value.toUpperCase())}
                  error={errors.symbol}
                  placeholder="e.g. XAUUSD"
                />
                {recentSymbols.length === 0 ? null : (
                  <div
                    role="group"
                    aria-label={a('trade.recentSymbols')}
                    className="flex min-w-0 flex-wrap gap-1.5"
                  >
                    {recentSymbols.map((recent) => (
                      <button
                        key={recent}
                        type="button"
                        aria-pressed={values.symbol === recent}
                        onClick={() => setField('symbol', recent)}
                        className="border-border text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring aria-pressed:border-primary aria-pressed:text-foreground relative rounded-full border px-2.5 py-1 text-xs outline-none after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[''] focus-visible:ring-2"
                      >
                        {recent}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <SegmentedChoice
                legend={t('field.direction')}
                value={values.direction}
                onChange={(value) => setField('direction', value)}
                error={errors.direction}
                errorId="after-direction-error"
                options={[
                  { value: 'long', label: t('direction.long') },
                  { value: 'short', label: t('direction.short') },
                ]}
              />
            </FieldPair>

            {/*
              BOTH TIMESTAMPS BEGIN BLANK AND STAY INDEPENDENT. A historical trade
              silently dated now is a wrong record that looks like a right one.
            */}
            <div className="flex min-w-0 flex-col gap-2">
              <p id="after-timezone" className="text-subtle-foreground text-xs">
                {a('trade.timezone', { timezone })}
              </p>
              <FieldPair>
                <TextInputField
                  id="after-entered-at"
                  type="datetime-local"
                  label={a('trade.entryTime')}
                  optionalLabel={a('trade.optional')}
                  value={values.enteredAt}
                  onChange={(value) => setField('enteredAt', value)}
                  error={errors.enteredAt}
                  extraDescribedBy="after-timezone"
                  numeric
                />
                <TextInputField
                  id="after-exited-at"
                  type="datetime-local"
                  label={a('trade.finalExitTime')}
                  optionalLabel={a('trade.optional')}
                  value={values.exitedAt}
                  onChange={(value) => setField('exitedAt', value)}
                  error={errors.exitedAt}
                  extraDescribedBy="after-timezone"
                  numeric
                />
              </FieldPair>
              {closingExit === null ||
              closingExitLabel === null ||
              finalMatchesClosingExit ? null : (
                <QuietAction
                  className="text-muted-foreground hover:text-foreground self-start font-normal"
                  onClick={() => setField('exitedAt', closingExit.local)}
                >
                  {a('trade.useClosingExitTime', { time: closingExitLabel })}
                </QuietAction>
              )}
              {exitTimesDiffer && closingExitLabel !== null ? (
                <InlineNote tone="warning" data-exit-time-mismatch="">
                  {a('trade.exitTimesDiffer', { time: closingExitLabel })}
                </InlineNote>
              ) : null}
            </div>
          </Band>

          {/* PLAN AT ENTRY — reconstructed, compact, and never inferred from the result. */}
          <Band>
            <div className="flex min-w-0 flex-col gap-1">
              <SectionLabel>{a('plan.title')}</SectionLabel>
              <InlineNote>{a('plan.description')}</InlineNote>
            </div>

            {planBasis === 'money' ? (
              <FieldPair>
                <PrimaryAmountField
                  size="compact"
                  id="after-planned-risk"
                  label={a('plan.plannedRisk')}
                  currency={currency}
                  value={values.plannedRisk}
                  onChange={(value) => setField('plannedRisk', value)}
                  error={errors.plannedRisk}
                  optionalLabel={a('trade.optional')}
                />
                <PrimaryAmountField
                  size="compact"
                  id="after-planned-reward"
                  label={a('plan.targetProfit')}
                  currency={currency}
                  value={values.plannedReward}
                  onChange={(value) => setField('plannedReward', value)}
                  error={errors.plannedReward}
                  optionalLabel={a('trade.optional')}
                />
              </FieldPair>
            ) : (
              <div className="flex min-w-0 flex-col gap-4">
                <InlineNote>{a('plan.priceHint')}</InlineNote>
                <FieldPair>
                  <TextInputField
                    id="after-plan-entry"
                    label={r('plannedEntry')}
                    optionalLabel={a('trade.optional')}
                    value={values.plannedEntry}
                    onChange={(value) => setField('plannedEntry', value)}
                    error={errors.plannedEntry}
                    inputMode="decimal"
                    numeric
                  />
                  <TextInputField
                    id="after-plan-stop"
                    label={r('plannedStop')}
                    optionalLabel={a('trade.optional')}
                    value={values.plannedStop}
                    onChange={(value) => setField('plannedStop', value)}
                    error={errors.plannedStop}
                    inputMode="decimal"
                    numeric
                  />
                </FieldPair>
                <FieldPair>
                  <TextInputField
                    id="after-plan-target"
                    label={r('takeProfit')}
                    optionalLabel={a('trade.optional')}
                    value={values.plannedTarget}
                    onChange={(value) => setField('plannedTarget', value)}
                    inputMode="decimal"
                    numeric
                  />
                  <TextInputField
                    id="after-plan-size"
                    label={t('field.positionSizeSimple')}
                    optionalLabel={a('trade.optional')}
                    value={values.plannedPositionSize}
                    onChange={(value) => setField('plannedPositionSize', value)}
                    inputMode="decimal"
                    numeric
                  />
                </FieldPair>
              </div>
            )}

            {targetR === null ? null : (
              <div data-target-r="" className="border-border/70 min-w-0 border-t pt-3">
                <ResultLine label={a('plan.targetR')} value={formatR(targetR) ?? targetR} />
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
              <QuietAction
                className="text-muted-foreground hover:text-foreground font-normal"
                onClick={() => changePlanBasis(planBasis === 'money' ? 'price' : 'money')}
              >
                {planBasis === 'money' ? a('plan.usePrice') : a('plan.useMoney')}
              </QuietAction>
            </div>
          </Band>

          {/*
            ACTUAL RESULT — the band this lifecycle exists for, and the strongest on
            the page: the one large figure, the derived outcome and Actual R at the
            product's metric size, and reconstruction as a disclosure beneath them.
          */}
          <div data-actual-result="" className="border-primary/40 min-w-0 border-t-2">
            <Band divided={false} className="gap-4 py-5 sm:py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <SectionLabel className="text-primary">{a('actual.title')}</SectionLabel>
                <InlineNote>{a('actual.description')}</InlineNote>
              </div>

              {actualBasis === 'money' ? (
                <div className="flex min-w-0 flex-col gap-4">
                  <PrimaryAmountField
                    id="after-final-pnl"
                    label={a('actual.finalPnl')}
                    currency={currency}
                    value={values.finalPnl}
                    onChange={(value) => setField('finalPnl', value)}
                    error={errors.finalPnl}
                    hint={a('actual.finalPnlHint', { currency })}
                    optionalLabel={a('trade.optional')}
                  />
                  <FieldPair>
                    <PrimaryAmountField
                      size="compact"
                      id="after-actual-risk"
                      label={a('actual.risk')}
                      currency={currency}
                      value={values.actualRisk}
                      onChange={(value) => setField('actualRisk', value)}
                      error={errors.actualRisk}
                      hint={a('actual.riskHint', { currency })}
                      optionalLabel={a('trade.optional')}
                    />
                  </FieldPair>
                </div>
              ) : (
                <FieldPair>
                  <TextInputField
                    id="after-actual-entry"
                    label={r('actualEntry')}
                    optionalLabel={a('trade.optional')}
                    value={values.actualEntry}
                    onChange={(value) => setField('actualEntry', value)}
                    error={errors.actualEntry}
                    inputMode="decimal"
                    numeric
                  />
                  <TextInputField
                    id="after-actual-stop"
                    label={r('actualInitialStop')}
                    optionalLabel={a('trade.optional')}
                    value={values.actualStop}
                    onChange={(value) => setField('actualStop', value)}
                    error={errors.actualStop}
                    inputMode="decimal"
                    numeric
                  />
                  <TextInputField
                    id="after-actual-size"
                    label={t('field.actualPositionSize')}
                    optionalLabel={a('trade.optional')}
                    value={values.actualPositionSize}
                    onChange={(value) => setField('actualPositionSize', value)}
                    inputMode="decimal"
                    numeric
                  />
                </FieldPair>
              )}

              <div
                data-result-summary=""
                className="border-border/70 flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t pt-4"
              >
                <div className="min-w-0">
                  <p className="text-muted-foreground text-xs font-medium">{a('actual.outcome')}</p>
                  <p
                    className={cn(
                      'mt-0.5 font-semibold',
                      outcome === null ? 'text-subtle-foreground text-base' : 'text-metric',
                    )}
                  >
                    {outcome === null
                      ? a('actual.unknown')
                      : r(`outcome.${outcome === 'break_even' ? 'breakEven' : outcome}`)}
                  </p>
                </div>
                <div className="min-w-0 sm:text-right">
                  <p className="text-muted-foreground text-xs font-medium">{r('actualR')}</p>
                  <p
                    className={cn(
                      'numeric mt-0.5 font-semibold',
                      actualR === null ? 'text-subtle-foreground text-base' : 'text-metric',
                    )}
                  >
                    {actualR === null ? a('actual.unavailable') : formatR(actualR)}
                  </p>
                  {actualBasis === 'money' && parsedFinal?.ok && !parsedRisk?.ok ? (
                    <InlineNote className="mt-1">{a('actual.rNeedsRisk')}</InlineNote>
                  ) : null}
                </div>
              </div>

              <QuietAction
                className="text-muted-foreground hover:text-foreground self-start font-normal"
                onClick={() => changeActualBasis(actualBasis === 'money' ? 'price' : 'money')}
              >
                {actualBasis === 'money' ? a('actual.usePrice') : a('actual.useMoney')}
              </QuietAction>

              {/* EXIT RECONSTRUCTION — optional supporting evidence, never the result. */}
              <div className="border-border/70 flex min-w-0 flex-col gap-3 border-t pt-4">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-foreground text-sm font-medium">{a('exits.title')}</h3>
                  <QuietAction
                    expanded={exitsOpen}
                    controls="after-exit-reconstruction"
                    onClick={() => {
                      setExitsOpen((current) => !current);
                      if (exitsOpen) setEditingExitId(null);
                    }}
                  >
                    {exitsOpen ? a('exits.hide') : a('exits.addDetails')}
                  </QuietAction>
                </div>
                {exitsOpen ? null : <InlineNote>{a('exits.collapsedHint')}</InlineNote>}

                {exitsOpen ? (
                  <div
                    id="after-exit-reconstruction"
                    className="border-border min-w-0 overflow-hidden rounded-lg border"
                  >
                    {exits.length === 0 ? (
                      <p className="text-muted-foreground px-3 py-3 text-sm">{a('exits.empty')}</p>
                    ) : (
                      <ol className="divide-border min-w-0 divide-y">
                        {exits.map((exit, index) => (
                          <li key={exit.id} className="min-w-0">
                            {editingExitId === exit.id ? (
                              <ExitEditor
                                exit={exit}
                                index={index}
                                actualBasis={actualBasis}
                                currency={currency}
                                timezone={timezone}
                                errors={errors}
                                optionalLabel={a('trade.optional')}
                                onChange={(patch) =>
                                  setExits((current) =>
                                    current.map((item) =>
                                      item.id === exit.id ? { ...item, ...patch } : item,
                                    ),
                                  )
                                }
                                onRemove={() => {
                                  setExits((current) =>
                                    current.filter((item) => item.id !== exit.id),
                                  );
                                  setEditingExitId(null);
                                }}
                                onDone={() => setEditingExitId(null)}
                              />
                            ) : (
                              <button
                                type="button"
                                className="hover:bg-accent/40 focus-visible:ring-ring flex min-h-12 w-full min-w-0 items-center justify-between gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:-outline-offset-2"
                                onClick={() => setEditingExitId(exit.id)}
                              >
                                <span className="min-w-0">
                                  <span className="text-foreground block text-sm">
                                    {a('exits.exitNumber', { number: index + 1 })}
                                  </span>
                                  <span className="text-muted-foreground numeric block truncate text-xs">
                                    {exit.value.trim() === '' ? a('exits.sparse') : exit.value}
                                  </span>
                                </span>
                                <span className="text-primary shrink-0 text-xs font-medium">
                                  {a('exits.edit')}
                                </span>
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    <div className="border-border border-t px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto min-h-11 min-w-0 py-2 text-left whitespace-normal"
                        onClick={() => {
                          const exit = blankExit();
                          setExits((current) => [...current, exit]);
                          setEditingExitId(exit.id);
                        }}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        {a('exits.add')}
                      </Button>
                    </div>

                    {recordedExits.length === 0 ? null : (
                      <div className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 border-t px-3 py-3">
                        <fieldset className="flex min-w-0 flex-col gap-1">
                          <legend className="text-muted-foreground mb-1 text-xs font-medium">
                            {a('exits.completeness')}
                          </legend>
                          {(['unknown', 'incomplete', 'complete'] as const).map((value) => (
                            <label
                              key={value}
                              className="hover:bg-accent/40 flex min-h-11 min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 text-sm"
                            >
                              <input
                                type="radio"
                                name="after-exit-completeness"
                                value={value}
                                checked={completeness === value}
                                onChange={() => setCompleteness(value)}
                                className="size-4 shrink-0"
                              />
                              <span className="min-w-0">
                                {a(`exits.completenessOptions.${value}`)}
                              </span>
                            </label>
                          ))}
                        </fieldset>

                        <ReconciliationSummary
                          currency={currency}
                          finalMinor={parsedFinal?.ok ? parsedFinal.value : null}
                          subtotalMinor={monetarySnapshot.exitSubtotalMinor?.toString() ?? null}
                          reconciliation={
                            actualBasis === 'money'
                              ? monetarySnapshot.reconciliation
                              : 'not_applicable'
                          }
                          canAdoptAfterSave={
                            actualBasis === 'money' && monetarySnapshot.canAdoptExitSubtotal
                          }
                          error={errors.exits}
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </Band>
          </div>
        </TaskSurface>

        <JournalLauncherSurface
          headingId="after-journal-heading"
          heading={a('journal.title')}
          aside={a('journal.aside')}
          areas={[
            {
              id: 'idea',
              label: a('journal.idea.label'),
              Icon: Lightbulb,
              invitation: a('journal.idea.prompt'),
              preview: ideaPreview,
              onOpen: () => openJournal('idea'),
              triggerRef: ideaTrigger,
            },
            {
              id: 'feelings',
              label: a('journal.feelings.label'),
              Icon: HeartPulse,
              invitation: a('journal.feelings.prompt'),
              preview: feelingsPreview,
              onOpen: () => openJournal('feelings'),
              triggerRef: feelingsTrigger,
            },
          ]}
        />

        <FormFooter
          action={a('save.action')}
          pendingLabel={r('saving')}
          pending={pending}
          helper={a('save.helper')}
          suppressed={editingExitId !== null}
        />
      </form>

      <TradeAdaptiveOverlay
        open={journalArea === 'idea'}
        onOpenChange={(open) => {
          if (!open) setJournalArea(null);
        }}
        title={a('journal.idea.label')}
        description={a('journal.idea.description')}
        closeLabel={t('lifecycle.common.close')}
        returnFocusRef={ideaTrigger}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {a('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="after-idea" className="text-muted-foreground text-xs font-medium">
              {a('journal.idea.prompt')}
            </label>
            <Textarea
              id="after-idea"
              rows={4}
              placeholder={a('journal.idea.placeholder')}
              value={journalDraft.confirmationNotes}
              onChange={(event) =>
                setJournalDraft((current) => ({
                  ...current,
                  confirmationNotes: event.target.value,
                }))
              }
              className="min-h-28 text-base"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-foreground text-sm font-medium">
              {a('journal.idea.strategyQuestion')}
            </p>
            <SelectField
              id="after-strategy"
              label={t('field.strategy')}
              optionalLabel={a('trade.optional')}
              hint={a('journal.idea.strategyHint')}
            >
              <NativeSelect
                id="after-strategy"
                value={journalDraft.strategyId}
                aria-describedby="after-strategy-hint"
                onChange={(event) => {
                  const strategyId = event.target.value;
                  setJournalDraft((current) => ({
                    ...current,
                    strategyId,
                    setupId: '',
                    conditionMet: {},
                  }));
                }}
              >
                <option value="">{t('create.chooseStrategy')}</option>
                {options.strategies.map((strategy) => (
                  <option key={strategy.strategyId} value={strategy.strategyId}>
                    {strategy.name}
                  </option>
                ))}
              </NativeSelect>
            </SelectField>

            {draftStrategy === undefined ? null : (
              <SelectField
                id="after-setup"
                label={t('field.setup')}
                optionalLabel={a('trade.optional')}
                hint={a('journal.idea.setupHint')}
              >
                <NativeSelect
                  id="after-setup"
                  value={journalDraft.setupId}
                  aria-describedby="after-setup-hint"
                  onChange={(event) => {
                    const setupId = event.target.value;
                    setJournalDraft((current) => ({ ...current, setupId, conditionMet: {} }));
                  }}
                >
                  <option value="">{t('create.chooseSetup')}</option>
                  {draftStrategy.setups.map((setup) => (
                    <option key={setup.setupId} value={setup.setupId}>
                      {setup.name}
                    </option>
                  ))}
                </NativeSelect>
              </SelectField>
            )}

            {draftSetup !== undefined && draftSetup.conditions.length > 0 ? (
              <fieldset className="border-border flex min-w-0 flex-col gap-1 border-y py-3">
                <legend className="text-foreground text-sm font-medium">
                  {a('journal.idea.checklistTitle')}
                </legend>
                <p className="text-muted-foreground text-xs">{a('plan.setupHint')}</p>
                {draftSetup.conditions.map((condition) => (
                  <label
                    key={condition.conditionKey}
                    className="flex min-h-11 min-w-0 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={journalDraft.conditionMet[condition.conditionKey] === true}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setJournalDraft((current) => ({
                          ...current,
                          conditionMet: {
                            ...current.conditionMet,
                            [condition.conditionKey]: checked,
                          },
                        }));
                      }}
                    />
                    <span className="min-w-0 break-words">{condition.label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>

          <FieldPair>
            <TextInputField
              id="after-timeframe"
              label={t('field.timeframe')}
              optionalLabel={a('trade.optional')}
              value={journalDraft.timeframe}
              onChange={(timeframe) => setJournalDraft((current) => ({ ...current, timeframe }))}
            />
            <TextInputField
              id="after-session"
              label={t('field.session')}
              optionalLabel={a('trade.optional')}
              value={journalDraft.session}
              onChange={(session) => setJournalDraft((current) => ({ ...current, session }))}
            />
          </FieldPair>

          <TextInputField
            id="after-chart-link"
            type="url"
            inputMode="url"
            label={r('chartLink')}
            optionalLabel={a('trade.optional')}
            value={journalDraft.tradingviewUrl}
            placeholder="https://www.tradingview.com/x/…"
            onChange={(tradingviewUrl) =>
              setJournalDraft((current) => ({ ...current, tradingviewUrl }))
            }
          />

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="after-notes" className="text-muted-foreground text-xs font-medium">
              {a('journal.idea.notes')}
            </label>
            <Textarea
              id="after-notes"
              rows={2}
              value={journalDraft.notes}
              onChange={(event) =>
                setJournalDraft((current) => ({ ...current, notes: event.target.value }))
              }
              className="min-h-20 text-base"
            />
          </div>
        </div>
      </TradeAdaptiveOverlay>

      <TradeAdaptiveOverlay
        open={journalArea === 'feelings'}
        onOpenChange={(open) => {
          if (!open) setJournalArea(null);
        }}
        title={a('journal.feelings.label')}
        description={a('journal.feelings.description')}
        closeLabel={t('lifecycle.common.close')}
        returnFocusRef={feelingsTrigger}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {a('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="flex min-w-0 flex-col gap-6">
          <TradeConfidenceChoice
            id="after-confidence"
            label={t('field.confidence')}
            hint={tConfidence('hintHindsight')}
            value={confidenceOf(journalDraft.confidence) ?? null}
            onChange={(value) =>
              setJournalDraft((current) => ({
                ...current,
                confidence: value === null ? '' : String(value),
              }))
            }
          />
          <TradeEmotionChips
            legend={a('journal.feelings.emotions')}
            catalog={options.emotionCatalog}
            value={journalDraft.emotions}
            onChange={(next) => setJournalDraft((current) => ({ ...current, emotions: next }))}
            groupLabel={(key) => r(`emotionGroups.${key}`)}
            noneLabel={a('journal.feelings.noneOfThese')}
            notRecordedLabel={a('journal.notRecorded')}
          />
        </div>
      </TradeAdaptiveOverlay>

      <AlertDialog open={confirmUnmetOpen} onOpenChange={setConfirmUnmetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{r('unmet.title')}</AlertDialogTitle>
            <AlertDialogDescription>{r('unmet.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lifecycle.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmUnmetOpen(false);
                void submit(true);
              }}
            >
              {r('unmet.continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One exit, being edited. Its own actions finish it; the page's Save stands aside meanwhile. */
function ExitEditor({
  exit,
  index,
  actualBasis,
  currency,
  timezone,
  errors,
  optionalLabel,
  onChange,
  onRemove,
  onDone,
}: {
  exit: ExitDraft;
  index: number;
  actualBasis: Basis;
  currency: string;
  timezone: string;
  errors: ErrorMap;
  optionalLabel: string;
  onChange: (patch: Partial<ExitDraft>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const a = useTranslations('trades.create.recording.after');
  const r = useTranslations('trades.create.recording');
  return (
    <div data-exit-editor="" className="bg-accent/20 flex min-w-0 flex-col gap-4 px-3 py-3.5">
      <h4 className="text-foreground text-sm font-medium">
        {a('exits.exitNumber', { number: index + 1 })}
      </h4>
      <FieldPair>
        <TextInputField
          id={`exit-${exit.id}-value`}
          label={actualBasis === 'money' ? r('realizedPnl') : r('exitPrice')}
          optionalLabel={optionalLabel}
          value={exit.value}
          onChange={(value) => onChange({ value })}
          error={errors[`exit-${exit.id}-value`]}
          inputMode="decimal"
          hint={actualBasis === 'money' ? currency : undefined}
          numeric
        />
        <TextInputField
          id={`exit-${exit.id}-percent`}
          label={r('closedPercent')}
          optionalLabel={optionalLabel}
          value={exit.closedPercent}
          onChange={(closedPercent) => onChange({ closedPercent })}
          error={errors[`exit-${exit.id}-percent`]}
          inputMode="decimal"
          numeric
        />
      </FieldPair>
      <FieldPair>
        <SelectField
          id={`exit-${exit.id}-scope`}
          label={a('exits.scope')}
          optionalLabel={optionalLabel}
        >
          <NativeSelect
            id={`exit-${exit.id}-scope`}
            value={exit.scope}
            onChange={(event) => onChange({ scope: event.target.value as ExitScope })}
          >
            <option value="">{a('exits.scopeOptions.unknown')}</option>
            <option value="part">{a('exits.scopeOptions.part')}</option>
            <option value="all_remaining">{a('exits.scopeOptions.allRemaining')}</option>
          </NativeSelect>
        </SelectField>
        <TextInputField
          id={`exit-${exit.id}-time`}
          type="datetime-local"
          label={r('exitTime')}
          optionalLabel={optionalLabel}
          value={exit.exitedAt}
          onChange={(exitedAt) => onChange({ exitedAt })}
          error={errors[`exit-${exit.id}-time`]}
          hint={timezone}
          numeric
        />
      </FieldPair>
      <TextInputField
        id={`exit-${exit.id}-reason`}
        label={a('exits.reason')}
        optionalLabel={optionalLabel}
        value={exit.reason}
        onChange={(reason) => onChange({ reason })}
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-muted-foreground min-h-11"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {a('exits.remove')}
        </Button>
        <Button type="button" size="sm" onClick={onDone} className="min-h-11">
          <Check className="size-4" aria-hidden="true" />
          {a('exits.done')}
        </Button>
      </div>
    </div>
  );
}

/** The supporting subtotal beside the authoritative final result; it picks neither in a conflict. */
function ReconciliationSummary({
  currency,
  finalMinor,
  subtotalMinor,
  reconciliation,
  canAdoptAfterSave,
  error,
}: {
  currency: string;
  finalMinor: string | null;
  subtotalMinor: string | null;
  reconciliation: 'not_recorded' | 'unreconciled' | 'matched' | 'conflict' | 'not_applicable';
  canAdoptAfterSave: boolean;
  error?: string | undefined;
}) {
  const a = useTranslations('trades.create.recording.after');
  if (reconciliation === 'not_recorded') return null;
  return (
    <div
      data-reconciliation={reconciliation}
      className={cn(
        'flex min-w-0 flex-col gap-1.5 border-t pt-3',
        reconciliation === 'conflict' ? 'border-warning/40' : 'border-border/70',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">{a('exits.subtotal')}</span>
        <strong className="numeric text-sm break-all">
          {signedMoney(subtotalMinor, currency) ?? a('actual.unavailable')}
        </strong>
      </div>
      <p
        className={cn(
          'text-xs leading-relaxed',
          reconciliation === 'conflict' ? 'text-warning' : 'text-muted-foreground',
        )}
      >
        {a(`exits.reconciliation.${reconciliation}`, {
          final: signedMoney(finalMinor, currency) ?? a('actual.unknown'),
        })}
      </p>
      {canAdoptAfterSave ? (
        <p className="text-subtle-foreground text-xs leading-relaxed">
          {a('exits.adoptAfterSave')}
        </p>
      ) : null}
      {error === undefined ? null : (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
