'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ExitRow {
  readonly id: string;
  readonly percent: string;
  readonly amount: string;
  readonly at: string;
  readonly usesFinalTime?: boolean;
}

/**
 * THE EXITS EDITOR.
 *
 * THE PERCENTAGE IS OF THE ORIGINAL POSITION, AND THE AMOUNT IS THAT LEG'S OWN
 * TOTAL. Those two sentences are the whole contract, and getting them wrong is
 * the single most consequential arithmetic error available here: 40% at +80 USD
 * and 60% at −30 USD is +50 USD and +0.50R against a 100 USD initial risk — it
 * is NOT +0.14R, which is what weighting already-realized amounts by their
 * percentage a second time produces. The header states the contract in words so
 * a reader never has to infer it from the numbers.
 *
 * NO INVENTED 50/50 ROWS. A new leg arrives with a blank percentage and a blank
 * result. The current form seeds two half-position rows, which look like a
 * sensible default and are in fact a fabricated claim about how the trade was
 * managed. "Use remaining 60%" is offered as an explicit action instead — the
 * reader asks for the number rather than being handed it.
 *
 * REALIZED SO FAR IS NEVER SHOWN AS A FINAL RESULT. While the legs total under
 * 100%, the summary says what is realized and what is still open, and the
 * closed-trade action stays unavailable. Below 100% nothing is normalised
 * silently: the reader either records the rest or changes to an open position.
 */
/**
 * THE ORDINARY CLOSE IS NOT AN ALLOCATION PROBLEM.
 *
 * A trader who simply closed their position has one result and one time. Asking
 * them to confirm that it was 100% of the position, in an editable field, beside
 * a "0.00% remaining" meter, is arithmetic invented by the form — there is
 * nothing to divide. This is what the single-close path shows instead; the
 * percentage machinery appears only once the reader asks for Multiple exits,
 * because that is the only situation in which it means anything.
 */
export function SingleCloseFields({
  amount,
  onAmountChange,
  at,
  onAtChange,
  currency = 'USD',
}: {
  amount: string;
  onAmountChange: (value: string) => void;
  at: string;
  onAtChange: (value: string) => void;
  currency?: string;
}) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 min-[560px]:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="single-close-amount" className="text-xs">
          Net P&amp;L ({currency})
        </Label>
        <Input
          id="single-close-amount"
          value={amount}
          inputMode="decimal"
          onChange={(event) => onAmountChange(event.target.value)}
          className="numeric text-base"
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="single-close-at" className="text-xs">
          Exit time
        </Label>
        <Input
          id="single-close-at"
          value={at}
          onChange={(event) => onAtChange(event.target.value)}
          className="text-base"
        />
      </div>
    </div>
  );
}

