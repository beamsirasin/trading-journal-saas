'use client';

import { Check, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { composePlannedR, composeTraderCloseV2 } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
import { isConfidenceStep, type ConfidenceStep } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { createCompletedTradeAction, createTradeAction } from '@/server/actions/trades';
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
import { Textarea } from '@/components/ui/textarea';
import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { useRouter } from '@/i18n/navigation';

import { TradeConfidenceControl } from './trade-confidence-control';
import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
} from './trade-form-values';
import { formatR } from './trade-format';
import { PlanField } from './trade-plan-field';

type Timing = 'at_entry' | 'after_trade';
type Basis = 'price' | 'money';
type Panel = 'trade' | 'result' | 'setup' | 'context';
type Direction = '' | 'long' | 'short';
type SystemChoice = 'pending' | 'target' | 'stop' | 'break_even' | 'custom' | 'no_trade';
type ErrorMap = Record<string, string>;

interface Values {
  tradingAccountId: string;
  symbol: string;
  direction: Direction;
  enteredAt: string;
  exitedAt: string;
  plannedEntry: string;
  plannedStop: string;
  plannedTarget: string;
  plannedPositionSize: string;
  plannedRisk: string;
  plannedReward: string;
  actualEntry: string;
  actualStop: string;
  actualRisk: string;
  actualPositionSize: string;
  simpleExit: string;
  strategyId: string;
  setupId: string;
  timeframe: string;
  session: string;
  confidence: string;
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
  customSystemExit: string;
  customSystemR: string;
}

interface ExitDraft {
  id: string;
  closedPercent: string;
  value: string;
  exitedAt: string;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'border-input bg-surface-raised ring-offset-background focus-visible:ring-ring min-h-11 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none',
        props.className,
      )}
    />
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="bg-surface border-border grid grid-cols-2 gap-1 rounded-lg border p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 rounded-md px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
            value === option.value
              ? 'bg-primary/12 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  optional,
  type = 'text',
  hint,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  optional?: boolean | undefined;
  type?: string | undefined;
  hint?: string | undefined;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <PlanField id={id} label={label} error={error} optional={optional} hint={hint}>
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : `${id}-error`}
      />
    </PlanField>
  );
}

function parseConfidence(value: string): ConfidenceStep | undefined {
  const parsed = Number.parseInt(value, 10);
  return isConfidenceStep(parsed) ? parsed : undefined;
}

function outcomeKey(value: 'win' | 'loss' | 'break_even') {
  return value === 'break_even' ? 'breakEven' : value;
}

