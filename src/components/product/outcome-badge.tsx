import { useTranslations } from 'next-intl';

import type { DemoOutcome } from '@/lib/demo';
import { cn } from '@/lib/utils';

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
 * decided by an explicit tolerance band — a global Calculation Engine
 * Version 1 constant (`BREAK_EVEN_TOLERANCE_R`, `src/config/trade-calc.ts`),
 * not per-workspace or per-trading-account configuration (CLAUDE.md §6).
 *
 * `axis` is the semantic side (`system` | `trader`), not display text — the
 * translated label ("System" / "Actual") comes from `common.system` /
 * `common.actual`, so this component works in either locale without its
 * callers knowing the current language.
 */
export function OutcomeBadge({
  outcome,
  axis,
  className,
}: {
  outcome: DemoOutcome;
  axis: 'system' | 'trader';
  className?: string;
}) {
  const t = useTranslations('common');
  const outcomeLabel =
    outcome === 'win' ? t('win') : outcome === 'loss' ? t('loss') : t('breakEven');
  const axisLabel = axis === 'system' ? t('system') : t('actual');

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        OUTCOME_CLASS[outcome],
        className,
      )}
    >
      <span className="sr-only">{axisLabel}: </span>
      {outcomeLabel}
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
  const t = useTranslations('trades.quadrantNotes');
  const key = quadrantNoteKey(systemOutcome, actualOutcome);
  if (key === null) {
    return null;
  }

  return (
    <span className={cn('text-muted-foreground text-xs leading-relaxed', className)}>{t(key)}</span>
  );
}

function quadrantNoteKey(
  system: DemoOutcome,
  actual: DemoOutcome,
): 'systemDamaged' | 'brokeRules' | 'closedFlat' | null {
  if (system === 'win' && actual === 'loss') return 'systemDamaged';
  if (system === 'loss' && actual === 'win') return 'brokeRules';
  if (system === 'win' && actual === 'break_even') return 'closedFlat';
  return null;
}
