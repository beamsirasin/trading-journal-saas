'use client';

import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import {
  exitHistoryStatusOf,
  type ExitHistoryStatus,
  type ReconciliationStatus,
} from '../closed-trade';
import {
  actualR,
  allocation,
  cumulativeRealized,
  lifecycleOf,
  resultLabel,
  signedExitAmount,
  statusText,
  type ExitHistory,
  type ExitRecord,
} from '../exit-model';
import { ExitFields } from './exit-fields';
import { QuietAction } from './form-primitives';
import { formatTimestamp } from './timestamp-picker';

/**
 * THE EXITS EDITOR — recorded exits READ; only one exit EDITS.
 *
 * EVERY NUMBER ON THIS SCREEN COMES FROM `exit-model.ts`, and so do the ones on
 * the Close trade flow and the Record exit action. Three surfaces recording the
 * same event used to do the arithmetic three times; now there is one contract
 * and three views of it. Nothing here re-weights an amount by a percentage, and
 * nothing invents an allocation the record does not support.
 *
 * THE PERCENTAGE IS OPTIONAL NOW, and that changes what this control can say.
 * With every fraction recorded it still reports "40% closed · 60% remaining";
 * with even one unrecorded it says "Partially closed" and stops there, because a
 * running total that is missing a term is not a smaller total — it is unknown.
 *
 * A MISSING PERCENTAGE IS NOT A DEFECT. It draws no warning and blocks nothing.
 * The one thing that still earns amber is a trade whose exit history the trader
 * has marked incomplete while declaring the position closed — a record that
 * knows it is missing something.
 */

export const DEFAULT_EXIT_ROWS: readonly ExitRecord[] = [
  {
    id: 'e1',
    scope: 'part',
    percent: '25',
    outcome: 'loss',
    amount: '40.00',
    at: { date: '2026-09-01', time: '12:02' },
  },
  {
    id: 'e2',
    scope: 'part',
    percent: '35',
    outcome: 'profit',
    amount: '120.00',
    at: { date: '2026-09-01', time: '14:15' },
  },
];

/**
 * WHAT THE HISTORICAL PATH PASSES IN WHEN THE EXITS ARE ONLY SUPPORTING DETAIL.
 *
 * On the Fully closed path the trade already has an authoritative whole-trade
 * result, so these legs describe HOW that total was reached rather than deciding
 * what it is. In that role the panel must not print its own Actual R — a second
 * R on the same screen, derived from a possibly partial subtotal, is two answers
 * to one question — and its total is labelled a subtotal, never a result.
 *
 * `total` is the authoritative figure, for stating the relationship in words.
 * Nothing here adds it to anything.
 */
export interface SupportingRole {
  readonly total: number | null;
  readonly reconciliation: ReconciliationStatus;
  /**
   * The trade's result IS this reconstruction — the trader adopted it.
   *
   * The panel then drops the "Matches final result" line: with the result
   * sourced from these legs the two figures are the same number by
   * construction, and announcing that they agree invites the reader to believe
   * two independent figures were compared.
   */
  readonly sourced: boolean;
  /**
   * Offered ONLY when a complete, fully priced history has no result to
   * contradict. Absent otherwise, so the action cannot appear beside a partial
   * sum or over a figure the trader already stated.
   */
  readonly onAdopt?: () => void;
  /** Sends the trader to the existing final-result field rather than a dialog. */
  readonly onEditFinalResult?: () => void;
}

