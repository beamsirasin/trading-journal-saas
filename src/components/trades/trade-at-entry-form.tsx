'use client';

import { BarChart3, CircleAlert, Clock, GitBranch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState, useSyncExternalStore } from 'react';

import { composePlannedR } from '@/lib/calc/trade';
import { generateId } from '@/lib/identifiers';
import { CONFIDENCE_LEVELS, confidenceLevelKey } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { createTradeAction } from '@/server/actions/trades';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { useRouter } from '@/i18n/navigation';

import {
  activeClassification,
  analysisSummary,
  answerCondition,
  answerNoEmotions,
  answerNoSetup,
  answerNoStrategy,
  AT_ENTRY_FIELD_SECTION,
  atEntryReadiness,
  buildAtEntryPayload,
  canDeselectEmotion,
  clearEntryTime,
  confirmEntryTime,
  createAtEntryDraft,
  editEntryTime,
  followClock,
  hasUserWork,
  removeEmotionsAnswer,
  removeSetupAnswer,
  removeStrategyAnswer,
  resetEntryTimeToNow,
  resolveExitPlan,
  sectionErrorCount,
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
import {
  Chip,
  ChoiceGroup,
  Disclosure,
  GroupHeading,
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
import { instantToDatetimeLocal, parseTradeMoneyInput } from './trade-form-values';
import { formatR } from './trade-format';
import { TradeRecordingModeChange } from './trade-recording-mode-change';
import { groupEmotionCatalog } from './trade-recording-primitives';
import { useKeyboardObscuringViewport } from './trade-recording-surface';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

const NONE = '__none';
const RECENT_SYMBOL_LIMIT = 3;

/**
 * ONE SAVE, NEVER TWO IN THE DOCUMENT. The sticky desktop panel and the docked
 * phone bar are two compositions of the same action, so only the one matching
 * the viewport is rendered. CSS alone would leave both in the document, which
 * is two identical buttons to anything reading the page rather than looking at
 * it. Both keep their responsive classes, so the frame between a server render
 * and hydration never shows the wrong one.
 */
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

/** Where a failed Save sends focus for each field — always a real, focusable control. */
const FIELD_TARGET_ID: Readonly<Record<AtEntryField, string>> = {
  tradingAccountId: 'entry-account',
  symbol: 'entry-symbol',
  direction: 'entry-direction-long',
  risk: 'entry-risk',
  actualRiskAmount: 'entry-actual-risk',
  enteredAt: 'entry-time',
  targetProfit: 'entry-target-profit',
  targetPrice: 'entry-target-price',
  contextEntryPrice: 'entry-context-entry-price',
  contextStopPrice: 'entry-context-stop-price',
  contextPositionSize: 'entry-context-size',
};

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

/** A control is a valid focus target only while it is actually rendered. */
function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/**
 * AT ENTRY — "Record an open trade", Add Trade contract v1.
 *
 * READING ORDER ANSWERS THE MOMENT'S QUESTION. The trade, then risk and plan,
 * then the trader's read on it, then optional context. Risk at Entry is the one
 * lead figure and the 1R baseline; Actual Risk is shown as a visible, reversible
 * assumption; Target and Exit Plan are independent answers; price is context.
 *
 * ALL SEMANTICS LIVE IN `at-entry-draft`. This component renders a draft and
 * applies that module's transitions: preserved inactive work, explicit Remove
 * answer, the last-emotion guard, the state-neutral Exit Plan editor, and a
 * readiness derived from the same error set Save uses.
 *
 * ONE SAVE. On desktop it sits in a sticky panel beside the form with what is
 * still needed; on phones it docks to the bottom and yields to the keyboard.
 * Only one of the two is ever rendered at a time.
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
  const c = useTranslations('trades.create.recording.contractEntry');
  const router = useRouter();
  const hydrated = useIsHydrated();
  const keyboardOpen = useKeyboardObscuringViewport();
  const wide = useIsWideViewport();
  const symbolFavorites = useTradePlanFavorites('symbol', options.workspaceId);
  const [mutationKey] = useState(generateId);
  const formId = useId();
  const ids = { trade: useId(), plan: useId(), read: useId() };

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
  const [storedDraft, setStoredDraft] = useState(pristine);
  const [accountPickerOpen, setAccountPickerOpen] = useState(initialAccount === '');
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AtEntryErrors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emotionHint, setEmotionHint] = useState(false);

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
        return c('errors.invalidDatetime');
      case 'invalid_price':
        return c('errors.invalidPrice');
      case 'fixed_target_requires_value':
        return c('errors.fixedTargetRequiresValue');
      case 'actual_risk_equals_risk_at_entry':
        return c('errors.actualRiskEqualsRiskAtEntry');
    }
  }

  const requirements = [
    { key: 'account', field: 'tradingAccountId', done: draft.tradingAccountId !== '' },
    { key: 'symbol', field: 'symbol', done: draft.symbol.trim() !== '' },
    { key: 'direction', field: 'direction', done: draft.direction !== '' },
    { key: 'risk', field: 'risk', done: validation.riskMinor !== null },
  ] as const;
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

  function focusFirstError(fields: readonly AtEntryField[]) {
    // Two frames: the first lets a section just opened commit, the second measures it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const field of fields) {
          const target = document.getElementById(FIELD_TARGET_ID[field]);
          if (target !== null && isRendered(target)) {
            target.focus();
            return;
          }
        }
        const status = Array.from(
          document.querySelectorAll<HTMLElement>('[data-save-status]'),
        ).find(isRendered);
        status?.focus();
      }),
    );
  }

  async function submit() {
    setAttempted(true);
    setServerErrors({});
    const current = followClock(storedDraft, nowLocal());
    const currentValidation = validateAtEntryDraft(current, { currency, timezone });
    const currentReadiness = atEntryReadiness(currentValidation);
    if (currentReadiness.status === 'blocked') {
      setServerMessage(null);
      if (currentReadiness.fields.includes('tradingAccountId')) setAccountPickerOpen(true);
      if (currentReadiness.fields.some((field) => AT_ENTRY_FIELD_SECTION[field] === 'context')) {
        setContextOpen(true);
      }
      focusFirstError(currentReadiness.fields);
      return;
    }
    const payload = buildAtEntryPayload(current, { currency, timezone, mutationKey, options });
    if (payload === null) return;

    setPending(true);
    setServerMessage(null);
    const result = await createTradeAction(payload);
    setPending(false);
    if (!result.ok) {
      const mapped: AtEntryErrors = {};
      for (const key of Object.keys(result.error.fieldErrors ?? {})) {
        const field = SERVER_FIELD[key];
        if (field !== undefined) mapped[field] = 'invalid_price';
      }
      setServerErrors(mapped);
      setServerMessage(t(`errors.${result.error.code}`));
      return;
    }
    symbolFavorites.recordUse(payload.symbol);
    router.push(`/app/trades?trade=${result.data.tradeId}`);
  }

  const contextErrorCount = sectionErrorCount(visibleErrors, 'context');
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

  const recentSymbols = symbolFavorites.recents.slice(0, RECENT_SYMBOL_LIMIT);

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <p
        data-recording-mode="at_entry"
        className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
      >
        <span>{c('subtitle')}</span>
        <TradeRecordingModeChange isDirty={hasUserWork(storedDraft, pristine)} />
      </p>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-8">
        <form
          id={formId}
          data-at-entry-linear-form=""
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="bg-card border-border shadow-card flex min-w-0 flex-col rounded-xl border"
        >
          {/* 1 — THE TRADE */}
          <section
            aria-labelledby={ids.trade}
            className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6"
          >
            <GroupHeading id={ids.trade} title={c('sections.trade')} />

            {accountPickerOpen || selectedAccount === undefined ? (
              <SelectField
                id="entry-account"
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
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
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
                  id="entry-symbol"
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
                idPrefix="entry-direction"
                legend={c('direction.label')}
                value={draft.direction === '' ? null : draft.direction}
                compact
                error={errorText('direction')}
                onChange={(direction) => apply((current) => ({ ...current, direction }))}
                options={[
                  { value: 'long', label: c('direction.long') },
                  { value: 'short', label: c('direction.short') },
                ]}
              />
            </div>

            <EntryTimeField
              draft={draft}
              timezone={timezone}
              error={errorText('enteredAt')}
              onEdit={(value) => apply((current) => editEntryTime(current, value))}
              onConfirm={() => apply(confirmEntryTime)}
              onClear={() => apply(clearEntryTime)}
              onUseNow={() => apply((current) => resetEntryTimeToNow(current, nowLocal()))}
            />
          </section>

          {/* 2 — RISK AND PLAN */}
          <section
            aria-labelledby={ids.plan}
            className="border-border flex min-w-0 flex-col gap-6 border-t px-4 py-5 sm:px-6 sm:py-6"
          >
            <GroupHeading id={ids.plan} title={c('sections.plan')} />

            <div className="flex min-w-0 flex-col gap-3">
              <TextField
                id="entry-risk"
                label={c('risk.label')}
                value={draft.risk}
                onChange={(risk) => apply((current) => ({ ...current, risk }))}
                suffix={currency}
                inputMode="decimal"
                size="lead"
                figure
                hint={c('risk.hint')}
                error={errorText('risk')}
              />
              <ActualRiskField
                draft={draft}
                currency={currency}
                riskIsValid={validation.riskMinor !== null}
                error={errorText('actualRiskAmount')}
                onMode={(mode) => apply((current) => setActualRiskMode(current, mode))}
                onAmount={(amount) => apply((current) => setActualRiskAmount(current, amount))}
              />
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              <ChoiceGroup
                idPrefix="entry-target"
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
                    id="entry-target-profit"
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
                    id="entry-target-price"
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
              {targetR === null ? null : (
                <p className="text-muted-foreground text-sm">
                  {c('target.reachR', { r: targetR })}
                </p>
              )}
            </div>

            <AtEntryExitPlan
              draft={draft}
              options={options}
              onChange={(next) => apply(() => next)}
            />
          </section>

          {/* 3 — THE TRADER'S READ (core analytical data, optional to save) */}
          <section
            aria-labelledby={ids.read}
            className="border-border flex min-w-0 flex-col gap-5 border-t px-4 py-5 sm:px-6 sm:py-6"
          >
            <GroupHeading
              id={ids.read}
              title={c('sections.read')}
              description={c('sections.readDescription')}
              aside={
                <span className="text-muted-foreground hidden items-center gap-1.5 text-sm lg:inline-flex">
                  <BarChart3 className="size-4" aria-hidden="true" />
                  {c('sections.usedInAnalytics')}
                </span>
              }
            />
            <Disclosure
              id="entry-analysis-toggle"
              title={analysisOpen ? c('summary.hide') : c('summary.open')}
              summary={
                <span data-analysis-summary="" className="flex min-w-0 flex-col">
                  {(analysisLines.length === 0 ? [c('summary.notAnswered')] : analysisLines).map(
                    (line) => (
                      <span key={line} className="block min-w-0 break-words">
                        {line}
                      </span>
                    ),
                  )}
                </span>
              }
              open={analysisOpen}
              onToggle={() => setAnalysisOpen((open) => !open)}
              openFromDesktop
            >
              <div className="flex min-w-0 flex-col gap-6 pb-2">
                <StrategyFields
                  draft={draft}
                  options={options}
                  inheritedPlanName={
                    exitPlan.resolved.status === 'inherited' ? exitPlan.resolved.plan.name : null
                  }
                  onSelectStrategy={(value) =>
                    apply((current) =>
                      value === ''
                        ? removeStrategyAnswer(current)
                        : value === NONE
                          ? answerNoStrategy(current)
                          : selectStrategy(current, value),
                    )
                  }
                  onSelectSetup={(value) =>
                    apply((current) =>
                      value === ''
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
                {active.strategy === null ? null : null}
                <div className="border-border border-t pt-5">
                  <ChoiceGroup
                    idPrefix="entry-confidence"
                    legend={c('confidence.label')}
                    value={draft.confidence === null ? null : String(draft.confidence)}
                    status={c('notAnswered')}
                    columns={5}
                    compact
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
                  <Helper>{c('confidence.hint')}</Helper>
                </div>
                <div className="border-border border-t pt-5">
                  <EmotionFields
                    draft={draft}
                    catalog={options.emotionCatalog}
                    showLastOneHint={emotionHint}
                    onToggle={(key) => {
                      if (!canDeselectEmotion(draft, key)) {
                        setEmotionHint(true);
                        return;
                      }
                      setEmotionHint(false);
                      apply((current) => toggleEmotion(current, key));
                    }}
                    onNone={() => {
                      setEmotionHint(false);
                      apply(answerNoEmotions);
                    }}
                    onRemove={() => {
                      setEmotionHint(false);
                      apply(removeEmotionsAnswer);
                    }}
                  />
                </div>
              </div>
            </Disclosure>
          </section>

          {/* 4 — CONTEXT */}
          <section className="border-border min-w-0 border-t px-2 py-3 sm:px-3">
            <Disclosure
              id="entry-context-toggle"
              title={c('sections.context')}
              summary={
                contextErrorCount > 0 ? (
                  <span className="text-destructive inline-flex min-w-0 items-center gap-1.5">
                    <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                    {c('summary.hasErrors', { count: contextErrorCount })}
                  </span>
                ) : contextFilled === 0 ? (
                  c('summary.contextEmpty')
                ) : (
                  c('summary.contextFilled', { count: contextFilled })
                )
              }
              open={contextOpen}
              onToggle={() => setContextOpen((open) => !open)}
            >
              <ContextFields
                draft={draft}
                notices={validation.notices}
                errorText={errorText}
                onChange={(patch) =>
                  apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
                }
              />
            </Disclosure>
          </section>

          {/* Phones and tablets: one docked action bar that yields to the keyboard. */}
          {wide ? null : (
            <div
              data-global-save=""
              data-action-bar={keyboardOpen ? 'inline' : 'docked'}
              className={cn(
                'border-border bg-card flex min-w-0 items-center gap-3 rounded-b-xl border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden',
                !keyboardOpen && 'sticky bottom-0 z-20 shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.45)]',
              )}
            >
              <p
                data-save-status=""
                tabIndex={-1}
                aria-live="polite"
                className={cn('min-w-0 flex-1 text-sm leading-snug outline-none', statusTone)}
              >
                {statusLine}
              </p>
              <Button type="submit" size="lg" className="min-h-12 shrink-0" disabled={pending}>
                {pending ? c('save.saving') : c('save.action')}
              </Button>
            </div>
          )}
        </form>

        {/* Desktop: the save panel stays in view beside a long form. */}
        {wide ? (
          <aside
            aria-label={c('save.panelTitle')}
            className="hidden lg:sticky lg:top-[calc(var(--shell-header-height)+1.5rem)] lg:block"
          >
            <div
              data-global-save=""
              className="bg-card border-border shadow-card flex flex-col gap-4 rounded-xl border p-5"
            >
              <div>
                <h2 className="text-foreground text-base font-semibold">{c('save.panelTitle')}</h2>
                <p className="text-muted-foreground mt-0.5 text-sm">{c('save.panelDescription')}</p>
              </div>
              <ul className="flex flex-col gap-2.5">
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
              <Button
                type="submit"
                form={formId}
                size="lg"
                className="min-h-12 w-full"
                disabled={pending}
              >
                {pending ? c('save.saving') : c('save.action')}
              </Button>
              <p
                data-save-status=""
                tabIndex={-1}
                aria-live="polite"
                className={cn('text-sm outline-none', statusTone)}
              >
                {statusLine}
              </p>
              <p className="text-muted-foreground text-xs">{c('save.helper')}</p>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function EntryTimeField({
  draft,
  timezone,
  error,
  onEdit,
  onConfirm,
  onClear,
  onUseNow,
}: {
  draft: AtEntryDraft;
  timezone: string;
  error?: string | undefined;
  onEdit: (value: string) => void;
  onConfirm: () => void;
  onClear: () => void;
  onUseNow: () => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const { source, value } = draft.entryTime;
  const isDefault = source === 'default_now' && value !== '';
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <TextField
        id="entry-time"
        type="datetime-local"
        label={c('entryTime.label')}
        value={value}
        onChange={onEdit}
        figure
        dashed={isDefault}
        hint={c('entryTime.hint', { timezone })}
        error={error}
        labelAside={
          isDefault ? (
            <Tag tone="default" icon={<Clock className="size-3" aria-hidden="true" />}>
              {c('entryTime.defaulted')}
            </Tag>
          ) : source === 'cleared' ? (
            <StateText>{c('entryTime.notSet')}</StateText>
          ) : null
        }
      />
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {isDefault ? (
          <InlineAction onClick={onConfirm}>{c('entryTime.confirm')}</InlineAction>
        ) : null}
        {source === 'cleared' ? (
          <InlineAction onClick={onUseNow}>{c('entryTime.useNow')}</InlineAction>
        ) : value === '' ? null : (
          <InlineAction onClick={onClear}>{c('entryTime.clear')}</InlineAction>
        )}
      </div>
    </div>
  );
}

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

function StrategyFields({
  draft,
  options,
  inheritedPlanName,
  onSelectStrategy,
  onSelectSetup,
  onCondition,
}: {
  draft: AtEntryDraft;
  options: TradeCreateOptions;
  inheritedPlanName: string | null;
  onSelectStrategy: (value: string) => void;
  onSelectSetup: (value: string) => void;
  onCondition: (conditionKey: string, status: 'met' | 'not_met' | null) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const active = activeClassification(draft, options);
  const strategyValue =
    draft.classification.strategy === 'none'
      ? NONE
      : active.strategy === null
        ? ''
        : active.strategy.strategyId;
  const setupValue =
    active.setupAnswer === 'none' ? NONE : active.setup === null ? '' : active.setup.setupId;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <SelectField
            id="entry-strategy"
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
              ...options.strategies.map((strategy) => ({
                value: strategy.strategyId,
                label: strategy.name,
              })),
            ]}
          />
          {active.strategy !== null && inheritedPlanName !== null ? (
            <Notice
              icon={
                <GitBranch
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
              }
            >
              {c('strategy.suppliesExitPlan', {
                strategy: active.strategy.name,
                plan: inheritedPlanName,
              })}
            </Notice>
          ) : null}
        </div>
        <SelectField
          id="entry-setup"
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
            ...(active.strategy?.setups ?? []).map((setup) => ({
              value: setup.setupId,
              label: setup.name,
            })),
          ]}
        />
      </div>

      {active.setup === null || active.setup.conditions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-foreground text-sm font-medium">{c('strategy.conditions')}</p>
          <Helper>{c('strategy.conditionsHint')}</Helper>
          <ul className="divide-border mt-2 flex min-w-0 flex-col divide-y">
            {active.setup.conditions.map((condition) => {
              const value = active.conditionAnswers[condition.conditionKey] ?? null;
              return (
                <li key={condition.conditionKey} className="min-w-0 py-3">
                  <ChoiceGroup
                    idPrefix={`entry-condition-${condition.conditionKey}`}
                    legend={condition.label}
                    value={value}
                    compact
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
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function EmotionFields({
  draft,
  catalog,
  showLastOneHint,
  onToggle,
  onNone,
  onRemove,
}: {
  draft: AtEntryDraft;
  catalog: TradeCreateOptions['emotionCatalog'];
  showLastOneHint: boolean;
  onToggle: (key: string) => void;
  onNone: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  const { answer, keys } = draft.emotions;
  return (
    <fieldset className="min-w-0" data-emotions-answer={answer}>
      <Legend
        aside={
          answer === 'unanswered' ? (
            <StateText>{c('notAnswered')}</StateText>
          ) : (
            <InlineAction ariaLabel={c('emotions.removeAria')} onClick={onRemove}>
              {c('removeAnswer')}
            </InlineAction>
          )
        }
      >
        {c('emotions.legend')}
      </Legend>
      <div className="grid min-w-0 gap-x-6 gap-y-3 min-[560px]:grid-cols-2">
        {groupEmotionCatalog(catalog).map((group) => (
          <div key={group.key} className="flex min-w-0 flex-col gap-1.5">
            <p className="text-muted-foreground text-sm">
              {t(`create.recording.emotionGroups.${group.key}`)}
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.emotions.map((emotion) => (
                <Chip
                  key={emotion.key}
                  selected={answer === 'selected' && keys.includes(emotion.key)}
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
        <Chip selected={answer === 'none'} onClick={onNone}>
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
  draft: AtEntryDraft;
  notices: readonly ('stop_wrong_side' | 'target_wrong_side')[];
  errorText: (field: AtEntryField) => string | undefined;
  onChange: (patch: Partial<AtEntryDraft['context']>) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry.context');
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-3">
      <TextAreaField
        id="entry-context-reason"
        label={c('reason')}
        value={draft.context.reason}
        onChange={(reason) => onChange({ reason })}
        placeholder={c('reasonPlaceholder')}
      />
      <TextField
        id="entry-context-chart"
        label={c('chart')}
        value={draft.context.tradingviewUrl}
        onChange={(tradingviewUrl) => onChange({ tradingviewUrl })}
        inputMode="url"
        placeholder="https://www.tradingview.com/x/…"
      />
      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
        <TextField
          id="entry-context-timeframe"
          label={c('timeframe')}
          value={draft.context.timeframe}
          onChange={(timeframe) => onChange({ timeframe })}
          placeholder="15m"
        />
        <TextField
          id="entry-context-session"
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
            id="entry-context-entry-price"
            label={c('entryPrice')}
            value={draft.context.entryPrice}
            onChange={(entryPrice) => onChange({ entryPrice })}
            inputMode="decimal"
            figure
            error={errorText('contextEntryPrice')}
          />
          <TextField
            id="entry-context-stop-price"
            label={c('stopPrice')}
            value={draft.context.stopPrice}
            onChange={(stopPrice) => onChange({ stopPrice })}
            inputMode="decimal"
            figure
            error={errorText('contextStopPrice')}
          />
          <TextField
            id="entry-context-size"
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
        id="entry-context-notes"
        label={c('notes')}
        value={draft.context.notes}
        onChange={(notes) => onChange({ notes })}
      />
    </div>
  );
}
