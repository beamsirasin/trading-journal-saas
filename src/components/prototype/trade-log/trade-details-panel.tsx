'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

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

import { emotionLabel } from '../add-trade/emotions-control';
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
  execution: 'Entry & exits',
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
          {/*
            `aria-disabled`, NOT `disabled`, on these two.

            `disabled` removes an element from the focus order entirely. At the
            first and last trade of a page that silently deleted a control from
            the drawer's toolbar mid-review: a keyboard user tabbing through the
            header would find Previous present on one trade and gone on the
            next, with nothing to explain the change. `aria-disabled` keeps both
            reachable and announced as unavailable, and the handler simply does
            nothing — which is also why they are not `<Button disabled>`, whose
            styling would have implied the other behaviour.
          */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-disabled={onPrevious === null}
              className={cn(onPrevious === null && 'pointer-events-none opacity-50')}
              onClick={() => onPrevious?.()}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-disabled={onNext === null}
              className={cn(onNext === null && 'pointer-events-none opacity-50')}
              onClick={() => onNext?.()}
            >
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
            /*
              THE ROVING TABINDEX HAS TO TAKE FOCUS WITH IT.

              Arrow keys already changed the selected tab, but focus stayed on
              the button that had just become `tabindex="-1"`. A second arrow
              press then did nothing a keyboard user could see, and Tab jumped
              somewhere unrelated — the tablist was operable exactly once. The
              ARIA tabs pattern requires focus to follow selection here, so the
              newly selected tab is focused explicitly. Home/End are part of the
              same pattern and were simply missing.
            */
            onKeyDown={(event) => {
              const order: DetailTab[] = ['overview', 'execution', 'review'];
              const index = order.indexOf(tab);
              let nextTab: DetailTab | null = null;
              if (event.key === 'ArrowRight') {
                nextTab = order[(index + 1) % order.length] ?? 'overview';
              } else if (event.key === 'ArrowLeft') {
                nextTab = order[(index + order.length - 1) % order.length] ?? 'overview';
              } else if (event.key === 'Home') {
                nextTab = 'overview';
              } else if (event.key === 'End') {
                nextTab = 'review';
              }
              if (nextTab === null) return;
              event.preventDefault();
              onTabChange(nextTab);
              document.getElementById(`${tabsId}-${nextTab}-tab`)?.focus();
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
 * THE LEAD — money, then R, then when the trade ran.
 *
 * MONEY IS THE HEADLINE. The block used to open with `+2.10R` at `text-metric`
 * and put the money underneath it in body text. That is the right emphasis for
 * a trader fluent in R and useless to the person this product is trying to
 * teach: `+420.00 USD` is checkable against a broker statement, and `+2.10R` is
 * a unit they have not learned yet. R is directly beneath, labelled
 * `Result (R)` — visible, secondary, and available to be learned by watching it
 * move against a number they already trust.
 *
 * `Net profit` / `Net loss` NAMES THE DIRECTION, so the figure never has to be
 * read for its sign alone, and a partially closed position says `Net P&L from
 * closed portion` rather than leaving a reader to discover that the number
 * covers only part of the trade.
 *
 * IT IS NOT IN A BOX. It was a bordered, tinted panel at the top of a tab that
 * then presented six more bordered sections beneath it, so the panel opened as a
 * stack of containers and the reader met the drawer's structure before the
 * trade's story. A hairline under it does the same job.
 *
 * THE RULE COMPARISON IS NOT ANNOUNCED HERE WHEN IT IS ABSENT. A trade whose
 * rule-based result was never recorded says nothing about it in Overview —
 * telling a reader what is missing before they have read what happened is the
 * journal talking about itself. Review is where that offer belongs.
 */
function ResultBlock({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const money = signedMoney(trade.netPnlMinor, trade.currency);
  const rValue = signedR(trade.actualR);
  const isPartial = trade.lifecycle === 'partially_closed';
  const tone = toneForDecimal(trade.netPnlMinor);

  const moneyLabel = isPartial
    ? 'Net P&L from closed portion'
    : tone === 'positive'
      ? 'Net profit'
      : tone === 'negative'
        ? 'Net loss'
        : 'Net P&L';

  return (
    <div className="border-border min-w-0 border-b pb-4">
      <p className="text-muted-foreground text-xs font-medium">{moneyLabel}</p>
      <p
        className={cn(
          'numeric mt-0.5 font-semibold',
          money === null ? 'text-subtle-foreground text-base' : cn('text-metric', TONE_CLASS[tone]),
        )}
      >
        {money ?? copy.notRecorded}
      </p>

      {rValue === null ? null : (
        <div className="mt-2 min-w-0">
          <p className="text-muted-foreground text-xs font-medium">Result (R)</p>
          <p
            className={cn(
              'numeric mt-0.5 text-base font-semibold',
              TONE_CLASS[toneForDecimal(trade.actualR)],
            )}
          >
            {rValue}
          </p>
        </div>
      )}

      {trade.outcome === null ? null : (
        <p className="text-foreground mt-2 text-sm font-medium">
          {outcomeLabel(copy, trade.outcome)}
        </p>
      )}

      {/*
        THE RULE COMPARISON, ONE LINE, ONLY WHEN IT EXISTS. Two numbers and the
        words a beginner already has — no "actual vs system", no execution-gap
        figure, and nothing at all when nobody has recorded one.
      */}
      {trade.systemState === 'resolved' ? (
        <p className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted-foreground">If you followed your rules</span>
          <span className={cn('numeric font-medium', TONE_CLASS[toneForDecimal(trade.systemR)])}>
            {signedR(trade.systemR)}
          </span>
        </p>
      ) : trade.systemState === 'no_trade' ? (
        <p className="text-muted-foreground mt-3 text-sm">
          Following your rules, you would not have taken this trade.
        </p>
      ) : null}

      {/* The span of the trade, in the reader's own zone, stated once. */}
      <p className="text-subtle-foreground numeric mt-3 min-w-0 text-xs">
        {trade.enteredAt ?? 'Entry time not recorded'} → {trade.exitedAt ?? 'still open'}
        <span className="ml-2">{PROTOTYPE_TIMEZONE}</span>
      </p>
    </div>
  );
}
const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  flat: 'text-foreground',
  unavailable: 'text-subtle-foreground',
} as const;

/**
 * A compact labelled line.
 *
 * WHY THIS REPLACES MOST OF THE `FactGrid`s HERE. A fact grid stacks its label
 * above its value in its own column cell, which is right when the values are
 * long or need to align down a column. In this drawer most facts are two or
 * three words — a strategy name, a confidence level, a planned R — and stacking
 * each one cost two lines and a column gap to say something that fits on one.
 * On a phone, where the grid collapses to a single column, six facts became
 * twelve lines of alternating small text: the "long stack of independent
 * label/value blocks" the review named. This states the same fact on one row,
 * label left and value right, so a group of them reads as a group.
 */
function Line({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string | null;
  tone?: 'default' | 'numeric';
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-1">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd
        className={cn(
          'min-w-0 text-right text-sm break-words',
          tone === 'numeric' && 'numeric',
          value === null ? 'text-subtle-foreground' : 'text-foreground',
        )}
      >
        {value ?? 'Not recorded'}
      </dd>
    </div>
  );
}

/** A group of lines under one quiet heading. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h3 className="text-label text-muted-foreground mb-1 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * OVERVIEW — the story of the trade, in four groups.
 *
 * SEVEN SECTIONS BECAME FOUR. Timing folded into the result lead. "At entry" and
 * "Why this trade" were one subject — what the trader brought to the trade —
 * split across two headings. Chart and Notes were two fields each promoted to a
 * section of its own; they are one group, because "what else is attached to this
 * record" is one question.
 *
 * IDENTITY IS STILL NOT REPEATED. Symbol, direction and account sit in the
 * drawer's persistent header, forty pixels above, where they stay visible on
 * every tab and through every scroll.
 *
 * NO EMPTY-STATE ESSAYS. `PanelEmpty` printed a title and an explanatory
 * sentence for each absent optional area — three of them on an ordinary
 * part-filled trade, which is more text about what is missing than the trade
 * itself contains. An absent value is one muted line saying so.
 */
function OverviewTab({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const emotions =
    trade.emotions === null
      ? null
      : trade.emotions.length === 0
        ? 'None of these'
        : trade.emotions.map(emotionLabel).join(', ');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ResultBlock trade={trade} copy={copy} />

      <Group title="Strategy">
        {trade.strategy === null ? (
          <p className="text-subtle-foreground text-sm">No strategy assigned</p>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <dl className="divide-border min-w-0 divide-y">
              <Line label="Strategy" value={trade.strategy} />
              <Line label="Trade setup" value={trade.setup} />
            </dl>
            {/*
              THE ENTRY CHECKLIST BELONGS TO THE SETUP, AND STAYS CLOSED.
              It sat expanded under every trade that had one — five rows of
              condition names in a tab whose job is "what happened", read by
              someone who mostly wants the result. It is a disclosure now, with
              its state summarised on the trigger so the reader can tell whether
              opening it is worth doing.
            */}
            {trade.conditions.length === 0 ? null : (
              <EntryChecklistDisclosure conditions={trade.conditions} />
            )}
          </div>
        )}
      </Group>

      <Group title="Plan">
        {trade.plan === null ? (
          <p className="text-subtle-foreground text-sm">
            No original plan. Planned R stays unavailable rather than being reconstructed from the
            result.
          </p>
        ) : (
          <dl className="divide-border min-w-0 divide-y">
            {trade.plan.basis === 'money' ? (
              <>
                <Line
                  label="Planned risk"
                  value={
                    signedMoney(trade.plan.riskMinor, trade.currency)?.replace('+', '') ?? null
                  }
                  tone="numeric"
                />
                <Line
                  label="Target reward"
                  value={
                    signedMoney(trade.plan.rewardMinor, trade.currency)?.replace('+', '') ?? null
                  }
                  tone="numeric"
                />
              </>
            ) : (
              <>
                <Line label="Planned entry" value={trade.plan.entry} tone="numeric" />
                <Line label="Planned stop" value={trade.plan.stop} tone="numeric" />
                <Line label="Planned target" value={trade.plan.target} tone="numeric" />
              </>
            )}
            <Line label="Planned R" value={signedR(trade.plan.plannedR)} tone="numeric" />
          </dl>
        )}
      </Group>

      <Group title={trade.contextRecalled ? 'Context · recalled after the trade' : 'Context'}>
        <dl className="divide-border min-w-0 divide-y">
          <Line
            label="Confidence"
            value={trade.confidence === null ? null : (CONFIDENCE_LABEL[trade.confidence] ?? null)}
          />
          <Line label="Emotions" value={emotions} />
        </dl>
        {trade.entryReason === null ? null : (
          <p className="text-foreground mt-2 text-sm leading-relaxed">{trade.entryReason}</p>
        )}
      </Group>

      <Group title="Notes">
        {trade.notes === null ? (
          <p className="text-subtle-foreground text-sm">No notes.</p>
        ) : (
          <p className="text-foreground text-sm leading-relaxed">{trade.notes}</p>
        )}
        {trade.chartUrl === null ? null : (
          // "View chart", not the raw URL. A 44-character TradingView link is an
          // address, not information: it wraps across two lines, says nothing a
          // reader wants to read, and its only useful property is that it is
          // clickable. The href still carries it for copy-link and new-tab.
          <a
            href={trade.chartUrl}
            className="text-primary focus-visible:ring-ring mt-1 inline-flex min-h-11 min-w-0 items-center gap-1.5 rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            View chart
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </Group>
    </div>
  );
}

function ExecutionTab({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const isOpenPosition = trade.lifecycle === 'open' || trade.lifecycle === 'partially_closed';
  const remainingBps = 10000 - trade.closedBps;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/*
        NO "RECORDED USING MONEY", NO "STORED, NEVER DERIVED FROM PRICE AND SIZE".
        Both were true and both were about the implementation. A reader looking
        at a finished trade does not need to be told which representation the
        record happens to hold, and "stored, never derived" answers a question
        only the people who built it were asking.
      */}
      <PanelSection title="Opening">
        <FactGrid>
          <Fact label="Entry price" value={trade.entryPrice} tone="neutral" omitWhenEmpty />
          <Fact label="Stop loss at entry" value={trade.initialStop} tone="neutral" omitWhenEmpty />
          <Fact label="Position size" value={trade.positionSize} tone="neutral" omitWhenEmpty />
          <Fact
            label="Risk at entry"
            value={signedMoney(trade.actualRiskMinor, trade.currency)?.replace('+', '') ?? null}
            tone="neutral"
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
                {trade.exits.length === 1 ? null : (
                  <span className="bg-muted text-muted-foreground numeric mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs">
                    {exit.sequence}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    {/*
                      A FULL CLOSE IS NOT AN ALLOCATION. A single leg at 100%
                      printed "Exit 1 · 100.00% of position", which is three
                      pieces of arithmetic to say "it closed". The percentage
                      appears only when there is genuinely a division to describe.
                    */}
                    <span className="text-foreground numeric text-sm font-medium">
                      {trade.exits.length === 1 && Number(exit.percent) >= 99.995
                        ? 'Full close'
                        : `${exit.percent}% of position`}
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
            {/* Same interpolated-label wrap as the exits editor's
                "Use remaining X%" — see its note. */}
            <Button
              variant="outline"
              size="sm"
              className="h-auto min-h-11 min-w-0 shrink py-2 text-left whitespace-normal"
            >
              Close remaining {closedPercentLabel(remainingBps)}
            </Button>
          </div>
        ) : null}
      </PanelSection>

      <PanelSection title="Result">
        <FactGrid>
          <Fact
            label={
              trade.lifecycle === 'partially_closed' ? 'Net P&L from closed portion' : 'Net P&L'
            }
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
            label={trade.lifecycle === 'partially_closed' ? 'R from closed portion' : 'Result (R)'}
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

/**
 * THE ENTRY CHECKLIST, SUMMARISED ON ITS OWN TRIGGER.
 *
 * `Not answered` is a first-class third state, never folded into "not met" —
 * "I did not evaluate this" and "this was false" are different claims about a
 * trader's process, and only one of them is a criticism.
 *
 * THE EXPLANATORY CAPTION IS GONE. It read "Setup conditions · unanswered is not
 * the same as failed", which is the product explaining its own data model inside
 * an ordinary workflow. The three state words carry that distinction by
 * themselves: `Followed`, `Not followed`, `Not answered` cannot be confused with
 * one another, and a sentence saying so is a sentence about the schema.
 *
 * The trigger states the tally, so a reader can decide whether to open it at all.
 */
function EntryChecklistDisclosure({
  conditions,
  label = 'Entry checklist',
  stateLabels = { met: 'Met', not_met: 'Not met', not_recorded: 'Not answered' },
}: {
  conditions: PrototypeTrade['conditions'];
  label?: string;
  stateLabels?: { met: string; not_met: string; not_recorded: string };
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const tally = [
    conditions.filter((condition) => condition.state === 'met').length,
    conditions.filter((condition) => condition.state === 'not_met').length,
    conditions.filter((condition) => condition.state !== 'met' && condition.state !== 'not_met')
      .length,
  ];
  const summary = [
    tally[0] === 0 ? null : `${tally[0]} ${stateLabels.met.toLowerCase()}`,
    tally[1] === 0 ? null : `${tally[1]} ${stateLabels.not_met.toLowerCase()}`,
    tally[2] === 0 ? null : `${tally[2]} not answered`,
  ]
    .filter((part): part is string => part !== null)
    .join(', ');

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 w-full min-w-0 items-center gap-2 rounded-sm text-left text-xs outline-none focus-visible:ring-2"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-150',
            open && 'rotate-180',
            'motion-reduce:transition-none',
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">
          {label} · {summary}
        </span>
      </button>

      {open ? (
        <ul id={id} className="divide-border border-border mt-1 divide-y rounded-md border">
          {conditions.map((condition) => (
            <li
              key={condition.label}
              className="flex min-w-0 items-center justify-between gap-3 p-2.5"
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
                  ? stateLabels.met
                  : condition.state === 'not_met'
                    ? stateLabels.not_met
                    : stateLabels.not_recorded}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * REVIEW — the human question first, and the machinery behind it.
 *
 * IT USED TO OPEN ON "SYSTEM OUTCOME". The most technical idea in the product,
 * described in a sentence about counterfactual resolution, on the tab a trader
 * arrives at wanting to learn something about their own behaviour. If there was
 * no system result yet — which is the common case — the first thing the tab said
 * was that something was missing.
 *
 * IT OPENS ON THE NOTE NOW. "What would you repeat or change next time?" with
 * the trader's own sentence under it, or one quiet line and one action when
 * there is none. No dashed empty container: an absent review note is not a
 * broken record and does not need a box drawn around its absence.
 *
 * THE RULE OBSERVATIONS ARE A TALLY, NOT A LIST. "Rules · 2 followed, 1 not
 * answered" is what a reader wants at a glance, and the full list is one
 * activation away. Nothing converts an unanswered rule into a broken one.
 *
 * THE COMPARISON IS PLAIN MONEY AND R. `Actual vs System`, `System R` and
 * `Execution gap` were three terms of art in one panel; the comparison says
 * "Your net P&L" and "If you followed your rules" and lets the reader do the
 * subtraction they were always going to do anyway.
 */
function ReviewTab({ trade, copy }: { trade: PrototypeTrade; copy: PrototypeCopy }) {
  const money = signedMoney(trade.netPnlMinor, trade.currency);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Group title="What would you repeat or change next time?">
        {trade.reviewNote === null ? (
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p className="text-subtle-foreground text-sm">No review note yet.</p>
            <Button variant="outline" size="sm" className="min-h-11">
              Add review note
            </Button>
          </div>
        ) : (
          <p className="text-foreground text-sm leading-relaxed">{trade.reviewNote}</p>
        )}
      </Group>

      <Group title="Did you follow your rules?">
        {trade.executionRules.length === 0 ? (
          <p className="text-subtle-foreground text-sm">Not answered</p>
        ) : (
          <EntryChecklistDisclosure
            conditions={trade.executionRules}
            label="Rules"
            stateLabels={{ met: 'Followed', not_met: 'Not followed', not_recorded: 'Not answered' }}
          />
        )}

        {trade.mistakes.length === 0 ? null : (
          <div className="mt-3 flex flex-wrap gap-2">
            {trade.mistakes.map((mistake) => (
              <Badge key={mistake} variant="warning">
                {mistake}
              </Badge>
            ))}
          </div>
        )}
      </Group>

      <Group title="Result if you followed your rules">
        {trade.systemState === 'pending' ? (
          /*
            THE OFFER LIVES HERE AND NOWHERE ELSE. It was repeated in the journal
            row, in the Overview lead and again on this tab; a reader met the same
            unfinished chore three times before reaching the thing they came for.
            One action, on the tab where the work would actually be done.
          */
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p className="text-subtle-foreground text-sm">Not recorded</p>
            <Button size="sm" className="min-h-11">
              Compare with your rules
            </Button>
          </div>
        ) : trade.systemState === 'no_trade' ? (
          <p className="text-muted-foreground text-sm">
            Following your rules, you would not have taken this trade. That is not a zero result —
            there is nothing to compare against.
          </p>
        ) : (
          <dl className="divide-border min-w-0 divide-y">
            <Line label="Your net P&L" value={money} tone="numeric" />
            <Line label="Your result (R)" value={signedR(trade.actualR)} tone="numeric" />
            <Line
              label="If you followed your rules"
              value={signedR(trade.systemR)}
              tone="numeric"
            />
          </dl>
        )}
      </Group>

      <p className="text-subtle-foreground text-xs">{copy.timezoneNote}</p>
    </div>
  );
}
