'use client';

import { Check, Image as ImageIcon, Link2, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { composePlannedR, type PlannedRSnapshot } from '@/lib/calc/trade';
import type { CalcResult } from '@/lib/calc/types';
import { generateId } from '@/lib/identifiers';
import {
  CHART_ATTACHMENT_MAX_BYTES,
  isChartAttachmentContentType,
} from '@/lib/storage/chart-attachment';
import {
  isConfidenceStep,
  SESSION_QUICK_SUGGESTIONS,
  TIMEFRAME_QUICK_SUGGESTIONS,
  type ConfidenceStep,
} from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import {
  deleteChartAttachmentAction,
  uploadChartAttachmentAction,
} from '@/server/actions/chart-attachment';
import { createTradeAction } from '@/server/actions/trades';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { Link, useRouter } from '@/i18n/navigation';

import { TradeConfidenceControl } from './trade-confidence-control';
import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
} from './trade-form-values';
import { formatR } from './trade-format';
import { PlanField } from './trade-plan-field';
import {
  actualExecutionErrors,
  stageErrors,
  type ActualExecutionErrorCode,
  type PlanErrorCode,
  type PlanErrorMap,
  type PlanValidationValues,
} from './trade-plan-validation';
import { TradeQuickSelectField } from './trade-quick-select';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

type Direction = '' | 'long' | 'short';
type ErrorMap = Record<string, string>;

interface Values {
  tradingAccountId: string;
  strategyId: string;
  setupId: string;
  symbol: string;
  direction: Direction;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget: string;
  plannedPositionSize: string;
  /** Human decimal text, e.g. "50.00" — converted to minor units only at submit time via `parseTradeMoneyInput`. */
  plannedRiskMinor: string;
  plannedRewardMinor: string;
  /**
   * Phase 14E — Open/Close-Only Trade Flow. The one REQUIRED representation
   * of what actually happened, independent of the optional Plan fields
   * above — never fabricated from them (CLAUDE.md §6, brief §6).
   */
  actualResultMode: 'price' | 'money';
  actualEntry: string;
  actualInitialStop: string;
  /** Human decimal text — converted to minor units only at submit time, exactly like `plannedRiskMinor`. */
  actualInitialRiskMinor: string;
  actualPositionSize: string;
  /** `datetime-local` wall-clock text in the user's saved timezone; defaults to "now" post-hydration, always editable — mirrors `TradeDateTimeInput`'s own convention. */
  enteredAt: string;
  timeframe: string;
  session: string;
  /** '' | '0' | '25' | '50' | '75' | '100' — Founder-UAT Confidence redesign; no other value is ever set. */
  confidence: string;
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
  chartAttachmentStorageKey: string;
}

type UploadState =
  | { readonly status: 'idle' }
  | { readonly status: 'uploading' }
  /**
   * `previewObjectUrl` is a LOCAL `URL.createObjectURL` preview of the
   * originally-selected `File` — never the remote object (Founder review:
   * the uploaded Blob is private and has no public URL to preview from).
   * Revoked on removal/unmount by this component's own effect.
   */
  | { readonly status: 'uploaded'; readonly storageKey: string; readonly previewObjectUrl: string }
  | { readonly status: 'error'; readonly message: string };

const PLAN_ERROR_MESSAGE_KEY: Record<PlanErrorCode, string> = {
  required_account: 'validation.requiredAccount',
  setup_requires_strategy: 'validation.setupRequiresStrategy',
  required_symbol: 'validation.requiredSymbol',
  required_direction: 'validation.requiredDirection',
  required_entry: 'validation.requiredEntry',
  required_stop: 'validation.requiredStop',
  invalid_decimal: 'validation.invalidDecimal',
  incomplete_price_plan: 'validation.incompletePricePlan',
  incomplete_money_plan: 'validation.incompleteMoneyPlan',
  invalid_tradingview_url: 'validation.invalidTradingViewUrl',
};

/**
 * Phase 14E — Open/Close-Only Trade Flow. The one REQUIRED-field error
 * surface for the New Trade form (everything else in `PLAN_ERROR_MESSAGE_KEY`
 * is either shape validation or, since Plan is optional data, never blocks
 * Open). Exact copy per brief §20 — never "Trade incomplete"/"Invalid Plan".
 */
const ACTUAL_EXECUTION_ERROR_MESSAGE_KEY: Record<ActualExecutionErrorCode, string> = {
  required_actual_price: 'validation.requiredActualPrice',
  invalid_actual_price: 'validation.invalidDecimal',
  required_actual_risk: 'validation.requiredActualRisk',
  invalid_actual_risk: 'validation.invalidDecimal',
};

function translatePlanErrors(
  errors: PlanErrorMap,
  t: ReturnType<typeof useTranslations<'trades'>>,
): ErrorMap {
  const out: ErrorMap = {};
  for (const [field, code] of Object.entries(errors)) {
    out[field] = t(PLAN_ERROR_MESSAGE_KEY[code]);
  }
  return out;
}

function parseConfidence(value: string): ConfidenceStep | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number.parseInt(value, 10);
  return isConfidenceStep(parsed) ? parsed : undefined;
}

