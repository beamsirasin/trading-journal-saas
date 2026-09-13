'use client';

import { HeartPulse, Lightbulb } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState } from 'react';

import { composePlannedR } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
import { confidenceLevelKey } from '@/lib/trades/constants';
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
import { TradeConfidenceChoice } from './trade-confidence-choice';
import { TradeEmotionChips } from './trade-emotion-chips';
import {
  datetimeLocalToIso,
  instantToDatetimeLocal,
  parseTradeMoneyInput,
} from './trade-form-values';
import { formatR, formatTradeMoney } from './trade-format';
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
const RECENT_SYMBOL_LIMIT = 3;

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 64 ? trimmed : `${trimmed.slice(0, 63)}…`;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * AT ENTRY — a trade that is still open, recorded on one task surface.
 *
 * THE COMPOSITION IS THE ACCEPTED PROTOTYPE'S. One card holds the trade: the
 * account as context with a way to change it, Symbol beside Direction, the entry
 * time already set to now, and the plan — Risk at entry as the one large figure,
 * Target profit beside it, Target R as a derived line. The Journal sits under the
 * card as one optional surface ("Now or later"), and the save action closes the
 * page. Strategy, Setup, the checklist, timeframe, session and the chart live in
 * the Trade idea, where they describe the trade rather than compete with its
 * numbers.
 *
 * THE CONTRACT IS PRODUCTION'S AND DID NOT MOVE. One `createTradeAction` call,
 * Money plan by default, the server copying the opening from the plan unless the
 * trader says it differed, the mutation key reused on retry, unmet conditions
 * confirmed before saving, and the same redirect.
 *
 * NOT MIGRATED, AND NOT PRETENDED. The prototype's explicit "No fixed target"
 * declaration and its structured Exit plan have no persistence: a blank Target
 * profit still means no target, and no exit plan row is shown.
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
  const symbolFavorites = useTradePlanFavorites('symbol', options.workspaceId);
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
  /* With nothing to show as context, the account starts as the decision it is. */
  const [accountPickerOpen, setAccountPickerOpen] = useState(initialAccount === '');
  const [planBasis, setPlanBasis] = useState<Basis>('money');
  const [advancedOpening, setAdvancedOpening] = useState(false);
  const [openingBasis, setOpeningBasis] = useState<Basis>('money');
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
  /*
    Only a SERVER refusal is held as state. The "check the highlighted fields"
    banner is derived from the field errors below, so it disappears the moment
    the last highlighted field is corrected instead of outliving every error.
  */
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmUnmetOpen, setConfirmUnmetOpen] = useState(false);

  /*
    ENTRY TIME FOLLOWS THE CLOCK UNTIL THE TRADER CHANGES IT — resolved after
    hydration only, so the server never renders a time the browser immediately
    contradicts.
  */
  const defaultEnteredAt = hydrated
    ? instantToDatetimeLocal(new Date().toISOString(), timezone)
    : '';
  const enteredAtValue = values.enteredAt === '' ? defaultEnteredAt : values.enteredAt;

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === values.tradingAccountId,
  );
  const currency = selectedAccount?.baseCurrency ?? 'USD';
  const committedStrategy = options.strategies.find(
    (item) => item.strategyId === values.strategyId,
  );
  const committedSetup = committedStrategy?.setups.find((item) => item.setupId === values.setupId);
  const draftStrategy = options.strategies.find(
    (item) => item.strategyId === journalDraft.strategyId,
  );
  const draftSetup = draftStrategy?.setups.find((item) => item.setupId === journalDraft.setupId);
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

  function toggleOpening() {
    setAdvancedOpening((current) => !current);
    resetOpening(planBasis);
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
  /* 1R in money only where the plan states it; never derived from price × size (CLAUDE.md §6). */
  const oneR =
    planBasis === 'money' && plannedRisk?.ok ? formatTradeMoney(plannedRisk.value, currency) : null;
  const moneyDecidingBasis = advancedOpening ? openingBasis : planBasis;

  const isDirty =
    emotions !== null ||
    Object.values(conditionMet).some(Boolean) ||
    (Object.keys(pristine) as (keyof Values)[]).some((key) => values[key] !== pristine[key]);

  const confidenceStep = confidenceOf(values.confidence);
  const ideaPreview = [
    values.confirmationNotes.trim() === '' ? null : excerpt(values.confirmationNotes),
    committedStrategy === undefined
      ? null
      : [committedStrategy.name, committedSetup?.name].filter(Boolean).join(' · '),
  ].filter(isPresent);
  if (
    ideaPreview.length === 0 &&
    [values.tradingviewUrl, values.notes, values.timeframe, values.session].some(
      (value) => value.trim() !== '',
    )
  ) {
    ideaPreview.push(e('journal.idea.detailsAdded'));
  }
  const feelingsParts = [
    confidenceStep === undefined
      ? null
      : e('journal.feelings.confidencePreview', {
          level: t(`create.confidence.level.${confidenceLevelKey(confidenceStep)}`),
        }),
    emotions === null
      ? null
      : emotions.length === 0
        ? e('journal.feelings.noneOfThese')
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
      if (next.tradingAccountId !== undefined) setAccountPickerOpen(true);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(
            '[data-at-entry-linear-form] :is([aria-invalid="true"], [data-invalid="true"])',
          )
          ?.focus(),
      );
      return;
    }

    const conditionAnswers = (committedSetup?.conditions ?? []).map((condition) => ({
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
    const symbol = values.symbol.trim().toUpperCase();

    setPending(true);
    setServerError(null);
    const result = await createTradeAction({
      mutationKey,
      tradingAccountId: values.tradingAccountId,
      recordingTiming: 'at_entry',
      systemPlanBasis: planBasis,
      ...(values.strategyId === '' ? {} : { strategyId: values.strategyId }),
      ...(values.setupId === '' ? {} : { setupId: values.setupId }),
      ...(committedSetup === undefined
        ? {}
        : { conditionSetToken: committedSetup.conditionSetToken, conditionAnswers }),
      symbol,
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
      ...(confidenceStep === undefined ? {} : { confidence: confidenceStep }),
      ...(emotions === null ? {} : { emotionKeys: [...emotions] }),
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
      setServerError(t(`errors.${result.error.code}`));
      return;
    }
    symbolFavorites.recordUse(symbol);
    router.push(`/app/trades?trade=${result.data.tradeId}`);
  }

  const formError =
    serverError ?? (Object.keys(errors).length > 0 ? r('validation.fixFields') : null);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
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
            : 'border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm'
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
        className="flex min-w-0 flex-col gap-3 md:gap-4"
      >
        <TaskSurface>
          <Band className="gap-3 py-3.5 sm:py-3.5">
            {accountPickerOpen || selectedAccount === undefined ? (
              <SelectField
                id="entry-account"
                label={t('field.account')}
                error={errors.tradingAccountId}
              >
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
              </SelectField>
            ) : (
              <ContextLine
                primary={selectedAccount.name}
                secondary={selectedAccount.baseCurrency}
                {...(options.tradingAccounts.length > 1
                  ? {
                      action: (
                        <QuietAction onClick={() => setAccountPickerOpen(true)}>
                          {e('trade.change')}{' '}
                          <span className="sr-only">{e('trade.changeAccountSr')}</span>
                        </QuietAction>
                      ),
                    }
                  : {})}
              />
            )}
          </Band>

          <Band>
            <SectionLabel className="sr-only">{e('trade.title')}</SectionLabel>
            <FieldPair>
              <div className="flex min-w-0 flex-col gap-1.5">
                <TextInputField
                  id="entry-symbol"
                  label={t('field.symbol')}
                  value={values.symbol}
                  onChange={(value) => setField('symbol', value.toUpperCase())}
                  error={errors.symbol}
                  placeholder="e.g. XAUUSD"
                />
                {recentSymbols.length === 0 ? null : (
                  <div
                    role="group"
                    aria-label={e('trade.recentSymbols')}
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
                errorId="entry-direction-error"
                options={[
                  { value: 'long', label: t('direction.long') },
                  { value: 'short', label: t('direction.short') },
                ]}
              />
            </FieldPair>

            <div className="flex min-w-0 flex-col gap-1">
              <p id="entry-timezone" className="text-subtle-foreground mb-1 text-xs">
                {e('trade.timezone', { timezone })}
              </p>
              <TextInputField
                id="entry-entered-at"
                type="datetime-local"
                label={e('trade.entryTime')}
                value={enteredAtValue}
                onChange={(value) => setField('enteredAt', value)}
                error={errors.enteredAt}
                extraDescribedBy="entry-timezone"
                numeric
              />
              {values.enteredAt === '' && enteredAtValue !== '' ? (
                <p data-entry-time-now="" className="text-subtle-foreground text-xs">
                  {e('trade.setToNow')}
                </p>
              ) : null}
            </div>
          </Band>

          <Band divided={false} className="gap-3 py-5 sm:py-5">
            <SectionLabel id="entry-plan-heading">{e('plan.title')}</SectionLabel>

            {planBasis === 'money' ? (
              <FieldPair>
                <PrimaryAmountField
                  id="entry-risk"
                  label={e('plan.risk')}
                  currency={currency}
                  value={values.plannedRisk}
                  onChange={(value) => setField('plannedRisk', value)}
                  hint={e('plan.riskHint')}
                  error={errors.plannedRisk}
                />
                <PrimaryAmountField
                  id="entry-target-profit"
                  label={e('plan.targetProfit')}
                  currency={currency}
                  value={values.plannedReward}
                  onChange={(value) => setField('plannedReward', value)}
                  error={errors.plannedReward}
                  optionalLabel={e('plan.optional')}
                />
              </FieldPair>
            ) : (
              <div className="flex min-w-0 flex-col gap-4">
                <InlineNote>{e('plan.priceHint')}</InlineNote>
                <FieldPair>
                  <TextInputField
                    id="entry-plan-entry"
                    label={r('plannedEntry')}
                    value={values.plannedEntry}
                    onChange={(value) => setField('plannedEntry', value)}
                    error={errors.plannedEntry}
                    inputMode="decimal"
                    numeric
                  />
                  <TextInputField
                    id="entry-plan-stop"
                    label={r('plannedStop')}
                    value={values.plannedStop}
                    onChange={(value) => setField('plannedStop', value)}
                    error={errors.plannedStop}
                    inputMode="decimal"
                    numeric
                  />
                </FieldPair>
                <FieldPair>
                  <TextInputField
                    id="entry-plan-target"
                    label={r('takeProfit')}
                    value={values.plannedTarget}
                    onChange={(value) => setField('plannedTarget', value)}
                    optionalLabel={e('plan.optional')}
                    inputMode="decimal"
                    numeric
                  />
                  <TextInputField
                    id="entry-plan-size"
                    label={t('field.positionSizeSimple')}
                    value={values.plannedPositionSize}
                    onChange={(value) => setField('plannedPositionSize', value)}
                    optionalLabel={e('plan.optional')}
                    inputMode="decimal"
                    numeric
                  />
                </FieldPair>
              </div>
            )}

            {/*
              ONE DERIVED LINE, AND ONLY WHEN IT MEANS SOMETHING. A hairline above
              it so the figure belongs to the amounts rather than floating after
              them; absent until the engine resolves Target R from both halves.
            */}
            {targetR === null ? null : (
              <div data-target-r="" className="border-border/70 min-w-0 border-t pt-3">
                <ResultLine
                  label={e('plan.targetR')}
                  value={formatR(targetR) ?? targetR}
                  detail={oneR === null ? undefined : e('plan.oneR', { amount: oneR })}
                />
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 pt-1">
              <QuietAction
                className="text-muted-foreground hover:text-foreground font-normal"
                onClick={() => changePlanBasis(planBasis === 'money' ? 'price' : 'money')}
              >
                {planBasis === 'money' ? e('plan.usePrice') : e('plan.useMoney')}
              </QuietAction>
              <QuietAction
                className="text-muted-foreground hover:text-foreground font-normal"
                expanded={advancedOpening}
                controls="entry-opening"
                onClick={toggleOpening}
              >
                {e('plan.openingDiffers')}
              </QuietAction>
            </div>

            {moneyDecidingBasis === 'price' ? (
              <InlineNote tone="warning" data-price-no-money-notice="">
                {r('priceHasNoMoney')}
              </InlineNote>
            ) : null}

            {advancedOpening ? (
              <div
                id="entry-opening"
                className="border-border flex min-w-0 flex-col gap-4 border-t pt-4"
              >
                <SegmentedChoice
                  legend={r('actualOpeningBy')}
                  value={openingBasis}
                  onChange={resetOpening}
                  errorId="entry-opening-basis-error"
                  options={[
                    { value: 'money', label: r('money') },
                    { value: 'price', label: r('price') },
                  ]}
                />
                {openingBasis === 'price' ? (
                  <FieldPair>
                    <TextInputField
                      id="entry-opening-entry"
                      label={r('actualEntry')}
                      value={values.actualEntry}
                      onChange={(value) => setField('actualEntry', value)}
                      error={errors.actualEntry}
                      inputMode="decimal"
                      numeric
                    />
                    <TextInputField
                      id="entry-opening-stop"
                      label={r('actualStop')}
                      value={values.actualStop}
                      onChange={(value) => setField('actualStop', value)}
                      error={errors.actualStop}
                      inputMode="decimal"
                      numeric
                    />
                    <TextInputField
                      id="entry-opening-size"
                      label={t('field.actualPositionSize')}
                      value={values.actualPositionSize}
                      onChange={(value) => setField('actualPositionSize', value)}
                      optionalLabel={e('plan.optional')}
                      inputMode="decimal"
                      numeric
                    />
                  </FieldPair>
                ) : (
                  <PrimaryAmountField
                    id="entry-opening-risk"
                    label={r('initialRisk')}
                    currency={currency}
                    value={values.actualRisk}
                    onChange={(value) => setField('actualRisk', value)}
                    error={errors.actualRisk}
                  />
                )}
              </div>
            ) : null}
          </Band>
        </TaskSurface>

        <JournalLauncherSurface
          headingId="entry-journal-heading"
          heading={e('journal.title')}
          aside={e('journal.aside')}
          areas={[
            {
              id: 'idea',
              label: e('journal.idea.label'),
              Icon: Lightbulb,
              invitation: e('journal.idea.prompt'),
              preview: ideaPreview,
              onOpen: () => openJournal('idea'),
              triggerRef: ideaTrigger,
            },
            {
              id: 'feelings',
              label: e('journal.feelings.label'),
              Icon: HeartPulse,
              invitation: e('journal.feelings.prompt'),
              preview: feelingsPreview,
              onOpen: () => openJournal('feelings'),
              triggerRef: feelingsTrigger,
            },
          ]}
        />

        <FormFooter
          action={e('save.action')}
          pendingLabel={r('saving')}
          pending={pending}
          helper={e('save.helper')}
        />
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
            <Button type="button" variant="ghost" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {e('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="entry-idea" className="text-muted-foreground text-xs font-medium">
              {e('journal.idea.prompt')}
            </label>
            <Textarea
              id="entry-idea"
              rows={4}
              placeholder={e('journal.idea.placeholder')}
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
              {e('journal.idea.strategyQuestion')}
            </p>
            <SelectField
              id="entry-strategy"
              label={t('field.strategy')}
              optionalLabel={e('plan.optional')}
              hint={e('journal.idea.strategyHint')}
            >
              <NativeSelect
                id="entry-strategy"
                value={journalDraft.strategyId}
                aria-describedby="entry-strategy-hint"
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
                id="entry-setup"
                label={t('field.setup')}
                optionalLabel={e('plan.optional')}
                hint={e('journal.idea.setupHint')}
              >
                <NativeSelect
                  id="entry-setup"
                  value={journalDraft.setupId}
                  aria-describedby="entry-setup-hint"
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

            {draftSetup !== undefined && draftSetup.conditions.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('create.conditions.notConfigured')}
              </p>
            ) : null}

            {draftSetup !== undefined && draftSetup.conditions.length > 0 ? (
              <fieldset className="border-border flex min-w-0 flex-col gap-1 border-y py-3">
                <legend className="text-foreground text-sm font-medium">
                  {e('journal.idea.checklistTitle')}
                </legend>
                <p className="text-muted-foreground text-xs">{e('journal.idea.checklistHint')}</p>
                <p className="text-muted-foreground text-xs">
                  {t('create.conditions.adherence', {
                    met: draftSetup.conditions.filter(
                      (condition) => journalDraft.conditionMet[condition.conditionKey] === true,
                    ).length,
                    total: draftSetup.conditions.length,
                    percentage: Math.round(
                      (draftSetup.conditions.filter(
                        (condition) => journalDraft.conditionMet[condition.conditionKey] === true,
                      ).length /
                        draftSetup.conditions.length) *
                        100,
                    ),
                  })}
                </p>
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
              id="entry-timeframe"
              label={t('field.timeframe')}
              optionalLabel={e('plan.optional')}
              value={journalDraft.timeframe}
              onChange={(timeframe) => setJournalDraft((current) => ({ ...current, timeframe }))}
            />
            <TextInputField
              id="entry-session"
              label={t('field.session')}
              optionalLabel={e('plan.optional')}
              value={journalDraft.session}
              onChange={(session) => setJournalDraft((current) => ({ ...current, session }))}
            />
          </FieldPair>

          <TextInputField
            id="entry-chart-link"
            type="url"
            inputMode="url"
            label={r('chartLink')}
            optionalLabel={e('plan.optional')}
            value={journalDraft.tradingviewUrl}
            placeholder="https://www.tradingview.com/x/…"
            onChange={(tradingviewUrl) =>
              setJournalDraft((current) => ({ ...current, tradingviewUrl }))
            }
          />

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="entry-notes" className="text-muted-foreground text-xs font-medium">
              {e('journal.idea.notes')}
            </label>
            <Textarea
              id="entry-notes"
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
        title={e('journal.feelings.label')}
        description={e('journal.feelings.description')}
        closeLabel={t('lifecycle.common.close')}
        returnFocusRef={feelingsTrigger}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setJournalArea(null)}>
              {t('lifecycle.common.cancel')}
            </Button>
            <Button type="button" onClick={commitJournal}>
              {e('journal.done')}
            </Button>
          </div>
        }
      >
        <div className="flex min-w-0 flex-col gap-6">
          <TradeConfidenceChoice
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
          <TradeEmotionChips
            legend={e('journal.feelings.emotions')}
            catalog={options.emotionCatalog}
            value={journalDraft.emotions}
            onChange={(next) => setJournalDraft((current) => ({ ...current, emotions: next }))}
            groupLabel={(key) => r(`emotionGroups.${key}`)}
            noneLabel={e('journal.feelings.noneOfThese')}
            notRecordedLabel={e('journal.notRecorded')}
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
