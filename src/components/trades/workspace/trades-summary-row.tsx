import { useTranslations } from 'next-intl';

import type { AnalyticsDisplayTone } from '@/lib/analytics/presentation';
import type { DashboardPageData } from '@/lib/dashboard/page-data';
import {
  composeTradesSummary,
  type TradesSummaryModel,
  type TradesSummaryValue,
} from '@/lib/trades/workspace-summary';
import { cn } from '@/lib/utils';
import { MetricLabel } from '@/components/product/metric';

const TONE_CLASS: Record<AnalyticsDisplayTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

/**
 * The Trades workspace's four summary figures.
 *
 * THE DASHBOARD CARD IS THE SOURCE OF TRUTH, AND THIS IS ITS QUIET SIBLING.
 * Same surface, same border, same radius, same label typography, same
 * bottom-anchored figure — so the two rows are visibly one family. What is
 * dropped is everything that made the Dashboard's row a headline: the hero
 * type role, the indicator slot, the context line, and the square 16px
 * padding. Here the TABLE is the content and this strip is orientation, so
 * the figure takes `text-metric` (the product's ordinary figure size) rather
 * than `text-kpi-hero`, and the card is shorter.
 *
 * Four columns at `md`, two below. Two-up on a phone is the 2 x 2 grid the
 * mobile layout wants and it needs no separate mobile component to get it.
 *
 * NOTHING HERE FETCHES OR COMPUTES. `composeTradesSummary` selects already-
 * canonical states out of the Dashboard payload; this file is typography and
 * state wording only.
 */
export function TradesSummaryRow({
  data,
  className,
}: {
  data: DashboardPageData;
  className?: string;
}) {
  const t = useTranslations('trades.workspace.summary');
  const models = composeTradesSummary(data);

  return (
    <section aria-labelledby="trades-summary-heading" className={cn('min-w-0', className)}>
      <h2 id="trades-summary-heading" className="sr-only">
        {t('regionLabel')}
      </h2>
      <dl className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {models.map((model) => (
          <SummaryCard key={model.key} model={model} />
        ))}
      </dl>
    </section>
  );
}

function SummaryCard({ model }: { model: TradesSummaryModel }) {
  const t = useTranslations('trades.workspace.summary');

  return (
    <div
      data-trades-summary={model.key}
      data-trades-summary-status={model.value.status}
      className={cn(
        'bg-card border-border flex min-w-0 flex-col gap-1 rounded-lg border px-4 py-3',
        'hover:border-ring/40 transition-colors',
      )}
    >
      <dt className="min-w-0">
        <MetricLabel variant="plain" className="leading-snug break-words">
          {t(`${model.key}.label`)}
        </MetricLabel>
      </dt>
      <dd className="min-w-0">
        <SummaryValue value={model.value} />
      </dd>
    </div>
  );
}

/**
 * Never a fake zero. An empty population reads as "No Trades in scope" and an
 * unavailable metric names its own reason, both in words — because printing
 * `0.00R` over a population that does not exist is the one thing a journal
 * must never do (CLAUDE.md §6).
 *
 * The unavailable reasons resolve against the Dashboard's existing
 * `dashboard.real.unavailable.*` vocabulary rather than a second copy of the
 * same sentences under this page's namespace.
 */
function SummaryValue({ value }: { value: TradesSummaryValue }) {
  const t = useTranslations('trades.workspace.summary');
  const tReal = useTranslations('dashboard.real');

  if (value.status === 'available') {
    return (
      <span className={cn('numeric text-metric break-words', TONE_CLASS[value.tone])}>
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
