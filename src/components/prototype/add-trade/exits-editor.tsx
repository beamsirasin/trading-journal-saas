'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Field, OutcomeChoice, type MoneyOutcome } from './form-primitives';
import { formatTimestamp, TimestampField, type Timestamp } from './timestamp-picker';

export interface ExitRow {
  readonly id: string;
  /** Percent of the ORIGINAL position, as typed. */
  readonly percent: string;
  /** What the amount MEANS — the same three words the main result uses. */
  readonly outcome: MoneyOutcome;
  /** This leg's OWN result, unsigned. Never re-weighted by the percentage. */
  readonly amount: string;
  readonly at: Timestamp | null;
}

/**
 * THE EXITS EDITOR.
 *
 * THE ARITHMETIC CONTRACT IS UNCHANGED, and it is the reason this control is
 * treated so carefully. The percentage is of the ORIGINAL position and the
 * amount is that leg's OWN total: 40% at +80 USD and 60% at −30 USD is +50 USD
 * and +0.50R against a 100 USD risk at entry — NOT +0.14R, which is what
 * weighting already-realized amounts by their percentage a second time gives.
 * The field is labelled `% of original position closed` rather than `% closed`
 * for exactly that reason.
 *
 * THE SIGN IS ASKED IN WORDS HERE TOO. A leg used to be typed as a signed
 * number, so recording a losing exit meant knowing to type a minus — the same
 * inference the main result stopped requiring when the `+/-` toggle was
 * replaced by Profit / Loss / Break-even. One product should not ask a trader
 * to learn two different conventions for the same fact, so this uses the same
 * control and stores the magnitude beside the meaning.
 *
 * `Add exit` / `Update exit`, NOT `Save exit`. Nothing here saves a trade. The
 * only Save is the one on the main screen, and an action inside a draft that
 * says "Save" invites a reader to believe their trade is now recorded.
 *
 * AMBER MEANS A REQUIREMENT IS UNMET, NOT THAT WORK IS IN PROGRESS. A position
 * with 60% still open is an ordinary state, styled neutrally. A trade being
 * recorded as fully closed whose legs do not total 100% is a record that cannot
 * be saved as it stands.
 */

export const DEFAULT_EXIT_ROWS: readonly ExitRow[] = [
  {
    id: 'e1',
    percent: '25',
    outcome: 'loss',
    amount: '40.00',
    at: { date: '2026-09-01', time: '12:02' },
  },
  {
    id: 'e2',
    percent: '35',
    outcome: 'profit',
    amount: '120.00',
    at: { date: '2026-09-01', time: '14:15' },
  },
];

/** The leg's signed contribution, from its magnitude and its stated meaning. */
export function signedExitAmount(row: ExitRow): number {
  if (row.outcome === 'break_even') return 0;
  const magnitude = Number(row.amount);
  if (!Number.isFinite(magnitude) || row.amount === '') return Number.NaN;
  return row.outcome === 'loss' ? -magnitude : magnitude;
}

/**
 * The latest recorded exit instant, or `null` while none carries a time.
 *
 * THIS IS WHERE A MULTI-EXIT TRADE'S FINAL EXIT TIME COMES FROM. Asking a
 * trader to maintain per-leg timestamps AND a separate "final exit time" is
 * asking them to keep two records in agreement by hand, and the form has no way
 * to tell which one to believe when they drift. The last leg to close IS the
 * final exit.
 */
export function latestExitTimestamp(rows: readonly ExitRow[]): Timestamp | null {
  const stamped = rows.filter((row): row is ExitRow & { at: Timestamp } => row.at !== null);
  if (stamped.length === 0) return null;
  return stamped.reduce((latest, row) =>
    `${row.at.date}T${row.at.time}` > `${latest.at.date}T${latest.at.time}` ? row : latest,
  ).at;
}

