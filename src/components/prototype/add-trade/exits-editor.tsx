'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { Field } from './form-primitives';
import { formatTimestamp, TimestampField, type Timestamp } from './timestamp-picker';

export interface ExitRow {
  readonly id: string;
  /** Percent of the ORIGINAL position, as typed. */
  readonly percent: string;
  /** This leg's OWN net result — never re-weighted by the percentage. */
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
 * for exactly that reason: an ambiguous label here is an arithmetic error
 * waiting to be made by the reader instead of by the code.
 *
 * WHAT CHANGED. Every leg used to be a permanently expanded three-input grid,
 * plus a standing empty row waiting to become a fourth and a fifth — roughly
 * 300px of form to state two facts the trader had finished stating. A recorded
 * exit is a SUMMARY ROW now, only the active leg is an editor, and `Record an
 * exit` deliberately opens a new one.
 *
 * "RECORD AN EXIT", NOT "TAKE PROFIT". Exits lose money too, and a generic
 * action named after the good case quietly tells a trader the bad case does not
 * belong here.
 *
 * AMBER MEANS A REQUIREMENT IS UNMET, NOT THAT WORK IS IN PROGRESS. A position
 * with 60% still open is an ordinary state, styled neutrally. A trade being
 * recorded as fully closed whose legs do not total 100% cannot be saved as it
 * stands — that and over-allocation are the only two things here that earn a
 * warning tone.
 */

const DEFAULT_ROWS: readonly ExitRow[] = [
  { id: 'e1', percent: '25', amount: '-40.00', at: { date: '2026-09-01', time: '12:02' } },
  { id: 'e2', percent: '35', amount: '120.00', at: { date: '2026-09-01', time: '14:15' } },
];

/** `40%` where it is whole, `40.5%` where it is not. Never `40.00%`. */
function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`;
}

export function ExitsEditor({
  variant = 'after-trade',
  initialRows,
  initialRisk = '100.00',
  currency = 'USD',
  /** Opens one leg's editor on arrival, for the active-editor review state. */
  initialActiveId = null,
}: {
  /** `after-trade` must reach exactly 100%; `open-position` may stay short of it. */
  variant?: 'after-trade' | 'open-position';
  initialRows?: readonly ExitRow[];
  initialRisk?: string;
  currency?: string;
  initialActiveId?: string | null;
}) {
  const [rows, setRows] = useState<readonly ExitRow[]>(initialRows ?? DEFAULT_ROWS);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const closed = rows.reduce((total, row) => {
    const value = Number(row.percent);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
  const stillOpen = 100 - closed;

  const realized = rows.reduce((total, row) => {
    const value = Number(row.amount);
    return Number.isFinite(value) && row.amount !== '' ? total + value : total;
  }, 0);

  const riskNumber = Number(initialRisk);
  const realizedR = Number.isFinite(riskNumber) && riskNumber > 0 ? realized / riskNumber : null;

  const complete = Math.abs(closed - 100) < 0.005;
  const overAllocated = closed > 100.005;
  const unresolved = overAllocated || (variant === 'after-trade' && !complete);

  function update(id: string, patch: Partial<ExitRow>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div className="border-border min-w-0 rounded-lg border">
      <div className="border-border flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-2.5">
        <h3 className="text-foreground text-sm font-medium">Exits</h3>
        <p className="numeric text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{formatPercent(closed)} closed</span>
          {stillOpen > 0.005 ? ` · ${formatPercent(stillOpen)} still open` : ''}
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
                remainingForRow={stillOpen + (Number(row.percent) || 0)}
                canRemove={rows.length > 1}
                onChange={(patch) => update(row.id, patch)}
                onRemove={() => {
                  setRows((current) => current.filter((item) => item.id !== row.id));
                  setActiveId(null);
                  setSavedNotice(null);
                }}
                onSave={() => {
                  setActiveId(null);
                  setSavedNotice(
                    `Exit saved · ${formatPercent(closed)} closed${
                      stillOpen > 0.005 ? ` · ${formatPercent(stillOpen)} still open` : ''
                    }`,
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
                  setSavedNotice(null);
                }}
              />
            )}
          </li>
        ))}
      </ol>

      {/*
        AT 100% THERE IS NOTHING LEFT TO ALLOCATE, AND THE CONTROL SIMPLY DOES
        NOT OFFER IT. The previous version kept the action present and disabled
        with a sentence explaining why — a control whose only function was to be
        unavailable. Redistribution is still supported: reduce a leg and both the
        remainder and this action come back.
      */}
      {complete ? null : (
        <div className="border-border border-t px-3 py-2">
          {/* `Button` is `whitespace-nowrap` by design, which is right for the
              short labels it usually carries. At 200% zoom on a 320px screen this
              one is 364px of unbreakable row, so it is allowed to wrap. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-11 min-w-0 shrink py-2 text-left whitespace-normal"
            onClick={() => {
              const id = `e${rows.length + 1}-${Date.now()}`;
              setRows((current) => [...current, { id, percent: '', amount: '', at: null }]);
              setActiveId(id);
              setSavedNotice(null);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Record an exit
          </Button>
        </div>
      )}

      {savedNotice === null ? null : (
        <p role="status" className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
          {savedNotice}
        </p>
      )}

      <div
        className={cn(
          'border-border min-w-0 border-t px-3 py-2.5',
          unresolved ? 'bg-warning/5' : 'bg-muted/30',
        )}
      >
        {/*
          THE LABEL NAMES THE SCOPE. "Realized so far" left a reader to work out
          what it was realized FROM; "Net P&L from closed portion" says that this
          figure belongs only to the part of the position that is no longer
          running, which is the single most misreadable number on a partial trade.
        */}
        <p className="text-muted-foreground text-xs font-medium">
          {complete ? 'Net P&L' : 'Net P&L from closed portion'}
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
                ? `${formatPercent(stillOpen)} is unaccounted for. A fully closed trade must total 100%.`
                : `${formatPercent(stillOpen)} still open.`}
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
  const amount = Number(row.amount);
  const hasAmount = row.amount !== '' && Number.isFinite(amount);

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
          {/* An explicit, visible fallback — never an estimated event time. */}
          {formatTimestamp(row.at) ?? 'Exit time not recorded'}
        </span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit exit ${index + 1}`}
          className={cn(
            /*
              THE ::after EXTENSION GIVES HEIGHT, NOT WIDTH. "Edit" at 12px is a
              22px-wide box, and the audit measures the element's own rect for
              width — correctly, because a transparent pseudo-element stretched
              vertically does nothing for a thumb aiming sideways. `px-1.5` is a
              real 30px target, not a reported one.
            */
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
 * `All remaining` fills the percentage rather than asking the trader to work out
 * what is left, which is the single most common reason a partial exit gets
 * recorded wrongly.
 *
 * `Save exit` closes the editor and states what changed. It does not save the
 * TRADE — the trade's own Save is on the main screen and says so.
 */
function ExitEditorRow({
  index,
  row,
  currency,
  remainingForRow,
  canRemove,
  onChange,
  onRemove,
  onSave,
}: {
  index: number;
  row: ExitRow;
  currency: string;
  /** What this leg could take without pushing the total past 100%. */
  remainingForRow: number;
  canRemove: boolean;
  onChange: (patch: Partial<ExitRow>) => void;
  onRemove: () => void;
  onSave: () => void;
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

      <div className="grid min-w-0 grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        <Field label="% of original position closed">
          {(id) => (
            <Input
              id={id}
              value={row.percent}
              inputMode="decimal"
              placeholder="—"
              onChange={(event) => onChange({ percent: event.target.value })}
              className="numeric text-base"
            />
          )}
        </Field>
        <Field label={`Net P&L for this exit (${currency})`}>
          {(id) => (
            <Input
              id={id}
              value={row.amount}
              inputMode="decimal"
              placeholder="—"
              onChange={(event) => onChange({ amount: event.target.value })}
              className="numeric text-base"
            />
          )}
        </Field>
      </div>

      <TimestampField
        label="Exit time"
        title="Exit date and time"
        value={row.at}
        onChange={(at) => onChange({ at })}
        placeholder="Select exit date and time"
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
        <Button size="sm" className="min-h-11" onClick={onSave}>
          Save exit
        </Button>
      </div>
    </div>
  );
}
