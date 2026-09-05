'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * ONE ROW, TWO ANSWERS: what was planned, and what happened.
 *
 * `Entry` and `Actual Entry` are a pair. They lived on two different panels,
 * so reading them together meant switching tabs and holding a number in your
 * head — for the one comparison the whole journal exists to make.
 *
 * THIS FILE IS PRESENTATIONAL AND STAYS THAT WAY. It holds no state, reads no
 * form value, and computes nothing: every string it prints — the planned
 * value, the R figures, the 1R reference — arrives already formatted from
 * `trade-recording-form.tsx`, which is where the `lib/calc` previews already
 * live. If a change ever seems to need a `useState` or an arithmetic
 * expression in here, the boundary is wrong and the caller should be doing it.
 */

export interface PlanVsActualRow {
  readonly key: string;
  /**
   * The row caption, sitting above the planned value: it names the field as
   * the PLAN calls it (`Entry`, `Take Profit`), never as the input beside it
   * calls it. Printing `Actual Entry` here would say the same words twice per
   * row, and on a phone the two land three lines apart.
   */
  readonly label: string;
  /**
   * The planned side, already formatted. `null` means the plan does not carry
   * this field — a Money plan has no Entry — and renders as an explicit
   * "not planned" rather than an empty cell that could read as zero.
   */
  readonly planned: string | null;
  /** The actual side: a live control, owned and wired by the caller. */
  readonly input: ReactNode;
}

export interface PlanVsActualSummary {
  readonly plannedLabel: string;
  readonly plannedText: string | null;
  readonly actualLabel: string;
  readonly actualText: string | null;
  readonly differenceLabel: string;
  /**
   * Rendered only when BOTH sides resolved. A difference against a figure the
   * engine could not produce is a fabrication, so the caller passes `null` and
   * this component prints nothing rather than a dash that looks like zero.
   */
  readonly differenceText: string | null;
  readonly differenceTone: 'positive' | 'negative' | 'neutral';
  /** Shown in place of any figure that is missing, never as `0`. */
  readonly incompleteText: string;
}

export function TradePlanVsActual({
  planColumnLabel,
  actualColumnLabel,
  rows,
  notPlannedLabel,
  crossBasisNotice,
  oneRReference,
  summary,
}: {
  planColumnLabel: string;
  actualColumnLabel: string;
  rows: readonly PlanVsActualRow[];
  notPlannedLabel: string;
  /** Shown when the plan and the result were recorded on different bases. */
  crossBasisNotice?: string | undefined;
  /** `1R = ฿1,000.00`, when the plan states it in money. */
  oneRReference?: string | undefined;
  summary: PlanVsActualSummary;
}) {
  return (
    <div className="grid gap-4">
      {crossBasisNotice === undefined ? null : (
        <p
          data-cross-basis-notice=""
          className="border-border bg-muted/50 text-muted-foreground rounded-lg border px-3 py-2 text-xs"
        >
          {crossBasisNotice}
        </p>
      )}

      <div data-plan-vs-actual="" className="grid gap-3">
        {/*
          THE COLUMN HEADINGS EXIST ONLY WHERE THERE ARE COLUMNS. Below `md`
          each field becomes its own card and the two headings would be a
          promise the layout no longer keeps, so they are hidden from sight and
          from the accessibility tree together — the per-row caption carries
          the same meaning there.
        */}
        <div
          aria-hidden="true"
          className="text-muted-foreground hidden grid-cols-2 gap-4 px-1 text-xs font-medium md:grid"
        >
          <span>{planColumnLabel}</span>
          <span>{actualColumnLabel}</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.key}
            data-plan-vs-actual-row={row.key}
            className={cn(
              'border-border grid gap-2 rounded-lg border p-3',
              // 340px halved leaves ~150px for a decimal price. So the split
              // is a tablet-and-up affordance and the phone gets a card: the
              // planned figure as a caption, the input at full width.
              'md:grid-cols-2 md:items-center md:gap-4',
            )}
          >
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{row.label}</p>
              <p
                data-planned-value={row.key}
                className={cn(
                  'numeric mt-0.5 truncate text-sm',
                  row.planned === null ? 'text-muted-foreground italic' : 'text-foreground',
                )}
              >
                {row.planned ?? notPlannedLabel}
              </p>
            </div>
            <div className="min-w-0">{row.input}</div>
          </div>
        ))}
      </div>

      {oneRReference === undefined ? null : (
        <p data-one-r-reference="" className="text-muted-foreground text-xs">
          {oneRReference}
        </p>
      )}

      {/*
        THE BAR IS THE POINT OF THE TABLE. Planned R and Actual R, side by
        side, updating as the numbers are typed — the sentence "I planned for
        three and took one" is the reason a trader keeps a journal at all.

        Both figures come from the caller's existing `lib/calc` previews and
        the difference is the engine's own subtraction of those two results.
        Nothing here adds, divides or rounds.
      */}
      <div
        data-r-summary=""
        className="border-border bg-muted/40 grid gap-3 rounded-lg border p-3 sm:grid-cols-3"
      >
        <SummaryFigure
          label={summary.plannedLabel}
          text={summary.plannedText}
          fallback={summary.incompleteText}
          tone="neutral"
        />
        <SummaryFigure
          label={summary.actualLabel}
          text={summary.actualText}
          fallback={summary.incompleteText}
          tone="neutral"
        />
        {summary.differenceText === null ? null : (
          <SummaryFigure
            label={summary.differenceLabel}
            text={summary.differenceText}
            fallback={summary.incompleteText}
            tone={summary.differenceTone}
          />
        )}
      </div>
    </div>
  );
}

function SummaryFigure({
  label,
  text,
  fallback,
  tone,
}: {
  label: string;
  text: string | null;
  fallback: string;
  tone: 'positive' | 'negative' | 'neutral';
}) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 sm:flex-col sm:items-start sm:justify-start sm:gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <strong
        className={cn(
          'numeric truncate text-sm',
          text === null
            ? 'text-muted-foreground text-xs font-normal'
            : tone === 'positive'
              ? 'text-positive'
              : tone === 'negative'
                ? 'text-negative'
                : 'text-foreground',
        )}
      >
        {text ?? fallback}
      </strong>
    </div>
  );
}
