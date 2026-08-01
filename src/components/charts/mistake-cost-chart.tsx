'use client';

import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { DemoMistake } from '@/lib/demo';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

import { ChartTooltip } from './chart-tooltip';

/**
 * What each mistake actually costs, in R.
 *
 * Ranked by cost, never by frequency — the product's position is that the
 * mistake you make most often is rarely the one that hurts most, and a
 * frequency chart hides that. "Chased entry" appears more often than
 * "revenge trade" and costs half as much.
 *
 * Form choice: horizontal bars, because the category names are long and
 * would be rotated or truncated on a vertical axis. The bars are magnitude on
 * one nominal dimension, so they all take ONE hue — colouring each bar
 * differently would spend the identity channel re-encoding what bar length
 * already shows.
 *
 * `chart-3` rather than `negative`: these are costs, but painting them in the
 * loss colour makes the panel read as an alarm every time it is opened, and
 * the design system reserves red-green pairings for outcome direction.
 */
export function MistakeCostChart({
  mistakes,
  className,
}: {
  mistakes: readonly DemoMistake[];
  className?: string;
}) {
  const t = useTranslations('charts');
  const prefersReducedMotion = usePrefersReducedMotion();
  const nameFor = { costR: t('cost') };

  const data = mistakes.map((mistake) => ({
    label: mistake.label,
    costR: Number(mistake.costR),
  }));

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />

          <XAxis
            type="number"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `${value}R`}
          />

          <YAxis
            type="category"
            dataKey="label"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={104}
          />

          <Tooltip
            content={<ChartTooltip nameFor={nameFor} unit="R" decimals={1} />}
            cursor={{ fill: 'var(--accent)' }}
          />

          <Bar
            dataKey="costR"
            fill="var(--chart-3)"
            // 4px rounded ends on the data end only; the end anchored to the
            // baseline stays square so bars share a clean common edge.
            radius={[4, 4, 4, 4]}
            maxBarSize={18}
            isAnimationActive={!prefersReducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MistakeCostTable({ mistakes }: { mistakes: readonly DemoMistake[] }) {
  const t = useTranslations('charts.mistakeCostTable');
  const tSeverity = useTranslations('mistakes.severity');

  return (
    <table>
      <caption>{t('caption')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('mistake')}</th>
          <th scope="col">{t('severity')}</th>
          <th scope="col">{t('occurrences')}</th>
          <th scope="col">{t('cost')}</th>
        </tr>
      </thead>
      <tbody>
        {mistakes.map((mistake) => (
          <tr key={mistake.id}>
            <th scope="row">{mistake.label}</th>
            <td>{tSeverity(mistake.severity)}</td>
            <td>{mistake.occurrences}</td>
            <td>{mistake.costR}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
