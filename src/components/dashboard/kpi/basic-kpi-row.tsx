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

import { KpiIndicator } from './kpi-indicator';
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
      // The header affordance still answers "what IS this metric" in one
      // plain sentence. The indicator beside the figure answers "what is it
      // made of" — two different questions, so two different affordances
      // rather than one popover trying to be both.
      info={{
        triggerLabel: t('infoTrigger', { metric: label }),
        description: t(`${model.key}.info`),
      }}
      value={<KpiValue value={model.value} emphasis={model.emphasis} />}
      // Only where `composeBasicKpis` published one — Net P&L passes
      // `undefined` and the slot is not rendered at all, rather than reserved
      // empty.
      {...(model.indicator.kind === 'none'
        ? {}
        : {
            indicator: (
              <KpiIndicator
                metricKey={model.key}
                indicator={model.indicator}
                detail={model.detail}
              />
            ),
          })}
      context={<KpiContext context={model.context} />}
    />
  );
}

/**
 * Only Net P&L can be signed, so only Net P&L can arrive with a positive or
 * negative tone; the other four presenters compose their values as neutral in
 * `composeBasicKpis`. A high Win Rate is not a verdict.
 *
 * The figure is set here rather than through `MetricValue` because the KPI row
 * carries its own two sizes — the lead card's and the other four's — while
 * `MetricValue` speaks for every other figure in the product at one shared
 * size.
 *
 * The KPI roles are registered as font-size utilities in the shared `cn()`
 * configuration. That keeps the semantic size and its tone as independent
 * classes while preserving normal last-size-wins behaviour for overrides.
 */
function KpiValue({ value, emphasis }: { value: BasicKpiValue; emphasis: 'lead' | 'standard' }) {
  const t = useTranslations('dashboard.basicKpi');
  const tReal = useTranslations('dashboard.real');

  if (value.status === 'available') {
    return (
      <span
        data-kpi-figure={emphasis}
        className={cn(
          'numeric inline-flex items-baseline break-words',
          emphasis === 'lead' ? 'text-kpi-hero' : 'text-kpi',
          TONE_CLASS[value.tone],
        )}
      >
        {value.text}
      </span>
    );
  }

  const text =
    value.status === 'empty'
      ? t('empty')
      : value.status === 'error'
        ? tReal('unavailable.data_integrity_error')
        : tReal(`unavailable.${value.reason}`);

  return <span className="text-muted-foreground text-sm leading-snug">{text}</span>;
}

/**
 * The supporting line — which after this pass only Net P&L has.
 *
 * Everything the other four used to print here moved behind their indicator
 * (see `BasicKpiContext`). What is left is the one fact a money total does not
 * carry on its face: how many Trades produced it — or, when there is no total,
 * how many Trades are the reason and why.
 */
function KpiContext({ context }: { context: BasicKpiContext }) {
  const t = useTranslations('dashboard.basicKpi');

  switch (context.kind) {
    case 'tradeCount':
      return <span className="numeric">{t('tradeCount', { count: context.tradeCount })}</span>;
    case 'missingMoney':
      return (
        <span className="numeric" data-kpi-missing-money="">
          {t('missingMoney', { missing: context.missing, total: context.total })}
        </span>
      );
    case 'none':
      return null;
  }
}
