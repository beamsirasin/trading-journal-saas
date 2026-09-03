'use client';

import { Check, Plus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { composePlannedR, composeTraderCloseV2 } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
import { isConfidenceStep, type ConfidenceStep } from '@/lib/trades/constants';
import type { RecordingTiming } from '@/lib/trades/recording-timing';
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
import { Link, useRouter } from '@/i18n/navigation';

import { NativeSelect } from './trade-action-form';
import { TradeConfidenceControl } from './trade-confidence-control';
import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
} from './trade-form-values';
import { formatR } from './trade-format';
import { PlanField } from './trade-plan-field';

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

/**
 * The form's two-state segmented control.
 *
 * IT KEEPS ITS BUTTON SEMANTICS ON PURPOSE. `components/ui/segmented-control`
 * is the shared radio-based control and is where this one's LOOK now comes
 * from — same bordered group, same `surface-raised` selected segment, same
 * control shadow — but swapping the implementation would turn every segment
 * from a `button` with `aria-pressed` into a `radio`, changing the semantics
 * this form's existing behaviour, tests and end-to-end selectors all depend
 * on, and losing the per-option `disabled` this one needs. This pass is a
 * visual migration, so the visuals migrated and the behaviour did not.
 */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'border-border bg-background grid gap-1 rounded-lg border p-1',
        'grid-cols-2',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'focus-visible:ring-ring min-h-11 rounded-md border border-transparent px-3 text-sm font-medium transition-colors duration-150 ease-(--motion-ease-standard) outline-none focus-visible:ring-2 motion-reduce:transition-none',
            'disabled:cursor-not-allowed disabled:opacity-45',
            value === option.value
              ? 'bg-surface-raised border-border shadow-control text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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

/** The pristine draft, in one place, so both the initial state and the touched-check read from it. */
function emptyValues(tradingAccountId: string): Values {
  return {
    tradingAccountId,
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
  };
}

/**
 * The one way back to the recording-mode choice.
 *
 * A PLAIN LINK WHILE THE FORM IS EMPTY, AND A QUESTION ONCE IT IS NOT.
 * Returning to the choice leaves this route, so the draft goes with it — that
 * is the safe reset the old in-form toggle had to perform by hand, and it is
 * now structural. But a reset the reader did not expect is just lost work, so
 * once anything has been entered the same control asks first, through the
 * dialog primitive this form already uses.
 *
 * No draft is persisted across the change. Carrying a half-filled At Entry
 * plan into an After Trade form would mean deciding which of its fields still
 * mean anything, and that is a product decision, not something to improvise.
 */
