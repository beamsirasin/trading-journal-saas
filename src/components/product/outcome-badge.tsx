import type { DemoOutcome } from '@/lib/demo';
import { cn } from '@/lib/utils';

const OUTCOME_LABEL: Record<DemoOutcome, string> = {
  win: 'Win',
  loss: 'Loss',
  break_even: 'Break-even',
};

const OUTCOME_CLASS: Record<DemoOutcome, string> = {
  win: 'border-positive/30 bg-positive/10 text-positive',
  loss: 'border-negative/30 bg-negative/10 text-negative',
  break_even: 'border-border bg-muted text-muted-foreground',
};

/**
 * A trade outcome, for one axis of the outcome matrix.
 *
 * The word is always present — never a bare coloured dot. Beyond colour
 * blindness, "win" and "loss" on this product are genuinely ambiguous without
 * their axis: a red badge means something different in the system column than
 * in the actual column, and only the label disambiguates them.
 *
 * Break-even is a first-class outcome, not a rounding artefact of zero. It is
 * decided by an explicit tolerance band per trading account (CLAUDE.md §6).
 */
export function OutcomeBadge({
  outcome,
  axis,
  className,
}: {
  outcome: DemoOutcome;
  /** Spoken prefix, e.g. "System" so it reads "System: Win". */
  axis: 'System' | 'Actual';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        OUTCOME_CLASS[outcome],
        className,
      )}
    >
      <span className="sr-only">{axis}: </span>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

/**
 * The quadrant a trade falls in, stated in words.
 *
 * Rendered where the pairing matters more than either outcome alone — the
 * "system win / trader loss" cell is the most valuable signal the product
 * produces, and it is invisible if the two badges are merely adjacent.
 */
export function QuadrantNote({
  systemOutcome,
  actualOutcome,
  className,
}: {
  systemOutcome: DemoOutcome;
  actualOutcome: DemoOutcome;
  className?: string;
}) {
  const note = quadrantNote(systemOutcome, actualOutcome);
  if (note === null) {
    return null;
  }

  return (
    <span className={cn('text-muted-foreground text-xs leading-relaxed', className)}>{note}</span>
  );
}

function quadrantNote(system: DemoOutcome, actual: DemoOutcome): string | null {
  if (system === 'win' && actual === 'loss') {
    return 'The setup worked. The execution gave it back.';
  }
  if (system === 'loss' && actual === 'win') {
    return 'Paid for breaking the rules — the habit, not the result, is the risk.';
  }
  if (system === 'win' && actual === 'break_even') {
    return 'A winning setup closed flat.';
  }
  return null;
}