const DIRECTION_STYLE = {
  long: {
    Icon: TrendingUp,
    selected: 'border-positive bg-positive/15 text-positive ring-positive/30 ring-2',
    unselected:
      'border-border bg-card text-foreground hover:border-positive/50 hover:bg-positive/5',
  },
  short: {
    Icon: TrendingDown,
    selected: 'border-negative bg-negative/15 text-negative ring-negative/30 ring-2',
    unselected:
      'border-border bg-card text-foreground hover:border-negative/50 hover:bg-negative/5',
  },
} as const;

export function TradeCreateForm({
  options,
  timezone,
}: {
  options: TradeCreateOptions;
  timezone: string;
}) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [mutationKey] = useState(generateId);
  const [chartTab, setChartTab] = useState<'link' | 'upload'>('link');
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle' });
  const [priceOpen, setPriceOpen] = useState(true);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [confirmUnmetOpen, setConfirmUnmetOpen] = useState(false);
  const [conditionMetByKey, setConditionMetByKey] = useState<Record<string, boolean>>({});
  const [emotionKeys, setEmotionKeys] = useState<string[]>([]);
  const initialAccount =
    options.tradingAccounts.length === 1
      ? (options.tradingAccounts[0]?.tradingAccountId ?? '')
      : '';
  const [values, setValues] = useState<Values>({
    tradingAccountId: initialAccount,
    strategyId: '',
    setupId: '',
    symbol: '',
    direction: '',
    plannedEntry: '',
    plannedStop: '',
    plannedTarget: '',
    plannedPositionSize: '',
    plannedRiskMinor: '',
    plannedRewardMinor: '',
    actualResultMode: 'price',
    actualEntry: '',
    actualInitialStop: '',
    actualInitialRiskMinor: '',
    actualPositionSize: '',
    enteredAt: '',
    timeframe: '',
    session: '',
    confidence: '',
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
    chartAttachmentStorageKey: '',
  });

  // Revokes the local preview object URL whenever it changes or this form
  // unmounts — `URL.createObjectURL` allocations are never released by the
  // browser on their own.
  useEffect(() => {
    if (uploadState.status !== 'uploaded') return;
    const { previewObjectUrl } = uploadState;
    return () => URL.revokeObjectURL(previewObjectUrl);
  }, [uploadState]);

  // Entered-At defaults to the current instant, editable, never silently
  // overwritten once the user has touched it — the same SSR-safe convention
  // `TradeDateTimeInput` establishes (empty on the server, "now" once
  // hydrated), applied via this codebase's own `useIsHydrated` idiom
  // (`src/hooks/use-is-hydrated.ts`, already used by `theme-selector.tsx`/
  // `use-trade-plan-favorites.ts`): computed fresh at render time, never a
  // `useEffect` that calls `setState`, which cascades an extra render and is
  // flagged by this project's React Compiler lint rule.
  const isHydrated = useIsHydrated();
  const defaultEnteredAt = isHydrated
    ? instantToDatetimeLocal(new Date().toISOString(), timezone)
    : '';
  const enteredAtValue = values.enteredAt === '' ? defaultEnteredAt : values.enteredAt;

  const symbolFavorites = useTradePlanFavorites('symbol', options.workspaceId);
  const timeframeFavorites = useTradePlanFavorites('timeframe', options.workspaceId);
  const sessionFavorites = useTradePlanFavorites('session', options.workspaceId);

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const selectedStrategy = options.strategies.find((item) => item.strategyId === values.strategyId);
  const selectedSetup = selectedStrategy?.setups.find((item) => item.setupId === values.setupId);

  function planValidationValues(): PlanValidationValues {
    return {
      tradingAccountId: values.tradingAccountId,
      strategyId: values.strategyId,
      setupId: values.setupId,
      symbol: values.symbol,
      direction: values.direction,
      plannedEntry: values.plannedEntry,
      plannedStop: values.plannedStop,
      plannedTarget: values.plannedTarget,
      plannedPositionSize: values.plannedPositionSize,
      plannedRiskMinor: values.plannedRiskMinor,
      plannedRewardMinor: values.plannedRewardMinor,
      tradingviewUrl: values.tradingviewUrl,
    };
  }

  /**
   * The live Price+Money agreement preview — reuses `composePlannedR`
   * directly (the SAME pure function `createTrade` calls server-side), so
   * the client preview and the server's authoritative decision can never
   * diverge on whether two representations agree. `null` when Direction is
   * not yet chosen (nothing meaningful to compute).
   */
  function computeLiveSnapshot(): CalcResult<PlannedRSnapshot> | null {
    if (values.direction === '') return null;
    const currency = selectedAccount?.baseCurrency;
    const plannedEntry = values.plannedEntry.trim() === '' ? null : values.plannedEntry.trim();
    const plannedStop = values.plannedStop.trim() === '' ? null : values.plannedStop.trim();
    const plannedTarget = values.plannedTarget.trim() === '' ? null : values.plannedTarget.trim();

    let plannedRiskMinor: bigint | null = null;
    if (currency !== undefined && values.plannedRiskMinor.trim() !== '') {
      const risk = parseTradeMoneyInput(values.plannedRiskMinor.trim(), currency, {
        allowZero: false,
      });
      plannedRiskMinor = risk.ok ? BigInt(risk.value) : null;
    }
    let plannedRewardMinor: bigint | null = null;
    if (currency !== undefined && values.plannedRewardMinor.trim() !== '') {
      const reward = parseTradeMoneyInput(values.plannedRewardMinor.trim(), currency, {
        allowZero: true,
      });
      plannedRewardMinor = reward.ok ? BigInt(reward.value) : null;
    }

    return composePlannedR({
      direction: values.direction,
      plannedEntry,
      plannedStop,
      plannedTarget,
      plannedRiskMinor,
      plannedRewardMinor,
    });
  }

  function hasLiveMismatch(): boolean {
    const snapshot = computeLiveSnapshot();
    return snapshot !== null && snapshot.ok && snapshot.value.mismatch;
  }

  function setField<K extends keyof Values>(field: K, value: Values[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  }

  function handleStrategyChange(strategyId: string) {
    const strategy = options.strategies.find((item) => item.strategyId === strategyId);
    setValues((current) => ({
      ...current,
      strategyId,
      setupId: strategy?.setups.length === 1 ? (strategy.setups[0]?.setupId ?? '') : '',
    }));
    setConditionMetByKey({});
    setErrors((current) => {
      const next = { ...current };
      delete next.strategyId;
      delete next.setupId;
      return next;
    });
    setFormError(null);
  }

  function handleSetupChange(setupId: string) {
    setField('setupId', setupId);
    setConditionMetByKey({});
  }

  function closePriceSection() {
    if (!moneyOpen) return;
    setPriceOpen(false);
  }
  function closeMoneySection() {
    if (!priceOpen) return;
    setMoneyOpen(false);
  }

  async function handleFileSelected(file: File) {
    if (!isChartAttachmentContentType(file.type)) {
      setUploadState({ status: 'error', message: t('errors.unsupported_file_type') });
      return;
    }
    if (file.size <= 0 || file.size > CHART_ATTACHMENT_MAX_BYTES) {
      setUploadState({ status: 'error', message: t('errors.file_too_large') });
      return;
    }
    setUploadState({ status: 'uploading' });
    const formData = new FormData();
    formData.append('file', file);
    const result = await uploadChartAttachmentAction(formData);
    if (!result.ok) {
      setUploadState({ status: 'error', message: t(`errors.${result.error.code}`) });
      return;
    }
    // A local preview of the SELECTED file, never the remote object — the
    // uploaded Blob is private and has no fetchable URL to preview from
    // (Founder review). Revoked by this component's own effect.
    const previewObjectUrl = URL.createObjectURL(file);
    setUploadState({ status: 'uploaded', storageKey: result.data.storageKey, previewObjectUrl });
    setValues((current) => ({ ...current, chartAttachmentStorageKey: result.data.storageKey }));
  }

  function handleRemoveUpload() {
    if (uploadState.status === 'uploaded') {
      // Best-effort — never blocks the UI on storage cleanup succeeding
      // (Founder review §5). The user removed this file before any Trade
      // ever referenced it, so this request still owns the only knowledge
      // of the key needed to delete it safely.
      void deleteChartAttachmentAction(uploadState.storageKey);
    }
    setUploadState({ status: 'idle' });
    setValues((current) => ({ ...current, chartAttachmentStorageKey: '' }));
  }

  function fieldError(field: keyof Values): string | undefined {
    return errors[field];
  }

  async function submit(unmetConfirmed = false) {
    const finalErrors = stageErrors(2, planValidationValues());
    if (Object.keys(finalErrors).length > 0) {
      setErrors(translatePlanErrors(finalErrors, t));
      return;
    }
    if (hasLiveMismatch()) {
      setFormError(t('create.plan.mismatchBlocked'));
      return;
    }
    // Phase 14E — the one REQUIRED field on this form beyond Core: exactly
    // one authoritative Actual execution basis. Checked separately from
    // `stageErrors` (which governs the optional Plan) so its error copy can
    // stay specific per brief §20.
    const executionError = actualExecutionErrors({
      actualResultMode: values.actualResultMode,
      actualEntry: values.actualEntry,
      actualInitialStop: values.actualInitialStop,
      actualInitialRiskMinor: values.actualInitialRiskMinor,
    });
    if (executionError !== null) {
      const field = values.actualResultMode === 'price' ? 'actualEntry' : 'actualInitialRiskMinor';
      setErrors((current) => ({
        ...current,
        [field]: t(ACTUAL_EXECUTION_ERROR_MESSAGE_KEY[executionError]),
      }));
      return;
    }

    const currency = selectedAccount?.baseCurrency ?? '';
    let actualInitialRiskMinor: string | null = null;
    if (values.actualResultMode === 'money') {
      const risk = parseTradeMoneyInput(values.actualInitialRiskMinor.trim(), currency, {
        allowZero: false,
      });
      if (!risk.ok) {
        setErrors((current) => ({
          ...current,
          actualInitialRiskMinor: t('lifecycle.validation.money'),
        }));
        return;
      }
      actualInitialRiskMinor = risk.value;
    }
    const enteredAtResult = datetimeLocalToIso(enteredAtValue, timezone);
    if (!enteredAtResult.ok) {
      setErrors((current) => ({ ...current, enteredAt: t('lifecycle.validation.time') }));
      return;
    }
    let plannedRiskMinor: string | null = null;
    if (values.plannedRiskMinor.trim() !== '') {
      const risk = parseTradeMoneyInput(values.plannedRiskMinor.trim(), currency, {
        allowZero: false,
      });
      if (!risk.ok) {
        setErrors((current) => ({ ...current, plannedRiskMinor: t('lifecycle.validation.money') }));
        return;
      }
      plannedRiskMinor = risk.value;
    }
    let plannedRewardMinor: string | null = null;
    if (values.plannedRewardMinor.trim() !== '') {
      const reward = parseTradeMoneyInput(values.plannedRewardMinor.trim(), currency, {
        allowZero: true,
      });
      if (!reward.ok) {
        setErrors((current) => ({
          ...current,
          plannedRewardMinor: t('lifecycle.validation.money'),
        }));
        return;
      }
      plannedRewardMinor = reward.value;
    }

    const conditionAnswers = (selectedSetup?.conditions ?? []).map((condition) => ({
      conditionKey: condition.conditionKey,
      status:
        conditionMetByKey[condition.conditionKey] === true
          ? ('met' as const)
          : ('not_met' as const),
    }));
    if (!unmetConfirmed && conditionAnswers.some((answer) => answer.status === 'not_met')) {
      setConfirmUnmetOpen(true);
      return;
    }

    setIsPending(true);
    setFormError(null);
    const confidence = parseConfidence(values.confidence);
    const result = await createTradeAction({
      mutationKey,
      tradingAccountId: values.tradingAccountId,
      // Strategy/Setup are optional (Phase 14C) — omitted entirely, never
      // sent as an empty string, exactly when nothing was chosen.
      // `CreateTradeSchema`'s `strategyId`/`setupId` are `uuidField().optional()`,
      // which accepts an ABSENT key but rejects `''` as an invalid UUID.
      ...(values.strategyId === '' ? {} : { strategyId: values.strategyId }),
      ...(values.setupId === '' ? {} : { setupId: values.setupId }),
      ...(selectedSetup === undefined
        ? {}
        : { conditionSetToken: selectedSetup.conditionSetToken, conditionAnswers }),
      symbol: values.symbol,
      direction: values.direction,
      plannedEntry: values.plannedEntry.trim() === '' ? null : values.plannedEntry.trim(),
      plannedStop: values.plannedStop.trim() === '' ? null : values.plannedStop.trim(),
      plannedTarget: values.plannedTarget.trim() === '' ? null : values.plannedTarget.trim(),
      plannedPositionSize:
        values.plannedPositionSize.trim() === '' ? null : values.plannedPositionSize.trim(),
      plannedRiskMinor,
      plannedRewardMinor,
      // Phase 14E — the normal customer New Trade flow always supplies its
      // one required Actual execution basis, so this Trade is created
      // already `open`, atomically, never a separate `openTrade` call after.
      actualResultMode: values.actualResultMode,
      actualEntry: values.actualResultMode === 'price' ? values.actualEntry.trim() : null,
      actualInitialStop:
        values.actualResultMode === 'price' ? values.actualInitialStop.trim() : null,
      actualInitialRiskMinor,
      actualPositionSize:
        values.actualPositionSize.trim() === '' ? null : values.actualPositionSize.trim(),
      enteredAt: enteredAtResult.value,
      timeframe: values.timeframe,
      session: values.session,
      ...(confidence === undefined ? {} : { confidence }),
      emotionKeys,
      confirmationNotes: values.confirmationNotes,
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
      chartAttachmentStorageKey:
        values.chartAttachmentStorageKey.trim() === '' ? null : values.chartAttachmentStorageKey,
    });
    setIsPending(false);
    if (result.ok) {
      symbolFavorites.recordUse(values.symbol);
      timeframeFavorites.recordUse(values.timeframe);
      sessionFavorites.recordUse(values.session);
      router.push(`/app/trades?trade=${result.data.tradeId}`);
      return;
    }
    const mapped: ErrorMap = {};
    for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      const message = messages[0];
      mapped[field] =
        message === undefined
          ? t('validation.invalidField')
          : translateServerFieldError(message, t);
    }
    setErrors(mapped);
    setFormError(t(`errors.${result.error.code}`));
    if ('plannedRiskMinor' in mapped || 'plannedRewardMinor' in mapped) setMoneyOpen(true);
    if ('plannedEntry' in mapped || 'plannedStop' in mapped || 'plannedTarget' in mapped)
      setPriceOpen(true);
  }

  const confidenceNum = parseConfidence(values.confidence);
  const liveSnapshot = computeLiveSnapshot();
  const conditionCount = selectedSetup?.conditions.length ?? 0;
  const metConditionCount = (selectedSetup?.conditions ?? []).filter(
    (condition) => conditionMetByKey[condition.conditionKey] === true,
  ).length;
  const conditionPercentage =
    conditionCount === 0 ? null : Math.round((metConditionCount / conditionCount) * 100);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div
        role="status"
        aria-live="polite"
        className={
          formError === null
            ? 'sr-only'
            : 'border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm'
        }
      >
        {formError ?? t('create.ready')}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="border-border bg-card grid gap-10 rounded-lg border p-4 sm:p-6"
      >
        <fieldset className="grid gap-5">
          <legend className="text-card-title mb-2">{t('create.accountTitle')}</legend>
          <p className="text-muted-foreground text-sm">{t('create.accountDescription')}</p>
          <PlanField
            id="trade-account"
            label={t('field.account')}
            error={fieldError('tradingAccountId')}
          >
            <Select
              id="trade-account"
              value={values.tradingAccountId}
              onChange={(event) => setField('tradingAccountId', event.target.value)}
              aria-invalid={fieldError('tradingAccountId') !== undefined}
              aria-describedby={
                fieldError('tradingAccountId') === undefined ? undefined : 'trade-account-error'
              }
            >
              <option value="">{t('create.chooseAccount')}</option>
              {options.tradingAccounts.map((account) => (
                <option key={account.tradingAccountId} value={account.tradingAccountId}>
                  {account.name} · {account.baseCurrency}
                </option>
              ))}
            </Select>
          </PlanField>
        </fieldset>

        <fieldset className="grid gap-8">
          <legend className="text-card-title mb-2">{t('create.planTitle')}</legend>

          <div className="grid gap-5">
            <h3 className="text-label text-muted-foreground uppercase">
              {t('create.sections.corePlan')}
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <TradeQuickSelectField
                id="trade-symbol"
                label={t('field.symbol')}
                value={values.symbol}
                onChange={(value) => setField('symbol', value)}
                transform={(value) => value.toUpperCase()}
                favorites={symbolFavorites.favorites}
                recents={symbolFavorites.recents}
                onToggleFavorite={symbolFavorites.toggle}
                error={fieldError('symbol')}
              />
              <fieldset
                className="flex flex-col gap-2"
                aria-invalid={fieldError('direction') !== undefined}
                aria-describedby={
                  fieldError('direction') === undefined ? undefined : 'trade-direction-error'
                }
              >
                <legend className="text-sm font-medium">{t('field.direction')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['long', 'short'] as const).map((direction) => {
                    const isSelected = values.direction === direction;
                    const style = DIRECTION_STYLE[direction];
                    const Icon = style.Icon;
                    return (
                      <button
                        key={direction}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setField('direction', direction)}
                        className={cn(
                          'flex min-h-11 items-center justify-center gap-2 rounded-md border-2 px-3 py-2 text-sm font-semibold transition-colors',
                          isSelected ? style.selected : style.unselected,
                        )}
                      >
                        <Icon aria-hidden="true" size={16} />
                        {t(`direction.${direction}`)}
                        {isSelected ? <Check aria-hidden="true" size={16} /> : null}
                      </button>
                    );
                  })}
                </div>
                {fieldError('direction') === undefined ? null : (
                  <p id="trade-direction-error" role="alert" className="text-destructive text-xs">
                    {fieldError('direction')}
                  </p>
                )}
              </fieldset>
            </div>

            <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
              <h3 className="text-sm font-semibold">{t('create.sections.actualExecution')}</h3>
              <PlanField id="trade-actual-mode" label={t('field.actualResultMode')}>
                <Select
                  id="trade-actual-mode"
                  value={values.actualResultMode}
                  onChange={(event) =>
                    setField('actualResultMode', event.target.value as 'price' | 'money')
                  }
                >
                  <option value="price">{t('lifecycle.execution.priceMode')}</option>
                  <option value="money">{t('lifecycle.execution.moneyMode')}</option>
                </Select>
              </PlanField>
              <div className="grid gap-5 sm:grid-cols-2">
                {values.actualResultMode === 'price' ? (
                  <>
                    <DecimalField
                      id="trade-actual-entry"
                      field="actualEntry"
                      label={t('field.actualEntry')}
                      values={values}
                      setField={setField}
                      error={fieldError('actualEntry')}
                    />
                    <DecimalField
                      id="trade-actual-stop"
                      field="actualInitialStop"
                      label={t('field.initialStop')}
                      values={values}
                      setField={setField}
                      error={fieldError('actualInitialStop')}
                    />
                  </>
                ) : (
                  <DecimalField
                    id="trade-actual-risk"
                    field="actualInitialRiskMinor"
                    label={t('field.initialRisk')}
                    hint={
                      selectedAccount === undefined
                        ? undefined
                        : t('lifecycle.execution.moneyHint', {
                            currency: selectedAccount.baseCurrency,
                          })
                    }
                    values={values}
                    setField={setField}
                    error={fieldError('actualInitialRiskMinor')}
                  />
                )}
                <DecimalField
                  id="trade-actual-size"
                  field="actualPositionSize"
                  label={t('field.actualPositionSize')}
                  values={values}
                  setField={setField}
                  error={fieldError('actualPositionSize')}
                  optional
                />
              </div>
              <PlanField
                id="trade-entered-at"
                label={t('field.enteredAt')}
                hint={t('lifecycle.execution.timezoneHint', { timezone })}
                error={fieldError('enteredAt')}
              >
                <Input
                  id="trade-entered-at"
                  type="datetime-local"
                  value={enteredAtValue}
                  onChange={(event) => setField('enteredAt', event.target.value)}
                  aria-invalid={fieldError('enteredAt') !== undefined}
                  aria-describedby={
                    fieldError('enteredAt') === undefined ? undefined : 'trade-entered-at-error'
                  }
                />
              </PlanField>
            </div>

            <h3 className="text-label text-muted-foreground uppercase">
              {t('create.sections.tradePlan')}
            </h3>
            <PlanRepresentationToggle
              title={t('create.plan.priceTitle')}
              isOpen={priceOpen}
              onOpen={() => setPriceOpen(true)}
              onClose={closePriceSection}
              addLabel={t('create.plan.addPrice')}
              hideLabel={t('create.plan.hidePrice')}
              canClose={moneyOpen}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <DecimalField
                  id="trade-entry"
                  field="plannedEntry"
                  label={t('field.entry')}
                  values={values}
                  setField={setField}
                  error={fieldError('plannedEntry')}
                />
                <DecimalField
                  id="trade-stop"
                  field="plannedStop"
                  label={t('field.stop')}
                  values={values}
                  setField={setField}
                  error={fieldError('plannedStop')}
                />
                <DecimalField
                  id="trade-target"
                  field="plannedTarget"
                  label={t('field.target')}
                  values={values}
                  setField={setField}
                  error={fieldError('plannedTarget')}
                  optional
                />
                <DecimalField
                  id="trade-position-size"
                  field="plannedPositionSize"
                  label={t('field.positionSize')}
                  values={values}
                  setField={setField}
                  error={fieldError('plannedPositionSize')}
                  optional
                />
              </div>
            </PlanRepresentationToggle>

            <PlanRepresentationToggle
              title={t('create.plan.moneyTitle')}
              isOpen={moneyOpen}
              onOpen={() => setMoneyOpen(true)}
              onClose={closeMoneySection}
              addLabel={t('create.plan.addMoney')}
              hideLabel={t('create.plan.hideMoney')}
              canClose={priceOpen}
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <DecimalField
                  id="trade-risk"
                  field="plannedRiskMinor"
                  label={t('field.plannedRisk')}
                  hint={
                    selectedAccount === undefined
                      ? undefined
                      : t('lifecycle.execution.moneyHint', {
                          currency: selectedAccount.baseCurrency,
                        })
                  }
                  values={values}
                  setField={setField}
                  error={fieldError('plannedRiskMinor')}
                />
                <DecimalField
                  id="trade-reward"
                  field="plannedRewardMinor"
                  label={t('field.plannedReward')}
                  values={values}
                  setField={setField}
                  error={fieldError('plannedRewardMinor')}
                  optional
                />
              </div>
            </PlanRepresentationToggle>

            {liveSnapshot !== null && liveSnapshot.ok && liveSnapshot.value.mismatch ? (
              <div
                role="alert"
                className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm"
              >
                <p className="font-medium">{t('create.plan.mismatchTitle')}</p>
                <p className="mt-1">
                  {t('create.plan.mismatchBody', {
                    priceR: formatR(liveSnapshot.value.priceR) ?? '—',
                    moneyR: formatR(liveSnapshot.value.moneyR) ?? '—',
                  })}
                </p>
              </div>
            ) : liveSnapshot !== null && liveSnapshot.ok && liveSnapshot.value.plannedR !== null ? (
              <div className="border-border bg-muted/30 rounded-lg border p-3 text-sm">
                {t('create.plan.previewR', {
                  value: formatR(liveSnapshot.value.plannedR) ?? '—',
                })}
                {liveSnapshot.value.source === 'both' ? ` · ${t('create.plan.previewAgree')}` : ''}
              </div>
            ) : null}
          </div>

          <fieldset className="grid gap-5">
            <legend className="text-label text-muted-foreground uppercase">
              {t('create.strategyTitle')}
            </legend>
            <p className="text-muted-foreground text-sm">{t('create.strategyDescription')}</p>
            <PlanField
              id="trade-strategy"
              label={t('field.strategy')}
              error={fieldError('strategyId')}
            >
              <Select
                id="trade-strategy"
                value={values.strategyId}
                onChange={(event) => handleStrategyChange(event.target.value)}
                aria-invalid={fieldError('strategyId') !== undefined}
                aria-describedby={
                  fieldError('strategyId') === undefined ? undefined : 'trade-strategy-error'
                }
              >
                <option value="">{t('create.chooseStrategy')}</option>
                {options.strategies.map((strategy) => (
                  <option key={strategy.strategyId} value={strategy.strategyId}>
                    {strategy.name} ·{' '}
                    {t('common.version', { number: strategy.currentVersionNumber })}
                  </option>
                ))}
              </Select>
            </PlanField>
            <PlanField id="trade-setup" label={t('field.setup')} error={fieldError('setupId')}>
              <Select
                id="trade-setup"
                value={values.setupId}
                disabled={selectedStrategy === undefined}
                onChange={(event) => handleSetupChange(event.target.value)}
                aria-invalid={fieldError('setupId') !== undefined}
                aria-describedby={
                  fieldError('setupId') === undefined ? undefined : 'trade-setup-error'
                }
              >
                <option value="">{t('create.chooseSetup')}</option>
                {(selectedStrategy?.setups ?? []).map((setup) => (
                  <option key={setup.setupId} value={setup.setupId}>
                    {setup.name}
                  </option>
                ))}
              </Select>
            </PlanField>
            {selectedStrategy !== undefined && selectedStrategy.setups.length === 0 ? (
              <p className="border-warning/30 bg-warning/10 rounded-md border p-3 text-sm">
                {t('prerequisite.noSetupDescription')}{' '}
                <Link
                  href={`/app/strategies?strategy=${selectedStrategy.strategyId}`}
                  className="text-primary inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
                >
                  {t('prerequisite.manageStrategies')}
                </Link>
              </p>
            ) : null}
          </fieldset>

          <div className="grid gap-5">
            <h3 className="text-label text-muted-foreground uppercase">
              {t('create.sections.context')}
            </h3>
            <div className="grid gap-5 sm:grid-cols-2">
              <TradeQuickSelectField
                id="trade-timeframe"
                label={t('field.timeframe')}
                value={values.timeframe}
                onChange={(value) => setField('timeframe', value)}
                favorites={timeframeFavorites.favorites}
                recents={timeframeFavorites.recents}
                suggestions={TIMEFRAME_QUICK_SUGGESTIONS}
                onToggleFavorite={timeframeFavorites.toggle}
                optional
              />
              <TradeQuickSelectField
                id="trade-session"
                label={t('field.session')}
                value={values.session}
                onChange={(value) => setField('session', value)}
                favorites={sessionFavorites.favorites}
                recents={sessionFavorites.recents}
                suggestions={SESSION_QUICK_SUGGESTIONS}
                onToggleFavorite={sessionFavorites.toggle}
                optional
              />
            </div>
          </div>

          <section aria-labelledby="trade-conditions-title" className="grid gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3
                  id="trade-conditions-title"
                  className="text-label text-muted-foreground uppercase"
                >
                  {t('create.sections.conditions')}
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  {t('create.conditions.description')}
                </p>
              </div>
              {conditionCount === 0 ? null : (
                <output className="text-sm font-medium" aria-live="polite">
                  {t('create.conditions.adherence', {
                    met: metConditionCount,
                    total: conditionCount,
                    percentage: conditionPercentage ?? 0,
                  })}
                </output>
              )}
            </div>
            {selectedSetup === undefined ? (
              <p className="border-border bg-muted/30 rounded-md border p-4 text-sm">
                {t('create.conditions.chooseSetup')}
              </p>
            ) : conditionCount === 0 ? (
              <p className="border-border bg-muted/30 rounded-md border p-4 text-sm">
                {t('create.conditions.notConfigured')}
              </p>
            ) : (
              <div className="grid gap-2">
                {selectedSetup.conditions.map((condition) => (
                  <label
                    key={condition.conditionKey}
                    className="border-border hover:bg-accent/40 flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={conditionMetByKey[condition.conditionKey] === true}
                      onChange={(event) =>
                        setConditionMetByKey((current) => ({
                          ...current,
                          [condition.conditionKey]: event.target.checked,
                        }))
                      }
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>{condition.label}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-3">
            <h3 className="text-label text-muted-foreground uppercase">
              {t('create.sections.confidence')}
            </h3>
            <TradeConfidenceControl
              id="trade-confidence"
              label={t('field.confidence')}
              value={confidenceNum ?? null}
              onChange={(next) => setField('confidence', next === null ? '' : String(next))}
            />
          </div>

          <fieldset className="grid gap-3">
            <legend className="text-label text-muted-foreground uppercase">
              {t('create.sections.emotions')}
            </legend>
            <p className="text-muted-foreground text-sm">{t('create.emotions.description')}</p>
            <div className="flex flex-wrap gap-2">
              {options.emotionCatalog.map((emotion) => {
                const selected = emotionKeys.includes(emotion.key);
                return (
                  <button
                    key={emotion.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      setEmotionKeys((current) =>
                        current.includes(emotion.key)
                          ? current.filter((key) => key !== emotion.key)
                          : [...current, emotion.key],
                      )
                    }
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground ring-primary/25 ring-2'
                        : 'border-border bg-card hover:bg-accent/50',
                    )}
                  >
                    {selected ? <Check aria-hidden="true" size={15} /> : null}
                    {t(`emotions.${emotion.key}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-3">
            <h3 className="text-label text-muted-foreground uppercase">
              {t('create.sections.entryReason')}
            </h3>
            <PlanField id="trade-confirmation" label={t('create.sections.entryReason')} optional>
              <Textarea
                id="trade-confirmation"
                value={values.confirmationNotes}
                onChange={(event) => setField('confirmationNotes', event.target.value)}
              />
            </PlanField>
          </div>

          <div className="grid gap-3">
            <h3 className="text-label text-muted-foreground uppercase">
              {t('create.sections.chart')}
            </h3>
            {options.chartUploadConfigured ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-pressed={chartTab === 'link'}
                  onClick={() => setChartTab('link')}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
                    chartTab === 'link'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <Link2 aria-hidden="true" size={14} />
                  {t('create.chart.linkOption')}
                </button>
                <button
                  type="button"
                  aria-pressed={chartTab === 'upload'}
                  onClick={() => setChartTab('upload')}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors',
                    chartTab === 'upload'
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <ImageIcon aria-hidden="true" size={14} />
                  {t('create.chart.uploadOption')}
                </button>
              </div>
            ) : null}
            {options.chartUploadConfigured && chartTab === 'upload' ? (
              <ChartUploadPanel
                t={t}
                state={uploadState}
                onFileSelected={(file) => void handleFileSelected(file)}
                onRemove={handleRemoveUpload}
              />
            ) : (
              <PlanField
                id="trade-tv"
                label={t('field.tradingViewUrl')}
                optional
                error={fieldError('tradingviewUrl')}
              >
                <Input
                  id="trade-tv"
                  type="url"
                  value={values.tradingviewUrl}
                  onChange={(event) => setField('tradingviewUrl', event.target.value)}
                  aria-invalid={fieldError('tradingviewUrl') !== undefined}
                  aria-describedby={
                    fieldError('tradingviewUrl') === undefined ? undefined : 'trade-tv-error'
                  }
                />
              </PlanField>
            )}
          </div>

          <details className="border-border rounded-md border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t('create.sections.notes')}
            </summary>
            <div className="mt-4">
              <PlanField id="trade-notes" label={t('field.notes')} optional>
                <Textarea
                  id="trade-notes"
                  value={values.notes}
                  onChange={(event) => setField('notes', event.target.value)}
                />
              </PlanField>
            </div>
          </details>
        </fieldset>

        <div className="flex justify-end border-t pt-5">
          <Button type="submit" disabled={isPending}>
            <Check aria-hidden="true" />
            {isPending ? t('create.creating') : t('create.saveTrade')}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmUnmetOpen} onOpenChange={setConfirmUnmetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('create.conditions.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('create.conditions.confirmDescription', {
                met: metConditionCount,
                unmet: conditionCount - metConditionCount,
                total: conditionCount,
                percentage: conditionPercentage ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm">{t('create.conditions.uncheckedSavedNotMet')}</p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>
              {t('create.conditions.goBack')}
            </AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={() => void submit(true)}>
              {t('create.conditions.confirmSave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function translateServerFieldError(
  message: string,
  t: ReturnType<typeof useTranslations<'trades'>>,
): string {
  const known: Record<string, string> = {
    invalid_risk_direction: t('validation.invalidRiskDirection'),
    zero_risk: t('validation.zeroRisk'),
    invalid_target_direction: t('validation.invalidTargetDirection'),
    invalid_tradingview_url: t('validation.invalidTradingViewUrl'),
    invalid_planned_risk: t('validation.invalidPlannedRisk'),
    invalid_planned_reward: t('validation.invalidPlannedReward'),
    must_be_positive: t('validation.invalidPlannedRisk'),
    incomplete_price_plan: t('validation.incompletePricePlan'),
    incomplete_money_plan: t('validation.incompleteMoneyPlan'),
    invalid_chart_attachment_key: t('validation.invalidChartAttachment'),
  };
  return known[message] ?? t('validation.invalidField');
}

function Select({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] ${className}`}
      {...props}
    />
  );
}

function PlanRepresentationToggle({
  title,
  isOpen,
  onOpen,
  onClose,
  addLabel,
  hideLabel,
  canClose,
  children,
}: {
  title: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  addLabel: string;
  hideLabel: string;
  canClose: boolean;
  children: React.ReactNode;
}) {
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="border-border text-muted-foreground hover:border-primary hover:text-primary inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md border border-dashed px-3 text-sm font-medium"
      >
        <Plus aria-hidden="true" size={14} />
        {addLabel}
      </button>
    );
  }
  return (
    <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        {canClose ? (
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline"
          >
            {hideLabel}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ChartUploadPanel({
  t,
  state,
  onFileSelected,
  onRemove,
}: {
  t: ReturnType<typeof useTranslations<'trades'>>;
  state: UploadState;
  onFileSelected: (file: File) => void;
  onRemove: () => void;
}) {
  if (state.status === 'uploaded') {
    return (
      <div className="flex flex-col items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object-URL preview of the selected File; the uploaded Blob itself is private and has no fetchable URL. */}
        <img
          src={state.previewObjectUrl}
          alt={t('create.chart.previewAlt')}
          className="border-border max-h-48 w-auto rounded-md border object-contain"
        />
        <Button type="button" variant="outline" size="sm" onClick={onRemove}>
          {t('create.chart.remove')}
        </Button>
      </div>
    );
  }
  return (
    <div className="border-border bg-muted/30 flex flex-col gap-2 rounded-md border border-dashed p-4">
      <Label htmlFor="trade-chart-upload">{t('create.chart.uploadLabel')}</Label>
      <input
        id="trade-chart-upload"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={state.status === 'uploading'}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) onFileSelected(file);
          event.target.value = '';
        }}
        aria-describedby="trade-chart-upload-hint"
        className="text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
      />
      <p id="trade-chart-upload-hint" className="text-muted-foreground text-xs">
        {t('create.chart.uploadHint')}
      </p>
      {state.status === 'uploading' ? (
        <p className="text-muted-foreground text-xs">{t('create.chart.uploading')}</p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert" className="text-destructive text-xs">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function DecimalField({
  id,
  field,
  label,
  values,
  setField,
  error,
  optional,
  hint,
}: {
  id: string;
  field:
    | 'plannedEntry'
    | 'plannedStop'
    | 'plannedTarget'
    | 'plannedPositionSize'
    | 'plannedRiskMinor'
    | 'plannedRewardMinor'
    | 'actualEntry'
    | 'actualInitialStop'
    | 'actualInitialRiskMinor'
    | 'actualPositionSize';
  label: string;
  values: Values;
  setField: <K extends keyof Values>(field: K, value: Values[K]) => void;
  error?: string | undefined;
  optional?: boolean | undefined;
  hint?: string | undefined;
}) {
  return (
    <PlanField id={id} label={label} optional={optional} hint={hint} error={error}>
      <Input
        id={id}
        inputMode="decimal"
        value={values[field]}
        onChange={(event) => setField(field, event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
    </PlanField>
  );
}