export function ExitsEditor({
  variant = 'after-trade',
  initialRows,
  initialRisk = '100.00',
  currency = 'USD',
}: {
  /** `after-trade` must reach exactly 100%; `open-position` may stay short of it. */
  variant?: 'after-trade' | 'open-position';
  initialRows?: readonly ExitRow[];
  initialRisk?: string;
  currency?: string;
}) {
  const [rows, setRows] = useState<readonly ExitRow[]>(
    initialRows ?? [
      { id: 'e1', percent: '40.00', amount: '80.00', at: '5 Sep 2026, 13:44' },
      { id: 'e2', percent: '', amount: '', at: '' },
    ],
  );

  const recorded = rows.reduce((total, row) => {
    const value = Number(row.percent);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
  const remaining = Math.max(0, 100 - recorded);

  const realized = rows.reduce((total, row) => {
    const value = Number(row.amount);
    return Number.isFinite(value) && row.amount !== '' ? total + value : total;
  }, 0);

  const riskNumber = Number(initialRisk);
  const realizedR = Number.isFinite(riskNumber) && riskNumber > 0 ? realized / riskNumber : null;

  const complete = Math.abs(recorded - 100) < 0.005;

  function update(id: string, patch: Partial<ExitRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div className="border-border bg-card min-w-0 rounded-lg border">
      <div className="border-border flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
        <h3 className="text-foreground text-sm font-semibold">Exits</h3>
        <p className="numeric text-muted-foreground text-sm">
          <span className="text-foreground font-medium">{recorded.toFixed(2)}% recorded</span>
          {' · '}
          {remaining.toFixed(2)}% remaining
        </p>
      </div>

      <ol className="divide-border min-w-0 divide-y">
        {rows.map((row, index) => (
          <li key={row.id} className="min-w-0 px-4 py-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="text-muted-foreground text-xs font-medium">Exit {index + 1}</span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove exit ${index + 1}`}
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                  className="text-muted-foreground hover:text-negative focus-visible:ring-ring flex size-8 items-center justify-center rounded-md outline-none focus-visible:ring-2"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 min-[560px]:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${row.id}-percent`} className="text-xs">
                  % of original position
                </Label>
                <Input
                  id={`${row.id}-percent`}
                  value={row.percent}
                  inputMode="decimal"
                  placeholder="—"
                  onChange={(event) => update(row.id, { percent: event.target.value })}
                  className="numeric text-base"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${row.id}-amount`} className="text-xs">
                  Net P&amp;L for this exit ({currency})
                </Label>
                <Input
                  id={`${row.id}-amount`}
                  value={row.amount}
                  inputMode="decimal"
                  placeholder="—"
                  onChange={(event) => update(row.id, { amount: event.target.value })}
                  className="numeric text-base"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor={`${row.id}-at`} className="text-xs">
                  Exit time
                </Label>
                <Input
                  id={`${row.id}-at`}
                  value={row.at}
                  placeholder="—"
                  onChange={(event) => update(row.id, { at: event.target.value })}
                  className="text-base"
                />
                {row.at === '' ? (
                  // An explicit, visible fallback — not an estimated event time.
                  // Said ONCE, below the field: as a placeholder AND a hint it
                  // appeared twice within 30 pixels of itself.
                  <p className="text-subtle-foreground text-xs">Uses final exit time</p>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/*
        AT 100% THERE IS NOTHING LEFT TO ALLOCATE, AND THE UI SAYS SO.

        `Add exit` used to stay live at a full allocation, offering a sixth leg
        of a position that is entirely closed. Pressing it could only produce an
        invalid total, so the reader was being invited to break the record. It
        is disabled at 100% with the reason stated — and the reason names the
        remedy, because redistribution IS supported: reduce an existing leg and
        the remainder reappears.
      */}
      <div className="border-border flex min-w-0 flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button
          variant="outline"
          size="sm"
          aria-disabled={complete}
          className={cn(complete && 'pointer-events-none opacity-50')}
          onClick={() => {
            if (complete) return;
            setRows((current) => [
              ...current,
              { id: `e${current.length + 1}-${Date.now()}`, percent: '', amount: '', at: '' },
            ]);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add exit
        </Button>
        {complete ? (
          <p className="text-muted-foreground min-w-0 text-xs">
            100% allocated. Reduce an exit to free up a percentage.
          </p>
        ) : null}
        {remaining > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            /*
              `Button` is `whitespace-nowrap` by design, which is right for the
              short labels it usually carries. This one interpolates a number
              into a sentence, and at 200% text zoom on a 390px screen
              "Use remaining 60.00%" is 346px of unbreakable text that pushed
              the page 21px sideways. Allowing THIS label to wrap keeps the
              button's own contract intact everywhere else.
            */
            // `shrink min-w-0` as well as `whitespace-normal`: `Button` is
            // `shrink-0`, so letting the text wrap was not enough — a flex item
            // that cannot shrink still claims its max-content width, and the
            // label went on overflowing at its full 346px.
            className="h-auto min-h-11 min-w-0 shrink py-2 text-left whitespace-normal"
            onClick={() =>
              setRows((current) => {
                const lastBlank = [...current].reverse().find((row) => row.percent === '');
                if (lastBlank === undefined) return current;
                return current.map((row) =>
                  row.id === lastBlank.id ? { ...row, percent: remaining.toFixed(2) } : row,
                );
              })
            }
          >
            Use remaining {remaining.toFixed(2)}%
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          'border-border border-t px-4 py-3',
          complete ? 'bg-muted/40' : 'bg-warning/5',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="min-w-0 text-sm">
            <span className="text-muted-foreground">
              {complete ? 'Final result' : 'Realized so far'}
            </span>{' '}
            <span
              className={cn(
                'numeric text-base font-semibold',
                realized > 0 ? 'text-positive' : realized < 0 ? 'text-negative' : 'text-foreground',
              )}
            >
              {realized > 0 ? '+' : ''}
              {realized.toFixed(2)} {currency}
            </span>
          </p>
          {realizedR === null ? null : (
            <p className="min-w-0 text-sm">
              <span className="text-muted-foreground">{complete ? 'Actual R' : 'Realized R'}</span>{' '}
              <span
                className={cn(
                  'numeric text-base font-semibold',
                  realizedR > 0
                    ? 'text-positive'
                    : realizedR < 0
                      ? 'text-negative'
                      : 'text-foreground',
                )}
              >
                {realizedR > 0 ? '+' : ''}
                {realizedR.toFixed(2)}R
              </span>
            </p>
          )}
        </div>

        <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
          {complete
            ? `Each leg's own total, summed. Against ${initialRisk} ${currency} of initial risk for the whole position.`
            : variant === 'after-trade'
              ? `${remaining.toFixed(2)}% is unaccounted for. A closed trade must total exactly 100% — record the rest, or change this to an open position.`
              : `Realized so far. ${remaining.toFixed(2)}% of the position is still open, so this is not the final closed-trade result.`}
        </p>
      </div>
    </div>
  );
}
