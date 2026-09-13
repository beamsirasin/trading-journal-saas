'use client';

import { HeartPulse, Lightbulb, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { composePlannedR } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
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
import { Textarea } from '@/components/ui/textarea';
import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { useRouter } from '@/i18n/navigation';

import { NativeSelect } from './trade-action-form';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { TradeConfidenceControl } from './trade-confidence-control';
import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
} from './trade-form-values';
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
type JournalArea = 'idea' | 'feelings';
type ErrorMap = Record<string, string>;

interface Values {
  tradingAccountId: string;
  symbol: string;
  direction: Direction;
  enteredAt: string;
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
  strategyId: string;
  setupId: string;
  timeframe: string;
  session: string;
  confidence: string;
  confirmationNotes: string;
  tradingviewUrl: string;
  notes: string;
}

function emptyValues(tradingAccountId: string): Values {
  return {
    tradingAccountId,
    symbol: '',
    direction: '',
    enteredAt: '',
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
    strategyId: '',
    setupId: '',
    timeframe: '',
    session: '',
    confidence: '',
    confirmationNotes: '',
    tradingviewUrl: '',
    notes: '',
  };
}

const PLAN_FIELDS = [
  'plannedEntry',
  'plannedStop',
  'plannedTarget',
  'plannedPositionSize',
  'plannedRisk',
  'plannedReward',
] as const;
const OPENING_FIELDS = ['actualEntry', 'actualStop', 'actualRisk', 'actualPositionSize'] as const;

/**
 * WHAT CHOOSING PRICE COSTS, SAID WHERE THE CHOICE IS MADE.
 *
 * A Price-basis Trade has no monetary result by design
 * (`docs/calculation-spec.md`), and a single one leaves the Dashboard's Net P&L
 * unavailable for the whole population. At Entry, the basis that decides this
 * is the Plan's — or the Advanced opening's when that override is on.
 */
