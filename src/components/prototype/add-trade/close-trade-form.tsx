'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import { PROTOTYPE_TIMEZONE, type PrototypeTrade } from '../fixtures';
import { signedMoney } from '../presentation';
import { PrototypeShell } from '../prototype-shell';
import {
  Band,
  Field,
  FormFooter,
  FormShell,
  OutcomeChoice,
  PrimaryAmountField,
  TaskSurface,
  type MoneyOutcome,
} from './form-primitives';
import { TimestampField, type Timestamp } from './timestamp-picker';

/**
 * CLOSE TRADE — for a position the journal already knows about.
 *
 * THIS IS NOT "LOG A TRADE → FULLY CLOSED", AND THE DIFFERENCE IS THE WHOLE
 * POINT. That flow reconstructs a completed trade that was never journaled: it
 * has to ask for the account, the symbol, the direction, the entry time, the
 * risk and the plan, because nothing knows them. An open trade in the journal
 * has all of that already. Asking for it again would be asking a trader to
 * re-type their own record, and every re-typed field is a chance for the second
 * copy to disagree with the first.
 *
 * So this screen carries the baseline forward, read-only, and asks exactly one
 * question: WHAT ACTUALLY HAPPENED? How much closed, when, and what it made.
 *
 * THE DENOMINATOR NEVER MOVES. Actual R is the realized money over the ORIGINAL
 * risk at entry — the figure recorded when the trade began. It does not change
 * because a stop was moved to break-even, tightened, trailed, or because only
 * part of the position closed. A trade that risked 10 and made 5 is +0.50R
 * whether it closed in one exit or four, and there is no "current risk" here to
 * confuse that with.
 *
 * PARTIAL AND FULL ARE DIFFERENT OUTCOMES, NOT DIFFERENT AMOUNTS. Closing all
 * remaining settles the trade; closing part of it leaves the position open with
 * its remaining exposure intact, and the screen says which of the two is about
 * to happen before the trader commits to it.
 *
 * NOTHING HERE RECORDS A SYSTEM RESULT. What following the rules would have
 * produced is a separate judgement, it is optional, and it is never inferred
 * from the exit being recorded on this screen.
 */
