'use client';

import { ChevronRight, Plus, Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, useTransition } from 'react';

import { currentSystemGrossRPreview } from '@/lib/calc/system-assessment';
import {
  composeSystemResolveGrossOnly,
  composeSystemResolveV2,
  type ResolveSystemGrossRInput,
} from '@/lib/calc/trade';
import type {
  PlanAdherence,
  SystemExitReason,
  SystemPlanProvenance,
  SystemResolutionKind,
} from '@/lib/trades/constants';
import { tradeSystemAssessmentEligibility } from '@/lib/trades/system-assessment-view';
import { cn } from '@/lib/utils';
import {
  correctSystemResolutionAction,
  markSystemCannotDetermineAction,
  markSystemNoTradeAction,
  resolveSystemTradeAction,
} from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import {
  actionErrorCode,
  ActionFeedback,
  FormInput,
  TradeField,
} from '@/components/trades/trade-action-form';
import { TradeAdaptiveOverlay } from '@/components/trades/trade-adaptive-overlay';
import { TradeDateTimeInput } from '@/components/trades/trade-datetime-input';
import { datetimeLocalToIso } from '@/components/trades/trade-form-values';
import { formatR } from '@/components/trades/trade-format';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

type Answer = '' | 'yes' | 'no_trade' | 'cannot_determine';
type CloseChoice = '' | SystemExitReason | 'custom_r';
type FeedbackTarget = 'answer' | 'resolution' | 'action';

const PRICE_REASONS: readonly SystemExitReason[] = [
  'target_hit',
  'stop_hit',
  'break_even_rule',
  'trailing_exit',
  'time_exit',
  'rule_exit',
  'manual_system_valid_exit',
];

function initialAnswer(trade: TradeDetail): Answer {
  if (trade.systemStatus === 'resolved') return 'yes';
  if (trade.systemStatus === 'no_trade') return 'no_trade';
  if (trade.systemStatus === 'cannot_determine') return 'cannot_determine';
  return '';
}

function initialCloseChoice(trade: TradeDetail): CloseChoice {
  if (trade.systemStatus !== 'resolved') return '';
  if (trade.systemResolutionKind === 'money_custom') return 'custom_r';
  if (trade.systemResolutionKind?.startsWith('money_')) return trade.systemExitReason ?? '';
  return trade.systemExitReason ?? '';
}

function minor(value: string | null): bigint | null {
  return value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
}

function currentConfirmedPreview(trade: TradeDetail): string | null {
  const preview = currentSystemGrossRPreview({
    systemStatus: trade.systemStatus,
    systemResolutionKind: trade.systemResolutionKind,
    direction: trade.direction,
    plannedEntry: trade.plannedEntry,
    plannedStop: trade.plannedStop,
    plannedRiskMinor: minor(trade.plannedRiskMinor),
    plannedRewardMinor: minor(trade.plannedRewardMinor),
    systemExitPrice: trade.systemExitPrice,
    systemGrossRInput: trade.systemGrossRInput,
  });
  return preview?.ok ? preview.value : null;
}

