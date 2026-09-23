'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import type { RiskStateDraft, TargetDraft } from './at-entry-draft';

/**
 * THE PLAN AT A GLANCE — one compact, read-only card beneath Plan & Risk's
 * launcher rows (Add Trade contract §4–§5, decision 54).
 *
 * IT READS; IT NEVER ASKS. Every value here is answered in a row above, so
 * nothing in this card is editable and nothing in it is a second place to
 * change an answer. It exists because a trader reviewing their own plan on a
 * phone should be able to see risk, target and the ratio between them without
 * opening three editors.
 *
 * IT STATES ONLY WHAT IS KNOWN. A Planned RR exists only when a Defined Risk
 * and a Fixed Target's profit are both recorded. Every other shape says which
 * one it is, in its own words:
 *
 *   No Defined Risk        risk "Not defined", RR "Not available" — no R or RR
 *                          figure can ever exist for this Trade (§4).
 *   Rule-based exit        target "Rule-based", RR "Not known yet" — the Exit
 *                          Plan decides the result, so the ratio is not knowable
 *                          at entry. That is a state, not a gap.
 *   Unanswered             the neutral word, never a zero and never "none".
 *
 * NO TRADER RESULT APPEARS HERE. At entry there is no result to show, and a
 * summary that implied one would be inventing it.
 */
export function TradePlannedSummary({
  riskState,
  risk,
  currency,
  target,
  plannedRR,
  exitPlanLabel,
}: {
  riskState: RiskStateDraft;
  /** Risk at Entry as typed; belongs to a Defined Risk alone. */
  risk: string;
  currency: string;
  target: TargetDraft;
  /** `1:2`-shaped ratio, already formatted; `null` when it is not knowable. */
  plannedRR: string | null;
  /** The Exit Plan in one phrase, or `null` when none is recorded. */
  exitPlanLabel: string | null;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const summary = useTranslations('trades.create.recording.plannedSummary');

  const noDefinedRisk = riskState === 'no_defined';
  const amount = risk.trim();
  const riskValue = noDefinedRisk
    ? summary('riskNotDefined')
    : riskState === 'defined' && amount !== ''
      ? `${amount} ${currency}`
      : c('notAnswered');

  const ruleBased = target.state === 'no_fixed';
  const targetProfit = target.profit.trim();
  const targetValue = ruleBased
    ? summary('targetRuleBased')
    : target.state === 'fixed'
      ? targetProfit === ''
        ? c('target.fixed')
        : `${targetProfit} ${currency}`
      : c('notAnswered');

  /*
    WHY THE RATIO IS MISSING MATTERS. "Not available" is a closed door — no
    planned 1R exists, so no ratio ever will. "Not known yet" is an open one:
    the plan is rule-based, and the result will say what it was worth.
  */
  const rrValue =
    plannedRR !== null
      ? plannedRR
      : noDefinedRisk
        ? summary('rrNotAvailable')
        : ruleBased
          ? summary('rrNotKnownYet')
          : c('notAnswered');

  return (
    <div
      data-planned-summary={riskState}
      className="bg-muted/40 border-border/60 flex min-w-0 flex-col gap-2 rounded-lg border px-4 py-3"
    >
      <p className="text-muted-foreground text-[0.8125rem] leading-5 font-medium">
        {summary('title')}
      </p>
      <dl className="grid min-w-0 gap-x-4 gap-y-1.5 text-sm min-[420px]:grid-cols-2">
        <Line label={summary('risk')} value={riskValue} data="risk" muted={noDefinedRisk} />
        <Line label={summary('target')} value={targetValue} data="target" />
        <Line
          label={summary('rr')}
          value={rrValue}
          data="rr"
          muted={plannedRR === null}
          wide={exitPlanLabel === null}
        />
        {exitPlanLabel === null ? null : (
          <Line label={summary('exitPlan')} value={exitPlanLabel} data="exitPlan" />
        )}
      </dl>
    </div>
  );
}

/** One read-only pair: what it is, and what the plan says it is. */
function Line({
  label,
  value,
  data,
  muted = false,
  wide = false,
}: {
  label: string;
  value: string;
  data: string;
  muted?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      data-planned-line={data}
      className={cn(
        'flex min-w-0 items-baseline justify-between gap-3',
        wide && 'min-[420px]:col-span-2',
      )}
    >
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right',
          muted ? 'text-subtle-foreground' : 'text-foreground font-medium',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