export function CloseTradeForm({
  trade,
  /** Opens on the partial branch, for the review state that photographs it. */
  partial = false,
  /** Seeds the amount and its meaning, for the profit / loss / break-even states. */
  seed,
}: {
  trade: PrototypeTrade;
  partial?: boolean;
  seed?: { outcome: MoneyOutcome; amount: string };
}) {
  const [scope, setScope] = useState<'all' | 'part'>(partial ? 'part' : 'all');
  const [percent, setPercent] = useState('');
  const [outcome, setOutcome] = useState<MoneyOutcome>(seed?.outcome ?? 'profit');
  const [amount, setAmount] = useState(seed?.amount ?? '');
  const [exitedAt, setExitedAt] = useState<Timestamp | null>(null);

  const currency = trade.currency;

  /*
    THE BASELINE, AS RECORDED. Read from the trade rather than re-collected, and
    stated in the same three terms the details panel uses so a reader moving
    between them is looking at one record and not two descriptions of it.
  */
  const riskMinor = trade.actualRiskMinor;
  const riskNumber = riskMinor === null ? Number.NaN : Number(riskMinor) / 100;
  const hasRisk = Number.isFinite(riskNumber) && riskNumber > 0;
  const targetMinor = trade.plan?.rewardMinor ?? null;
  const targetR = hasRisk && targetMinor !== null ? Number(targetMinor) / 100 / riskNumber : null;

  /* Already realized before this exit — the closed portion of a partial trade. */
  const alreadyRealized = trade.netPnlMinor === null ? 0 : Number(trade.netPnlMinor) / 100;

  const magnitude = Number(amount);
  const thisExit =
    outcome === 'break_even'
      ? 0
      : amount !== '' && Number.isFinite(magnitude)
        ? magnitude * (outcome === 'loss' ? -1 : 1)
        : Number.NaN;
  const hasThisExit = Number.isFinite(thisExit);

  const cumulative = hasThisExit ? alreadyRealized + thisExit : Number.NaN;
  /*
    ACTUAL R — CUMULATIVE MONEY OVER THE ORIGINAL RISK.

    Not this exit's money over this exit's share of the risk. The percentages
    describe how much of the position closed; they do not re-weight amounts that
    are already the realized result of closing it. Weighting twice is how 40% at
    +80 becomes +0.14R instead of +0.80R.

    With no recorded risk there is no R. Not zero, not infinity — unavailable.
  */
  const actualR = hasRisk && hasThisExit ? cumulative / riskNumber : null;
  const settles = scope === 'all';

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <FormShell
        title="Close trade"
        situation={settles ? 'Closing the whole position' : 'Recording a partial exit'}
        footer={
          <FormFooter
            action={settles ? 'Close trade' : 'Record exit'}
            helper={
              settles
                ? 'This settles the trade. You can still add your review afterwards.'
                : 'The trade stays open with its remaining position.'
            }
            sticky
          />
        }
      >
        <TaskSurface>
          {/*
            THE TRADE, AS ALREADY RECORDED — a reference, not a form. Nothing
            here is editable, because nothing here is being asked for: the
            journal knows all of it, and re-collecting it is how the second copy
            comes to disagree with the first.
          */}
          <Band className="gap-2 py-3.5">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="text-foreground text-base font-semibold">{trade.symbol}</span>
              <span className="text-muted-foreground text-sm">
                {trade.direction === 'long' ? 'Long' : 'Short'}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              Opened {trade.enteredAt ?? 'time not recorded'} · {trade.accountName} · {currency}
            </p>
          </Band>

          <Band className="gap-2 py-3.5">
            <h2 className="text-label text-muted-foreground uppercase">Plan at entry</h2>
            <dl className="divide-border min-w-0 divide-y">
              <PlanLine
                label="Risk at entry"
                value={
                  riskMinor === null
                    ? null
                    : (signedMoney(riskMinor, currency)?.replace('+', '') ?? null)
                }
              />
              <PlanLine
                label="Target profit"
                value={
                  targetMinor === null
                    ? null
                    : (signedMoney(targetMinor, currency)?.replace('+', '') ?? null)
                }
              />
              {/* Target R is derived, and absent whenever either half is. It is
                  what the trade was set up to pay — never a result. */}
              <PlanLine
                label="Target R"
                value={targetR === null ? null : `+${targetR.toFixed(2)}R`}
              />
            </dl>
          </Band>

          <Band divided={false} className="py-4">
            <h2 className="text-label text-muted-foreground uppercase">What happened</h2>

            <fieldset className="min-w-0">
              <legend className="text-muted-foreground mb-1.5 text-xs font-medium">
                How much closed?
              </legend>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                {[
                  { value: 'all' as const, label: 'All remaining' },
                  { value: 'part' as const, label: 'Part of position' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={scope === option.value}
                    onClick={() => setScope(option.value)}
                    className={cn(
                      'flex min-h-11 items-center justify-center rounded-lg border px-2 text-sm font-medium',
                      'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
                      scope === option.value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-input bg-background text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            {scope === 'part' ? (
              <div className="max-w-[14rem]">
                <Field label="% of original position closed">
                  {(id) => (
                    <input
                      id={id}
                      value={percent}
                      inputMode="decimal"
                      placeholder="—"
                      onChange={(event) => setPercent(event.target.value)}
                      className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 numeric h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                    />
                  )}
                </Field>
              </div>
            ) : null}

            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-subtle-foreground text-xs">Times in {PROTOTYPE_TIMEZONE}</p>
              <TimestampField
                label="Exit time"
                title="Exit date and time"
                value={exitedAt}
                onChange={setExitedAt}
                placeholder="Not set"
              />
            </div>

            {/*
              THE SAME THREE WORDS THE REST OF THE PRODUCT USES. Break-even means
              net zero AFTER the costs attributable to this exit — an exit at the
              entry price is still a net loss if the fees were real.
            */}
            <OutcomeChoice value={outcome} onChange={setOutcome} />

            {outcome === 'break_even' ? (
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs font-medium">Net P&L for this exit</p>
                <p className="numeric text-foreground text-metric mt-0.5 font-semibold">
                  0.00 {currency}
                </p>
              </div>
            ) : (
              <PrimaryAmountField
                label={`Net ${outcome === 'loss' ? 'loss' : 'profit'} for this exit`}
                currency={currency}
                value={amount}
                onChange={setAmount}
                hint="After fees and other costs"
              />
            )}

            <ActualResult
              currency={currency}
              cumulative={cumulative}
              actualR={actualR}
              hasRisk={hasRisk}
              settles={settles}
              carriedForward={alreadyRealized !== 0}
            />
          </Band>
        </TaskSurface>
      </FormShell>
    </PrototypeShell>
  );
}

/** One baseline row. `null` prints "Not recorded" — never a fabricated zero. */
function PlanLine({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 py-1">
      <dt className="text-muted-foreground shrink-0 text-xs">{label}</dt>
      <dd
        className={cn(
          'numeric min-w-0 text-right text-sm',
          value === null ? 'text-subtle-foreground' : 'text-foreground',
        )}
      >
        {value ?? 'Not recorded'}
      </dd>
    </div>
  );
}

/**
 * What this exit makes the trade worth so far.
 *
 * MONEY LEADS, R FOLLOWS — the same order the rest of the product uses. The
 * label says whether this is the trade's final result or only the part of it
 * that has closed, because those are different claims and a partial trade's
 * figure is the one most likely to be misread as final.
 *
 * WITH NO RECORDED RISK THERE IS NO R, and the screen says so rather than
 * printing a zero. A real exit is still worth recording without one: the money
 * is a fact, and R is a ratio that needs a denominator nobody supplied.
 */
function ActualResult({
  currency,
  cumulative,
  actualR,
  hasRisk,
  settles,
  carriedForward,
}: {
  currency: string;
  cumulative: number;
  actualR: number | null;
  hasRisk: boolean;
  settles: boolean;
  carriedForward: boolean;
}) {
  if (!Number.isFinite(cumulative)) return null;

  const tone =
    cumulative > 0 ? 'text-positive' : cumulative < 0 ? 'text-negative' : 'text-foreground';

  return (
    <div className="border-border min-w-0 border-t pt-3">
      <p className="text-muted-foreground text-xs font-medium">
        {settles ? 'Actual result' : 'Net P&L from closed portion'}
      </p>
      <p className={cn('numeric mt-0.5 text-base font-semibold', tone)}>
        {cumulative > 0 ? '+' : ''}
        {cumulative.toFixed(2)} {currency}
      </p>

      <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground text-xs font-medium">Actual R</span>
        {actualR === null ? (
          <span className="text-subtle-foreground text-sm">
            {hasRisk ? 'Not available' : 'Needs a recorded risk at entry'}
          </span>
        ) : (
          <span className={cn('numeric text-base font-semibold', tone)}>
            {actualR > 0 ? '+' : ''}
            {actualR.toFixed(2)}R
          </span>
        )}
      </p>

      {carriedForward ? (
        <p className="text-subtle-foreground mt-1 text-xs">
          Includes what this trade had already realized.
        </p>
      ) : null}
    </div>
  );
}
