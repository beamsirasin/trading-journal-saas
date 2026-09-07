'use client';

import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useId } from 'react';

import { executionGapR } from '@/lib/calc/attribution';
import { cn } from '@/lib/utils';
import {
  Fact,
  FactGrid,
  PanelEmpty,
  PanelSection,
} from '@/components/trades/workspace/panel-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';

import { outcomeLabel, statusLabel, type PrototypeCopy } from '../copy';
import { PROTOTYPE_TIMEZONE, type PrototypeTrade } from '../fixtures';
import {
  closedPercentLabel,
  CONFIDENCE_LABEL,
  signedMoney,
  signedR,
  toneForDecimal,
} from '../presentation';

export type DetailTab = 'overview' | 'execution' | 'review';

const TAB_LABEL: Record<DetailTab, string> = {
  overview: 'Overview',
  execution: 'Execution',
  review: 'Review',
};

/**
 * TRADE DETAILS — three tabs, one drawer, two presentations.
 *
 * SIX TABS BECAME THREE, and the merge is by QUESTION rather than by field
 * count. Overview answers "what is this trade and what did it come from" —
 * result, identity, classification, the original plan, the state of mind, the
 * chart, the notes. Execution answers "what actually happened, and what can I
 * still do to it". Review answers "how does it compare to the system, and what
 * did I learn". Chart and Notes were never questions of their own; they were two
 * fields each promoted to a peer of the trade's entire execution history.
 *
 * THE HEADER CARRIES NO METRICS. The tall metric block the current drawer opens
 * with repeats, in a fixed band the reader cannot scroll away, figures that
 * Overview then states again forty pixels below. Here the header is identity and
 * the one action the lifecycle affords; the result is stated once, at the top of
 * Overview, where it belongs.
 *
 * DESKTOP IS A 640px RIGHT DRAWER; below 1,200px it takes the full viewport.
 * There is no intermediate state where a narrow strip of dimmed table sits
 * beside a cramped panel — at that width the list is context, not a comparison
 * surface, and the modal backdrop already says so.
 */
