'use client';

import { Check, HeartPulse, Lightbulb, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { composePlannedR, composeTraderCloseV2 } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
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

import { NativeSelect } from './trade-action-form';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { TradeConfidenceChoice } from './trade-confidence-choice';
import { datetimeLocalToIso, parseTradeMoneyInput } from './trade-form-values';
import { formatR, formatTradeMoney } from './trade-format';
import { TradeRecordingModeChange } from './trade-recording-mode-change';
import {
  ChoiceGroup,
  confidenceOf,
  Field,
  groupEmotionCatalog,
  JournalLauncher,
  SectionHeading,
} from './trade-recording-primitives';

type Basis = 'money' | 'price';
type Direction = '' | 'long' | 'short';
type ExitScope = '' | 'part' | 'all_remaining';
type Completeness = 'unknown' | 'incomplete' | 'complete';
type JournalArea = 'idea' | 'feelings';
type ErrorMap = Record<string, string>;

interface ExitDraft {
  readonly id: string;
  closedPercent: string;
  scope: ExitScope;
  value: string;
  exitedAt: string;
  reason: string;
}

interface Values {
  tradingAccountId: string;
  symbol: string;
  direction: Direction;
  enteredAt: string;
  exitedAt: string;
  strategyId: string;
  setupId: string;
  timeframe: string;
  session: string;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget: string;
  plannedPositionSize: string;
  plannedRisk: string;
  plannedReward: string;
  actualEntry: string;
  actualStop: string;
  actualPositionSize: string;
  actualRisk: string;
  finalPnl: string;
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
  confidence: string;
}

function emptyValues(tradingAccountId: string): Values {
  return {
    tradingAccountId,
    symbol: '',
    direction: '',
    enteredAt: '',
    exitedAt: '',
    strategyId: '',
    setupId: '',
    timeframe: '',
    session: '',
    plannedEntry: '',
    plannedStop: '',
    plannedTarget: '',
    plannedPositionSize: '',
    plannedRisk: '',
    plannedReward: '',
    actualEntry: '',
    actualStop: '',
    actualPositionSize: '',
    actualRisk: '',
    finalPnl: '',
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
    confidence: '',
  };
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

function meaningfulExit(exit: ExitDraft): boolean {
  return (
    exit.closedPercent.trim() !== '' ||
    exit.scope !== '' ||
    exit.value.trim() !== '' ||
    exit.exitedAt !== ''
  );
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
  const router = useRouter();
  const [mutationKey] = useState(generateId);
  const initialAccount =
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((item) => item.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '');
  const pristine = useMemo(() => emptyValues(initialAccount), [initialAccount]);
  const [values, setValues] = useState(pristine);
  const [planBasis, setPlanBasis] = useState<Basis>('money');
  const [actualBasis, setActualBasis] = useState<Basis>('money');
  const [exits, setExits] = useState<ExitDraft[]>([]);
  const [exitsOpen, setExitsOpen] = useState(false);
  const [editingExitId, setEditingExitId] = useState<string | null>(null);
  const [completeness, setCompleteness] = useState<Completeness>('unknown');
  const [conditionMet, setConditionMet] = useState<Record<string, boolean>>({});
  const [emotionKeys, setEmotionKeys] = useState<string[]>([]);
  const [feelingsRecorded, setFeelingsRecorded] = useState(false);
  const [journalArea, setJournalArea] = useState<JournalArea | null>(null);
  const [journalDraft, setJournalDraft] = useState({
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
    confidence: '',
    emotionKeys: [] as string[],
  });
  const ideaTrigger = useRef<HTMLButtonElement>(null);
  const feelingsTrigger = useRef<HTMLButtonElement>(null);
  const [errors, setErrors] = useState<ErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmUnmetOpen, setConfirmUnmetOpen] = useState(false);

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const selectedStrategy = options.strategies.find((item) => item.strategyId === values.strategyId);
  const selectedSetup = selectedStrategy?.setups.find((item) => item.setupId === values.setupId);
  const recordedExits = exits.filter(meaningfulExit);

  const setField = <K extends keyof Values>(field: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

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
    if (
      values.actualEntry.trim() === '' ||
      values.actualStop.trim() === '' ||
      priceExits.length === 0 ||
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

  const actualR =
    actualBasis === 'money' ? monetarySnapshot.actualR : (priceActual?.actualR ?? null);
  const outcome =
    actualBasis === 'money' ? monetarySnapshot.traderOutcome : (priceActual?.traderOutcome ?? null);
  const isDirty =
    recordedExits.length > 0 ||
    feelingsRecorded ||
    (Object.keys(pristine) as (keyof Values)[]).some((key) => values[key] !== pristine[key]);

  const emotionGroups = groupEmotionCatalog(options.emotionCatalog);

  function openJournal(area: JournalArea) {
    setJournalDraft({
      confirmationNotes: values.confirmationNotes,
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
      confidence: values.confidence,
      emotionKeys: [...emotionKeys],
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
      }));
    } else if (journalArea === 'feelings') {
      setValues((current) => ({ ...current, confidence: journalDraft.confidence }));
      setEmotionKeys(journalDraft.emotionKeys);
      setFeelingsRecorded(true);
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
      setFormError(r('validation.fixFields'));
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
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

    setPending(true);
    setFormError(null);
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
      symbol: values.symbol.trim().toUpperCase(),
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
      ...(confidenceOf(values.confidence) === undefined
        ? {}
        : { confidence: confidenceOf(values.confidence) }),
      ...(feelingsRecorded ? { emotionKeys } : {}),
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
      setFormError(t(`errors.${result.error.code}`));
      return;
    }
    router.push(`/app/trades?trade=${result.data.tradeId}&tab=review`);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
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
            : 'border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm'
        }
      >
        {formError ?? r('ready')}
      </div>

      <form
        data-after-trade-linear-form=""
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="grid min-w-0 gap-5"
      >
        <section className="border-border bg-card grid min-w-0 gap-5 rounded-xl border p-4 sm:p-6">
          <SectionHeading
            number="1"
            title={a('trade.title')}
            description={a('trade.description')}
          />
          <div className="grid min-w-0 gap-5 sm:grid-cols-3">
            <div className="grid min-w-0 gap-1.5 sm:col-span-2">
              <label htmlFor="after-account" className="text-sm font-medium">
                {t('field.account')}
              </label>
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
              {errors.tradingAccountId === undefined ? null : (
                <p id="after-account-error" role="alert" className="text-destructive text-sm">
                  {errors.tradingAccountId}
                </p>
              )}
            </div>
            <Field
              id="after-symbol"
              label={t('field.symbol')}
              value={values.symbol}
              onChange={(value) => setField('symbol', value.toUpperCase())}
              error={errors.symbol}
              placeholder="XAUUSD"
            />
          </div>
          <ChoiceGroup
            legend={t('field.direction')}
            name="after-direction"
            value={values.direction}
            onChange={(value) => setField('direction', value)}
            error={errors.direction}
            options={[
              { value: 'long', label: t('direction.long') },
              { value: 'short', label: t('direction.short') },
            ]}
          />
          <p className="text-muted-foreground -mb-3 text-xs">{a('trade.timezone', { timezone })}</p>
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field
              id="after-entered-at"
              type="datetime-local"
              label={a('trade.entryTime')}
              value={values.enteredAt}
              onChange={(value) => setField('enteredAt', value)}
              error={errors.enteredAt}
              optional
            />
            <Field
              id="after-exited-at"
              type="datetime-local"
              label={a('trade.finalExitTime')}
              value={values.exitedAt}
              onChange={(value) => setField('exitedAt', value)}
              error={errors.exitedAt}
              optional
            />
          </div>
        </section>

        <section className="border-border bg-card grid min-w-0 gap-5 rounded-xl border p-4 sm:p-6">
          <SectionHeading number="2" title={a('plan.title')} description={a('plan.description')} />
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor="after-strategy" className="text-sm font-medium">
                {t('field.strategy')}{' '}
                <span className="text-muted-foreground font-normal">· optional</span>
              </label>
              <NativeSelect
                id="after-strategy"
                value={values.strategyId}
                onChange={(event) => {
                  setField('strategyId', event.target.value);
                  setField('setupId', '');
                  setConditionMet({});
                }}
              >
                <option value="">{t('create.chooseStrategy')}</option>
                {options.strategies.map((strategy) => (
                  <option key={strategy.strategyId} value={strategy.strategyId}>
                    {strategy.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor="after-setup" className="text-sm font-medium">
                {t('field.setup')}{' '}
                <span className="text-muted-foreground font-normal">· optional</span>
              </label>
              <NativeSelect
                id="after-setup"
                value={values.setupId}
                disabled={selectedStrategy === undefined}
                onChange={(event) => {
                  setField('setupId', event.target.value);
                  setConditionMet({});
                }}
              >
                <option value="">{t('create.chooseSetup')}</option>
                {(selectedStrategy?.setups ?? []).map((setup) => (
                  <option key={setup.setupId} value={setup.setupId}>
                    {setup.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {selectedSetup?.conditions.length ? (
            <details className="border-border rounded-lg border px-3 py-2">
              <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer items-center text-sm font-medium outline-none focus-visible:ring-2">
                {a('plan.setupChecklist')}
              </summary>
              <fieldset className="grid gap-2 pb-2">
                <legend className="text-muted-foreground mb-1 text-xs">
                  {a('plan.setupHint')}
                </legend>
                {selectedSetup.conditions.map((condition) => (
                  <label
                    key={condition.conditionKey}
                    className="flex min-h-11 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={conditionMet[condition.conditionKey] === true}
                      onChange={(event) =>
                        setConditionMet((current) => ({
                          ...current,
                          [condition.conditionKey]: event.target.checked,
                        }))
                      }
                    />
                    {condition.label}
                  </label>
                ))}
              </fieldset>
            </details>
          ) : null}
          <ChoiceGroup
            legend={a('plan.basis')}
            name="after-plan-basis"
            value={planBasis}
            onChange={setPlanBasis}
            options={[
              { value: 'money', label: r('money') },
              { value: 'price', label: r('price') },
            ]}
          />
          {planBasis === 'money' ? (
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id="after-planned-risk"
                label={a('plan.plannedRisk')}
                value={values.plannedRisk}
                onChange={(value) => setField('plannedRisk', value)}
                error={errors.plannedRisk}
                inputMode="decimal"
                hint={currency}
                optional
              />
              <Field
                id="after-planned-reward"
                label={a('plan.targetProfit')}
                value={values.plannedReward}
                onChange={(value) => setField('plannedReward', value)}
                error={errors.plannedReward}
                inputMode="decimal"
                hint={currency}
                optional
              />
            </div>
          ) : (
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id="after-plan-entry"
                label={r('plannedEntry')}
                value={values.plannedEntry}
                onChange={(value) => setField('plannedEntry', value)}
                error={errors.plannedEntry}
                optional
              />
              <Field
                id="after-plan-stop"
                label={r('plannedStop')}
                value={values.plannedStop}
                onChange={(value) => setField('plannedStop', value)}
                error={errors.plannedStop}
                optional
              />
              <Field
                id="after-plan-target"
                label={r('takeProfit')}
                value={values.plannedTarget}
                onChange={(value) => setField('plannedTarget', value)}
                optional
              />
              <Field
                id="after-plan-size"
                label={t('field.positionSizeSimple')}
                value={values.plannedPositionSize}
                onChange={(value) => setField('plannedPositionSize', value)}
                optional
              />
            </div>
          )}
          {plannedPreview?.ok && plannedPreview.value.plannedR !== null ? (
            <div className="border-border flex min-w-0 items-baseline justify-between gap-3 border-t pt-3">
              <span className="text-muted-foreground text-sm">{a('plan.targetR')}</span>
              <strong className="numeric">{formatR(plannedPreview.value.plannedR)}</strong>
            </div>
          ) : null}
          <div className="grid min-w-0 gap-5 sm:grid-cols-2">
            <Field
              id="after-timeframe"
              label={t('field.timeframe')}
              value={values.timeframe}
              onChange={(value) => setField('timeframe', value)}
              optional
            />
            <Field
              id="after-session"
              label={t('field.session')}
              value={values.session}
              onChange={(value) => setField('session', value)}
              optional
            />
          </div>
        </section>

        <section
          className="border-primary/50 bg-card ring-primary/10 grid min-w-0 gap-5 rounded-xl border-2 p-4 ring-4 sm:p-6"
          data-actual-result=""
        >
          <SectionHeading
            number="3"
            title={a('actual.title')}
            description={a('actual.description')}
            strong
          />
          <ChoiceGroup
            legend={r('actualResultBy')}
            name="after-actual-basis"
            value={actualBasis}
            onChange={(basis) => {
              setActualBasis(basis);
              setErrors({});
            }}
            options={[
              { value: 'money', label: r('money'), description: a('actual.moneyHint') },
              { value: 'price', label: r('price'), description: a('actual.priceHint') },
            ]}
          />
          {actualBasis === 'money' ? (
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id="after-final-pnl"
                label={a('actual.finalPnl')}
                value={values.finalPnl}
                onChange={(value) => setField('finalPnl', value)}
                error={errors.finalPnl}
                inputMode="decimal"
                hint={a('actual.finalPnlHint', { currency })}
                optional
              />
              <Field
                id="after-actual-risk"
                label={a('actual.risk')}
                value={values.actualRisk}
                onChange={(value) => setField('actualRisk', value)}
                error={errors.actualRisk}
                inputMode="decimal"
                hint={a('actual.riskHint', { currency })}
                optional
              />
            </div>
          ) : (
            <div className="grid min-w-0 gap-5 sm:grid-cols-3">
              <Field
                id="after-actual-entry"
                label={r('actualEntry')}
                value={values.actualEntry}
                onChange={(value) => setField('actualEntry', value)}
                error={errors.actualEntry}
                optional
              />
              <Field
                id="after-actual-stop"
                label={r('actualInitialStop')}
                value={values.actualStop}
                onChange={(value) => setField('actualStop', value)}
                error={errors.actualStop}
                optional
              />
              <Field
                id="after-actual-size"
                label={t('field.actualPositionSize')}
                value={values.actualPositionSize}
                onChange={(value) => setField('actualPositionSize', value)}
                optional
              />
            </div>
          )}

          <div
            className="bg-muted/40 grid min-w-0 gap-3 rounded-xl p-4 sm:grid-cols-2"
            data-result-summary=""
          >
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs font-medium">{a('actual.outcome')}</p>
              <p className="text-xl font-semibold">
                {outcome === null
                  ? a('actual.unknown')
                  : r(`outcome.${outcome === 'break_even' ? 'breakEven' : outcome}`)}
              </p>
            </div>
            <div className="min-w-0 sm:text-right">
              <p className="text-muted-foreground text-xs font-medium">{r('actualR')}</p>
              <p className="numeric text-xl font-semibold">
                {actualR === null ? a('actual.unavailable') : formatR(actualR)}
              </p>
              {actualBasis === 'money' && parsedFinal?.ok && !parsedRisk?.ok ? (
                <p className="text-muted-foreground text-xs">{a('actual.rNeedsRisk')}</p>
              ) : null}
            </div>
          </div>

          <div className="grid min-w-0 gap-3 border-t pt-4">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{a('exits.title')}</h3>
                <p className="text-muted-foreground text-xs">{a('exits.description')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                aria-expanded={exitsOpen}
                aria-controls="after-exit-reconstruction"
                onClick={() => {
                  setExitsOpen((current) => !current);
                  if (exitsOpen) setEditingExitId(null);
                }}
              >
                {exitsOpen ? a('exits.hide') : a('exits.addDetails')}
              </Button>
            </div>
            {exitsOpen ? (
              <div id="after-exit-reconstruction" className="grid min-w-0 gap-3">
                {exits.length === 0 ? (
                  <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
                    {a('exits.empty')}
                  </p>
                ) : null}
                <ol className="grid min-w-0 gap-3">
                  {exits.map((exit, index) => (
                    <li key={exit.id} className="border-border min-w-0 rounded-lg border">
                      {editingExitId === exit.id ? (
                        <ExitEditor
                          exit={exit}
                          index={index}
                          actualBasis={actualBasis}
                          currency={currency}
                          timezone={timezone}
                          errors={errors}
                          onChange={(patch) =>
                            setExits((current) =>
                              current.map((item) =>
                                item.id === exit.id ? { ...item, ...patch } : item,
                              ),
                            )
                          }
                          onRemove={() => {
                            setExits((current) => current.filter((item) => item.id !== exit.id));
                            setEditingExitId(null);
                          }}
                          onDone={() => setEditingExitId(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="hover:bg-accent focus-visible:ring-ring flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2"
                          onClick={() => setEditingExitId(exit.id)}
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">
                              {a('exits.exitNumber', { number: index + 1 })}
                            </span>
                            <span className="text-muted-foreground block truncate text-xs">
                              {exit.value.trim() === '' ? a('exits.sparse') : exit.value}
                            </span>
                          </span>
                          <span className="text-primary text-sm">{a('exits.edit')}</span>
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 justify-self-start"
                  onClick={() => {
                    const exit = blankExit();
                    setExits((current) => [...current, exit]);
                    setEditingExitId(exit.id);
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {a('exits.add')}
                </Button>

                {recordedExits.length === 0 ? null : (
                  <fieldset className="grid min-w-0 gap-2 rounded-lg border p-3">
                    <legend className="px-1 text-sm font-medium">{a('exits.completeness')}</legend>
                    <div className="grid min-w-0 gap-2 sm:grid-cols-3">
                      {(['unknown', 'incomplete', 'complete'] as const).map((value) => (
                        <label
                          key={value}
                          className="hover:bg-accent flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2"
                        >
                          <input
                            type="radio"
                            name="after-exit-completeness"
                            value={value}
                            checked={completeness === value}
                            onChange={() => setCompleteness(value)}
                            className="mt-0.5 size-4 shrink-0"
                          />
                          <span className="text-sm">{a(`exits.completenessOptions.${value}`)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                <ReconciliationSummary
                  currency={currency}
                  finalMinor={parsedFinal?.ok ? parsedFinal.value : null}
                  subtotalMinor={monetarySnapshot.exitSubtotalMinor?.toString() ?? null}
                  reconciliation={
                    actualBasis === 'money' ? monetarySnapshot.reconciliation : 'not_applicable'
                  }
                  canAdoptAfterSave={
                    actualBasis === 'money' && monetarySnapshot.canAdoptExitSubtotal
                  }
                  error={errors.exits}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section className="border-border bg-card grid min-w-0 gap-4 rounded-xl border p-4 sm:p-6">
          <SectionHeading
            number="4"
            title={a('journal.title')}
            description={a('journal.description')}
          />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <JournalLauncher
              ref={ideaTrigger}
              icon={<Lightbulb className="size-5" aria-hidden="true" />}
              label={a('journal.idea.label')}
              prompt={a('journal.idea.prompt')}
              summary={values.confirmationNotes.trim() || null}
              onClick={() => openJournal('idea')}
            />
            <JournalLauncher
              ref={feelingsTrigger}
              icon={<HeartPulse className="size-5" aria-hidden="true" />}
              label={a('journal.feelings.label')}
              prompt={a('journal.feelings.prompt')}
              summary={
                feelingsRecorded
                  ? a('journal.feelings.summary', {
                      count: emotionKeys.length,
                      confidence: values.confidence || a('journal.notRecorded'),
                    })
                  : null
              }
              onClick={() => openJournal('feelings')}
            />
          </div>
        </section>

        <div
          data-global-save=""
          data-suppressed={editingExitId === null ? undefined : ''}
          className={cn(
            'border-border bg-card/95 pb-safe sticky bottom-0 z-10 rounded-xl border px-4 backdrop-blur-sm sm:static sm:px-6 sm:backdrop-blur-none',
            editingExitId !== null && 'hidden',
          )}
        >
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">{a('save.helper')}</p>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
              {pending ? r('saving') : a('save.action')}
            </Button>
          </div>
        </div>
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
            <Button type="button" variant="outline" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {a('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="after-idea" className="text-sm font-medium">
              {a('journal.idea.prompt')}
            </label>
            <Textarea
              id="after-idea"
              value={journalDraft.confirmationNotes}
              onChange={(event) =>
                setJournalDraft((current) => ({
                  ...current,
                  confirmationNotes: event.target.value,
                }))
              }
            />
          </div>
          <Field
            id="after-chart-link"
            label={r('chartLink')}
            value={journalDraft.tradingviewUrl}
            onChange={(value) =>
              setJournalDraft((current) => ({ ...current, tradingviewUrl: value }))
            }
            optional
          />
          <div className="grid gap-1.5">
            <label htmlFor="after-notes" className="text-sm font-medium">
              {a('journal.idea.notes')}
            </label>
            <Textarea
              id="after-notes"
              value={journalDraft.notes}
              onChange={(event) =>
                setJournalDraft((current) => ({ ...current, notes: event.target.value }))
              }
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
            <Button type="button" variant="outline" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {a('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="grid min-w-0 gap-5">
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
          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold">{a('journal.feelings.emotions')}</legend>
            {emotionGroups.map((group) => (
              <div key={group.key} data-after-emotion-group={group.key} className="grid gap-2">
                <p className="text-muted-foreground text-xs font-medium">
                  {r(`emotionGroups.${group.key}`)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.emotions.map((emotion) => {
                    const selected = journalDraft.emotionKeys.includes(emotion.key);
                    return (
                      <button
                        key={emotion.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() =>
                          setJournalDraft((current) => ({
                            ...current,
                            emotionKeys: selected
                              ? current.emotionKeys.filter((key) => key !== emotion.key)
                              : [...current.emotionKeys, emotion.key],
                          }))
                        }
                        className={cn(
                          'focus-visible:ring-ring min-h-11 rounded-full border px-4 text-sm outline-none focus-visible:ring-2',
                          selected
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-accent',
                        )}
                      >
                        {emotion.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
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

function ExitEditor({
  exit,
  index,
  actualBasis,
  currency,
  timezone,
  errors,
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
  onChange: (patch: Partial<ExitDraft>) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const a = useTranslations('trades.create.recording.after');
  const r = useTranslations('trades.create.recording');
  return (
    <div data-exit-editor="" className="bg-muted/20 grid min-w-0 gap-4 p-3">
      <h4 className="text-sm font-semibold">{a('exits.exitNumber', { number: index + 1 })}</h4>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field
          id={`exit-${exit.id}-value`}
          label={actualBasis === 'money' ? r('realizedPnl') : r('exitPrice')}
          value={exit.value}
          onChange={(value) => onChange({ value })}
          error={errors[`exit-${exit.id}-value`]}
          inputMode="decimal"
          hint={actualBasis === 'money' ? currency : undefined}
          optional
        />
        <Field
          id={`exit-${exit.id}-percent`}
          label={r('closedPercent')}
          value={exit.closedPercent}
          onChange={(closedPercent) => onChange({ closedPercent })}
          error={errors[`exit-${exit.id}-percent`]}
          inputMode="decimal"
          optional
        />
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor={`exit-${exit.id}-scope`} className="text-sm font-medium">
            {a('exits.scope')} <span className="text-muted-foreground font-normal">· optional</span>
          </label>
          <NativeSelect
            id={`exit-${exit.id}-scope`}
            value={exit.scope}
            onChange={(event) => onChange({ scope: event.target.value as ExitScope })}
          >
            <option value="">{a('exits.scopeOptions.unknown')}</option>
            <option value="part">{a('exits.scopeOptions.part')}</option>
            <option value="all_remaining">{a('exits.scopeOptions.allRemaining')}</option>
          </NativeSelect>
        </div>
        <Field
          id={`exit-${exit.id}-time`}
          type="datetime-local"
          label={r('exitTime')}
          value={exit.exitedAt}
          onChange={(exitedAt) => onChange({ exitedAt })}
          error={errors[`exit-${exit.id}-time`]}
          hint={timezone}
          optional
        />
      </div>
      <Field
        id={`exit-${exit.id}-reason`}
        label={a('exits.reason')}
        value={exit.reason}
        onChange={(reason) => onChange({ reason })}
        optional
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onRemove} className="text-muted-foreground">
          <Trash2 className="size-4" aria-hidden="true" />
          {a('exits.remove')}
        </Button>
        <Button type="button" onClick={onDone}>
          <Check className="size-4" aria-hidden="true" />
          {a('exits.done')}
        </Button>
      </div>
    </div>
  );
}

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
        'grid min-w-0 gap-2 rounded-lg border p-3',
        reconciliation === 'conflict'
          ? 'border-warning/50 bg-warning/5'
          : 'border-border bg-muted/30',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">{a('exits.subtotal')}</span>
        <strong className="numeric break-all">
          {signedMoney(subtotalMinor, currency) ?? a('actual.unavailable')}
        </strong>
      </div>
      <p className="text-sm">
        {a(`exits.reconciliation.${reconciliation}`, {
          final: signedMoney(finalMinor, currency) ?? a('actual.unknown'),
        })}
      </p>
      {canAdoptAfterSave ? (
        <p className="text-muted-foreground text-xs">{a('exits.adoptAfterSave')}</p>
      ) : null}
      {error === undefined ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
