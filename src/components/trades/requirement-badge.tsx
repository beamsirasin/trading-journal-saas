'use client';

import { useTranslations } from 'next-intl';

import type { RequirementLevel } from '@/lib/trades/requirements';
import { cn } from '@/lib/utils';

/**
 * ONE BADGE FOR REQUIRED / RECOMMENDED / OPTIONAL (Add Trade contract
 * decision 59; design-system "Requirement badge").
 *
 * A compact pill in a consistent secondary position — the right end of a row's
 * label line (`ml-auto`) — so a trader can scan a column of them on a phone.
 * It is a statement about completion, never a warning:
 *
 *   - Required     the brand tint: needed to complete, not to save;
 *   - Recommended  an outline in the same blue, quieter than Required;
 *   - Optional     neutral;
 *   - Depends on…  neutral, for the one level an Unanswered answer leaves
 *                  undecided (the Exit Plan while the Target is Unanswered).
 *
 * Never red, never an error: an unanswered Required item during normal entry
 * is progress still to make, not a mistake.
 */
export function RequirementBadge({
  level,
  className,
}: {
  level: RequirementLevel;
  className?: string;
}) {
  const t = useTranslations('trades.requirement');
  return (
    <span
      data-requirement={level}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-2 py-px text-[0.6875rem] leading-4 font-medium whitespace-nowrap',
        level === 'required'
          ? 'bg-primary/12 text-primary-text border-transparent'
          : level === 'recommended'
            ? 'border-primary/35 text-primary-text bg-transparent'
            : 'border-border text-muted-foreground bg-transparent',
        className,
      )}
    >
      {t(level)}
    </span>
  );
}