/** `40%` where it is whole, `40.5%` where it is not. Never `40.00%`. */
function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`;
}

export function ExitsEditor({
  variant = 'after-trade',
  rows,
  onRowsChange,
  initialRisk = '100.00',
  currency = 'USD',
  /** Opens one leg's editor on arrival, for the active-editor review state. */
  initialActiveId = null,
}: {
  /** `after-trade` reports RECORDING COVERAGE; `open-position` reports LIFECYCLE. */
  variant?: 'after-trade' | 'open-position';
  rows: readonly ExitRow[];
  onRowsChange: (rows: readonly ExitRow[]) => void;
  initialRisk?: string;
  currency?: string;
  initialActiveId?: string | null;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [draftIds, setDraftIds] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const closed = rows.reduce((total, row) => {
    const value = Number(row.percent);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
  const remainder = 100 - closed;

  const realized = rows.reduce((total, row) => {
    const value = signedExitAmount(row);
    return Number.isFinite(value) ? total + value : total;
  }, 0);

  const riskNumber = Number(initialRisk);
  const realizedR = Number.isFinite(riskNumber) && riskNumber > 0 ? realized / riskNumber : null;

  const complete = Math.abs(closed - 100) < 0.005;
  const overAllocated = closed > 100.005;
  const unresolved = overAllocated || (variant === 'after-trade' && !complete);

  const coverageWord = variant === 'after-trade' ? 'recorded' : 'closed';
  const remainderWord = variant === 'after-trade' ? 'not recorded' : 'still open';

  function update(id: string, patch: Partial<ExitRow>) {
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div className="border-border min-w-0 rounded-lg border">
      <div className="border-border flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-2.5">
        <h3 className="text-foreground text-sm font-medium">Exits</h3>
        {/*
          TWO DIFFERENT QUESTIONS, TWO DIFFERENT VOCABULARIES.

          "40% still open" is a claim about the POSITION — that part of it is
          still exposed to the market. On a trade the trader has just told us is
          FULLY CLOSED that claim is false: the position is closed, and what is
          missing is the record of how. Saying "still open" there silently
          contradicts the lifecycle they selected one screen earlier.

          A fully closed trade reports RECORDING COVERAGE; an open position
          reports LIFECYCLE. Same arithmetic, two meanings, never the same words.
        */}
        <p className="numeric text-muted-foreground text-xs">
          <span className="text-foreground font-medium">
            {formatPercent(closed)} {coverageWord}
          </span>
          {remainder > 0.005 ? ` · ${formatPercent(remainder)} ${remainderWord}` : ''}
        </p>
      </div>

      <ol className="divide-border min-w-0 divide-y">
        {rows.map((row, index) => (
          <li key={row.id} className="min-w-0">
            {activeId === row.id ? (
              <ExitEditorRow
                index={index}
                row={row}
                currency={currency}
                remainingForRow={remainder + (Number(row.percent) || 0)}
                canRemove={rows.length > 1}
                isDraft={draftIds.includes(row.id)}
                onChange={(patch) => update(row.id, patch)}
                onRemove={() => {
                  onRowsChange(rows.filter((item) => item.id !== row.id));
                  setDraftIds((current) => current.filter((id) => id !== row.id));
                  setActiveId(null);
                  setNotice(null);
                }}
                onCommit={() => {
                  setActiveId(null);
                  setDraftIds((current) => current.filter((id) => id !== row.id));
                  setNotice(
                    `${formatPercent(closed)} ${coverageWord}` +
                      (remainder > 0.005 ? ` · ${formatPercent(remainder)} ${remainderWord}` : ''),
                  );
                }}
              />
            ) : (
              <ExitSummaryRow
                index={index}
                row={row}
                currency={currency}
                onEdit={() => {
                  setActiveId(row.id);
                  setNotice(null);
                }}
              />
            )}
          </li>
        ))}
      </ol>

      {/*
        AT 100% THERE IS NOTHING LEFT TO ALLOCATE, AND THE CONTROL SIMPLY DOES
        NOT OFFER IT. Redistribution is still supported: reduce a leg and both
        the remainder and this action come back.
      */}
      {complete ? null : (
        <div className="border-border border-t px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-11 min-w-0 shrink py-2 text-left whitespace-normal"
            onClick={() => {
              const id = `e${rows.length + 1}-${Date.now()}`;
              onRowsChange([...rows, { id, percent: '', outcome: 'profit', amount: '', at: null }]);
              setDraftIds((current) => [...current, id]);
              setActiveId(id);
              setNotice(null);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Record an exit
          </Button>
        </div>
      )}

      {notice === null ? null : (
        <p role="status" className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
          {notice}
        </p>
      )}

      <div
        className={cn(
          'border-border min-w-0 border-t px-3 py-2.5',
          unresolved ? 'bg-warning/5' : 'bg-muted/30',
        )}
      >
        {/*
          THE LABEL NAMES THE SCOPE, and which scope depends on what kind of
          remainder this is: unrecorded coverage on a closed trade, or a real
          open remainder on a running position.
        */}
        <p className="text-muted-foreground text-xs font-medium">
          {complete
            ? 'Net P&L'
            : variant === 'after-trade'
              ? 'Net P&L from recorded exits'
              : 'Net P&L from closed portion'}
        </p>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              'numeric text-base font-semibold',
              realized > 0 ? 'text-positive' : realized < 0 ? 'text-negative' : 'text-foreground',
            )}
          >
            {realized > 0 ? '+' : ''}
            {realized.toFixed(2)} {currency}
          </span>
          {realizedR === null ? null : (
            <span className="numeric text-muted-foreground text-sm">
              · {realizedR > 0 ? '+' : ''}
              {realizedR.toFixed(2)}R
            </span>
          )}
        </div>

        <p
          className={cn(
            'mt-1 text-xs leading-relaxed',
            unresolved ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {overAllocated
            ? `Exits total ${formatPercent(closed)} of the position. Reduce a leg to bring it back to 100%.`
            : complete
              ? `Against ${initialRisk} ${currency} risked at entry.`
              : variant === 'after-trade'
                ? `${formatPercent(remainder)} of the position has no exit recorded yet. A fully closed trade needs all 100%.`
                : `${formatPercent(remainder)} of the position is still open.`}
        </p>
      </div>
    </div>
  );
}

/**
 * A recorded leg, at rest.
 *
 * Two lines: what it was and what it made, then when and the way back in. The
 * money is the only emphasised thing in the row, because scanning a column of
 * legs is scanning their results.
 */
function ExitSummaryRow({
  index,
  row,
  currency,
  onEdit,
}: {
  index: number;
  row: ExitRow;
  currency: string;
  onEdit: () => void;
}) {
  const amount = signedExitAmount(row);
  const hasAmount = Number.isFinite(amount);

  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="text-foreground min-w-0 truncate text-sm">
          Exit {index + 1}
          <span className="text-muted-foreground">
            {' · '}
            <span className="numeric">
              {row.percent === '' ? 'Not set' : formatPercent(Number(row.percent))}
            </span>
          </span>
        </span>
        <span
          className={cn(
            'numeric shrink-0 text-sm font-semibold',
            !hasAmount
              ? 'text-subtle-foreground font-normal'
              : amount > 0
                ? 'text-positive'
                : amount < 0
                  ? 'text-negative'
                  : 'text-foreground',
          )}
        >
          {hasAmount ? `${amount > 0 ? '+' : ''}${amount.toFixed(2)} ${currency}` : 'No result'}
        </span>
      </div>

      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="text-muted-foreground numeric min-w-0 truncate text-xs">
          {formatTimestamp(row.at) ?? 'Exit time not recorded'}
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit exit ${index + 1}`}
          className={cn(
            // The ::after extension gives height, not width — and the audit
            // measures the element's own rect. `px-1.5` is a real 30px target.
            'text-primary focus-visible:ring-ring relative shrink-0 rounded-sm px-1.5 text-xs font-medium',
            'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
            'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
          )}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