function ChoiceGroup<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
  describedBy,
  invalid = false,
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  onChange: (value: T) => void;
  describedBy?: string | undefined;
  invalid?: boolean;
}) {
  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
    >
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const id = `${name}-${option.value || 'unanswered'}`;
          return (
            <label
              key={option.value || 'unanswered'}
              htmlFor={id}
              className={cn(
                'border-input bg-background flex min-h-12 min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm',
                'has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-2',
                value === option.value && 'border-primary bg-primary/5',
                option.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <input
                id={id}
                name={name}
                type="radio"
                className="size-4 shrink-0"
                checked={value === option.value}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
              />
              <span className="min-w-0 leading-snug">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function resolutionInput(
  trade: TradeDetail,
  choice: CloseChoice,
  exitPrice: string,
  grossR: string,
): ResolveSystemGrossRInput | null {
  const pricePlan = trade.plannedEntry !== null && trade.plannedStop !== null;
  if (choice === '') return null;

  let resolutionKind: SystemResolutionKind;
  let systemExitPrice: string | null = null;
  let systemGrossRInput: string | null = null;

  if (pricePlan) {
    resolutionKind = 'price_exit';
    systemExitPrice =
      choice === 'target_hit'
        ? trade.plannedTarget
        : choice === 'stop_hit'
          ? trade.plannedStop
          : choice === 'break_even_rule'
            ? trade.plannedEntry
            : exitPrice || null;
  } else if (choice === 'target_hit') {
    resolutionKind = 'money_target';
  } else if (choice === 'stop_hit') {
    resolutionKind = 'money_stop';
  } else if (choice === 'break_even_rule') {
    resolutionKind = 'money_break_even';
  } else {
    resolutionKind = 'money_custom';
    systemGrossRInput = grossR || null;
  }

  return {
    resolutionKind,
    direction: trade.direction,
    plannedEntry: trade.plannedEntry,
    plannedStop: trade.plannedStop,
    plannedRiskMinor: minor(trade.plannedRiskMinor),
    plannedRewardMinor: minor(trade.plannedRewardMinor),
    systemExitPrice,
    systemGrossRInput,
  };
}

export function SystemAssessmentLauncher({
  trade,
  timezone,
  canWrite,
}: {
  trade: TradeDetail;
  timezone: string;
  canWrite: boolean;
}) {
  const t = useTranslations('trades.lifecycle.system.assessment');
  const tErrors = useTranslations('trades');
  const router = useRouter();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);
  const [answer, setAnswer] = useState<Answer>(() => initialAnswer(trade));
  const [choice, setChoice] = useState<CloseChoice>(() => initialCloseChoice(trade));
  const [exitPrice, setExitPrice] = useState(trade.systemExitPrice ?? '');
  const [grossR, setGrossR] = useState(trade.systemGrossRInput ?? '');
  const [costR, setCostR] = useState(trade.systemCostR ?? '');
  const [provenance, setProvenance] = useState<SystemPlanProvenance>(
    trade.systemPlanProvenance ?? 'unknown',
  );
  const [adherence, setAdherence] = useState<PlanAdherence | ''>(trade.planAdherence ?? '');

  const eligibility = tradeSystemAssessmentEligibility(trade);
  const stale = eligibility === 'needs_review';
  const confirmed = trade.systemR ?? trade.systemGrossR;
  const currentPreview = stale ? currentConfirmedPreview(trade) : null;
  const previousLine =
    confirmed === null
      ? t('previousFinding')
      : trade.systemR === null
        ? t('previousGrossR', { r: formatR(confirmed) ?? '—' })
        : t('previousR', { r: formatR(confirmed) ?? '—' });
  const pricePlan = trade.plannedEntry !== null && trade.plannedStop !== null;
  const calculationInput = useMemo(
    () => resolutionInput(trade, choice, exitPrice, grossR),
    [trade, choice, exitPrice, grossR],
  );
  const preview = useMemo(() => {
    if (answer !== 'yes' || calculationInput === null) return null;
    return costR.trim() === ''
      ? composeSystemResolveGrossOnly(calculationInput)
      : composeSystemResolveV2({ ...calculationInput, systemCostR: costR });
  }, [answer, calculationInput, costR]);

  function openEditor() {
    setAnswer(initialAnswer(trade));
    setChoice(initialCloseChoice(trade));
    setExitPrice(trade.systemExitPrice ?? '');
    setGrossR(trade.systemGrossRInput ?? '');
    setCostR(trade.systemCostR ?? '');
    setProvenance(trade.systemPlanProvenance ?? 'unknown');
    setAdherence(trade.planAdherence ?? '');
    setFeedback(null);
    setFeedbackTarget(null);
    setOpen(true);
  }

  const launcherLines = stale
    ? [t('needsReview'), previousLine]
    : trade.systemStatus === 'resolved'
      ? trade.systemR === null && trade.systemGrossR !== null
        ? [t('grossOnly'), formatR(trade.systemGrossR) ?? t('assessed')]
        : [confirmed === null ? t('assessed') : (formatR(confirmed) ?? t('assessed'))]
      : trade.systemStatus === 'no_trade'
        ? [t('answerNo')]
        : trade.systemStatus === 'cannot_determine'
          ? [t('answerCannot')]
          : [];

  function closeOverlay() {
    if (!pending) setOpen(false);
  }

  function clearFeedback() {
    if (feedback === null) return;
    setFeedback(null);
    setFeedbackTarget(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setFeedbackTarget(null);
    if (answer === '') {
      setFeedback(t('chooseAnswer'));
      setFeedbackTarget('answer');
      return;
    }

    const metadata = {
      systemPlanProvenance: provenance,
      planAdherence: adherence === '' ? null : adherence,
    };
    let action: Promise<unknown> | null;

    if (trade.systemStatus === 'pending') {
      if (answer === 'no_trade') {
        action = markSystemNoTradeAction({ tradeId: trade.tradeId, ...metadata });
      } else if (answer === 'cannot_determine') {
        action = markSystemCannotDetermineAction({ tradeId: trade.tradeId, ...metadata });
      } else {
        action = resolvedActionPayload(event.currentTarget, false, metadata);
      }
    } else if (answer === 'no_trade' || answer === 'cannot_determine') {
      action = correctSystemResolutionAction({
        tradeId: trade.tradeId,
        target: answer,
        ...metadata,
      });
    } else {
      action = resolvedActionPayload(event.currentTarget, true, metadata);
    }

    if (action === null) return;
    startTransition(async () => {
      const result = await action;
      const code = actionErrorCode(result);
      if (code !== null) {
        setFeedback(tErrors(`errors.${code}`));
        setFeedbackTarget('action');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function resolvedActionPayload(
    form: HTMLFormElement,
    correction: boolean,
    metadata: { systemPlanProvenance: SystemPlanProvenance; planAdherence: PlanAdherence | null },
  ): Promise<unknown> | null {
    if (choice === '' || calculationInput === null || !preview?.ok) {
      setFeedback(t('completeResolution'));
      setFeedbackTarget('resolution');
      return null;
    }
    const data = new FormData(form);
    let systemExitedAt: string | null = trade.systemExitedAt;
    if (choice === 'time_exit') {
      const time = datetimeLocalToIso(String(data.get('systemExitedAt') ?? ''), timezone);
      if (!time.ok) {
        setFeedback(tErrors('lifecycle.validation.time'));
        setFeedbackTarget('resolution');
        return null;
      }
      systemExitedAt = time.value;
    }

    const reason: SystemExitReason = choice === 'custom_r' ? 'manual_system_valid_exit' : choice;
    const payload: Record<string, unknown> = {
      tradeId: trade.tradeId,
      ...(correction ? { target: 'resolved' } : {}),
      resolutionKind: calculationInput.resolutionKind,
      systemExitedAt,
      systemCostR: costR,
      ...metadata,
    };
    if (calculationInput.resolutionKind === 'price_exit') {
      payload.systemExitPrice = calculationInput.systemExitPrice;
      payload.systemExitReason = reason;
    } else if (calculationInput.resolutionKind === 'money_custom') {
      payload.systemGrossRInput = calculationInput.systemGrossRInput;
    }
    return correction ? correctSystemResolutionAction(payload) : resolveSystemTradeAction(payload);
  }

  const closeOptions = pricePlan
    ? PRICE_REASONS.map((reason) => ({
        value: reason as CloseChoice,
        label: t(`reason.${reason}`),
        disabled: reason === 'target_hit' && trade.plannedTarget === null,
      }))
    : ([
        { value: 'target_hit', label: t('reason.target_hit'), disabled: trade.plannedR === null },
        { value: 'stop_hit', label: t('reason.stop_hit') },
        { value: 'break_even_rule', label: t('reason.break_even_rule') },
        { value: 'custom_r', label: t('customR') },
      ] as const);
  const needsExitPrice =
    pricePlan &&
    choice !== '' &&
    choice !== 'target_hit' &&
    choice !== 'stop_hit' &&
    choice !== 'break_even_rule';
  const resolutionDescription =
    feedbackTarget === 'resolution' ? 'system-assessment-feedback' : undefined;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        data-system-assessment-launcher
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openEditor}
        className="border-border bg-muted/20 hover:bg-accent/40 focus-visible:ring-ring flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left outline-none focus-visible:ring-2"
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            launcherLines.length
              ? 'bg-primary/10 text-primary-text'
              : 'bg-muted text-muted-foreground',
          )}
        >
          <Scale className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t('title')}</span>
          {launcherLines.length === 0 ? (
            <span className="text-muted-foreground block text-xs">{t('invitation')}</span>
          ) : (
            launcherLines.slice(0, 2).map((line) => (
              <span key={line} className="text-muted-foreground block truncate text-xs">
                {line}
              </span>
            ))
          )}
        </span>
        {launcherLines.length ? (
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
        ) : (
          <Plus className="size-4 shrink-0" aria-hidden="true" />
        )}
      </button>

      <TradeAdaptiveOverlay
        open={open}
        onOpenChange={(next) => (next ? openEditor() : closeOverlay())}
        returnFocusRef={launcherRef}
        closeLabel={t('close')}
        title={t('title')}
        description={t('description')}
        footer={
          <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className="min-h-12 w-full sm:w-auto"
              onClick={closeOverlay}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            {canWrite ? (
              <Button
                form="system-assessment-form"
                type="submit"
                className="min-h-12 w-full sm:w-auto"
                disabled={pending}
              >
                {pending ? t('saving') : stale ? t('stillApplies') : t('confirm')}
              </Button>
            ) : null}
          </div>
        }
      >
        <form id="system-assessment-form" className="grid min-w-0 gap-5" onSubmit={submit}>
          {stale ? (
            <div
              className="border-warning/40 bg-warning/10 grid min-w-0 gap-1 rounded-lg border p-3 text-sm"
              data-system-assessment-stale
            >
              <p className="font-semibold">{t('needsReview')}</p>
              <p>{previousLine}</p>
              {currentPreview === null ? null : (
                <p className="text-muted-foreground">
                  {t('currentR', { r: formatR(currentPreview) ?? '—' })}
                </p>
              )}
              <p className="text-muted-foreground text-xs">{t('staleHint')}</p>
            </div>
          ) : null}

          <ChoiceGroup<Answer>
            name="system-assessment-taken"
            legend={t('takenQuestion')}
            value={answer}
            describedBy={feedbackTarget === 'answer' ? 'system-assessment-feedback' : undefined}
            invalid={feedbackTarget === 'answer'}
            onChange={(next) => {
              clearFeedback();
              setAnswer(next);
              if (next !== 'yes') setChoice('');
            }}
            options={[
              { value: 'yes', label: t('answerYes') },
              { value: 'no_trade', label: t('answerNo') },
              { value: 'cannot_determine', label: t('answerCannot') },
            ]}
          />

          {answer === 'yes' ? (
            <>
              <ChoiceGroup<CloseChoice>
                name="system-assessment-close"
                legend={t('closedQuestion')}
                value={choice}
                onChange={(next) => {
                  clearFeedback();
                  setChoice(next);
                }}
                describedBy={resolutionDescription}
                invalid={feedbackTarget === 'resolution'}
                options={closeOptions}
              />
              {needsExitPrice ? (
                <TradeField id="system-assessment-exit" label={t('exitPrice')}>
                  <FormInput
                    id="system-assessment-exit"
                    aria-describedby={resolutionDescription}
                    aria-invalid={feedbackTarget === 'resolution' || undefined}
                    value={exitPrice}
                    onChange={(event) => {
                      clearFeedback();
                      setExitPrice(event.target.value);
                    }}
                    inputMode="decimal"
                    required
                  />
                </TradeField>
              ) : null}
              {!pricePlan && choice === 'custom_r' ? (
                <TradeField
                  id="system-assessment-gross"
                  label={t('customR')}
                  hint={t('customRHint')}
                >
                  <FormInput
                    id="system-assessment-gross"
                    aria-describedby={
                      resolutionDescription === undefined
                        ? 'system-assessment-gross-hint'
                        : `system-assessment-gross-hint ${resolutionDescription}`
                    }
                    aria-invalid={feedbackTarget === 'resolution' || undefined}
                    value={grossR}
                    onChange={(event) => {
                      clearFeedback();
                      setGrossR(event.target.value);
                    }}
                    inputMode="decimal"
                    required
                  />
                </TradeField>
              ) : null}
              {choice === 'time_exit' ? (
                <TradeField id="system-assessment-time" label={t('exitTime')}>
                  <TradeDateTimeInput
                    id="system-assessment-time"
                    name="systemExitedAt"
                    timezone={timezone}
                    instant={trade.systemExitedAt}
                    required
                    describedBy={resolutionDescription}
                    onValueChange={clearFeedback}
                  />
                </TradeField>
              ) : null}
              <TradeField id="system-assessment-cost" label={t('cost')} hint={t('costHint')}>
                <FormInput
                  id="system-assessment-cost"
                  aria-describedby={
                    resolutionDescription === undefined
                      ? 'system-assessment-cost-hint'
                      : `system-assessment-cost-hint ${resolutionDescription}`
                  }
                  value={costR}
                  onChange={(event) => {
                    clearFeedback();
                    setCostR(event.target.value);
                  }}
                  inputMode="decimal"
                  placeholder={t('notRecorded')}
                />
              </TradeField>
              {preview?.ok ? (
                <div
                  className="bg-muted/40 grid min-w-0 gap-1 rounded-lg border p-3 text-sm"
                  data-system-assessment-preview
                >
                  <div className="flex min-w-0 justify-between gap-3">
                    <span className="text-muted-foreground">{t('gross')}</span>
                    <span className="numeric min-w-0 text-right break-all">
                      {formatR(preview.value.grossSystemR)}
                    </span>
                  </div>
                  {preview.value.systemCostR === null ? (
                    <p className="text-muted-foreground text-xs">{t('grossOnlyHint')}</p>
                  ) : (
                    <>
                      <div className="flex min-w-0 justify-between gap-3">
                        <span className="text-muted-foreground">{t('cost')}</span>
                        <span className="numeric min-w-0 text-right break-all">
                          -{formatR(preview.value.systemCostR)?.replace('+', '')}
                        </span>
                      </div>
                      <div className="flex min-w-0 justify-between gap-3 font-semibold">
                        <span>{t('net')}</span>
                        <span className="numeric min-w-0 text-right break-all">
                          {formatR(preview.value.systemR)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : null}

          <ChoiceGroup<SystemPlanProvenance>
            name="system-assessment-provenance"
            legend={t('provenanceQuestion')}
            value={provenance}
            onChange={(next) => {
              clearFeedback();
              setProvenance(next);
            }}
            describedBy="system-assessment-provenance-hint"
            options={[
              { value: 'at_entry', label: t('provenance.at_entry') },
              { value: 'reconstructed_later', label: t('provenance.reconstructed_later') },
              { value: 'unknown', label: t('provenance.unknown') },
            ]}
          />
          <p id="system-assessment-provenance-hint" className="text-muted-foreground -mt-3 text-xs">
            {t('provenanceHint')}
          </p>

          <ChoiceGroup<PlanAdherence | ''>
            name="system-assessment-adherence"
            legend={t('adherenceQuestion')}
            value={adherence}
            onChange={(next) => {
              clearFeedback();
              setAdherence(next);
            }}
            describedBy="system-assessment-adherence-hint"
            options={[
              { value: 'followed', label: t('adherence.followed') },
              { value: 'partly', label: t('adherence.partly') },
              { value: 'not_followed', label: t('adherence.not_followed') },
              { value: '', label: t('adherence.unanswered') },
            ]}
          />
          <p id="system-assessment-adherence-hint" className="text-muted-foreground -mt-3 text-xs">
            {t('adherenceHint')}
          </p>
          <ActionFeedback id="system-assessment-feedback" message={feedback} />
        </form>
      </TradeAdaptiveOverlay>
    </>
  );
}
