import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning';

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: 'text-foreground',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

/**
 * A formatted financial figure.
 *
 * `numeric` applies the monospace stack with tabular numerals so a column of
 * values aligns on the decimal point and an animating figure does not shift
 * its neighbours as digits change.
 *
 * The value is passed in already formatted, as a string. This component never
 * computes, rounds, or parses — rounding happens once at the presentation
 * boundary (CLAUDE.md §5), and a component that quietly re-rounded would be a
 * second place for a figure to change.
 */
export function MetricValue({
  value,
  unit,
  tone = 'neutral',
  className,
}: {
  value: string;
  unit?: string;
  tone?: MetricTone;
  className?: string;
}) {
  return (
    <span
      className={cn('numeric text-metric inline-flex items-baseline', TONE_TEXT[tone], className)}
    >
      {value}
      {unit === undefined ? null : (
        <span className="text-muted-foreground ml-0.5 text-base font-medium">{unit}</span>
      )}
    </span>
  );
}

export type TrendDirection = 'up' | 'down' | 'flat';

const TREND_ICON = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: ArrowRight,
} as const;

/**
 * A direction-of-change indicator.
 *
 * Colour is never the only signal (docs/design-system.md §2): the arrow shape
 * carries direction, and `srLabel` states it in words for anyone who sees
 * neither. Red-green colour blindness is common enough among traders that a
 * green-versus-red-only indicator would be unreadable for a real slice of the
 * intended users.
 *
 * `tone` is separate from `direction` on purpose. On this product "down" is
 * not reliably bad — a falling mistake count is an improvement — so the
 * caller decides which way is good.
 */
export function TrendIndicator({
  direction,
  label,
  srLabel,
  tone = 'neutral',
  className,
}: {
  direction: TrendDirection;
  label: string;
  /** Spoken form, e.g. "up 4 points versus the previous period". */
  srLabel: string;
  tone?: MetricTone;
  className?: string;
}) {
  const Icon = TREND_ICON[direction];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        TONE_TEXT[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}

/**
 * A small field label. Used for metric names, table group headings and form
 * section titles so they read as one family.
 *
 * TWO CASINGS, ONE ROLE, AND THE DIFFERENCE IS DENSITY.
 *
 * `caps` is the original treatment and stays the default, so no existing call
 * site changes: small, uppercase, 0.06em tracking. It reads as a heading, and
 * on a card that carries ONE label — a KPI tile, a form section — that is
 * exactly right.
 *
 * `plain` exists for the places that carry six or twelve of these at once: a
 * performance card's metric grid, an operational count strip, a table's
 * column heads. Uppercase plus letter-spacing costs roughly 15% extra width
 * per label and, repeated a dozen times in one viewport, stops reading as
 * hierarchy and starts reading as noise (CLAUDE.md §8: "not an admin
 * template"). Same size, same colour, same weight — only the shouting is
 * dropped, so the two remain one family and the caps version keeps its
 * meaning precisely because it is no longer everywhere.
 *
 * Sizing/colour overrides still arrive through `className` as before.
 */
export function MetricLabel({
  children,
  variant = 'caps',
  className,
}: {
  children: ReactNode;
  variant?: 'caps' | 'plain';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-muted-foreground',
        variant === 'caps' ? 'text-label uppercase' : 'text-xs leading-4 font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}
