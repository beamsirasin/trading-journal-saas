'use client';

import { BarChart3, CircleAlert, History, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { generateId } from '@/lib/identifiers';
import { CONFIDENCE_LEVELS, confidenceLevelKey, type OutcomeValue } from '@/lib/trades/constants';
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
import { datetimeLocalToIso, tradeMoneyInputValue } from './trade-form-values';
import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';
import { TradeRecordingModeChange } from './trade-recording-mode-change';
import { groupEmotionCatalog } from './trade-recording-primitives';
import { useKeyboardObscuringViewport } from './trade-recording-surface';
import { useTradePlanFavorites } from './use-trade-plan-favorites';

const NONE = '__none';
const RECENT_SYMBOL_LIMIT = 3;

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

function isRendered(element: Element): boolean {
  return element.getClientRects().length > 0;
}

interface SavedTrade {
  readonly tradeId: string;
  readonly symbol: string;
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
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
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
  const ids = { trade: useId(), result: useId(), plan: useId(), read: useId(), saved: useId() };
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
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<AfterTradeErrors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);
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

  function focusFirstError(fields: readonly AfterTradeField[]) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const field of fields) {
          const target = document.getElementById(fieldTargetId(field));
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
      if (sections.has('context')) setContextOpen(true);
      focusFirstError(currentReadiness.fields);
      return;
    }
    const payload = buildAfterTradePayload(current, {
      currency,
      timezone,
      now: currentNow,
      mutationKey,
      options,
    });
    if (payload === null) return;

    submitting.current = true;
    setPending(true);
    setServerMessage(null);
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
      const mapped: AfterTradeErrors = {};
      for (const key of Object.keys(result.error.fieldErrors ?? {})) {
        const field = SERVER_FIELD[key];
        if (field !== undefined && field !== 'exits') mapped[field] = 'invalid_price';
      }
      setServerErrors(mapped);
      setServerMessage(t(`errors.${result.error.code}`));
      return;
    }
    symbolFavorites.recordUse(payload.symbol);
    // Save → Persist: only now, with the Trade confirmed, does the draft go.
    onSaved?.();
    setSaved({ tradeId: result.data.tradeId, symbol: payload.symbol });
  }

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
            {a('saved.title')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {a('saved.description', { symbol: saved.symbol })}
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

  const contextErrorCount = Object.keys(visibleErrors).filter(
    (field) => afterTradeFieldSection(field as AfterTradeField) === 'context',
  ).length;
  const exitErrorCount = Object.keys(visibleErrors).filter(
    (field) => afterTradeFieldSection(field as AfterTradeField) === 'exits',
  ).length;
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

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <p
        data-recording-mode="after_trade"
        className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
      >
        <span>{a('subtitle')}</span>
        <TradeRecordingModeChange />
      </p>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-8">
        <form
          id={formId}
          data-after-trade-linear-form=""
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
            <GroupHeading id={ids.trade} title={a('sections.trade')} />

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
          </section>

          {/* 2 — WHAT HAPPENED */}
          <section
            aria-labelledby={ids.result}
            className="border-border flex min-w-0 flex-col gap-5 border-t px-4 py-5 sm:px-6 sm:py-6"
          >
            <GroupHeading
              id={ids.result}
              title={a('sections.result')}
              description={a('sections.resultDescription')}
            />
            <TextField
              id="after-finalPnl"
              label={a('result.finalPnl')}
              value={draft.finalPnl}
              onChange={(finalPnl) => apply((current) => ({ ...current, finalPnl }))}
              suffix={currency}
              inputMode="decimal"
              size="lead"
              figure
              hint={a('result.finalPnlHint', { currency })}
              error={errorText('finalPnl')}
            />
            <div className="flex min-w-0 flex-col gap-2">
              <ChoiceGroup
                idPrefix="after-outcome"
                legend={a('result.outcome')}
                value={draft.outcome}
                status={c('notAnswered')}
                columns={3}
                compact
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
            <div
              data-actual-r={validation.actualR.status}
              className="border-border flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">{a('result.actualR')}</p>
                <p className="text-muted-foreground text-xs">{a('result.actualRBasis')}</p>
              </div>
              {validation.actualR.status === 'known' ? (
                <p className="text-foreground text-lg font-semibold tabular-nums">
                  {formatR(validation.actualR.value)}
                </p>
              ) : (
                <p className="text-muted-foreground min-w-0 text-sm">
                  {a(`result.unavailable.${validation.actualR.reason}`)}
                </p>
              )}
            </div>
          </section>

          {/* 3 — RISK AND PLAN AT ENTRY */}
          <section
            aria-labelledby={ids.plan}
            className="border-border flex min-w-0 flex-col gap-6 border-t px-4 py-5 sm:px-6 sm:py-6"
          >
            <GroupHeading
              id={ids.plan}
              title={a('sections.plan')}
              description={a('sections.planDescription')}
            />
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
                error={draft.actualRisk.answer === 'matched' ? errorText('actualRisk') : undefined}
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
                    onChange={(amount) => apply((current) => setActualRiskAmount(current, amount))}
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
          </section>

          {/* 4 — EXIT HISTORY (supporting evidence) */}
          <section className="border-border min-w-0 border-t px-2 py-3 sm:px-3">
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
          </section>

          {/* 5 — THE TRADER'S READ (core analytical data, optional to save) */}
          <section
            aria-labelledby={ids.read}
            className="border-border flex min-w-0 flex-col gap-5 border-t px-4 py-5 sm:px-6 sm:py-6"
          >
            <GroupHeading
              id={ids.read}
              title={a('sections.read')}
              description={a('sections.readDescription')}
              aside={
                <span className="text-muted-foreground hidden items-center gap-1.5 text-sm lg:inline-flex">
                  <BarChart3 className="size-4" aria-hidden="true" />
                  {c('sections.usedInAnalytics')}
                </span>
              }
            />
            <Disclosure
              id="after-analysis-toggle"
              title={analysisOpen ? a('summary.hide') : a('summary.open')}
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
                <div className="border-border border-t pt-5">
                  <ChoiceGroup
                    idPrefix="after-confidence"
                    legend={a('confidence.label')}
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
                  <Helper>{a('confidence.hint')}</Helper>
                </div>
                {(['emotions', 'postTradeEmotions'] as const).map((phase) => (
                  <div key={phase} className="border-border border-t pt-5">
                    <EmotionFields
                      phase={phase}
                      answer={draft[phase]}
                      legend={
                        phase === 'emotions' ? a('emotions.entryLegend') : a('emotions.postLegend')
                      }
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
                  </div>
                ))}
              </div>
            </Disclosure>
          </section>

          {/* 6 — CONTEXT */}
          <section className="border-border min-w-0 border-t px-2 py-3 sm:px-3">
            <Disclosure
              id="after-context-toggle"
              title={a('sections.context')}
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
                notices={validation.notices.map((notice) => notice.kind)}
                errorText={errorText}
                onChange={(patch) =>
                  apply((current) => ({ ...current, context: { ...current.context, ...patch } }))
                }
              />
            </Disclosure>
          </section>

          {wide ? null : (
            <div
              data-global-save=""
              data-action-bar={keyboardOpen ? 'inline' : 'docked'}
              className={cn(
                'border-border bg-card flex min-w-0 flex-col gap-2 rounded-b-xl border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden',
                !keyboardOpen && 'sticky bottom-0 z-20 shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.45)]',
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <p
                  data-save-status=""
                  tabIndex={-1}
                  aria-live="polite"
                  className={cn('min-w-0 flex-1 text-sm leading-snug outline-none', statusTone)}
                >
                  {statusLine}
                </p>
                <Button type="submit" size="lg" className="min-h-12 shrink-0" disabled={pending}>
                  {pending ? a('save.saving') : a('save.action')}
                </Button>
              </div>
              {promptMissing ? (
                <p data-save-prompt="" className="text-muted-foreground text-xs">
                  {a('save.promptMissing')}
                </p>
              ) : null}
            </div>
          )}
        </form>

        {wide ? (
          <aside
            aria-label={a('save.panelTitle')}
            className="hidden lg:sticky lg:top-[calc(var(--shell-header-height)+1.5rem)] lg:block"
          >
            <div
              data-global-save=""
              className="bg-card border-border shadow-card flex flex-col gap-4 rounded-xl border p-5"
            >
              <div>
                <h2 className="text-foreground text-base font-semibold">{a('save.panelTitle')}</h2>
                <p className="text-muted-foreground mt-0.5 text-sm">{a('save.panelDescription')}</p>
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
              <div className="border-border flex flex-col gap-2 border-t pt-4">
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {a('save.recommendedTitle')}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {a('save.recommendedDescription')}
                  </p>
                </div>
                <ul data-save-prompt="" className="flex flex-col gap-1.5">
                  {recommended.map((item) => (
                    <li key={item.key} className="flex min-w-0 items-baseline gap-2 text-sm">
                      <span className="text-foreground">{a(`save.recommended.${item.key}`)}</span>
                      <StateText>
                        {item.done ? a('save.recorded') : a('save.notRecorded')}
                      </StateText>
                    </li>
                  ))}
                </ul>
              </div>
              <Button
                type="submit"
                form={formId}
                size="lg"
                className="min-h-12 w-full"
                disabled={pending}
              >
                {pending ? a('save.saving') : a('save.action')}
              </Button>
              <p
                data-save-status=""
                tabIndex={-1}
                aria-live="polite"
                className={cn('text-sm outline-none', statusTone)}
              >
                {statusLine}
              </p>
              <p className="text-muted-foreground text-xs">{a('save.helper')}</p>
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
      <div>
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden="true" />
          {a('exits.add')}
        </Button>
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
  const strategyValue =
    active.strategyAnswer === 'none'
      ? NONE
      : active.strategy === null
        ? ''
        : active.strategy.strategyId;
  const setupValue =
    active.setupAnswer === 'none' ? NONE : active.setup === null ? '' : active.setup.setupId;

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
        {legend}
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
