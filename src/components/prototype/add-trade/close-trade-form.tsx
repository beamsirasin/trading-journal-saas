'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

import {
  actualR,
  allocation,
  cumulativeRealized,
  lifecycleOf,
  resultLabel,
  statusText,
  type ExitHistory,
  type ExitRecord,
} from '../exit-model';
import { PROTOTYPE_TIMEZONE, type PrototypeTrade } from '../fixtures';
import { signedMoney } from '../presentation';
import { PrototypeShell } from '../prototype-shell';
import { ExitFields } from './exit-fields';
import { Band, FormFooter, FormShell, TaskSurface, type MoneyOutcome } from './form-primitives';

/**
 * CLOSE TRADE — for a position the journal already knows about.
 *
 * THIS IS NOT "LOG A TRADE → FULLY CLOSED", AND THE DIFFERENCE IS THE POINT.
 * That flow reconstructs a completed trade that was never journaled: it has to
 * ask for the account, symbol, direction, entry time, risk and plan, because
 * nothing knows them. An open trade in the journal has all of that already, and
 * every re-typed field is a chance for the second copy to disagree with the
 * first. So the baseline is carried forward read-only and the screen asks one
 * question: WHAT ACTUALLY HAPPENED?
 *
 * IT RENDERS THE SHARED `ExitFields` AND CALLS THE SHARED `exit-model`. The
 * Record exit action in Trade details opens this same screen, and the historical
 * multiple-exits editor renders the same field set against the same functions.
 * One contract, three views — which is the only way two surfaces recording one
 * event stay in agreement about what it made.
 *
 * THE DENOMINATOR NEVER MOVES. Actual R is realized money over the ORIGINAL risk
 * at entry. It does not change because a stop was trailed, because only part of
 * the position closed, or because a fraction happens to be known.
 */
