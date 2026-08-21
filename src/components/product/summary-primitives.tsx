import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The three Overview-level primitives from Phase 15A §5 / the Phase 15B
 * brief's "SUMMARY / INSIGHT / DETAIL PRIMITIVES". Deliberately small and
 * composable rather than one polymorphic "insight card" component with many
 * conditional props — each does one job, matching how this codebase already
 * groups a few small related components in one file (e.g.
 * `trade-status-badge.tsx`).
 *
 * None of these are wired into a real page yet (Analytics Overview is Phase
 * 15C's job) — this file is the reusable shape future slices compose against.
 */

/**
 * A. SUMMARY — one hero answer, small supporting metrics, sample/context, one
 * action. This is the "answer in 5-10 seconds" primitive (Phase 15A §7,
 * Level 1).
 */
export function HeroMetric({
  label,
  value,
  supporting,
  sample,
  action,
  className,
}: {
  /** e.g. "Trader Total R" */
  label: string;
  /** The one dominant answer — kept large/bold by the caller's own text-metric usage. */
  value: ReactNode;
  /** A short secondary line — e.g. "58% Win Rate". Recedes visually; never a second hero. */
  supporting?: ReactNode;
  /** Sample/context disclosure — e.g. "42 finalized Trades". */
  sample?: ReactNode;
  /** At most one action — a link/button to Explore or a specific filtered list. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <p className="text-muted-foreground text-label uppercase">{label}</p>
      <p className="text-metric numeric">{value}</p>
      {supporting === undefined ? null : (
        <p className="text-muted-foreground text-sm">{supporting}</p>
      )}
      {sample === undefined ? null : <p className="text-muted-foreground text-xs">{sample}</p>}
      {action === undefined ? null : <div className="pt-1">{action}</div>}
    </div>
  );
}

/**
 * B. INSIGHT — a short human-readable observation with its own sample
 * disclosure, never a causal claim (Phase 15A §18/§27). `sample === null`
 * (rather than omitted) renders the "no strong pattern yet" fallback instead
 * of a fabricated observation — the brief is explicit that this is preferable
 * to a forced insight.
 */
export function InsightNote({
  observation,
  sample,
  noPatternMessage = 'No strong pattern yet.',
  className,
}: {
  /** The observation sentence itself, or omitted when `sample` is `null`. */
  observation?: string;
  /** Supporting sample/count text, e.g. "12 Trades". `null` means no defensible comparison exists. */
  sample: string | null;
  /** Shown instead of `observation` when `sample` is `null`. */
  noPatternMessage?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <p className="text-sm">{sample === null ? noPatternMessage : observation}</p>
      {sample === null ? null : <p className="text-muted-foreground text-xs">{sample}</p>}
    </div>
  );
}

/**
 * C. DATA READINESS — a factual coverage line with an optional direct action.
 * Deliberately per-domain sample facts (Phase 15A §12/§20), never a universal
 * completion percentage.
 */
export function DataReadinessLine({
  fact,
  action,
  className,
}: {
  /** A factual sentence, e.g. "38 resolved · 5 pending". */
  fact: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 text-sm', className)}>
      <span className="text-muted-foreground">{fact}</span>
      {action}
    </div>
  );
}