export function ExitsEditor({
  rows,
  onRowsChange,
  /** The trade's ORIGINAL risk at entry, in major units. The frozen denominator. */
  riskAtEntry,
  currency = 'USD',
  /** The trader has already declared the position closed — the historical path. */
  declaredClosed = false,
  history = 'unknown',
  onHistoryChange,
  initialActiveId = null,
  onEditingChange,
  /** Present when these legs support an authoritative total rather than being it. */
  supporting,
}: {
  rows: readonly ExitRecord[];
  onRowsChange: (rows: readonly ExitRecord[]) => void;
  riskAtEntry: string;
  currency?: string;
  declaredClosed?: boolean;
  history?: ExitHistory;
  onHistoryChange?: (history: ExitHistory) => void;
  initialActiveId?: string | null;
  /** Lets a parent yield its mobile-global action to this local editor. */
  onEditingChange?: (editing: boolean) => void;
  supporting?: SupportingRole;
}) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const [draftIds, setDraftIds] = useState<readonly string[]>([]);

  useEffect(() => {
    onEditingChange?.(activeId !== null);
  }, [activeId, onEditingChange]);

  const realized = cumulativeRealized(rows);
  const alloc = allocation(rows);
  const lifecycle = lifecycleOf(rows, declaredClosed);
  const risk = Number(riskAtEntry);
  const r = actualR(realized.total, risk);

  /*
    IN THE SUPPORTING ROLE THE TOTAL IS A SUBTOTAL, AND SAYS SO.

    `resultLabel` decides between "Final net P&L" and a recorded subtotal for a
    panel that OWNS the result. Here the result is owned elsewhere, so no wording
    this panel produces may sound like one.
  */
  const label =
    supporting === undefined
      ? resultLabel({ lifecycle, history, everyExitPriced: realized.everyExitPriced })
      : 'Recorded exits subtotal';
  /* The ONE amber case: the trader says the position is closed AND says the
     exit history is missing something. Not a missing percentage. */
  const unresolved = lifecycle === 'closed' && history === 'incomplete';
  const conflicting = supporting?.reconciliation === 'conflict';

  function update(id: string, patch: Partial<ExitRecord>) {
    onRowsChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div className="border-border min-w-0 rounded-lg border">
      <div className="border-border flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-2.5">
        <h3 className="text-foreground text-sm font-medium">Exits</h3>
        {/* Only what the recorded allocation genuinely supports — see
            `statusText`. An unknown remainder says "Partially closed" and
            invents nothing. */}
        <p className="numeric text-muted-foreground text-xs">{statusText(lifecycle, alloc)}</p>
      </div>

      <ol className="divide-border min-w-0 divide-y">
        {rows.map((row, index) => (
          <li key={row.id} className="min-w-0">
            {activeId === row.id ? (
              <div className="bg-accent/30 flex min-w-0 flex-col gap-4 px-3 py-3.5">
                <p className="text-foreground text-sm font-medium">Exit {index + 1}</p>
                <ExitFields
                  exit={row}
                  currency={currency}
                  riskAtEntry={riskAtEntry}
                  onChange={(patch) => update(row.id, patch)}
                />
                <div className="flex min-w-0 items-center justify-end gap-2">
                  {rows.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-negative mr-auto min-h-11"
                      onClick={() => {
                        onRowsChange(rows.filter((item) => item.id !== row.id));
                        setDraftIds((current) => current.filter((id) => id !== row.id));
                        setActiveId(null);
                      }}
                    >
                      Remove
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    className="min-h-11"
                    onClick={() => {
                      setActiveId(null);
                      setDraftIds((current) => current.filter((id) => id !== row.id));
                    }}
                  >
                    {draftIds.includes(row.id) ? 'Add exit' : 'Update exit'}
                  </Button>
                </div>
              </div>
            ) : (
              <ExitSummaryRow
                index={index}
                exit={row}
                currency={currency}
                onEdit={() => setActiveId(row.id)}
              />
            )}
          </li>
        ))}
      </ol>

      {lifecycle === 'closed' && !declaredClosed ? null : (
        <div className="border-border border-t px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-11 min-w-0 shrink py-2 text-left whitespace-normal"
            onClick={() => {
              const id = `e${rows.length + 1}-${Date.now()}`;
              onRowsChange([
                ...rows,
                { id, scope: 'part', percent: '', outcome: 'profit', amount: '', at: null },
              ]);
              setDraftIds((current) => [...current, id]);
              setActiveId(id);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Record an exit
          </Button>
        </div>
      )}

      {/*
        NO LEGS, NO FOOTER — AND ESPECIALLY NO `+0.00`.

        An empty exit history is the ordinary state of a trade recorded from its
        final result, and summing nothing to zero would put a fabricated figure
        under a panel the trader has only just opened. Nothing is stated until
        something has been recorded.
      */}
      {realized.exitCount === 0 ? null : (
        <div
          className={cn(
            'border-border min-w-0 border-t px-3 py-2.5',
            unresolved || conflicting ? 'bg-warning/5' : 'bg-muted/30',
          )}
        >
          {/*
            IN CONFLICT THE COMPARISON OWNS BOTH FIGURES, so this standalone
            subtotal stands down.

            Rendered, the panel printed "Recorded exits subtotal +80.00 USD" and
            then, four lines below, "Recorded exits subtotal +80.00 USD" again
            inside the comparison — the same label and the same number twice
            within one small box. A reader checking two figures against each
            other should not first have to work out whether they are looking at
            two or three.
          */}
          {conflicting ? null : (
            <>
              <p className="text-muted-foreground text-xs font-medium">{label}</p>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    'numeric text-base font-semibold',
                    realized.total > 0
                      ? 'text-positive'
                      : realized.total < 0
                        ? 'text-negative'
                        : 'text-foreground',
                  )}
                >
                  {realized.total > 0 ? '+' : ''}
                  {realized.total.toFixed(2)} {currency}
                </span>
                {/*
                  NO SECOND R IN THE SUPPORTING ROLE. The page's Actual R comes
                  from the authoritative whole-trade result; an R derived here
                  from a possibly partial subtotal would be a second, quieter
                  answer to the same question, and a reader has no way to tell
                  which one is the trade's.
                */}
                {supporting !== undefined ? null : r === null ? (
                  <span className="text-subtle-foreground text-xs">
                    Actual R needs a recorded risk at entry
                  </span>
                ) : (
                  <span className="numeric text-muted-foreground text-sm">
                    · {r > 0 ? '+' : ''}
                    {r.toFixed(2)}R
                  </span>
                )}
              </div>
            </>
          )}

          {supporting === undefined ? null : (
            <ReconciliationLine
              status={supporting.reconciliation}
              historyStatus={exitHistoryStatusOf(realized.exitCount, history)}
              total={supporting.total}
              subtotal={realized.total}
              currency={currency}
              sourced={supporting.sourced}
              {...(supporting.onEditFinalResult === undefined
                ? {}
                : { onEditFinalResult: supporting.onEditFinalResult })}
            />
          )}

          {/*
          THE QUESTION IS ASKED, NOT ASSUMED.

          Whether every exit has been written down is something only the trader
          knows, and a suspicion is not a finding. So the control asks — and
          until it is answered nothing on this panel claims the history is
          finished, however neatly the amounts happen to add up.
        */}
          {onHistoryChange === undefined || lifecycle !== 'closed' ? null : (
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
          )}

          {/*
            THE PROMOTION, AND IT IS ALWAYS AN ACTIVATION.

            It appears only where a complete, fully priced reconstruction stands
            beside a result nobody has stated — the one place where adopting it
            adds information rather than replacing some. It is a real button
            rather than a quiet link because it changes what the trade's money IS,
            and it names the figure it would install so nobody has to press it to
            find out.

            NOT OFFERED FOR A PARTIAL SUBTOTAL. `onAdopt` is absent whenever a leg
            is unpriced, so "Use +100.00 USD as final result" cannot appear over a
            history that is missing a term — the offer that would do the most
            damage is the one the model refuses to hand over.
          */}
          {supporting?.onAdopt === undefined ? null : (
            <div className="mt-2.5 flex min-w-0 flex-col items-start gap-1">
              {/*
                OUTLINED, NOT FILLED. Rendered as a filled button it was a second
                primary action of the same weight as Save, in a panel the page's
                hierarchy puts BELOW the result — two blue blocks, and no way to
                tell which one finishes the task. Outlined it is unmistakably a
                control and unmistakably not the page's main one.
              */}
              <Button
                size="sm"
                variant="outline"
                className="min-h-11 max-w-full"
                onClick={supporting.onAdopt}
              >
                Use {realized.total > 0 ? '+' : ''}
                {realized.total.toFixed(2)} {currency} as final result
              </Button>
              <p className="text-subtle-foreground text-xs leading-relaxed">
                Your recorded exits become this trade&rsquo;s result. You can change it afterwards.
              </p>
            </div>
          )}

          {/*
            IN THE SUPPORTING ROLE THIS SENTENCE WOULD BE FALSE. It says the
            total above is "not the whole result", which is true when this panel
            owns the money and wrong when the trade has its own authoritative
            figure sitting above it. `ReconciliationLine` speaks for that case.
          */}
          {unresolved && supporting === undefined ? (
            <p className="text-warning mt-1 text-xs leading-relaxed">
              Closed · Exit history incomplete. The total above is what has been recorded, not the
              whole result.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * HOW THE RECORDED LEGS STAND BESIDE THE TRADE'S OWN RESULT.
 *
 * THE SENTENCE THIS PASS DELETED, AND WHY IT WAS WRONG.
 *
 *   "Your final result stays +400.00 USD. The difference is exit history you
 *    have not recorded."
 *
 * The first sentence is true. The second is an inference the record does not
 * support. A gap between an authoritative total and a partial subtotal has
 * several honest explanations — an unrecorded leg, a mistyped leg, a mistyped
 * total, costs the trader netted into one figure and not the other — and the app
 * has no way to tell them apart. Naming one of them makes an unrecorded exit the
 * app's finding rather than the trader's statement, and it is the same family of
 * error as calling a history complete because the arithmetic worked out: reading
 * a cause out of a subtraction.
 *
 * SO AN UNDECLARED HISTORY GETS TWO FACTS AND NO STORY. The subtotal is already
 * labelled above; this states that the trade's result is unchanged by it, and
 * stops. When the trader has ESTABLISHED that exits are missing, that is their
 * claim and it may be repeated back to them.
 */
function ReconciliationLine({
  status,
  historyStatus,
  total,
  subtotal,
  currency,
  sourced,
  onEditFinalResult,
}: {
  status: ReconciliationStatus;
  historyStatus: ExitHistoryStatus;
  /** The trade's authoritative result. */
  total: number | null;
  /** What the recorded legs come to — the same figure printed above. */
  subtotal: number;
  currency: string;
  sourced: boolean;
  onEditFinalResult?: () => void;
}) {
  if (status === 'not_applicable' || total === null) return null;
  const figure = `${total > 0 ? '+' : ''}${total.toFixed(2)} ${currency}`;

  if (status === 'matched') {
    /*
      WHEN THE RESULT IS SOURCED HERE, THERE IS NOTHING TO MATCH IT AGAINST.

      "Adds up to your final result" beside an adopted figure compares a number
      with itself and invites the reader to believe two exist. The subtotal IS
      the result in that state, and the section above already says where it came
      from.
    */
    if (sourced) return null;
    return (
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">Matches final result.</p>
    );
  }

  if (status === 'unreconciled') {
    // The trader's own claim, repeated back — not the app's diagnosis.
    if (historyStatus === 'incomplete') {
      return (
        <p className="text-warning mt-1 text-xs leading-relaxed">
          You have said some exits are missing. Final result remains {figure}.
        </p>
      );
    }
    return (
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        Final result remains {figure}.
      </p>
    );
  }

  /*
    THE CONFLICT SHOWS BOTH FIGURES AND PICKS NEITHER.

    The trader has said this reconstruction is whole, and it does not come to the
    total they stated. One of the two is wrong and nothing on the record says
    which — a mistyped leg, a mistyped total and a leg that never happened all
    look identical from here. So both numbers are put side by side, the sentence
    names no culprit, and the two ways out go to the two things that could be
    corrected. Nothing is overwritten by either.
  */
  return (
    <div className="mt-2 flex min-w-0 flex-col gap-1.5">
      <dl className="divide-border/60 border-warning/30 min-w-0 divide-y border-y">
        <div className="flex min-w-0 items-baseline justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground text-xs">Final result</dt>
          <dd className="numeric text-foreground text-sm font-semibold">{figure}</dd>
        </div>
        <div className="flex min-w-0 items-baseline justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground text-xs">Recorded exits subtotal</dt>
          <dd className="numeric text-foreground text-sm font-semibold">
            {subtotal > 0 ? '+' : ''}
            {subtotal.toFixed(2)} {currency}
          </dd>
        </div>
      </dl>
      <p className="text-warning text-xs leading-relaxed">
        These values don&rsquo;t match. Review the final result or the recorded exits.
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {onEditFinalResult === undefined ? null : (
          <QuietAction onClick={onEditFinalResult}>Edit final result</QuietAction>
        )}
        <QuietAction
          onClick={() => {
            document.querySelector<HTMLButtonElement>('[data-exit-edit]')?.focus();
          }}
        >
          Review exits
        </QuietAction>
      </div>
    </div>
  );
}

/**
 * A recorded exit, at rest.
 *
 * The percentage appears only when it was recorded. "Part of position" with no
 * fraction is a complete description of a real exit, and printing "Not set"
 * beside it would make an optional field look like an unfinished one.
 */
function ExitSummaryRow({
  index,
  exit,
  currency,
  onEdit,
}: {
  index: number;
  exit: ExitRecord;
  currency: string;
  onEdit: () => void;
}) {
  const amount = signedExitAmount(exit);
  const scopeText =
    exit.scope === 'all_remaining'
      ? 'All remaining'
      : exit.percent === ''
        ? 'Part of position'
        : `${exit.percent}% of original position`;

  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="text-foreground min-w-0 truncate text-sm">
          Exit {index + 1}
          <span className="text-muted-foreground"> · {scopeText}</span>
        </span>
        <span
          className={cn(
            'numeric shrink-0 text-sm font-semibold',
            amount === null
              ? 'text-subtle-foreground font-normal'
              : amount > 0
                ? 'text-positive'
                : amount < 0
                  ? 'text-negative'
                  : 'text-foreground',
          )}
        >
          {amount === null
            ? 'No result'
            : `${amount > 0 ? '+' : ''}${amount.toFixed(2)} ${currency}`}
        </span>
      </div>

      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="text-muted-foreground numeric min-w-0 truncate text-xs">
          {formatTimestamp(exit.at) ?? 'Exit time not recorded'}
        </span>
        <button
          type="button"
          onClick={onEdit}
          data-exit-edit={index + 1}
          aria-label={`Edit exit ${index + 1}`}
          className={cn(
            'text-primary-text focus-visible:ring-ring relative shrink-0 rounded-sm px-1.5 text-xs font-medium',
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
