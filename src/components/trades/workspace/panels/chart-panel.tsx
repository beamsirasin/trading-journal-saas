'use client';

import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { TradeDetail } from '@/server/dal/trades';
import { PanelEmpty, PanelSection } from '@/components/trades/workspace/panel-primitives';

/**
 * CHART — whatever the trader actually attached, and nothing more.
 *
 * TRADECHEMIST IS MANUAL-FIRST AND THIS TAB STAYS THAT WAY. There is no
 * embedded charting engine here and no new dependency: the domain records
 * exactly two chart facts — an uploaded screenshot and a TradingView URL — and
 * this renders those two. Embedding a live chart library to imitate a
 * competitor would add a rendering runtime to the bundle in order to draw
 * candles this product does not store.
 *
 * THE IMAGE IS SERVED BY AN AUTHENTICATED ROUTE, NOT A PUBLIC URL. The DAL
 * deliberately publishes only `hasChartAttachment`, never a storage key or a
 * signed link; the `<img>` points at `/api/trades/[tradeId]/chart-attachment`,
 * which re-derives its own session and Workspace authorization independently
 * of the read that produced this Trade. `next/image` is not used precisely
 * because this is a private, authenticated, non-optimizable origin.
 *
 * The TradingView link is external and user-supplied, so it opens in a new tab
 * with `noopener noreferrer` — a journal must never hand a page it did not
 * author a reference back to this window.
 */
export function TradeChartPanel({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades.workspace.details');
  const tTrades = useTranslations('trades');

  const hasAnything = trade.hasChartAttachment || trade.tradingviewUrl !== null;

  if (!hasAnything) {
    return <PanelEmpty title={t('empty.chart.title')} description={t('empty.chart.description')} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {trade.hasChartAttachment ? (
        <PanelSection title={t('groups.chart')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated, private-storage-backed route, never a static or remote host next/image could optimize. */}
          <img
            src={`/api/trades/${trade.tradeId}/chart-attachment`}
            alt={t('chartAlt', { symbol: trade.symbol })}
            data-trade-chart-image=""
            className="border-border h-auto max-w-full rounded-lg border"
          />
          <a
            href={`/api/trades/${trade.tradeId}/chart-attachment`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary focus-visible:ring-ring inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-xs font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            {tTrades('detail.openChartImage')}
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
          </a>
        </PanelSection>
      ) : null}

      {trade.tradingviewUrl === null ? null : (
        <PanelSection title={tTrades('field.tradingViewUrl')}>
          <a
            href={trade.tradingviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-trade-chart-link=""
            className="text-primary focus-visible:ring-ring inline-flex min-h-11 w-fit items-center gap-1.5 rounded-sm text-sm font-semibold break-all underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            {tTrades('detail.openChart')}
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
          </a>
        </PanelSection>
      )}
    </div>
  );
}