/**
 * The one leg being edited.
 *
 * IT OPENS ON A QUESTION. "How much did you close?" with `Part of the position`
 * and `All remaining` beside it is answerable without arithmetic — and choosing
 * `All remaining` fills the percentage rather than making the trader work out
 * what is left, which is the commonest way a partial exit gets recorded wrongly.
 *
 * THE COMMIT ACTION NAMES WHAT IT DOES TO THE LEG, NOT TO THE TRADE. `Add exit`
 * on a leg that did not exist a moment ago; `Update exit` on one being changed.
 * It used to say `Save exit`, which is the same word the trade-level action
 * uses — and a reader who believes the trade has been saved will leave without
 * saving it.
 */
function ExitEditorRow({
  index,
  row,
  currency,
  remainingForRow,
  canRemove,
  isDraft,
  onChange,
  onRemove,
  onCommit,
}: {
  index: number;
  row: ExitRow;
  currency: string;
  /** What this leg could take without pushing the total past 100%. */
  remainingForRow: number;
  canRemove: boolean;
  /** Created by `Record an exit` and not yet committed once. */
  isDraft: boolean;
  onChange: (patch: Partial<ExitRow>) => void;
  onRemove: () => void;
  onCommit: () => void;
}) {
  const isAllRemaining =
    row.percent !== '' && Math.abs(Number(row.percent) - remainingForRow) < 0.005;

  return (
    <div className="bg-accent/30 flex min-w-0 flex-col gap-4 px-3 py-3.5">
      <p className="text-foreground text-sm font-medium">Exit {index + 1}</p>

      <fieldset className="min-w-0">
        <legend className="text-muted-foreground mb-1.5 text-xs font-medium">
          How much did you close?
        </legend>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={!isAllRemaining}
            onClick={() => onChange({ percent: '' })}
            className={cn(
              'flex min-h-11 items-center justify-center rounded-lg border px-2 text-sm font-medium',
              'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
              !isAllRemaining
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-input bg-background text-muted-foreground hover:bg-accent',
            )}
          >
            Part of the position
          </button>
          <button
            type="button"
            aria-pressed={isAllRemaining}
            onClick={() => onChange({ percent: String(Number(remainingForRow.toFixed(2))) })}
            className={cn(
              'flex min-h-11 items-center justify-center rounded-lg border px-2 text-sm font-medium',
              'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2',
              isAllRemaining
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-input bg-background text-muted-foreground hover:bg-accent',
            )}
          >
            All remaining
          </button>
        </div>
      </fieldset>

      <Field label="% of original position closed">
        {(id) => (
          <Input
            id={id}
            value={row.percent}
            inputMode="decimal"
            placeholder="—"
            onChange={(event) => onChange({ percent: event.target.value })}
            className="numeric max-w-[10rem] text-base"
          />
        )}
      </Field>

      {/* THE SAME THREE WORDS THE MAIN RESULT USES. One convention per product. */}
      <OutcomeChoice
        value={row.outcome}
        onChange={(outcome) => onChange({ outcome })}
        legend="Did this exit make or lose money?"
      />

      {row.outcome === 'break_even' ? null : (
        <Field label={`${row.outcome === 'loss' ? 'Loss' : 'Profit'} for this exit (${currency})`}>
          {(id) => (
            <Input
              id={id}
              value={row.amount}
              inputMode="decimal"
              placeholder="—"
              onChange={(event) => onChange({ amount: event.target.value })}
              className="numeric max-w-[12rem] text-base"
            />
          )}
        </Field>
      )}

      <TimestampField
        label="Exit time"
        title="Exit date and time"
        value={row.at}
        onChange={(at) => onChange({ at })}
        placeholder="Not set"
      />

      <div className="flex min-w-0 items-center justify-end gap-2">
        {canRemove ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-negative mr-auto min-h-11"
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : null}
        <Button size="sm" className="min-h-11" onClick={onCommit}>
          {isDraft ? 'Add exit' : 'Update exit'}
        </Button>
      </div>
    </div>
  );
}
