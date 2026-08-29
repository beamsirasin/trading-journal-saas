import { useTranslations } from 'next-intl';

import type { AnalyticsDisplayTone } from '@/lib/analytics/presentation';
import {
  composeBasicKpis,
  type BasicKpiContext,
  type BasicKpiModel,
  type BasicKpiValue,
} from '@/lib/dashboard/basic-kpi';
import type { DashboardPageData } from '@/lib/dashboard/page-data';
import { cn } from '@/lib/utils';
import { MetricValue } from '@/components/product/metric';

import { KpiMicroVisual } from './kpi-micro-visual';
import { BASIC_KPI_GRID_CLASS, KpiWidgetCard } from './kpi-widget-card';

const TONE_CLASS: Record<AnalyticsDisplayTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

/**
 * The five universal Basic KPI widgets, rendered from the D2
 * `DashboardPageData` payload only.
 *
 * No widget here fetches analytics and no formula is recomputed: every figure
 * arrives already canonical from D1 through D2, and this file's whole job is
 * typography, state wording, and the responsive composition. Ordering and
 * spans come from `DEFAULT_DASHBOARD_LAYOUT`, so this is not a second layout
 * system — five equal desktop columns at `lg`, three at `md`, two below that,
 * with the fifth card spanning both narrow columns to avoid a dangling half
 * row.
 *
 * Global unit mode is deliberately not consulted. These five metrics keep
 * their native semantic units — money, percentage, ratio, percentage, ratio —
 * and per-widget unit behaviour is a later phase's contract.
 */
export function BasicKpiRow({ data, className }: { data: DashboardPageData; className?: string }) {
  const t = useTranslations('dashboard.basicKpi');
  const models = composeBasicKpis(data);

  return (
    <section aria-labelledby="basic-kpi-heading" className={cn('min-w-0', className)}>
      <h2 id="basic-kpi-heading" className="sr-only">
        {t('regionLabel')}
      </h2>
      <dl className={BASIC_KPI_GRID_CLASS}>
        {models.map((model) => (
          <BasicKpiCard key={model.widgetId} model={model} />
        ))}
      </dl>
    </section>
  );
}

function BasicKpiCard({ model }: { model: BasicKpiModel }) {
  const t = useTranslations('dashboard.basicKpi');
  const label = t(`${model.key}.label`);

  return (
    <KpiWidgetCard
      layout={model.layout}
      label={label}
      status={model.value.status}
      {...(model.value.status === 'unavailable' ? { reason: model.value.reason } : {})}
      info={{
        triggerLabel: t('infoTrigger', { metric: label }),
        description: t(`${model.key}.info`),
      }}
      value={<KpiValue value={model.value} />}
      // Only where `composeBasicKpis` published one — Net P&L and Profit
      // Factor pass `undefined` and the band is not rendered at all, rather
      // than reserved empty.
      {...(model.micro.kind === 'none' ? {} : { micro: <KpiMicroVisual micro={model.micro} /> })}
      context={<KpiContext context={model.context} />}
    />
  );
}

/**
 * Only Net P&L can be signed, so only Net P&L can arrive with a positive or
 * negative tone; the other four presenters compose their values as neutral in
 * `composeBasicKpis`. A high Win Rate is not a verdict.
 */
function KpiValue({ value }: { value: BasicKpiValue }) {
  const t = useTranslations('dashboard.basicKpi');
  const tReal = useTranslations('dashboard.real');

  if (value.status === 'available') {
    return <MetricValue value={value.text} className={cn(TONE_CLASS[value.tone], 'break-words')} />;
  }

  const text =
    value.status === 'empty'
      ? t('empty')
      : value.status === 'error'
        ? tReal('unavailable.data_integrity_error')
        : tReal(`unavailable.${value.reason}`);

  return <span className="text-muted-foreground text-sm leading-snug">{text}</span>;
}

function KpiContext({ context }: { context: BasicKpiContext }) {
  const t = useTranslations('dashboard.basicKpi');

  switch (context.kind) {
    case 'composition':
      return (
        <span className="numeric">
          {t(context.unit === 'days' ? 'compositionDays' : 'compositionTrades', {
            wins: context.wins,
            breakEvens: context.breakEvens,
            losses: context.losses,
          })}
        </span>
      );
    case 'currency':
      return (
        <span>
          {t('currencyContext', { currency: context.currency, count: context.tradeCount })}
        </span>
      );
    case 'note':
      return <span>{t('calculatedFromR')}</span>;
    case 'averages':
      return (
        <span className="numeric">
          {t('averages', { win: context.averageWinR, loss: context.averageLossR })}
        </span>
      );
    case 'none':
      return null;
  }
}
