'use client';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

import { actualR, signedExitAmount, type ExitRecord } from '../exit-model';
import { Field, OutcomeChoice, PrimaryAmountField } from './form-primitives';
import { TimestampField } from './timestamp-picker';

/**
 * ONE EXIT'S FIELDS — the same set, in the same order, wherever an exit is
 * recorded.
 *
 * The Close trade flow, the Record exit action and the historical multiple-exits
 * editor all render this. That is what stops the three from drifting into subtly
 * different questions about the same event, which is exactly how two screens end
 * up disagreeing about what a trade made.
 *
 * THE ORDER IS THE POINT. Scope, time, meaning, money — then the percentage,
 * last and optional. It used to lead with "% of original position closed", which
 * put the one field a trader is least likely to remember in front of the three
 * they always know, and made an optional detail feel like a gate. A trader who
 * closed part of a position for +10 USD can now record exactly that and move on.
 *
 * THE PERCENTAGE NAMES ITS OWN SCOPE. "Portion of original position closed",
 * never a bare "% closed" — the difference between a fraction of the original
 * position and a fraction of what was left is an arithmetic error waiting to be
 * made by the reader rather than by the code.
 */
export function ExitFields({
  exit,
  currency,
  riskAtEntry,
  onChange,
}: {
  exit: ExitRecord;
  currency: string;
  /** The trade's ORIGINAL risk at entry, for the R contribution line. */
  riskAtEntry: string;
  onChange: (patch: Partial<ExitRecord>) => void;
}) {
  const signed = signedExitAmount(exit);
  const contribution = signed === null ? null : actualR(signed, Number(riskAtEntry));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <fieldset className="min-w-0">
        <legend className="text-muted-foreground mb-1.5 text-xs font-medium">
          How much did you close?
        </legend>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          {[
            { value: 'all_remaining' as const, label: 'All remaining' },
            { value: 'part' as const, label: 'Part of position' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={exit.scope === option.value}
              onClick={() =>
                onChange(
                  option.value === 'all_remaining'
                    ? // Closing the rest needs no fraction, and keeping a stale
                      // one would leave a percentage describing a different exit.
                      { scope: option.value, percent: '' }
                    : { scope: option.value },
                )
              }
              className={cn(
                'flex min-h-11 items-center justify-center rounded-lg border px-2 text-sm font-medium',
                'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
                exit.scope === option.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      <TimestampField
        label="Exit time"
        title="Exit date and time"
        value={exit.at}
        onChange={(at) => onChange({ at })}
        placeholder="Not set"
      />

      <OutcomeChoice
        value={exit.outcome}
        onChange={(outcome) => onChange({ outcome })}
        legend="Was this a profit or a loss?"
      />

      {exit.outcome === 'break_even' ? (
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">Net P&L for this exit</p>
          <p className="numeric text-foreground mt-0.5 text-xl font-semibold">0.00 {currency}</p>
        </div>
      ) : (
        <PrimaryAmountField
          label={`Net ${exit.outcome === 'loss' ? 'loss' : 'profit'} for this exit`}
          currency={currency}
          value={exit.amount}
          onChange={(amount) => onChange({ amount })}
          hint="After fees and other costs"
        />
      )}

      {/*
        THE R THIS EXIT CONTRIBUTES — the money over the ORIGINAL risk, never
        over a risk scaled by the fraction closed. This exit's amount is already
        the proceeds of its own fraction; weighting it again is the error the
        whole model is built to avoid.
      */}
      {contribution === null ? null : (
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground text-xs font-medium">Actual R contribution</span>
          <span
            className={cn(
              'numeric text-base font-semibold',
              contribution > 0
                ? 'text-positive'
                : contribution < 0
                  ? 'text-negative'
                  : 'text-foreground',
            )}
          >
            {contribution > 0 ? '+' : ''}
            {contribution.toFixed(2)}R
          </span>
        </p>
      )}

      {/*
        LAST, AND GENUINELY OPTIONAL. Nothing is inferred from its absence: not a
        remaining percentage, not a cumulative allocation, not a lifecycle. An
        exit with no fraction recorded is a complete exit.
      */}
      {/* `w-full min-w-0` as well as the cap: without them the wrapper takes its
          max-content width inside a flex column, and at 200% zoom on a 320px
          screen that collapsed the field to 18px of crushed, vertically wrapped
          text. The cap is a maximum, not a width. */}
      {exit.scope === 'part' ? (
        <div className="w-full max-w-[16rem] min-w-0">
          <Field label="Portion of original position closed" optional>
            {(id) => (
              <Input
                id={id}
                value={exit.percent}
                inputMode="decimal"
                placeholder="—"
                onChange={(event) => onChange({ percent: event.target.value })}
                className="numeric text-base"
              />
            )}
          </Field>
        </div>
      ) : null}
    </div>
  );
}