export function TradeDetailsPanel({
  trade,
  copy,
  tab,
  onTabChange,
  onClose,
  onPrevious,
  onNext,
}: {
  trade: PrototypeTrade | null;
  copy: PrototypeCopy;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}) {
  return (
    <Sheet open={trade !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        closeLabel="Close"
        className={cn(
          'w-full gap-0 p-0 sm:max-w-full',
          'min-[1200px]:w-[640px] min-[1200px]:max-w-[640px]',
        )}
      >
        {trade === null ? null : (
          <TradeDetailsBody
            trade={trade}
            copy={copy}
            tab={tab}
            onTabChange={onTabChange}
            onPrevious={onPrevious}
            onNext={onNext}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function TradeDetailsBody({
  trade,
  copy,
  tab,
  onTabChange,
  onPrevious,
  onNext,
}: {
  trade: PrototypeTrade;
  copy: PrototypeCopy;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const tabsId = useId();
  const isOpenPosition = trade.lifecycle === 'open' || trade.lifecycle === 'partially_closed';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border shrink-0 border-b px-5 pt-5 pr-14 pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <SheetTitle className="text-xl tracking-tight">{trade.symbol}</SheetTitle>
          <span className="text-muted-foreground text-sm">
            {trade.direction === 'long' ? 'Long' : 'Short'}
          </span>
          <Badge variant={isOpenPosition ? 'info' : 'neutral'} className="px-2 py-0.5">
            {statusLabel(copy, trade.lifecycle)}
          </Badge>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {trade.accountName} · {trade.currency}
        </p>

        <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={onPrevious === null}
              onClick={() => onPrevious?.()}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </Button>
            <Button variant="ghost" size="sm" disabled={onNext === null} onClick={() => onNext?.()}>
              Next
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <Button variant="outline" size="sm">
            {isOpenPosition ? 'Record exit' : 'Edit result'}
          </Button>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Trade details sections"
        className="border-border flex shrink-0 gap-1 border-b px-4"
      >
        {(Object.keys(TAB_LABEL) as DetailTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${tabsId}-${key}-tab`}
            aria-selected={tab === key}
            aria-controls={`${tabsId}-${key}-panel`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => onTabChange(key)}
            onKeyDown={(event) => {
              const order: DetailTab[] = ['overview', 'execution', 'review'];
              const index = order.indexOf(tab);
              if (event.key === 'ArrowRight') {
                onTabChange(order[(index + 1) % order.length] ?? 'overview');
              } else if (event.key === 'ArrowLeft') {
                onTabChange(order[(index + order.length - 1) % order.length] ?? 'overview');
              }
            }}
            className={cn(
              'focus-visible:ring-ring relative min-h-11 rounded-t-md px-3 text-sm font-medium outline-none focus-visible:ring-2',
              tab === key
                ? 'text-foreground after:bg-primary after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${tabsId}-${tab}-panel`}
        aria-labelledby={`${tabsId}-${tab}-tab`}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
      >
        {tab === 'overview' ? <OverviewTab trade={trade} copy={copy} /> : null}
        {tab === 'execution' ? <ExecutionTab trade={trade} copy={copy} /> : null}
        {tab === 'review' ? <ReviewTab trade={trade} copy={copy} /> : null}
      </div>
    </div>
  );
}

/**
 * The result, said ONCE, at the top of the trade.
 *
 * Two figures side by side, the money and the R, with the system's own figure
 * beside them only when it has genuinely been resolved. A pending system reads
 * "Not resolved yet" — never `0.00R`, and never the planned R standing in for
 * it, which would quietly convert an expectation into a counterfactual result.
 */
function ResultBlock({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const money = signedMoney(trade.netPnlMinor, trade.currency);
  const rValue = signedR(trade.actualR);
  const isRealized = trade.lifecycle === 'partially_closed';
  const gap = trade.systemState === 'resolved' ? executionGapR(trade.actualR, trade.systemR) : null;

  return (
    <div className="border-border bg-surface-raised/60 rounded-lg border p-4">
      <div className="flex min-w-0 flex-wrap items-end gap-x-8 gap-y-3">
        <Figure
          label={isRealized ? 'Realized R' : 'Actual R'}
          value={rValue}
          tone={toneForDecimal(trade.actualR)}
          emphasis
        />
        <Figure
          label={isRealized ? 'Realized P&L' : 'Net P&L'}
          value={money}
          tone={toneForDecimal(trade.netPnlMinor)}
          fallback={copy.notRecorded}
        />
        {trade.outcome === null ? null : (
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">Outcome</p>
            <p className="text-foreground mt-0.5 text-sm font-medium">
              {outcomeLabel(copy, trade.outcome)}
            </p>
          </div>
        )}
      </div>

      <div className="border-border mt-4 flex min-w-0 flex-wrap items-end gap-x-8 gap-y-3 border-t pt-3">
        {trade.systemState === 'resolved' ? (
          <>
            <Figure
              label="System R"
              value={signedR(trade.systemR)}
              tone={toneForDecimal(trade.systemR)}
            />
            <Figure
              label="Execution gap"
              value={gap !== null && gap.ok ? signedR(gap.value) : null}
              tone={gap !== null && gap.ok ? toneForDecimal(gap.value) : 'unavailable'}
              fallback="Not available"
            />
          </>
        ) : trade.systemState === 'no_trade' ? (
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">System would not enter.</span> There is no
            system trade to compare against — this is not a zero-R result.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            System result <span className="text-foreground font-medium">not resolved yet</span>. No
            execution gap until it is.
          </p>
        )}
      </div>
    </div>
  );
}

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  flat: 'text-foreground',
  unavailable: 'text-subtle-foreground',
} as const;

function Figure({
  label,
  value,
  tone,
  emphasis = false,
  fallback = '—',
}: {
  label: string;
  value: string | null;
  tone: keyof typeof TONE_CLASS;
  emphasis?: boolean;
  fallback?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          'numeric mt-0.5 font-semibold',
          emphasis ? 'text-2xl leading-7' : 'text-base',
          value === null ? 'text-subtle-foreground text-sm font-normal' : TONE_CLASS[tone],
        )}
      >
        {value ?? fallback}
      </p>
    </div>
  );
}

function OverviewTab({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const emotions =
    trade.emotions === null
      ? null
      : trade.emotions.length === 0
        ? 'None of these'
        : trade.emotions.join(', ');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <ResultBlock trade={trade} copy={copy} />

      <PanelSection title="Trade">
        <FactGrid>
          <Fact label="Account" value={trade.accountName} />
          <Fact label="Symbol" value={trade.symbol} />
          <Fact label="Direction" value={trade.direction === 'long' ? 'Long' : 'Short'} />
          <Fact label="Entered" value={trade.enteredAt} />
          <Fact label="Exited" value={trade.exitedAt} />
          <Fact label="Timezone" value={PROTOTYPE_TIMEZONE} />
        </FactGrid>
      </PanelSection>

      <PanelSection title="Strategy and setup">
        {trade.strategy === null ? (
          <PanelEmpty
            title="No strategy assigned"
            description="Assign a strategy to compare this trade against the system that produced it."
          />
        ) : (
          <FactGrid>
            <Fact label="Strategy" value={trade.strategy} />
            <Fact label="Setup" value={trade.setup} />
          </FactGrid>
        )}
      </PanelSection>

      <PanelSection title="Original plan">
        {trade.plan === null ? (
          <PanelEmpty
            title="No original plan recorded"
            description="This trade was recorded after the fact. Planned R stays unavailable rather than being reconstructed from the result."
          />
        ) : trade.plan.basis === 'money' ? (
          <FactGrid>
            <Fact
              label="Planned risk"
              value={signedMoney(trade.plan.riskMinor, trade.currency)?.replace('+', '') ?? null}
              tone="neutral"
            />
            <Fact
              label="Target reward"
              value={signedMoney(trade.plan.rewardMinor, trade.currency)?.replace('+', '') ?? null}
              tone="neutral"
            />
            <Fact label="Planned R" value={signedR(trade.plan.plannedR)} tone="neutral" />
          </FactGrid>
        ) : (
          <FactGrid>
            <Fact label="Planned entry" value={trade.plan.entry} tone="neutral" />
            <Fact label="Planned stop" value={trade.plan.stop} tone="neutral" />
            <Fact label="Planned target" value={trade.plan.target} tone="neutral" />
            <Fact label="Planned R" value={signedR(trade.plan.plannedR)} tone="neutral" />
          </FactGrid>
        )}
      </PanelSection>

      <PanelSection
        title="At entry"
        {...(trade.contextRecalled ? { description: 'Recorded after the trade.' } : {})}
      >
        <FactGrid>
          <Fact
            label="Confidence"
            value={trade.confidence === null ? null : (CONFIDENCE_LABEL[trade.confidence] ?? null)}
            {...(trade.confidence === null ? { hint: 'Not recorded' } : {})}
          />
          <Fact label="Emotions" value={emotions} />
        </FactGrid>
      </PanelSection>

      <PanelSection title="Why this trade">
        {trade.entryReason === null ? (
          <PanelEmpty
            title="No entry reason recorded"
            description="The reason you took the trade, in your own words, at the moment you took it."
          />
        ) : (
          <p className="text-foreground text-sm leading-relaxed">{trade.entryReason}</p>
        )}
      </PanelSection>

      <PanelSection title="Chart">
        {trade.chartUrl === null ? (
          <p className="text-muted-foreground text-sm">No chart reference.</p>
        ) : (
          <a
            href={trade.chartUrl}
            className="text-primary focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            {trade.chartUrl}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </PanelSection>

      <PanelSection title="Notes">
        {trade.notes === null ? (
          <p className="text-muted-foreground text-sm">No notes.</p>
        ) : (
          <p className="text-foreground text-sm leading-relaxed">{trade.notes}</p>
        )}
      </PanelSection>
    </div>
  );
}

function ExecutionTab({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const isOpenPosition = trade.lifecycle === 'open' || trade.lifecycle === 'partially_closed';
  const remainingBps = 10000 - trade.closedBps;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection
        title="Opening"
        description={`Recorded using ${trade.actualBasis === 'money' ? 'money' : 'prices'}.`}
      >
        <FactGrid>
          <Fact label="Entry price" value={trade.entryPrice} tone="neutral" omitWhenEmpty />
          <Fact label="Initial stop" value={trade.initialStop} tone="neutral" omitWhenEmpty />
          <Fact label="Position size" value={trade.positionSize} tone="neutral" omitWhenEmpty />
          <Fact
            label="Initial risk"
            value={signedMoney(trade.actualRiskMinor, trade.currency)?.replace('+', '') ?? null}
            tone="neutral"
            hint="The amount you initially risked. Stored, never derived from price and size."
          />
        </FactGrid>
      </PanelSection>

      <PanelSection
        title="Exits"
        {...(isOpenPosition
          ? {
              description: `${closedPercentLabel(trade.closedBps)} recorded · ${closedPercentLabel(remainingBps)} remaining`,
            }
          : {})}
      >
        {trade.exits.length === 0 ? (
          <PanelEmpty
            title="No exits recorded"
            description="Record a partial exit or close the position to add the first leg."
          />
        ) : (
          <ol className="border-border divide-border divide-y rounded-lg border">
            {trade.exits.map((exit) => (
              <li key={exit.sequence} className="flex min-w-0 items-start gap-3 p-3">
                <span className="bg-muted text-muted-foreground numeric mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs">
                  {exit.sequence}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-foreground numeric text-sm font-medium">
                      {exit.percent}% of position
                    </span>
                    <span
                      className={cn(
                        'numeric text-sm font-semibold',
                        exit.netPnlMinor === null
                          ? 'text-foreground'
                          : TONE_CLASS[toneForDecimal(exit.netPnlMinor)],
                      )}
                    >
                      {exit.netPnlMinor === null
                        ? `at ${exit.exitPrice ?? '—'}`
                        : signedMoney(exit.netPnlMinor, trade.currency)}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {exit.at}
                    {exit.usesFinalExitTime === true ? ' · Uses final exit time' : ''}
                    {exit.reason === undefined ? '' : ` · ${exit.reason}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {isOpenPosition ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm">
              Record partial exit
            </Button>
            <Button variant="outline" size="sm">
              Close remaining {closedPercentLabel(remainingBps)}
            </Button>
          </div>
        ) : null}
      </PanelSection>

      <PanelSection title="Result">
        <FactGrid>
          <Fact
            label={trade.lifecycle === 'partially_closed' ? 'Realized P&L' : 'Net P&L'}
            value={signedMoney(trade.netPnlMinor, trade.currency)}
            {...(trade.netPnlMinor === null
              ? {
                  hint: 'Recorded from prices. Monetary P&L is not available in this mode.',
                }
              : {
                  tone:
                    toneForDecimal(trade.netPnlMinor) === 'negative'
                      ? ('negative' as const)
                      : ('positive' as const),
                })}
          />
          <Fact
            label={trade.lifecycle === 'partially_closed' ? 'Realized R' : 'Actual R'}
            value={signedR(trade.actualR)}
            tone="neutral"
          />
        </FactGrid>
        {trade.lifecycle === 'partially_closed' ? (
          <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
            Realized so far. This is not the final closed-trade result —{' '}
            {closedPercentLabel(remainingBps)} of the position is still open.
          </p>
        ) : null}
      </PanelSection>

      <PanelSection title="Costs">
        {trade.costs === null ? (
          <p className="text-muted-foreground text-sm">
            No cost breakdown recorded. Costs are already included in the net result above.
          </p>
        ) : (
          <FactGrid>
            <Fact
              label="Commission"
              value={
                signedMoney(trade.costs.commissionMinor, trade.currency)?.replace('+', '') ?? null
              }
              tone="neutral"
            />
            <Fact
              label="Fees"
              value={signedMoney(trade.costs.feesMinor, trade.currency)?.replace('+', '') ?? null}
              tone="neutral"
            />
            <Fact
              label="Swap"
              value={signedMoney(trade.costs.swapMinor, trade.currency)?.replace('+', '') ?? null}
              tone="neutral"
            />
          </FactGrid>
        )}
      </PanelSection>

      <p className="text-subtle-foreground text-xs">{copy.timezoneNote}</p>
    </div>
  );
}

function ReviewTab({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const gap = trade.systemState === 'resolved' ? executionGapR(trade.actualR, trade.systemR) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection
        title="System outcome"
        description="What the strategy's own rules would have produced — decided by you, never inferred from your exit."
      >
        {trade.systemState === 'pending' ? (
          <div className="border-border flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
            <div>
              <p className="text-foreground text-sm font-medium">Review later</p>
              <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                Pending is unavailable, not zero. Nothing is compared until you resolve it.
              </p>
            </div>
            <Button size="sm">Add system result</Button>
          </div>
        ) : (
          <FactGrid>
            <Fact label="Outcome" value={trade.systemOutcome} />
            <Fact
              label="System R"
              value={trade.systemState === 'no_trade' ? null : signedR(trade.systemR)}
              tone="neutral"
              {...(trade.systemState === 'no_trade' ? { hint: 'No system trade — not 0R.' } : {})}
            />
          </FactGrid>
        )}
      </PanelSection>

      {trade.systemState === 'resolved' && gap !== null && gap.ok ? (
        <PanelSection title="System vs actual">
          <div className="border-border rounded-lg border p-4">
            <div className="flex min-w-0 flex-wrap items-end gap-x-8 gap-y-3">
              <Figure
                label="Actual R"
                value={signedR(trade.actualR)}
                tone={toneForDecimal(trade.actualR)}
              />
              <Figure
                label="System R"
                value={signedR(trade.systemR)}
                tone={toneForDecimal(trade.systemR)}
              />
              <Figure
                label="Execution gap"
                value={signedR(gap.value)}
                tone={toneForDecimal(gap.value)}
              />
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              {Number(gap.value) < 0
                ? `${signedR(gap.value)?.replace('-', '')} below the system result.`
                : Number(gap.value) > 0
                  ? `${signedR(gap.value)} above the system result.`
                  : 'Matched the system result.'}
            </p>
          </div>
        </PanelSection>
      ) : null}

      <PanelSection title="Rule observations" description="Unanswered is not the same as failed.">
        {trade.conditions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No setup conditions recorded for this trade.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-lg border">
            {trade.conditions.map((condition) => (
              <li
                key={condition.label}
                className="flex min-w-0 items-center justify-between gap-3 p-3"
              >
                <span className="text-foreground min-w-0 text-sm">{condition.label}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs font-medium',
                    condition.state === 'met'
                      ? 'text-positive'
                      : condition.state === 'not_met'
                        ? 'text-negative'
                        : 'text-muted-foreground',
                  )}
                >
                  {condition.state === 'met'
                    ? 'Met'
                    : condition.state === 'not_met'
                      ? 'Not met'
                      : 'Not recorded'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title="Mistakes">
        {trade.mistakes.length === 0 ? (
          <p className="text-muted-foreground text-sm">None recorded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {trade.mistakes.map((mistake) => (
              <Badge key={mistake} variant="warning">
                {mistake}
              </Badge>
            ))}
          </div>
        )}
      </PanelSection>

      <PanelSection title="What will you repeat or change?">
        {trade.reviewNote === null ? (
          <div className="border-border flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
            <p className="text-muted-foreground text-sm">No review note yet.</p>
            <Button variant="outline" size="sm">
              Add review note
            </Button>
          </div>
        ) : (
          <p className="text-foreground text-sm leading-relaxed">{trade.reviewNote}</p>
        )}
      </PanelSection>

      <p className="text-subtle-foreground text-xs">{copy.timezoneNote}</p>
    </div>
  );
}
