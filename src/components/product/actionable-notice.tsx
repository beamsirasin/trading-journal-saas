import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/status/status-badge';
import { Link } from '@/i18n/navigation';

/**
 * The shared distinction between actionable-later missing data (System
 * Outcome, Strategy/Setup classification, Review) and entry-time missing
 * data that must never be presented as truthfully completable (Setup
 * Checklist, Confidence, Emotions, Entry Reason, entry chart) — Phase 15A
 * §23-24, Phase 15B brief §7. Two small components, not one component with a
 * `mode` prop that silently allows the wrong copy to be paired with the
 * wrong CTA — the entry-time variant structurally has no CTA slot at all.
 */

/**
 * ACTIONABLE LATER — a specific fact plus a specific CTA (e.g. "Review",
 * "Classify", "Update"). Never an intrusive banner for a normal lifecycle
 * state — this renders as a plain inline notice, coloured `needs_attention`
 * (amber) via the shared status vocabulary, never `error` (red).
 */
export function ActionableNotice({
  fact,
  actionLabel,
  href,
  className,
}: {
  /** e.g. "5 System Outcomes pending" */
  fact: string;
  /** e.g. "Review" */
  actionLabel: string;
  /** A specific, filtered deep link — never a bare unfiltered list (Phase 15A §23). */
  href: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <span className="inline-flex items-center gap-2">
        <StatusBadge kind="needs_attention" label={fact} />
      </span>
      <Link
        href={href}
        className="text-primary inline-flex min-h-11 items-center underline-offset-4 hover:underline"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

/**
 * ENTRY-TIME MISSING — truthful, non-actionable-as-"complete" copy. Never
 * offers a "Complete now"-style CTA; the only allowed action is viewing the
 * Trade(s) in question, which is navigation, not a promise the data can be
 * truthfully backfilled (Phase 15A §17/§24).
 */
export function EntryTimeNotice({
  detail,
  viewLabel,
  href,
  className,
}: {
  /** e.g. "Not recorded at entry. Excluded from this analysis." */
  detail: string;
  /** e.g. "View trades" */
  viewLabel?: string;
  href?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <StatusBadge kind="not_recorded_at_entry" label={detail} />
      {href === undefined || viewLabel === undefined ? null : (
        <Link
          href={href}
          className="text-muted-foreground inline-flex min-h-11 items-center underline-offset-4 hover:underline"
        >
          {viewLabel}
        </Link>
      )}
    </div>
  );
}
