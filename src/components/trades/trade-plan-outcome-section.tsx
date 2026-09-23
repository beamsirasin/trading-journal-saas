'use client';

import { Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { planOutcomeResult } from '@/lib/calc/plan-outcome';
import {
  planOutcomeCase,
  planOutcomeNeedsAmount,
  type PlanOutcome,
  type PlanOutcomePlan,
} from '@/lib/trades/plan-outcome';

import type { PlanOutcomeDraft, PlanOutcomeDraftError } from './plan-outcome-draft';
import { ChoiceGroup, Helper, InlineAction, TextField } from './trade-at-entry-controls';
import { parseTradeMoneyInput } from './trade-form-values';
import { formatR, formatTradeMoney } from './trade-format';
import { GroupCard } from './trade-recording-step-parts';

/** The control a blocked Save focuses: the answer group's first option, or the amount. */
export function planOutcomeIds(idPrefix: string) {
  return {
    choice: `${idPrefix}-plan-outcome`,
    amount: `${idPrefix}-plan-outcome-amount`,
  } as const;
}

/**
 * SYSTEM RESULT — the first section of Stage 6, After Trade (Add Trade
 * contract decision 55). It asks one factual question: what would the
 * original plan have produced?
 *
 * THE PLAN DECIDES THE QUESTION; THE TRADER ANSWERS IT (`planOutcomeCase`):
 *
 *   Defined Risk + Fixed Target   "What happened first?" — Planned target /
 *                                 Planned risk / Can't determine. The amount
 *                                 and R each would produce are read from the
 *                                 plan and shown on the options: nothing to
 *                                 type unless the target was only a price.
 *   Defined Risk + Exit Plan      The plan, read-only, then "what result would
 *                                 it have produced?" — a stated amount, or
 *                                 Can't determine.
 *   No Defined Risk / none        One quiet line saying why there is no R
 *                                 comparison. Nothing is asked or invented.
 *   No target and no Exit Plan    One quiet line; nothing to establish.
 *
 * IT IS NOT REVIEW. No rule adherence, mistakes, reflection or System
 * Assessment, and no Net / Gross claim — Review keeps all of that. Every
 * answer is optional and may be left for later; Unanswered is never Can't
 * determine. The host owns the draft and applies each answer.
 */
export function TradePlanOutcomeSection({
  idPrefix,
  plan,
  currency,
  exitPlan,
  value,
  error,
  onOutcome,
  onAmount,
}: {
  idPrefix: string;
  plan: PlanOutcomePlan;
  currency: string;
  /** The recorded Exit Plan, read-only context for the exit-plan question. */
  exitPlan: { readonly name: string | null; readonly instructions: string | null } | null;
  value: PlanOutcomeDraft;
  error: PlanOutcomeDraftError | null;
  onOutcome: (outcome: PlanOutcome | null) => void;
  onAmount: (amount: string) => void;
}) {
  const p = useTranslations('trades.stage6.planOutcome');
  const c = useTranslations('trades.create.recording.contractEntry');
  const ids = planOutcomeIds(idPrefix);
  const kind = planOutcomeCase(plan);

  const money = (minor: bigint) => formatTradeMoney(minor.toString(), currency) ?? minor.toString();
  const figure = (minor: bigint, r: string) =>
    p('resultValue', { money: money(minor), r: formatR(r) ?? r });

  // What the plan says each bounded answer would produce — shown, never typed.
  const derived = (outcome: PlanOutcome): string | undefined => {
    const result = planOutcomeResult(outcome, null, plan);
    return result.status === 'known' ? figure(result.amountMinor, result.r) : undefined;
  };

  // The answer's own figure, once it has one.
  const statedMinor = (() => {
    if (value.outcome === null || !planOutcomeNeedsAmount(value.outcome, plan)) return null;
    const parsed = parseTradeMoneyInput(value.amount, currency, {
      allowNegative: true,
      allowZero: true,
    });
    return parsed.ok ? BigInt(parsed.value) : null;
  })();
  const result = planOutcomeResult(value.outcome, statedMinor, plan);

  const stale = error === 'plan_outcome_stale';
  const errorText =
    error === 'plan_outcome_amount_required'
      ? p('errors.amountRequired')
      : error === 'plan_outcome_invalid_money'
        ? p('errors.invalidMoney')
        : error === 'plan_outcome_amount_positive'
          ? p('errors.amountPositive')
          : undefined;

  const remove = (
    <InlineAction ariaLabel={p('removeAria')} onClick={() => onOutcome(null)}>
      {c('removeAnswer')}
    </InlineAction>
  );

  const quiet = (text: string) => (
    <p
      data-plan-outcome-message=""
      className="text-muted-foreground flex items-start gap-2.5 text-sm"
    >
      <Scale className="text-subtle-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{text}</span>
    </p>
  );

  return (
    <GroupCard title={p('title')} data-plan-outcome={kind}>
      <div className="-mt-2 flex min-w-0 flex-col gap-1">
        <Helper>{p('question')}</Helper>
        {kind === 'bounded' || kind === 'exit_plan' ? <Helper>{p('later')}</Helper> : null}
      </div>

      {kind === 'no_defined_risk' ? quiet(p('noDefinedRisk')) : null}
      {kind === 'risk_not_recorded' ? quiet(p('riskNotRecorded')) : null}
      {kind === 'unavailable' ? quiet(p('unavailable')) : null}

      {/*
        A STALE ANSWER CARRIES ITS OWN WAY OUT. The plan may no longer ask any
        question at all (no target and no Exit Plan now), so the answer group
        that normally holds Remove answer may not exist: the notice holds it.
      */}
      {stale ? (
        <div data-plan-outcome-stale="" className="flex min-w-0 flex-col gap-1.5">
          <p role="alert" className="text-warning text-sm">
            {p('stale')}
          </p>
          <div>{remove}</div>
        </div>
      ) : null}

      {kind === 'bounded' ? (
        <div id={ids.choice} tabIndex={-1} className="min-w-0 outline-none">
          <ChoiceGroup
            idPrefix={ids.choice}
            legend={p('boundedLegend')}
            value={stale ? null : value.outcome}
            status={c('notAnswered')}
            aside={remove}
            columns={3}
            compact
            onChange={onOutcome}
            options={[
              {
                value: 'planned_target_first',
                label: p('targetFirst'),
                ...(derived('planned_target_first') === undefined
                  ? {}
                  : { description: derived('planned_target_first') as string }),
              },
              {
                value: 'planned_risk_first',
                label: p('riskFirst'),
                description: derived('planned_risk_first') as string,
              },
              { value: 'cannot_determine', label: p('cannotDetermine') },
            ]}
          />
        </div>
      ) : null}

      {kind === 'exit_plan' ? (
        <>
          {exitPlan === null ? null : (
            <div
              data-plan-outcome-exit-plan=""
              className="bg-muted/40 border-border/60 flex min-w-0 flex-col gap-1 rounded-lg border px-4 py-3"
            >
              <p className="text-muted-foreground text-[0.8125rem] leading-5 font-medium">
                {p('exitPlanHeading')}
                {exitPlan.name === null ? null : (
                  <span className="text-foreground"> · {exitPlan.name}</span>
                )}
              </p>
              {exitPlan.instructions === null ? null : (
                <p className="text-foreground text-sm break-words whitespace-pre-line">
                  {exitPlan.instructions}
                </p>
              )}
            </div>
          )}
          <div id={ids.choice} tabIndex={-1} className="min-w-0 outline-none">
            <ChoiceGroup
              idPrefix={ids.choice}
              legend={p('exitPlanLegend')}
              value={stale ? null : value.outcome}
              status={c('notAnswered')}
              aside={remove}
              compact
              onChange={onOutcome}
              options={[
                { value: 'exit_plan_result', label: p('exitPlanResult') },
                { value: 'cannot_determine', label: p('cannotDetermine') },
              ]}
            />
          </div>
        </>
      ) : null}

      {!stale && value.outcome !== null && planOutcomeNeedsAmount(value.outcome, plan) ? (
        <div className="border-control-border border-l-2 pl-4">
          <TextField
            id={ids.amount}
            label={value.outcome === 'exit_plan_result' ? p('amountLabel') : p('targetAmountLabel')}
            value={value.amount}
            onChange={onAmount}
            suffix={currency}
            inputMode="decimal"
            figure
            hint={value.outcome === 'exit_plan_result' ? p('amountHint') : p('targetAmountHint')}
            error={errorText}
          />
        </div>
      ) : null}

      {/* The figure the answer comes to — the plan's, or the stated amount's. */}
      {result.status === 'known' && !stale ? (
        <div
          data-plan-outcome-result={result.outcome}
          className="flex min-w-0 items-baseline justify-between gap-3 text-sm"
        >
          <span className="text-muted-foreground">{p('result')}</span>
          <span className="text-foreground font-semibold tabular-nums">
            {figure(result.amountMinor, result.r)}
          </span>
        </div>
      ) : null}
    </GroupCard>
  );
}