function ChangeModeControl({ isDirty }: { isDirty: boolean }) {
  const t = useTranslations('trades');
  const tMode = useTranslations('trades.create.mode');
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isDirty) {
    return (
      <Link
        href="/app/trades/new"
        data-recording-mode-change=""
        className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
      >
        {tMode('change')}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        data-recording-mode-change=""
        onClick={() => setConfirmOpen(true)}
        className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
      >
        {tMode('change')}
      </button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tMode('changeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{tMode('changeConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lifecycle.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                router.push('/app/trades/new');
              }}
            >
              {tMode('changeConfirm.continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  timing,
  activeTradingAccountId = null,
  timezone,
}: {
  options: TradeCreateOptions;
  /**
   * WHICH SITUATION THIS FORM IS RECORDING, CHOSEN BEFORE IT MOUNTED.
   *
   * It used to be local state behind a segmented toggle at the top of the
   * form, which meant a half-filled form could have its meaning changed
   * underneath it. The choice is now its own step and travels in the URL, so
   * for this form it is a fixed input: the panels, the submit action and the
   * validation all derive from it, and nothing here can change it. Changing it
   * is a navigation back to the choice, which discards the draft — see
   * `ChangeModeControl`.
   */
  timing: RecordingTiming;
  /**
   * The workspace's persisted active Account, used ONLY as this field's
   * starting value. The field itself is unchanged and still decides which
   * Account the Trade belongs to.
   */
  activeTradingAccountId?: string | null;
  timezone: string;
}) {
  const locale = useLocale();
  const t = useTranslations('trades');
  const r = useTranslations('trades.create.recording');
  const tMode = useTranslations('trades.create.mode');
  const router = useRouter();
  const hydrated = useIsHydrated();
  const [mutationKey] = useState(generateId);
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
  /*
    The active Account first, then the sole Account, then nothing.

    The active id is checked AGAINST THE OFFERED OPTIONS rather than trusted:
    it is a per-user preference that can name an Account that has since been
    archived or moved, and seeding the select with a value it does not contain
    would silently blank the field on submit. Falling through to the existing
    single-Account default keeps the previous behaviour exactly where it
    already applied.
  */
  const initialAccount =
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((account) => account.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '');
  const pristine = useMemo(() => emptyValues(initialAccount), [initialAccount]);
  const [values, setValues] = useState<Values>(pristine);

  /*
    HAS THE TRADER ACTUALLY PUT ANYTHING IN?

    Compared against the pristine draft rather than tracked with a flag, so a
    field typed into and then cleared again correctly reads as untouched, and a
    field added to `Values` later is covered without anyone remembering to add
    it here. The seeded Trading Account is part of the pristine draft, so
    arriving on the form does not by itself count as a change.

    Its only job is to decide whether leaving for the mode choice needs to be
    acknowledged — it gates nothing else.
  */
  const isDirty =
    emotionKeys.length > 0 ||
    Object.values(conditionMet).some(Boolean) ||
    exits.some((exit) => exit.value !== '' || exit.exitedAt !== '') ||
    (Object.keys(pristine) as (keyof Values)[]).some((key) => values[key] !== pristine[key]);

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

  /*
    THE SAFE-RESET THAT USED TO LIVE HERE IS NOW STRUCTURAL.

    `changeTiming` cleared every field that stops meaning anything when the
    recording situation changes — the exit, the actual opening, the System
    choice, the exit legs. It existed because the toggle could flip a live
    form. It cannot any more: changing the mode leaves this route for the
    choice step, so the form unmounts and the next one mounts pristine. The
    guarantee is the same and there is no longer a partial-reset path to keep
    correct alongside it.
  */

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

  /**
   * EVERY REQUIREMENT THIS FORM HAS, COLLECTED ONCE.
   *
   * Moved out of `submit()` unchanged — same rules, same order, same
   * messages — because two things now need the answer: the submit handler,
   * which decides whether to send, and the action bar, which says what is
   * still missing. A second implementation of "what is required" would be a
   * parallel truth, and the moment it drifted the bar would promise
   * something the button refuses (or the reverse). There is one function, so
   * there is one answer.
   *
   * Pure: it reads state and returns a map. Nothing here sets state, which
   * is what makes it safe to call during render.
   */
  function collectErrors(): ErrorMap {
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
    return next;
  }

  async function submit(unmetConfirmed = false) {
    const next = collectErrors();
    // Still computed here, where it always was: the payload needs the same
    // conversion the validator did, and handing it back out of `collectErrors()`
    // would make the validator responsible for building the request too.
    const entered = datetimeLocalToIso(enteredAtValue, timezone);
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

  /**
   * WHAT IS STILL OUTSTANDING, SAID IN THE SAME WORDS THE FIELDS USE.
   *
   * `collectErrors()` is the one place that knows what this form requires —
   * the same call `submit()` makes before deciding whether to send — so this
   * sentence and the button cannot disagree about whether the form is ready.
   * The map below only turns a field key into the label the reader already saw
   * next to the input; it decides nothing and adds no rule of its own.
   *
   * `Intl.ListFormat` rather than joining on a comma, because "Symbol and
   * Entry" is a sentence where "Symbol, Entry" is a list — and Thai joins a
   * list differently from English.
   */
  const outstandingFieldLabels: Record<string, string> = {
    tradingAccountId: t('field.account'),
    symbol: t('field.symbol'),
    direction: t('field.direction'),
    setupId: t('field.setup'),
    enteredAt: r('enteredAt'),
    exitedAt: r('exitedAt'),
    plannedEntry: r('plannedEntry'),
    plannedStop: r('plannedStop'),
    plannedRisk: r('plannedRisk'),
    plannedReward: r('targetReward'),
    actualEntry: r('actualEntry'),
    actualStop: r('actualStop'),
    actualRisk: r('initialRisk'),
    simpleExit: actualBasis === 'price' ? r('exitPrice') : r('realizedPnl'),
    exits: r('partialExits'),
    actualResult: r('actualResult'),
    systemChoice: r('systemOutcome'),
  };
  const outstanding = Object.keys(collectErrors())
    .map((key) => outstandingFieldLabels[key])
    .filter((label): label is string => label !== undefined);
  const outstandingSummary =
    outstanding.length === 0
      ? r('remaining.ready')
      : r('remaining.needed', {
          fields: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
            outstanding,
          ),
        });

  return (
    /*
      FULL-WIDTH IN ITS OWN PAGE COLUMN. It used to be a `max-w-3xl` block
      centred inside a `wide` (100rem) page, so the header sat on one left edge
      and the form on another — the "narrow and disconnected" reading. The page
      container is now the app's standard `default` width and the form fills
      it, which puts both on one edge and gives the two-column field grids room
      without stretching a text input across a monitor.
    */
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/*
        THE MODE, SAID ONCE, DIRECTLY UNDER THE HEADING THAT NAMES IT.

        Three things used to say it: an `<h1>` reading "Log a trade", a
        subtitle reading "Recording at Entry.", and a bordered card reading
        "Recording: At Entry" with a Change link inside it. The heading is now
        the mode itself, so this is the sentence that explains what the mode
        means, with the way back to the choice at the end of it.

        It renders inside the shell's children rather than as a `description`
        prop because the Change control needs `isDirty` — form state that has
        no business being lifted into a layout component to satisfy a layout.
        Centred and muted so it reads as a continuation of the header above it.
      */}
      <p
        data-recording-mode={timing}
        className="text-muted-foreground mx-auto max-w-prose text-center text-sm text-pretty"
      >
        {tMode(`${timing}.description`)} <ChangeModeControl isDirty={isDirty} />
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
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="border-border bg-card grid gap-8 rounded-lg border p-4 sm:p-6"
      >
        <nav
          data-testid="new-trade-view-nav"
          aria-label={r('panels.label')}
          className={cn(
            'border-border bg-background grid gap-1 rounded-lg border p-1',
            // Unchanged information architecture: three panels At Entry, four
            // After Trade, in the order they have always been in. Two rows on
            // a phone rather than four cramped columns.
            timing === 'at_entry' ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4',
          )}
        >
          {panels.map((item) => (
            <button
              key={item}
              type="button"
              aria-current={panel === item ? 'page' : undefined}
              onClick={() => openPanel(item)}
              className={cn(
                'focus-visible:ring-ring min-h-11 rounded-md border border-transparent px-3 text-sm font-medium transition-colors duration-150 ease-(--motion-ease-standard) outline-none focus-visible:ring-2 motion-reduce:transition-none',
                'px-2',
                panel === item
                  ? 'bg-surface-raised border-border shadow-control text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {r(`panels.${item}`)}
            </button>
          ))}
        </nav>

        {panel === 'trade' ? (
          <div className="grid gap-8">
            <fieldset className="grid gap-5">
              <legend className="mb-2 text-base font-semibold">{r('identity')}</legend>
              {/*
                A FIELD IS AS WIDE AS WHAT GOES IN IT. Account is a select
                holding a name and a currency; Symbol holds four or six
                characters. Splitting the row in half gave a ticker a box wide
                enough for a sentence, which reads as "we have no idea what you
                are about to type".
              */}
              <div className="grid gap-5 sm:grid-cols-3">
                <PlanField
                  id="record-account"
                  className="sm:col-span-2"
                  label={t('field.account')}
                  error={errors.tradingAccountId}
                >
                  <NativeSelect
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
                  </NativeSelect>
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
                {/*
                  DIRECTION IS NOT AN OUTCOME, SO IT IS NOT COLOURED. These were
                  filled positive/negative swatches, which borrowed the tokens
                  this product reserves for what a Trade actually MADE — a Long
                  is not a win. Everywhere else in the app (the Trades table,
                  the Details header) direction is plain text, so the control
                  now uses the same neutral segmented language as its
                  neighbours. Selection is still carried by three things that
                  are not colour: `aria-pressed`, the raised surface, and the
                  check.
                */}
                <div className="border-border bg-background grid grid-cols-2 gap-1 rounded-lg border p-1">
                  {(['long', 'short'] as const).map((direction) => {
                    const Icon = direction === 'long' ? TrendingUp : TrendingDown;
                    const selected = values.direction === direction;
                    return (
                      <button
                        key={direction}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setField('direction', direction)}
                        className={cn(
                          'flex items-center justify-center gap-2',
                          'focus-visible:ring-ring min-h-11 rounded-md border border-transparent px-3 text-sm font-medium transition-colors duration-150 ease-(--motion-ease-standard) outline-none focus-visible:ring-2 motion-reduce:transition-none',
                          selected
                            ? 'bg-surface-raised border-border shadow-control text-foreground'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon size={16} aria-hidden="true" />
                        {t(`direction.${direction}`)}
                        {selected ? <Check size={16} aria-hidden="true" /> : null}
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

            {/*
              A GROUP, NOT A BOX. This was a bordered fieldset inside a
              bordered card, which drew a second frame around a third of the
              form and made the plan look like an aside rather than the middle
              of the story. It keeps the `<fieldset>`/`<legend>` semantics —
              these controls really are one group — and drops only the border,
              so the heading now matches every other heading on the panel.
            */}
            <fieldset className="grid gap-5">
              <legend className="mb-2 text-base font-semibold">{r('systemPlan')}</legend>
              <PlanField id="plan-basis" label={r('planBy')} hint={r('planByHelp')}>
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
                /*
                  Four short numbers that are read together — entry, stop,
                  target, size — so they sit on one line where there is room
                  for it, two-by-two on a tablet and one per row on a phone.
                  As two columns they wrapped into a 2x2 block whose reading
                  order (entry, stop / target, size) had to be inferred.
                */
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
                <div className="grid gap-5 sm:grid-cols-2">
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
                <div className="bg-muted/40 rounded-md p-3 text-sm">
                  <span className="text-muted-foreground">{r('plannedR')}</span>{' '}
                  <strong>{formatR(plannedPreview.value.plannedR)}</strong>
                </div>
              ) : null}
            </fieldset>

            {timing === 'at_entry' ? (
              <details
                className="border-border rounded-lg border p-4"
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
                {/* Closed by default, exactly as before; only the trigger now
                    reads like the product's other disclosures. */}
                <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 cursor-pointer items-center rounded-md text-sm font-medium transition-colors duration-150 ease-(--motion-ease-standard) outline-none focus-visible:ring-2 motion-reduce:transition-none">
                  {r('advanced')}
                </summary>
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
          <div className="grid gap-8">
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
                      className="border-border grid gap-4 rounded-lg border p-4 sm:grid-cols-3"
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
                <div className="border-border bg-muted/40 grid grid-cols-2 gap-4 rounded-lg border p-4">
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
              className="border-border grid gap-5 border-t pt-8"
              aria-labelledby="system-outcome-title"
            >
              <div>
                <h2 id="system-outcome-title" className="text-base font-semibold">
                  {r('systemOutcome')}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">{r('systemOutcomeHelp')}</p>
              </div>
              <PlanField id="system-choice" label={r('systemOutcome')} error={errors.systemChoice}>
                <NativeSelect
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
                </NativeSelect>
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
                <NativeSelect
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
                </NativeSelect>
              </PlanField>
              <PlanField id="record-setup" label={t('field.setup')} optional error={errors.setupId}>
                <NativeSelect
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
                </NativeSelect>
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
                      'min-h-11 rounded-full border px-4 text-sm outline-none',
                      'transition-colors duration-150 ease-(--motion-ease-standard) motion-reduce:transition-none',
                      'focus-visible:ring-ring focus-visible:ring-2',
                      emotionKeys.includes(emotion.key)
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
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

        {/*
          THE ACTION BELONGS AT THE END OF THE THING IT COMPLETES.

          It used to sit above the panels, sticky to the top of the card: the
          first thing a reader met on a form they had not filled in yet, and
          still there, unmoved, when they reached the bottom. At the foot it is
          where a reader arrives when they are done, and it can say something
          the top could not — what is still outstanding, on the left.

          That sentence reads from `collectErrors()`, the same function
          `submit()` uses to decide whether to send. It cannot disagree with
          the button, because it is not a second opinion.

          Sticky only on a phone, where the panels are tall enough that the
          action would otherwise be a scroll away; `pb-safe` keeps it clear of
          a home indicator. On a wider screen it is simply the last row of the
          card. The negative margins let it bleed to the card's own edges.
        */}
        <div className="border-border bg-card/95 supports-[backdrop-filter]:bg-card/80 pb-safe sticky bottom-0 z-10 -mx-4 -mb-4 border-t px-4 backdrop-blur-sm sm:static sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-0 sm:backdrop-blur-none">
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-muted-foreground min-w-0 text-sm">{outstandingSummary}</p>
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto sm:shrink-0"
              disabled={pending}
            >
              {pending ? r('saving') : timing === 'at_entry' ? r('openTrade') : r('saveCompleted')}
            </Button>
          </div>
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