export function TradeRecordingForm({
  options,
  timezone,
}: {
  options: TradeCreateOptions;
  timezone: string;
}) {
  const t = useTranslations('trades');
  const r = useTranslations('trades.create.recording');
  const router = useRouter();
  const hydrated = useIsHydrated();
  const [mutationKey] = useState(generateId);
  const [timing, setTiming] = useState<Timing>('at_entry');
  const [panel, setPanel] = useState<Panel>('trade');
  const [planBasis, setPlanBasis] = useState<Basis>('price');
  const [actualBasis, setActualBasis] = useState<Basis>('price');
  const [advancedOpening, setAdvancedOpening] = useState(false);
  const [openingBasis, setOpeningBasis] = useState<Basis>('price');
  const [partialExits, setPartialExits] = useState(false);
  const [systemChoice, setSystemChoice] = useState<SystemChoice>('pending');
  const [errors, setErrors] = useState<ErrorMap>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmUnmetOpen, setConfirmUnmetOpen] = useState(false);
  const [contextVisited, setContextVisited] = useState(false);
  const [emotionKeys, setEmotionKeys] = useState<string[]>([]);
  const [conditionMet, setConditionMet] = useState<Record<string, boolean>>({});
  const [exits, setExits] = useState<ExitDraft[]>([
    { id: generateId(), closedPercent: '50', value: '', exitedAt: '' },
    { id: generateId(), closedPercent: '50', value: '', exitedAt: '' },
  ]);
  const initialAccount =
    options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '';
  const [values, setValues] = useState<Values>({
    tradingAccountId: initialAccount,
    symbol: '',
    direction: '',
    enteredAt: '',
    exitedAt: '',
    plannedEntry: '',
    plannedStop: '',
    plannedTarget: '',
    plannedPositionSize: '',
    plannedRisk: '',
    plannedReward: '',
    actualEntry: '',
    actualStop: '',
    actualRisk: '',
    actualPositionSize: '',
    simpleExit: '',
    strategyId: '',
    setupId: '',
    timeframe: '',
    session: '',
    confidence: '',
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
    customSystemExit: '',
    customSystemR: '',
  });

  const defaultEnteredAt = hydrated
    ? instantToDatetimeLocal(new Date().toISOString(), timezone)
    : '';
  const enteredAtValue = values.enteredAt === '' ? defaultEnteredAt : values.enteredAt;

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const selectedStrategy = options.strategies.find((item) => item.strategyId === values.strategyId);
  const selectedSetup = selectedStrategy?.setups.find((item) => item.setupId === values.setupId);
  const conditionCount = selectedSetup?.conditions.length ?? 0;
  const metConditionCount = (selectedSetup?.conditions ?? []).filter(
    (condition) => conditionMet[condition.conditionKey] === true,
  ).length;
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const setField = <K extends keyof Values>(field: K, value: Values[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  function changeTiming(next: Timing) {
    setTiming(next);
    setPanel('trade');
    setErrors({});
    setFormError(null);
    setAdvancedOpening(false);
    setOpeningBasis(planBasis);
    setActualBasis('price');
    setPartialExits(false);
    setSystemChoice('pending');
    setExits([
      { id: generateId(), closedPercent: '50', value: '', exitedAt: '' },
      { id: generateId(), closedPercent: '50', value: '', exitedAt: '' },
    ]);
    setValues((current) => ({
      ...current,
      exitedAt: '',
      actualEntry: '',
      actualStop: '',
      actualRisk: '',
      actualPositionSize: '',
      simpleExit: '',
      customSystemExit: '',
      customSystemR: '',
    }));
  }

  function changePlanBasis(next: Basis) {
    setPlanBasis(next);
    setSystemChoice('pending');
    setValues((current) => ({
      ...current,
      plannedEntry: '',
      plannedStop: '',
      plannedTarget: '',
      plannedPositionSize: '',
      plannedRisk: '',
      plannedReward: '',
      customSystemExit: '',
      customSystemR: '',
    }));
  }

  function changeActualBasis(next: Basis) {
    setActualBasis(next);
    setPartialExits(false);
    setValues((current) => ({
      ...current,
      actualEntry: '',
      actualStop: '',
      actualRisk: '',
      actualPositionSize: '',
      simpleExit: '',
    }));
    setExits([
      { id: generateId(), closedPercent: '50', value: '', exitedAt: '' },
      { id: generateId(), closedPercent: '50', value: '', exitedAt: '' },
    ]);
  }

  const parsedPlanMoney = useMemo(() => {
    const risk =
      values.plannedRisk.trim() === ''
        ? null
        : parseTradeMoneyInput(values.plannedRisk, currency, { allowZero: false });
    const reward =
      values.plannedReward.trim() === ''
        ? null
        : parseTradeMoneyInput(values.plannedReward, currency, { allowZero: true });
    return { risk, reward };
  }, [currency, values.plannedReward, values.plannedRisk]);

  const plannedPreview = useMemo(() => {
    if (values.direction === '') return null;
    return composePlannedR({
      direction: values.direction,
      plannedEntry:
        planBasis === 'price' && values.plannedEntry.trim() !== ''
          ? values.plannedEntry.trim()
          : null,
      plannedStop:
        planBasis === 'price' && values.plannedStop.trim() !== ''
          ? values.plannedStop.trim()
          : null,
      plannedTarget:
        planBasis === 'price' && values.plannedTarget.trim() !== ''
          ? values.plannedTarget.trim()
          : null,
      plannedRiskMinor:
        planBasis === 'money' && parsedPlanMoney.risk?.ok
          ? BigInt(parsedPlanMoney.risk.value)
          : null,
      plannedRewardMinor:
        planBasis === 'money' && parsedPlanMoney.reward?.ok
          ? BigInt(parsedPlanMoney.reward.value)
          : null,
    });
  }, [
    parsedPlanMoney,
    planBasis,
    values.direction,
    values.plannedEntry,
    values.plannedStop,
    values.plannedTarget,
  ]);

  const actualPreview = useMemo(() => {
    if (timing !== 'after_trade' || values.direction === '') return null;
    const legs = partialExits ? exits : [{ closedPercent: '100', value: values.simpleExit }];
    const actualRisk =
      values.actualRisk.trim() === ''
        ? null
        : parseTradeMoneyInput(values.actualRisk, currency, { allowZero: false });
    const parsedLegs = legs.map((leg) => {
      if (actualBasis === 'price')
        return { closedBps: Number(leg.closedPercent) * 100, exitPrice: leg.value.trim() };
      const money = parseTradeMoneyInput(leg.value, currency, {
        allowNegative: true,
        allowZero: true,
      });
      return {
        closedBps: Number(leg.closedPercent) * 100,
        realizedPnlMinor: money.ok ? BigInt(money.value) : null,
      };
    });
    return composeTraderCloseV2({
      actualResultMode: actualBasis,
      direction: values.direction,
      actualEntry: actualBasis === 'price' ? values.actualEntry : null,
      actualInitialStop: actualBasis === 'price' ? values.actualStop : null,
      actualInitialRiskMinor:
        actualBasis === 'money' && actualRisk?.ok ? BigInt(actualRisk.value) : null,
      exits: parsedLegs,
    });
  }, [
    actualBasis,
    currency,
    exits,
    partialExits,
    timing,
    values.actualEntry,
    values.actualRisk,
    values.actualStop,
    values.direction,
    values.simpleExit,
  ]);

  const targetAvailable =
    planBasis === 'price' ? values.plannedTarget.trim() !== '' : values.plannedReward.trim() !== '';
  const panels: Panel[] =
    timing === 'at_entry' ? ['trade', 'setup', 'context'] : ['trade', 'result', 'setup', 'context'];

  function openPanel(next: Panel) {
    setPanel(next);
    if (next === 'context') setContextVisited(true);
  }

  function validateBase(): ErrorMap {
    const next: ErrorMap = {};
    if (values.tradingAccountId === '') next.tradingAccountId = t('validation.requiredAccount');
    if (values.symbol.trim() === '') next.symbol = t('validation.requiredSymbol');
    if (values.direction === '') next.direction = t('validation.requiredDirection');
    if (enteredAtValue === '') next.enteredAt = r('validation.enteredAt');
    if (planBasis === 'price') {
      if (values.plannedEntry.trim() === '') next.plannedEntry = t('validation.requiredEntry');
      if (values.plannedStop.trim() === '') next.plannedStop = t('validation.requiredStop');
    } else if (values.plannedRisk.trim() === '') next.plannedRisk = r('validation.plannedRisk');
    if (planBasis === 'money' && parsedPlanMoney.risk !== null && !parsedPlanMoney.risk.ok)
      next.plannedRisk = t('lifecycle.validation.money');
    if (planBasis === 'money' && parsedPlanMoney.reward !== null && !parsedPlanMoney.reward.ok)
      next.plannedReward = t('lifecycle.validation.money');
    if (values.setupId !== '' && values.strategyId === '')
      next.setupId = t('validation.setupRequiresStrategy');
    return next;
  }

  function mapServerErrors(result: {
    error: { code: string; fieldErrors?: Readonly<Record<string, readonly string[]>> };
  }) {
    const mapped: ErrorMap = {};
    for (const [field, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      mapped[field] =
        messages[0] === undefined ? t('validation.invalidField') : r('validation.invalidField');
    }
    setErrors(mapped);
    setFormError(t(`errors.${result.error.code}`));
    const resultFields = [
      'actualEntry',
      'actualInitialStop',
      'actualInitialRiskMinor',
      'exits',
      'exitedAt',
    ];
    if (Object.keys(mapped).some((key) => resultFields.includes(key))) setPanel('result');
    else setPanel('trade');
  }

  async function submit(unmetConfirmed = false) {
    const next = validateBase();
    const entered = datetimeLocalToIso(enteredAtValue, timezone);
    if (!entered.ok) next.enteredAt = t('lifecycle.validation.time');
    if (timing === 'after_trade') {
      const exited = datetimeLocalToIso(values.exitedAt, timezone);
      if (!exited.ok) next.exitedAt = t('lifecycle.validation.time');
      else if (entered.ok && exited.value < entered.value)
        next.exitedAt = r('validation.exitBeforeEntry');
      if (actualBasis === 'price') {
        if (values.actualEntry.trim() === '') next.actualEntry = r('validation.actualEntry');
        if (values.actualStop.trim() === '') next.actualStop = r('validation.actualStop');
      } else if (values.actualRisk.trim() === '') next.actualRisk = r('validation.actualRisk');
      if (!partialExits && values.simpleExit.trim() === '')
        next.simpleExit = r(
          actualBasis === 'price' ? 'validation.exitPrice' : 'validation.realizedPnl',
        );
      if (partialExits) {
        const total = exits.reduce((sum, leg) => sum + Number(leg.closedPercent || '0'), 0);
        if (total !== 100) next.exits = r('validation.exitTotal');
        if (exits.some((leg) => leg.value.trim() === '')) next.exits = r('validation.exitValues');
      }
      if (actualPreview === null || !actualPreview.ok)
        next.actualResult = r('validation.actualResult');
      if (systemChoice === 'target' && !targetAvailable)
        next.systemChoice = r('validation.targetUnavailable');
      if (
        systemChoice === 'custom' &&
        (planBasis === 'price' ? values.customSystemExit : values.customSystemR).trim() === ''
      )
        next.systemChoice = r('validation.customSystem');
    } else if (advancedOpening) {
      if (openingBasis === 'price') {
        if (values.actualEntry.trim() === '') next.actualEntry = r('validation.actualEntry');
        if (values.actualStop.trim() === '') next.actualStop = r('validation.actualStop');
      } else if (values.actualRisk.trim() === '') next.actualRisk = r('validation.actualRisk');
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      setFormError(r('validation.fixFields'));
      if (
        Object.keys(next).some((key) =>
          [
            'actualEntry',
            'actualStop',
            'actualRisk',
            'simpleExit',
            'exits',
            'actualResult',
            'systemChoice',
            'exitedAt',
          ].includes(key),
        )
      )
        setPanel('result');
      else setPanel('trade');
      return;
    }

    const conditionAnswers = (selectedSetup?.conditions ?? []).map((condition) => ({
      conditionKey: condition.conditionKey,
      status:
        conditionMet[condition.conditionKey] === true ? ('met' as const) : ('not_met' as const),
    }));
    if (!unmetConfirmed && conditionAnswers.some((answer) => answer.status === 'not_met')) {
      setConfirmUnmetOpen(true);
      return;
    }

    const plannedRiskMinor = parsedPlanMoney.risk?.ok ? parsedPlanMoney.risk.value : null;
    const plannedRewardMinor = parsedPlanMoney.reward?.ok ? parsedPlanMoney.reward.value : null;
    const common = {
      mutationKey,
      tradingAccountId: values.tradingAccountId,
      systemPlanBasis: planBasis,
      ...(values.strategyId === '' ? {} : { strategyId: values.strategyId }),
      ...(values.setupId === '' ? {} : { setupId: values.setupId }),
      ...(selectedSetup === undefined
        ? {}
        : { conditionSetToken: selectedSetup.conditionSetToken, conditionAnswers }),
      symbol: values.symbol.trim().toUpperCase(),
      direction: values.direction,
      plannedEntry: planBasis === 'price' ? values.plannedEntry.trim() : null,
      plannedStop: planBasis === 'price' ? values.plannedStop.trim() : null,
      plannedTarget:
        planBasis === 'price' && values.plannedTarget.trim() !== ''
          ? values.plannedTarget.trim()
          : null,
      plannedPositionSize:
        planBasis === 'price' && values.plannedPositionSize.trim() !== ''
          ? values.plannedPositionSize.trim()
          : null,
      plannedRiskMinor: planBasis === 'money' ? plannedRiskMinor : null,
      plannedRewardMinor: planBasis === 'money' ? plannedRewardMinor : null,
      timeframe: values.timeframe,
      session: values.session,
      confirmationNotes: values.confirmationNotes,
      ...(parseConfidence(values.confidence) === undefined
        ? {}
        : { confidence: parseConfidence(values.confidence) }),
      ...(contextVisited ? { emotionKeys } : {}),
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
      chartAttachmentStorageKey: null,
    };

    setPending(true);
    setFormError(null);
    if (timing === 'at_entry') {
      const opening = advancedOpening ? openingBasis : planBasis;
      let openingRisk: string | null = null;
      if (opening === 'money') {
        const raw = advancedOpening ? values.actualRisk : values.plannedRisk;
        const parsed = parseTradeMoneyInput(raw, currency, { allowZero: false });
        if (!parsed.ok) {
          setPending(false);
          setErrors({ actualRisk: t('lifecycle.validation.money') });
          setPanel('trade');
          return;
        }
        openingRisk = parsed.value;
      }
      const result = await createTradeAction({
        ...common,
        recordingTiming: 'at_entry',
        ...(advancedOpening
          ? {
              actualResultMode: opening,
              actualEntry: opening === 'price' ? values.actualEntry : null,
              actualInitialStop: opening === 'price' ? values.actualStop : null,
              actualInitialRiskMinor: opening === 'money' ? openingRisk : null,
              actualPositionSize:
                opening === 'price' && values.actualPositionSize.trim() !== ''
                  ? values.actualPositionSize
                  : null,
            }
          : {}),
        enteredAt: entered.ok ? entered.value : '',
      });
      setPending(false);
      if (!result.ok) return mapServerErrors(result);
      router.push(`/app/trades?trade=${result.data.tradeId}`);
      return;
    }

    const exited = datetimeLocalToIso(values.exitedAt, timezone);
    const actualRisk =
      actualBasis === 'money'
        ? parseTradeMoneyInput(values.actualRisk, currency, { allowZero: false })
        : null;
    const legDrafts = partialExits
      ? exits
      : [
          {
            id: 'simple',
            closedPercent: '100',
            value: values.simpleExit,
            exitedAt: values.exitedAt,
          },
        ];
    const completedExits = legDrafts.map((leg) => {
      const legTime = leg.exitedAt === '' ? exited : datetimeLocalToIso(leg.exitedAt, timezone);
      if (actualBasis === 'price') {
        return {
          closedBps: Number(leg.closedPercent) * 100,
          exitPrice: leg.value.trim(),
          exitedAt: legTime.ok ? legTime.value : undefined,
        };
      }
      const pnl = parseTradeMoneyInput(leg.value, currency, {
        allowNegative: true,
        allowZero: true,
      });
      return {
        closedBps: Number(leg.closedPercent) * 100,
        realizedPnlMinor: pnl.ok ? pnl.value : null,
        exitedAt: legTime.ok ? legTime.value : undefined,
      };
    });
    const systemResult = (() => {
      if (systemChoice === 'pending') return undefined;
      if (systemChoice === 'no_trade') return { status: 'no_trade' as const };
      if (planBasis === 'price') {
        const price =
          systemChoice === 'target'
            ? values.plannedTarget
            : systemChoice === 'stop'
              ? values.plannedStop
              : systemChoice === 'break_even'
                ? values.plannedEntry
                : values.customSystemExit;
        const reason =
          systemChoice === 'target'
            ? 'target_hit'
            : systemChoice === 'stop'
              ? 'stop_hit'
              : systemChoice === 'break_even'
                ? 'break_even_rule'
                : 'manual_system_valid_exit';
        return {
          status: 'resolved' as const,
          resolutionKind: 'price_exit' as const,
          systemExitPrice: price,
          systemExitedAt: exited.ok ? exited.value : '',
          systemExitReason: reason,
          systemCostR: '0',
        };
      }
      const resolutionKind =
        systemChoice === 'target'
          ? 'money_target'
          : systemChoice === 'stop'
            ? 'money_stop'
            : systemChoice === 'break_even'
              ? 'money_break_even'
              : 'money_custom';
      return {
        status: 'resolved' as const,
        resolutionKind,
        ...(resolutionKind === 'money_custom' ? { systemGrossRInput: values.customSystemR } : {}),
        systemExitedAt: exited.ok ? exited.value : '',
        systemCostR: '0',
      };
    })();
    const result = await createCompletedTradeAction({
      ...common,
      recordingTiming: 'after_trade',
      actualResultBasis: actualBasis,
      actualEntry: actualBasis === 'price' ? values.actualEntry : null,
      actualInitialStop: actualBasis === 'price' ? values.actualStop : null,
      actualInitialRiskMinor: actualBasis === 'money' && actualRisk?.ok ? actualRisk.value : null,
      actualPositionSize:
        actualBasis === 'price' && values.actualPositionSize.trim() !== ''
          ? values.actualPositionSize
          : null,
      enteredAt: entered.ok ? entered.value : '',
      exitedAt: exited.ok ? exited.value : '',
      exits: completedExits,
      ...(systemResult === undefined ? {} : { systemResult }),
    });
    setPending(false);
    if (!result.ok) return mapServerErrors(result);
    router.push(`/app/trades?trade=${result.data.tradeId}`);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <section
        aria-labelledby="recording-timing-title"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <h2 id="recording-timing-title" className="text-sm font-semibold">
          {r('timingQuestion')}
        </h2>
        <Segmented
          label={r('timingQuestion')}
          value={timing}
          options={[
            { value: 'at_entry', label: r('atEntry') },
            { value: 'after_trade', label: r('afterTrade') },
          ]}
          onChange={changeTiming}
        />
      </section>

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
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="border-border bg-card grid gap-6 rounded-lg border p-4 sm:p-5 lg:p-6"
      >
        <nav
          data-testid="new-trade-view-nav"
          aria-label={r('panels.label')}
          className="border-border flex max-w-full gap-1 overflow-x-auto border-b pb-2"
        >
          {panels.map((item) => (
            <button
              key={item}
              type="button"
              aria-current={panel === item ? 'page' : undefined}
              onClick={() => openPanel(item)}
              className={cn(
                'relative min-h-10 shrink-0 rounded-md px-3 text-sm font-semibold',
                panel === item
                  ? 'bg-primary/10 text-primary after:bg-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {r(`panels.${item}`)}
            </button>
          ))}
        </nav>

        {panel === 'trade' ? (
          <div className="grid gap-6">
            <fieldset className="grid gap-5 lg:grid-cols-3">
              <legend className="text-base font-semibold lg:col-span-3">{r('identity')}</legend>
              <div className="grid gap-5 sm:grid-cols-2 lg:contents">
                <PlanField
                  id="record-account"
                  label={t('field.account')}
                  error={errors.tradingAccountId}
                >
                  <Select
                    id="record-account"
                    value={values.tradingAccountId}
                    onChange={(event) => setField('tradingAccountId', event.target.value)}
                  >
                    <option value="">{t('create.chooseAccount')}</option>
                    {options.tradingAccounts.map((account) => (
                      <option key={account.tradingAccountId} value={account.tradingAccountId}>
                        {account.name} · {account.baseCurrency}
                      </option>
                    ))}
                  </Select>
                </PlanField>
                <TextField
                  id="record-symbol"
                  label={t('field.symbol')}
                  value={values.symbol}
                  onChange={(value) => setField('symbol', value.toUpperCase())}
                  error={errors.symbol}
                />
              </div>
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">{t('field.direction')}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(['long', 'short'] as const).map((direction) => {
                    const Icon = direction === 'long' ? TrendingUp : TrendingDown;
                    return (
                      <button
                        key={direction}
                        type="button"
                        aria-pressed={values.direction === direction}
                        onClick={() => setField('direction', direction)}
                        className={cn(
                          'flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold',
                          values.direction === direction
                            ? direction === 'long'
                              ? 'border-positive bg-positive/15 text-positive'
                              : 'border-negative bg-negative/15 text-negative'
                            : 'border-border',
                        )}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {t(`direction.${direction}`)}
                        {values.direction === direction ? (
                          <Check size={16} aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {errors.direction === undefined ? null : (
                  <p role="alert" className="text-destructive text-xs">
                    {errors.direction}
                  </p>
                )}
              </fieldset>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-2">
              <TextField
                id="record-entered-at"
                type="datetime-local"
                label={r('enteredAt')}
                value={enteredAtValue}
                onChange={(value) => setField('enteredAt', value)}
                error={errors.enteredAt}
              />
              {timing === 'after_trade' ? (
                <TextField
                  id="record-exited-at"
                  type="datetime-local"
                  label={r('exitedAt')}
                  value={values.exitedAt}
                  onChange={(value) => setField('exitedAt', value)}
                  error={errors.exitedAt}
                />
              ) : null}
            </div>

            <section
              aria-labelledby="record-system-plan-title"
              className="border-border grid gap-5 border-t pt-6"
            >
              <h2 id="record-system-plan-title" className="text-base font-semibold">
                {r('systemPlan')}
              </h2>
              <PlanField id="plan-basis" label={r('planBy')}>
                <Segmented
                  label={r('planBy')}
                  value={planBasis}
                  options={[
                    { value: 'price', label: r('price') },
                    { value: 'money', label: r('money') },
                  ]}
                  onChange={changePlanBasis}
                />
              </PlanField>
              {planBasis === 'price' ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    id="planned-entry"
                    label={r('plannedEntry')}
                    value={values.plannedEntry}
                    onChange={(value) => setField('plannedEntry', value)}
                    error={errors.plannedEntry}
                    inputMode="decimal"
                  />
                  <TextField
                    id="planned-stop"
                    label={r('plannedStop')}
                    value={values.plannedStop}
                    onChange={(value) => setField('plannedStop', value)}
                    error={errors.plannedStop}
                    inputMode="decimal"
                  />
                  <TextField
                    id="planned-target"
                    label={r('takeProfit')}
                    value={values.plannedTarget}
                    onChange={(value) => setField('plannedTarget', value)}
                    error={errors.plannedTarget}
                    optional
                    inputMode="decimal"
                  />
                  <TextField
                    id="planned-size"
                    label={t('field.positionSizeSimple')}
                    value={values.plannedPositionSize}
                    onChange={(value) => setField('plannedPositionSize', value)}
                    optional
                    inputMode="decimal"
                  />
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField
                    id="planned-risk"
                    label={r('plannedRisk')}
                    value={values.plannedRisk}
                    onChange={(value) => setField('plannedRisk', value)}
                    error={errors.plannedRisk}
                    hint={currency}
                    inputMode="decimal"
                  />
                  <TextField
                    id="planned-reward"
                    label={r('targetReward')}
                    value={values.plannedReward}
                    onChange={(value) => setField('plannedReward', value)}
                    error={errors.plannedReward}
                    hint={currency}
                    optional
                    inputMode="decimal"
                  />
                </div>
              )}
              {plannedPreview?.ok && plannedPreview.value.plannedR !== null ? (
                <div className="border-border flex items-center justify-between gap-4 border-t pt-4 text-sm">
                  <span className="text-muted-foreground">{r('plannedR')}</span>
                  <strong className="numeric text-lg">
                    {formatR(plannedPreview.value.plannedR)}
                  </strong>
                </div>
              ) : null}
            </section>

            {timing === 'at_entry' ? (
              <details
                className="border-border border-t pt-4"
                onToggle={(event) => {
                  if (!(event.currentTarget as HTMLDetailsElement).open) {
                    setAdvancedOpening(false);
                    setOpeningBasis(planBasis);
                    setValues((current) => ({
                      ...current,
                      actualEntry: '',
                      actualStop: '',
                      actualRisk: '',
                      actualPositionSize: '',
                    }));
                  }
                }}
              >
                <summary className="cursor-pointer text-sm font-semibold">{r('advanced')}</summary>
                <div className="mt-4 grid gap-5">
                  <label className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={advancedOpening}
                      onChange={(event) => {
                        setAdvancedOpening(event.target.checked);
                        setOpeningBasis(planBasis);
                      }}
                    />
                    {r('openingDiffers')}
                  </label>
                  {advancedOpening ? (
                    <>
                      <Segmented
                        label={r('actualOpeningBy')}
                        value={openingBasis}
                        options={[
                          { value: 'price', label: r('price') },
                          { value: 'money', label: r('money') },
                        ]}
                        onChange={(next) => {
                          setOpeningBasis(next);
                          setValues((current) => ({
                            ...current,
                            actualEntry: '',
                            actualStop: '',
                            actualRisk: '',
                            actualPositionSize: '',
                          }));
                        }}
                      />
                      {openingBasis === 'price' ? (
                        <div className="grid gap-5 sm:grid-cols-2">
                          <TextField
                            id="opening-entry"
                            label={r('actualEntry')}
                            value={values.actualEntry}
                            onChange={(value) => setField('actualEntry', value)}
                            error={errors.actualEntry}
                          />
                          <TextField
                            id="opening-stop"
                            label={r('actualStop')}
                            value={values.actualStop}
                            onChange={(value) => setField('actualStop', value)}
                            error={errors.actualStop}
                          />
                          <TextField
                            id="opening-size"
                            label={t('field.actualPositionSize')}
                            value={values.actualPositionSize}
                            onChange={(value) => setField('actualPositionSize', value)}
                            optional
                          />
                        </div>
                      ) : (
                        <TextField
                          id="opening-risk"
                          label={r('initialRisk')}
                          value={values.actualRisk}
                          onChange={(value) => setField('actualRisk', value)}
                          error={errors.actualRisk}
                          hint={currency}
                        />
                      )}
                    </>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {panel === 'result' && timing === 'after_trade' ? (
          <div className="grid gap-6">
            <section className="grid gap-5" aria-labelledby="actual-result-title">
              <h2 id="actual-result-title" className="text-base font-semibold">
                {r('actualResult')}
              </h2>
              <PlanField id="actual-basis" label={r('actualResultBy')} error={errors.actualResult}>
                <Segmented
                  label={r('actualResultBy')}
                  value={actualBasis}
                  options={[
                    { value: 'price', label: r('price') },
                    { value: 'money', label: r('money') },
                  ]}
                  onChange={changeActualBasis}
                />
              </PlanField>
              {actualBasis === 'price' ? (
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField
                    id="actual-entry"
                    label={r('actualEntry')}
                    value={values.actualEntry}
                    onChange={(value) => setField('actualEntry', value)}
                    error={errors.actualEntry}
                  />
                  <TextField
                    id="actual-stop"
                    label={r('actualInitialStop')}
                    value={values.actualStop}
                    onChange={(value) => setField('actualStop', value)}
                    error={errors.actualStop}
                  />
                  <TextField
                    id="actual-size"
                    label={t('field.actualPositionSize')}
                    value={values.actualPositionSize}
                    onChange={(value) => setField('actualPositionSize', value)}
                    optional
                  />
                  {!partialExits ? (
                    <TextField
                      id="simple-exit"
                      label={r('exitPrice')}
                      value={values.simpleExit}
                      onChange={(value) => setField('simpleExit', value)}
                      error={errors.simpleExit}
                    />
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField
                    id="actual-risk"
                    label={r('initialRisk')}
                    value={values.actualRisk}
                    onChange={(value) => setField('actualRisk', value)}
                    error={errors.actualRisk}
                    hint={currency}
                  />
                  {!partialExits ? (
                    <TextField
                      id="simple-pnl"
                      label={r('realizedPnl')}
                      value={values.simpleExit}
                      onChange={(value) => setField('simpleExit', value)}
                      error={errors.simpleExit}
                      hint={currency}
                    />
                  ) : null}
                </div>
              )}
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={partialExits}
                  onChange={(event) => setPartialExits(event.target.checked)}
                />
                {r('partialExits')}
              </label>
              {partialExits ? (
                <div className="grid gap-4">
                  {exits.map((leg, index) => (
                    <div
                      key={leg.id}
                      className="border-border grid gap-4 border-y py-4 sm:grid-cols-3"
                    >
                      <TextField
                        id={`exit-value-${leg.id}`}
                        label={actualBasis === 'price' ? r('exitPrice') : r('realizedPnl')}
                        value={leg.value}
                        onChange={(value) =>
                          setExits((current) =>
                            current.map((item) => (item.id === leg.id ? { ...item, value } : item)),
                          )
                        }
                      />
                      <TextField
                        id={`exit-percent-${leg.id}`}
                        label={r('closedPercent')}
                        value={leg.closedPercent}
                        onChange={(value) =>
                          setExits((current) =>
                            current.map((item) =>
                              item.id === leg.id ? { ...item, closedPercent: value } : item,
                            ),
                          )
                        }
                      />
                      <div className="flex items-end gap-2">
                        <TextField
                          id={`exit-time-${leg.id}`}
                          type="datetime-local"
                          label={r('exitTime')}
                          value={leg.exitedAt}
                          onChange={(value) =>
                            setExits((current) =>
                              current.map((item) =>
                                item.id === leg.id ? { ...item, exitedAt: value } : item,
                              ),
                            )
                          }
                          optional
                        />
                        {exits.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={r('removeExit', { number: index + 1 })}
                            onClick={() =>
                              setExits((current) => current.filter((item) => item.id !== leg.id))
                            }
                          >
                            <Trash2 size={16} />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {errors.exits === undefined ? null : (
                    <p role="alert" className="text-destructive text-sm">
                      {errors.exits}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() =>
                      setExits((current) => [
                        ...current,
                        { id: generateId(), closedPercent: '', value: '', exitedAt: '' },
                      ])
                    }
                  >
                    <Plus size={16} />
                    {r('addExit')}
                  </Button>
                </div>
              ) : null}
              {actualPreview?.ok ? (
                <div className="border-border grid grid-cols-2 gap-4 border-t pt-4">
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">{r('actualR')}</div>
                    <strong>{formatR(actualPreview.value.actualR)}</strong>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs uppercase">{r('result')}</div>
                    <strong>{r(`outcome.${outcomeKey(actualPreview.value.traderOutcome)}`)}</strong>
                  </div>
                </div>
              ) : null}
            </section>

            <section
              className="border-border grid gap-5 border-t pt-6"
              aria-labelledby="system-outcome-title"
            >
              <div>
                <h2 id="system-outcome-title" className="text-base font-semibold">
                  {r('systemOutcome')}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">{r('systemOutcomeHelp')}</p>
              </div>
              <PlanField id="system-choice" label={r('systemOutcome')} error={errors.systemChoice}>
                <Select
                  id="system-choice"
                  value={systemChoice}
                  onChange={(event) => setSystemChoice(event.target.value as SystemChoice)}
                >
                  <option value="pending">{r('system.pending')}</option>
                  <option value="target" disabled={!targetAvailable}>
                    {r('system.target')}
                  </option>
                  <option value="stop">{r('system.stop')}</option>
                  <option value="break_even">{r('system.breakEven')}</option>
                  <option value="custom">{r('system.custom')}</option>
                  <option value="no_trade">{r('system.noTrade')}</option>
                </Select>
              </PlanField>
              {!targetAvailable ? (
                <p className="text-muted-foreground text-xs">{r('targetUnavailable')}</p>
              ) : null}
              {systemChoice === 'custom' ? (
                <details open className="border-border rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {r('customSystem')}
                  </summary>
                  <div className="mt-4">
                    {planBasis === 'price' ? (
                      <TextField
                        id="custom-system-exit"
                        label={r('systemExitPrice')}
                        value={values.customSystemExit}
                        onChange={(value) => setField('customSystemExit', value)}
                      />
                    ) : (
                      <TextField
                        id="custom-system-r"
                        label={r('systemGrossR')}
                        value={values.customSystemR}
                        onChange={(value) => setField('customSystemR', value)}
                      />
                    )}
                  </div>
                </details>
              ) : null}
            </section>
          </div>
        ) : null}

        {panel === 'setup' ? (
          <div className="grid gap-6">
            {timing === 'after_trade' ? (
              <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-sm">
                {r('retrospective')}
              </p>
            ) : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <PlanField id="record-strategy" label={t('field.strategy')} optional>
                <Select
                  id="record-strategy"
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
                </Select>
              </PlanField>
              <PlanField id="record-setup" label={t('field.setup')} optional error={errors.setupId}>
                <Select
                  id="record-setup"
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
                </Select>
              </PlanField>
              <TextField
                id="record-timeframe"
                label={t('field.timeframe')}
                value={values.timeframe}
                onChange={(value) => setField('timeframe', value)}
                optional
              />
              <TextField
                id="record-session"
                label={t('field.session')}
                value={values.session}
                onChange={(value) => setField('session', value)}
                optional
              />
            </div>
            {selectedSetup !== undefined && conditionCount === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('create.conditions.notConfigured')}
              </p>
            ) : null}
            {selectedSetup?.conditions.length ? (
              <fieldset className="grid gap-3">
                <legend className="text-sm font-semibold">{r('setupChecklist')}</legend>
                <p className="text-muted-foreground text-sm">{r('setupBeforeEntry')}</p>
                <p className="text-muted-foreground text-sm">
                  {t('create.conditions.adherence', {
                    met: metConditionCount,
                    total: conditionCount,
                    percentage: Math.round((metConditionCount / conditionCount) * 100),
                  })}
                </p>
                {selectedSetup.conditions.map((condition) => (
                  <label
                    key={condition.conditionKey}
                    className="border-border flex min-h-11 items-center gap-3 rounded-md border p-3 text-sm"
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
            ) : null}
          </div>
        ) : null}

        {panel === 'context' ? (
          <div className="grid gap-6">
            {timing === 'after_trade' ? (
              <p className="bg-muted/50 text-muted-foreground rounded-md px-3 py-2 text-sm">
                {r('retrospective')}
              </p>
            ) : null}
            <TradeConfidenceControl
              id="record-confidence"
              label={t('field.confidence')}
              value={parseConfidence(values.confidence) ?? null}
              onChange={(value) => setField('confidence', value === null ? '' : String(value))}
            />
            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold">{r('emotions')}</legend>
              <div className="flex flex-wrap gap-2">
                {options.emotionCatalog.map((emotion) => (
                  <button
                    key={emotion.key}
                    type="button"
                    aria-pressed={emotionKeys.includes(emotion.key)}
                    onClick={() =>
                      setEmotionKeys((current) =>
                        current.includes(emotion.key)
                          ? current.filter((key) => key !== emotion.key)
                          : [...current, emotion.key],
                      )
                    }
                    className={cn(
                      'min-h-11 rounded-full border px-4 text-sm',
                      emotionKeys.includes(emotion.key)
                        ? 'border-primary bg-primary/10'
                        : 'border-border',
                    )}
                  >
                    {emotion.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <PlanField id="entry-reason" label={r('entryReason')} optional>
              <Textarea
                id="entry-reason"
                value={values.confirmationNotes}
                onChange={(event) => setField('confirmationNotes', event.target.value)}
              />
            </PlanField>
            <TextField
              id="chart-link"
              label={r('chartLink')}
              value={values.tradingviewUrl}
              onChange={(value) => setField('tradingviewUrl', value)}
              optional
            />
            <PlanField id="record-notes" label={t('field.notes')} optional>
              <Textarea
                id="record-notes"
                value={values.notes}
                onChange={(event) => setField('notes', event.target.value)}
              />
            </PlanField>
          </div>
        ) : null}

        <div className="border-border bg-surface-raised/40 -mx-4 -mb-4 flex justify-end border-t p-4 sm:-mx-5 sm:-mb-5 sm:px-5 lg:-mx-6 lg:-mb-6 lg:px-6">
          <Button type="submit" className="w-full sm:w-auto sm:min-w-52" disabled={pending}>
            {pending ? r('saving') : timing === 'at_entry' ? r('openTrade') : r('saveCompleted')}
          </Button>
        </div>
      </form>

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