function PriceHasNoMoneyNotice({ message }: { message: string }) {
  return (
    <p
      role="status"
      data-price-no-money-notice=""
      className="border-warning/40 bg-warning/10 text-foreground flex items-start gap-2 rounded-lg border p-3 text-xs"
    >
      <TriangleAlert aria-hidden="true" className="text-warning mt-px size-4 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/**
 * AT ENTRY — one linear recording flow for a trade that is still open.
 *
 * The same four-part shape as After Trade, in the same visual language, so the
 * two read as one product: The trade → Plan at entry → Journal at entry → Save.
 * What differs is the lifecycle. The entry time follows the clock until the
 * trader changes it; there is no Actual Result, no exit reconstruction and no
 * review, because none of those exist yet; and the Trade idea is asked in the
 * present tense.
 *
 * THE SHORT PATH is Symbol, Direction and Risk at entry: the account is seeded
 * and the entry time is already now. Target profit is optional and Target R is
 * derived by `lib/calc` only once both amounts exist — never typed, never shown
 * as zero. Price levels remain one quiet switch away rather than the first
 * question on the page.
 *
 * THE PAYLOAD IS UNCHANGED from the tabbed form this replaced: one canonical
 * `createTradeAction` call, Money by default, the server defaulting the opening
 * from the plan unless Advanced says the opening differed.
 */
export function TradeAtEntryForm({
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
  const e = useTranslations('trades.create.recording.entry');
  const tMode = useTranslations('trades.create.mode');
  const router = useRouter();
  const hydrated = useIsHydrated();
  const [mutationKey] = useState(generateId);
  /*
    The active Account first, then the sole Account, then nothing. The active
    id is checked against the offered options rather than trusted: it is a
    per-user preference that can name an Account since archived.
  */
  const initialAccount =
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((item) => item.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '');
  const pristine = useMemo(() => emptyValues(initialAccount), [initialAccount]);
  const [values, setValues] = useState(pristine);
  const [planBasis, setPlanBasis] = useState<Basis>('money');
  const [advancedOpening, setAdvancedOpening] = useState(false);
  const [openingBasis, setOpeningBasis] = useState<Basis>('money');
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

  /*
    ENTRY TIME FOLLOWS THE CLOCK UNTIL THE TRADER CHANGES IT.

    Resolved after hydration only, so the server never renders a time the
    browser would immediately contradict. An untouched field keeps meaning
    "now"; the line beneath it says so, because a trader writing up a position
    opened earlier must see that the value came from the clock.
  */
  const defaultEnteredAt = hydrated
    ? instantToDatetimeLocal(new Date().toISOString(), timezone)
    : '';
  const enteredAtValue = values.enteredAt === '' ? defaultEnteredAt : values.enteredAt;

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const selectedStrategy = options.strategies.find((item) => item.strategyId === values.strategyId);
  const selectedSetup = selectedStrategy?.setups.find((item) => item.setupId === values.setupId);
  const conditionCount = selectedSetup?.conditions.length ?? 0;
  const metConditionCount = (selectedSetup?.conditions ?? []).filter(
    (condition) => conditionMet[condition.conditionKey] === true,
  ).length;
  const emotionGroups = groupEmotionCatalog(options.emotionCatalog);

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

  /** Switching basis clears the fields it owns, so no value from the other basis is sent. */
  function changePlanBasis(next: Basis) {
    setPlanBasis(next);
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(PLAN_FIELDS.map((field) => [field, ''])),
    }));
    clearErrors(PLAN_FIELDS);
  }

  function resetOpening(basis: Basis) {
    setOpeningBasis(basis);
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(OPENING_FIELDS.map((field) => [field, ''])),
    }));
    clearErrors(OPENING_FIELDS);
  }

  const plannedRisk =
    values.plannedRisk.trim() === ''
      ? null
      : parseTradeMoneyInput(values.plannedRisk, currency, { allowZero: false });
  const plannedReward =
    values.plannedReward.trim() === ''
      ? null
      : parseTradeMoneyInput(values.plannedReward, currency, { allowZero: true });

  /** The engine's planned R — the same `lib/calc` call the server makes. */
  const plannedPreview =
    values.direction === ''
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
  /*
    1R in money only where the plan states it. A Price plan does not, and
    CLAUDE.md §6 forbids deriving an amount from price × size.
  */
  const oneR =
    planBasis === 'money' && plannedRisk?.ok ? formatTradeMoney(plannedRisk.value, currency) : null;

  const moneyDecidingBasis = advancedOpening ? openingBasis : planBasis;

  const isDirty =
    feelingsRecorded ||
    emotionKeys.length > 0 ||
    Object.values(conditionMet).some(Boolean) ||
    (Object.keys(pristine) as (keyof Values)[]).some((key) => values[key] !== pristine[key]);

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

  /** Every requirement this form has, collected once. Pure: safe to call anywhere. */
  function collectErrors(): ErrorMap {
    const next: ErrorMap = {};
    if (values.tradingAccountId === '') next.tradingAccountId = t('validation.requiredAccount');
    if (values.symbol.trim() === '') next.symbol = t('validation.requiredSymbol');
    if (values.direction === '') next.direction = t('validation.requiredDirection');
    if (enteredAtValue === '') next.enteredAt = r('validation.enteredAt');
    else if (!datetimeLocalToIso(enteredAtValue, timezone).ok)
      next.enteredAt = t('lifecycle.validation.time');

    if (planBasis === 'price') {
      if (values.plannedEntry.trim() === '') next.plannedEntry = t('validation.requiredEntry');
      if (values.plannedStop.trim() === '') next.plannedStop = t('validation.requiredStop');
      if (
        next.plannedEntry === undefined &&
        next.plannedStop === undefined &&
        plannedPreview?.ok === false
      )
        next.plannedEntry = t('errors.invalid_plan');
    } else {
      if (plannedRisk === null) next.plannedRisk = e('validation.risk');
      else if (!plannedRisk.ok) next.plannedRisk = t('lifecycle.validation.money');
      if (plannedReward !== null && !plannedReward.ok)
        next.plannedReward = t('lifecycle.validation.money');
    }
    if (values.setupId !== '' && values.strategyId === '')
      next.setupId = t('validation.setupRequiresStrategy');

    if (advancedOpening) {
      if (openingBasis === 'price') {
        if (values.actualEntry.trim() === '') next.actualEntry = r('validation.actualEntry');
        if (values.actualStop.trim() === '') next.actualStop = r('validation.actualStop');
      } else if (values.actualRisk.trim() === '') {
        next.actualRisk = r('validation.actualRisk');
      } else if (!parseTradeMoneyInput(values.actualRisk, currency, { allowZero: false }).ok) {
        next.actualRisk = t('lifecycle.validation.money');
      }
    }
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

    const entered = datetimeLocalToIso(enteredAtValue, timezone);
    const openingRisk =
      advancedOpening && openingBasis === 'money'
        ? parseTradeMoneyInput(values.actualRisk, currency, { allowZero: false })
        : null;
    const confidence = confidenceOf(values.confidence);

    setPending(true);
    setFormError(null);
    const result = await createTradeAction({
      mutationKey,
      tradingAccountId: values.tradingAccountId,
      recordingTiming: 'at_entry',
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
      plannedRiskMinor: planBasis === 'money' && plannedRisk?.ok ? plannedRisk.value : null,
      plannedRewardMinor: planBasis === 'money' && plannedReward?.ok ? plannedReward.value : null,
      timeframe: values.timeframe,
      session: values.session,
      confirmationNotes: values.confirmationNotes,
      ...(confidence === undefined ? {} : { confidence }),
      ...(feelingsRecorded ? { emotionKeys } : {}),
      tradingviewUrl: values.tradingviewUrl,
      notes: values.notes,
      chartAttachmentStorageKey: null,
      ...(advancedOpening
        ? {
            actualResultMode: openingBasis,
            actualEntry: openingBasis === 'price' ? values.actualEntry : null,
            actualInitialStop: openingBasis === 'price' ? values.actualStop : null,
            actualInitialRiskMinor: openingRisk?.ok ? openingRisk.value : null,
            actualPositionSize:
              openingBasis === 'price' && values.actualPositionSize.trim() !== ''
                ? values.actualPositionSize
                : null,
          }
        : {}),
      enteredAt: entered.ok ? entered.value : '',
    });
    setPending(false);
    if (!result.ok) {
      const mapped: ErrorMap = {};
      for (const field of Object.keys(result.error.fieldErrors ?? {}))
        mapped[field] = r('validation.invalidField');
      setErrors(mapped);
      setFormError(t(`errors.${result.error.code}`));
      return;
    }
    router.push(`/app/trades?trade=${result.data.tradeId}`);
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <p
        data-recording-mode="at_entry"
        className="text-muted-foreground mx-auto max-w-prose text-center text-sm text-pretty"
      >
        {tMode('at_entry.description')} <TradeRecordingModeChange isDirty={isDirty} />
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
        data-at-entry-linear-form=""
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="grid min-w-0 gap-5"
      >
        <section className="border-border bg-card grid min-w-0 gap-5 rounded-xl border p-4 sm:p-6">
          <SectionHeading
            number="1"
            title={e('trade.title')}
            description={e('trade.description')}
          />
          <div className="grid min-w-0 gap-5 sm:grid-cols-3">
            <div className="grid min-w-0 gap-1.5 sm:col-span-2">
              <label htmlFor="entry-account" className="text-sm font-medium">
                {t('field.account')}
              </label>
              <NativeSelect
                id="entry-account"
                value={values.tradingAccountId}
                aria-invalid={errors.tradingAccountId !== undefined}
                aria-describedby={
                  errors.tradingAccountId === undefined ? undefined : 'entry-account-error'
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
                <p id="entry-account-error" role="alert" className="text-destructive text-sm">
                  {errors.tradingAccountId}
                </p>
              )}
            </div>
            <Field
              id="entry-symbol"
              label={t('field.symbol')}
              value={values.symbol}
              onChange={(value) => setField('symbol', value.toUpperCase())}
              error={errors.symbol}
              placeholder="XAUUSD"
            />
          </div>
          <ChoiceGroup
            legend={t('field.direction')}
            name="entry-direction"
            value={values.direction}
            onChange={(value) => setField('direction', value)}
            error={errors.direction}
            options={[
              { value: 'long', label: t('direction.long') },
              { value: 'short', label: t('direction.short') },
            ]}
          />
          <div className="grid min-w-0 gap-1.5 sm:max-w-sm">
            <Field
              id="entry-entered-at"
              type="datetime-local"
              label={e('trade.entryTime')}
              value={enteredAtValue}
              onChange={(value) => setField('enteredAt', value)}
              error={errors.enteredAt}
              hint={e('trade.timezone', { timezone })}
            />
            {values.enteredAt === '' && enteredAtValue !== '' ? (
              <p data-entry-time-now="" className="text-muted-foreground text-xs">
                {e('trade.setToNow')}
              </p>
            ) : null}
          </div>
        </section>

        <section
          data-plan-at-entry=""
          className="border-primary/50 bg-card ring-primary/10 grid min-w-0 gap-5 rounded-xl border-2 p-4 ring-4 sm:p-6"
        >
          <SectionHeading
            number="2"
            title={e('plan.title')}
            description={e('plan.description')}
            strong
          />

          {planBasis === 'money' ? (
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id="entry-risk"
                label={e('plan.risk')}
                value={values.plannedRisk}
                onChange={(value) => setField('plannedRisk', value)}
                error={errors.plannedRisk}
                inputMode="decimal"
                hint={e('plan.riskHint', { currency })}
              />
              <Field
                id="entry-target-profit"
                label={e('plan.targetProfit')}
                value={values.plannedReward}
                onChange={(value) => setField('plannedReward', value)}
                error={errors.plannedReward}
                inputMode="decimal"
                hint={e('plan.targetHint', { currency })}
                optional
              />
            </div>
          ) : (
            <div className="grid min-w-0 gap-3">
              <p className="text-muted-foreground text-xs">{e('plan.priceHint')}</p>
              <div className="grid min-w-0 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Field
                  id="entry-plan-entry"
                  label={r('plannedEntry')}
                  value={values.plannedEntry}
                  onChange={(value) => setField('plannedEntry', value)}
                  error={errors.plannedEntry}
                  inputMode="decimal"
                />
                <Field
                  id="entry-plan-stop"
                  label={r('plannedStop')}
                  value={values.plannedStop}
                  onChange={(value) => setField('plannedStop', value)}
                  error={errors.plannedStop}
                  inputMode="decimal"
                />
                <Field
                  id="entry-plan-target"
                  label={r('takeProfit')}
                  value={values.plannedTarget}
                  onChange={(value) => setField('plannedTarget', value)}
                  inputMode="decimal"
                  optional
                />
                <Field
                  id="entry-plan-size"
                  label={t('field.positionSizeSimple')}
                  value={values.plannedPositionSize}
                  onChange={(value) => setField('plannedPositionSize', value)}
                  inputMode="decimal"
                  optional
                />
              </div>
            </div>
          )}

          {/*
            ONE DERIVED LINE, AND ONLY WHEN IT MEANS SOMETHING. Absent until the
            engine can resolve Target R from both halves of the plan; a blank
            target is not a zero-R target.
          */}
          {targetR === null ? null : (
            <div
              data-target-r=""
              className="border-border flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t pt-3"
            >
              <span className="text-muted-foreground text-sm">{e('plan.targetR')}</span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                {oneR === null ? null : (
                  <span className="text-muted-foreground numeric text-xs break-all">
                    {e('plan.oneR', { amount: oneR })}
                  </span>
                )}
                <strong className="numeric">{formatR(targetR)}</strong>
              </span>
            </div>
          )}

          <div className="grid min-w-0 gap-3">
            <Button
              type="button"
              variant="ghost"
              data-plan-basis-switch={planBasis}
              className="text-muted-foreground min-h-11 justify-self-start px-2"
              onClick={() => changePlanBasis(planBasis === 'money' ? 'price' : 'money')}
            >
              {planBasis === 'money' ? e('plan.usePrice') : e('plan.useMoney')}
            </Button>
            {moneyDecidingBasis === 'price' ? (
              <PriceHasNoMoneyNotice message={r('priceHasNoMoney')} />
            ) : null}
          </div>

          <div className="border-border grid min-w-0 gap-5 border-t pt-5">
            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <div className="grid min-w-0 gap-1.5">
                <label htmlFor="entry-strategy" className="text-sm font-medium">
                  {t('field.strategy')}{' '}
                  <span className="text-muted-foreground font-normal">· optional</span>
                </label>
                <NativeSelect
                  id="entry-strategy"
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
                <label htmlFor="entry-setup" className="text-sm font-medium">
                  {t('field.setup')}{' '}
                  <span className="text-muted-foreground font-normal">· optional</span>
                </label>
                <NativeSelect
                  id="entry-setup"
                  value={values.setupId}
                  disabled={selectedStrategy === undefined}
                  aria-invalid={errors.setupId !== undefined}
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
                {errors.setupId === undefined ? null : (
                  <p role="alert" className="text-destructive text-sm">
                    {errors.setupId}
                  </p>
                )}
              </div>
            </div>

            {selectedSetup !== undefined && conditionCount === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('create.conditions.notConfigured')}
              </p>
            ) : null}
            {/*
              Open, not collapsed: at entry the checklist is something the trader
              is doing right now, and it appears only once a Setup is chosen.
            */}
            {selectedSetup !== undefined && conditionCount > 0 ? (
              <fieldset className="border-border grid min-w-0 gap-2 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">{e('plan.setupChecklist')}</legend>
                <p className="text-muted-foreground text-xs">{e('plan.setupHint')}</p>
                <p className="text-muted-foreground text-xs">
                  {t('create.conditions.adherence', {
                    met: metConditionCount,
                    total: conditionCount,
                    percentage: Math.round((metConditionCount / conditionCount) * 100),
                  })}
                </p>
                {selectedSetup.conditions.map((condition) => (
                  <label
                    key={condition.conditionKey}
                    className="flex min-h-11 min-w-0 items-center gap-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0"
                      checked={conditionMet[condition.conditionKey] === true}
                      onChange={(event) =>
                        setConditionMet((current) => ({
                          ...current,
                          [condition.conditionKey]: event.target.checked,
                        }))
                      }
                    />
                    <span className="min-w-0 break-words">{condition.label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}

            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <Field
                id="entry-timeframe"
                label={t('field.timeframe')}
                value={values.timeframe}
                onChange={(value) => setField('timeframe', value)}
                optional
              />
              <Field
                id="entry-session"
                label={t('field.session')}
                value={values.session}
                onChange={(value) => setField('session', value)}
                optional
              />
            </div>
          </div>

          {/*
            THE OPENING OVERRIDE, KEPT AND KEPT OUT OF THE WAY. By default the
            server opens the Trade from the plan; this is the one place a trader
            says the actual opening differed.
          */}
          <details
            data-advanced-opening=""
            className="border-border rounded-lg border px-3 py-2"
            onToggle={(event) => {
              if (!(event.currentTarget as HTMLDetailsElement).open && advancedOpening) {
                setAdvancedOpening(false);
                resetOpening(planBasis);
              }
            }}
          >
            <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 cursor-pointer items-center rounded-md text-sm font-medium outline-none focus-visible:ring-2">
              {r('advanced')}
            </summary>
            <div className="grid min-w-0 gap-5 pb-2">
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  className="size-4 shrink-0"
                  checked={advancedOpening}
                  onChange={(event) => {
                    setAdvancedOpening(event.target.checked);
                    resetOpening(planBasis);
                  }}
                />
                {r('openingDiffers')}
              </label>
              {advancedOpening ? (
                <>
                  <ChoiceGroup
                    legend={r('actualOpeningBy')}
                    name="entry-opening-basis"
                    value={openingBasis}
                    onChange={resetOpening}
                    options={[
                      { value: 'money', label: r('money') },
                      { value: 'price', label: r('price') },
                    ]}
                  />
                  {openingBasis === 'price' ? (
                    <div className="grid min-w-0 gap-5 sm:grid-cols-3">
                      <Field
                        id="entry-opening-entry"
                        label={r('actualEntry')}
                        value={values.actualEntry}
                        onChange={(value) => setField('actualEntry', value)}
                        error={errors.actualEntry}
                        inputMode="decimal"
                      />
                      <Field
                        id="entry-opening-stop"
                        label={r('actualStop')}
                        value={values.actualStop}
                        onChange={(value) => setField('actualStop', value)}
                        error={errors.actualStop}
                        inputMode="decimal"
                      />
                      <Field
                        id="entry-opening-size"
                        label={t('field.actualPositionSize')}
                        value={values.actualPositionSize}
                        onChange={(value) => setField('actualPositionSize', value)}
                        inputMode="decimal"
                        optional
                      />
                    </div>
                  ) : (
                    <Field
                      id="entry-opening-risk"
                      label={r('initialRisk')}
                      value={values.actualRisk}
                      onChange={(value) => setField('actualRisk', value)}
                      error={errors.actualRisk}
                      inputMode="decimal"
                      hint={currency}
                    />
                  )}
                </>
              ) : null}
            </div>
          </details>
        </section>

        <section className="border-border bg-card grid min-w-0 gap-4 rounded-xl border p-4 sm:p-6">
          <SectionHeading
            number="3"
            title={e('journal.title')}
            description={e('journal.description')}
          />
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <JournalLauncher
              ref={ideaTrigger}
              icon={<Lightbulb className="size-5" aria-hidden="true" />}
              label={e('journal.idea.label')}
              prompt={e('journal.idea.prompt')}
              summary={values.confirmationNotes.trim() || null}
              onClick={() => openJournal('idea')}
            />
            <JournalLauncher
              ref={feelingsTrigger}
              icon={<HeartPulse className="size-5" aria-hidden="true" />}
              label={e('journal.feelings.label')}
              prompt={e('journal.feelings.prompt')}
              summary={
                feelingsRecorded
                  ? e('journal.feelings.summary', {
                      count: emotionKeys.length,
                      confidence: values.confidence || e('journal.notRecorded'),
                    })
                  : null
              }
              onClick={() => openJournal('feelings')}
            />
          </div>
        </section>

        <div
          data-global-save=""
          className="border-border bg-card/95 pb-safe sticky bottom-0 z-10 rounded-xl border px-4 backdrop-blur-sm sm:static sm:px-6 sm:backdrop-blur-none"
        >
          <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground text-sm">{e('save.helper')}</p>
            <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={pending}>
              {pending ? r('saving') : e('save.action')}
            </Button>
          </div>
        </div>
      </form>

      <TradeAdaptiveOverlay
        open={journalArea === 'idea'}
        onOpenChange={(open) => {
          if (!open) setJournalArea(null);
        }}
        title={e('journal.idea.label')}
        description={e('journal.idea.description')}
        closeLabel={t('lifecycle.common.close')}
        returnFocusRef={ideaTrigger}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {e('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="entry-idea" className="text-sm font-medium">
              {e('journal.idea.prompt')}
            </label>
            <Textarea
              id="entry-idea"
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
            id="entry-chart-link"
            type="url"
            inputMode="url"
            label={r('chartLink')}
            value={journalDraft.tradingviewUrl}
            onChange={(value) =>
              setJournalDraft((current) => ({ ...current, tradingviewUrl: value }))
            }
            optional
          />
          <div className="grid gap-1.5">
            <label htmlFor="entry-notes" className="text-sm font-medium">
              {e('journal.idea.notes')}
            </label>
            <Textarea
              id="entry-notes"
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
        title={e('journal.feelings.label')}
        description={e('journal.feelings.description')}
        closeLabel={t('lifecycle.common.close')}
        returnFocusRef={feelingsTrigger}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {e('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="grid min-w-0 gap-5">
          <TradeConfidenceControl
            id="entry-confidence"
            label={t('field.confidence')}
            hint={e('journal.feelings.confidenceHint')}
            value={confidenceOf(journalDraft.confidence) ?? null}
            onChange={(value) =>
              setJournalDraft((current) => ({
                ...current,
                confidence: value === null ? '' : String(value),
              }))
            }
          />
          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold">{e('journal.feelings.emotions')}</legend>
            {emotionGroups.map((group) => (
              <div key={group.key} data-emotion-group={group.key} className="grid gap-2">
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
                        className={
                          selected
                            ? 'focus-visible:ring-ring border-primary bg-primary/10 min-h-11 rounded-full border px-4 text-sm outline-none focus-visible:ring-2'
                            : 'focus-visible:ring-ring border-border hover:bg-accent min-h-11 rounded-full border px-4 text-sm outline-none focus-visible:ring-2'
                        }
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