export function CloseTradeForm({
  trade,
  /** Opens on the partial branch — how Record exit arrives here. */
  partial = false,
  /** Seeds the amount and its meaning, for the review states. */
  seed,
  /** Seeds the optional fraction, for the state that shows a safe remainder. */
  seedPercent,
  /** Pretends an earlier exit exists whose fraction was never recorded. */
  priorUnknownExit = false,
}: {
  trade: PrototypeTrade;
  partial?: boolean;
  seed?: { outcome: MoneyOutcome; amount: string };
  seedPercent?: string;
  priorUnknownExit?: boolean;
}) {
  const currency = trade.currency;

  /*
    EXITS ALREADY ON THE RECORD. `priorUnknownExit` is the review state that
    matters most here: an earlier partial exit whose fraction nobody wrote down.
    Its money still counts; its allocation is simply unknowable, and the screen
    must not invent one.
  */
  const priorExits: readonly ExitRecord[] = priorUnknownExit
    ? [
        {
          id: 'prior',
          scope: 'part',
          percent: '',
          outcome: 'profit',
          amount: '10.00',
          at: { date: '2026-09-06', time: '17:40' },
        },
      ]
    : [];

  const [exit, setExit] = useState<ExitRecord>({
    id: 'new',
    scope: partial ? 'part' : 'all_remaining',
    percent: seedPercent ?? '',
    outcome: seed?.outcome ?? 'profit',
    amount: seed?.amount ?? '',
    at: null,
  });
  const [history, setHistory] = useState<ExitHistory>('unknown');

  const riskMinor = trade.actualRiskMinor;
  const riskNumber = riskMinor === null ? Number.NaN : Number(riskMinor) / 100;
  const targetMinor = trade.plan?.rewardMinor ?? null;
  const targetR =
    Number.isFinite(riskNumber) && riskNumber > 0 && targetMinor !== null
      ? Number(targetMinor) / 100 / riskNumber
      : null;

  const allExits = [...priorExits, exit];
  const realized = cumulativeRealized(allExits);
  const lifecycle = lifecycleOf(allExits, false);
  const alloc = allocation(allExits);
  const r = actualR(realized.total, riskNumber);
  const label = resultLabel({ lifecycle, history, everyExitPriced: realized.everyExitPriced });
  const settles = exit.scope === 'all_remaining';

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <FormShell
        title={settles ? 'Close trade' : 'Record exit'}
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
          {/* The trade, as already recorded — a reference, not a form. */}
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
            {priorExits.length === 0 ? null : (
              <p className="text-subtle-foreground text-xs">
                1 earlier exit recorded · portion not recorded
              </p>
            )}
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
              <PlanLine
                label="Target R"
                value={targetR === null ? null : `+${targetR.toFixed(2)}R`}
              />
            </dl>
          </Band>

          <Band divided={false} className="py-4">
            <h2 className="text-label text-muted-foreground uppercase">What happened</h2>
            <p className="text-subtle-foreground text-xs">Times in {PROTOTYPE_TIMEZONE}</p>

            {/*
              THE SHARED FIELD SET. Scope, time, meaning, money — then the
              fraction, last and optional. The percentage used to come first and
              block everything behind it; a trader who knows an exit made 10 USD
              but not whether it was 40% or 45% can now record exactly that.
            */}
            <ExitFields
              exit={exit}
              currency={currency}
              riskAtEntry={String(riskNumber)}
              onChange={(patch) => setExit((current) => ({ ...current, ...patch }))}
            />

            <ExitTotals
              label={label}
              total={realized.total}
              currency={currency}
              r={r}
              statusLine={statusText(lifecycle, alloc)}
              askHistory={lifecycle === 'closed'}
              history={history}
              onHistoryChange={setHistory}
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
 * What the trade is worth so far, and what it leaves behind.
 *
 * THE LABEL IS COMPUTED, NOT CHOSEN. `resultLabel` decides between "closed
 * portion", "recorded exits" and "final" from the lifecycle, the exit history
 * and whether every exit carries an amount — so this component cannot call a
 * subtotal final by accident, and neither can the exits editor, which asks the
 * same function.
 *
 * CLOSURE IS NOT COMPLETENESS. A settled position can still be missing an exit,
 * so the question is asked rather than assumed, and until it is answered the
 * figure is labelled a recorded subtotal.
 */
function ExitTotals({
  label,
  total,
  currency,
  r,
  statusLine,
  askHistory,
  history,
  onHistoryChange,
}: {
  label: string;
  total: number;
  currency: string;
  r: number | null;
  statusLine: string;
  askHistory: boolean;
  history: ExitHistory;
  onHistoryChange: (history: ExitHistory) => void;
}) {
  const tone = total > 0 ? 'text-positive' : total < 0 ? 'text-negative' : 'text-foreground';

  return (
    <div className="border-border min-w-0 border-t pt-3">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className={cn('numeric mt-0.5 text-base font-semibold', tone)}>
        {total > 0 ? '+' : ''}
        {total.toFixed(2)} {currency}
      </p>

      <p className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-muted-foreground text-xs font-medium">Actual R</span>
        {r === null ? (
          <span className="text-subtle-foreground text-sm">Needs a recorded risk at entry</span>
        ) : (
          <span className={cn('numeric text-base font-semibold', tone)}>
            {r > 0 ? '+' : ''}
            {r.toFixed(2)}R
          </span>
        )}
      </p>

      {/* The words the allocation can actually support, and no percentage it
          cannot. */}
      <p className="text-subtle-foreground mt-1 text-xs">After this exit · {statusLine}</p>

      {askHistory ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted-foreground text-xs">Are all exits recorded?</span>
          {[
            { value: 'complete' as const, label: 'Yes' },
            { value: 'incomplete' as const, label: 'No' },
            { value: 'unknown' as const, label: 'Not sure' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={history === option.value}
              onClick={() => onHistoryChange(option.value)}
              className={cn(
                'focus-visible:ring-ring relative rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-2',
                'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                history === option.value
                  ? 'border-primary bg-primary/10 text-foreground font-medium'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
