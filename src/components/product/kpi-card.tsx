import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { AnimatedNumber } from './animated-number';
import { MetricLabel, type MetricTone } from './metric';

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: 'text-foreground',
  positive: 'text-positive',
  negative: 'text-negative',
  warning: 'text-warning',
};

/**
 * A single headline figure.
 *
 * A stat tile rather than a one-bar chart: a current value with optional
 * context is exactly the case where a chart adds geometry and no information.
 *
 * `prefix`/`suffix` stay outside `AnimatedNumber` so that only the digits
 * count up — a currency symbol or "R" sliding into place would be motion
 * that carries nothing.
 */
export function KpiCard({
  label,
  value,
  prefix,
  suffix,
  tone = 'neutral',
  hint,
  footer,
  animate = true,
  className,
}: {
  label: string;
  /** Already rounded for display. */
  value: string;
  prefix?: string;
  suffix?: string;
  tone?: MetricTone;
  hint?: string;
  footer?: ReactNode;
  /** Off for figures inside a static, server-rendered surface. */
  animate?: boolean;
  className?: string;
}) {
  return (
    <div
      // A stable hook for tests. Asserting on rendered text alone is
      // unreliable here: `AnimatedNumber` renders the figure twice (an
      // aria-hidden animating copy and a visually-hidden settled one), and the
      // same number often appears again in a nearby caption.
      data-kpi={label}
      className={cn(
        'bg-card border-border flex flex-col gap-2 rounded-lg border p-4 sm:p-5',
        'transition-colors',
        className,
      )}
    >
      <MetricLabel>{label}</MetricLabel>

      <p className={cn('numeric text-metric flex items-baseline', TONE_TEXT[tone])}>
        {prefix === undefined ? null : <span>{prefix}</span>}
        {animate ? <AnimatedNumber value={value} /> : <span>{value}</span>}
        {suffix === undefined ? null : (
          <span className="text-muted-foreground ml-0.5 text-base font-medium">{suffix}</span>
        )}
      </p>

      {hint === undefined ? null : (
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      )}

      {footer}
    </div>
  );
}
