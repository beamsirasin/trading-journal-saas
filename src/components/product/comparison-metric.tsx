import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

import { MetricLabel } from './metric';

/**
 * Converts an already-rounded metric string into bar-fill percentage (0–100).
 *
 * This is bar GEOMETRY, not a metric — it never computes anything a
 * financial value depends on, only how wide to draw a `<div>`. Was
 * copy-pasted identically into three call sites (the landing page, the demo
 * dashboard, and the analytics page), each carrying a comment pointing at the
 * others; consolidated here so a future change to the rounding or scale
 * logic can't drift between copies.
 */
export function barPercent(value: string, scaleMax: number): number {
  return (Number(value) / scaleMax) * 100;
}

/**
 * A coloured square identifying a series.
 *
 * The series colour lives on the swatch and never on the text beside it. Two
 * reasons: the validated light-mode `system` step is 3.68:1, which is legal
 * for a graphic mark but below the 4.5:1 needed for small text; and coloured
 * text plus a coloured mark double-encodes identity for no gain. Text keeps
 * its text tokens (docs/design-system.md §9).
 */
export function SeriesSwatch({
  series,
  className,
}: {
  series: 'system' | 'trader';
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-[3px]',
        series === 'system' ? 'bg-system' : 'bg-trader',
        className,
      )}
    />
  );
}

/**
 * One metric, shown for the system and for the trader side by side.
 *
 * This is the product's core visual idea, so it is a component rather than a
 * layout repeated per page: the two values must always appear together, in
 * the same order, with the same labels. Showing an actual figure without its
 * system counterpart is precisely the failure mode of a conventional journal.
 *
 * The proportional bars are drawn only when `scaleMax` is supplied, because a
 * bar without a shared denominator invites the reader to compare lengths that
 * are not comparable.
 */
export function ComparisonMetric({
  label,
  systemValue,
  actualValue,
  unit,
  scaleMax,
  systemPercent,
  actualPercent,
  note,
  className,
}: {
  label: string;
  systemValue: string;
  actualValue: string;
  unit?: string;
  /** Present only to document that the two bars share a denominator. */
  scaleMax?: string;
  /** Bar width 0–100. Precomputed by the caller; this component never divides. */
  systemPercent?: number;
  actualPercent?: number;
  note?: string;
  className?: string;
}) {
  const t = useTranslations('common');
  const showBars = systemPercent !== undefined && actualPercent !== undefined;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <MetricLabel>{label}</MetricLabel>
        {scaleMax === undefined ? null : (
          <span className="text-muted-foreground text-xs">{t('ofScale', { scaleMax })}</span>
        )}
      </div>

      <dl className="flex flex-col gap-2.5">
        <Row
          series="system"
          name={t('system')}
          value={systemValue}
          {...(unit === undefined ? {} : { unit })}
          {...(showBars ? { percent: systemPercent } : {})}
        />
        <Row
          series="trader"
          name={t('actual')}
          value={actualValue}
          {...(unit === undefined ? {} : { unit })}
          {...(showBars ? { percent: actualPercent } : {})}
        />
      </dl>

      {note === undefined ? null : (
        <p className="text-muted-foreground text-xs leading-relaxed">{note}</p>
      )}
    </div>
  );
}

function Row({
  series,
  name,
  value,
  unit,
  percent,
}: {
  series: 'system' | 'trader';
  name: string;
  value: string;
  unit?: string;
  percent?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <dt className="flex min-w-16 items-center gap-2 text-sm">
        <SeriesSwatch series={series} />
        <span className="text-muted-foreground">{name}</span>
      </dt>

      {percent === undefined ? null : (
        <div
          className="bg-muted h-2 min-w-0 flex-1 overflow-hidden rounded-full"
          aria-hidden="true"
        >
          <div
            className={cn('h-full rounded-full', series === 'system' ? 'bg-system' : 'bg-trader')}
            style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
          />
        </div>
      )}

      <dd
        className={cn(
          'numeric text-foreground text-sm font-semibold',
          percent === undefined ? 'ml-auto' : '',
        )}
      >
        {value}
        {unit === undefined ? null : <span className="text-muted-foreground ml-0.5">{unit}</span>}
      </dd>
    </div>
  );
}
