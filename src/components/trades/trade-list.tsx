'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { TradeListItem } from '@/server/dal/trades';
import { formatR } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import { SystemStatusBadge, TradeStatusBadge } from '@/components/trades/trade-status-badge';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

export type TradeListView = TradeListItem & { readonly occurredAtDisplay: string };

function RValue({ value }: { value: string | null }) {
  return <span className="font-mono text-sm tabular-nums">{formatR(value) ?? '—'}</span>;
}

export function TradeList({
  trades,
  selectedTradeId,
  nextCursor,
  hasCursor,
}: {
  trades: readonly TradeListView[];
  selectedTradeId: string | null;
  nextCursor: string | null;
  hasCursor: boolean;
}) {
  const t = useTranslations('trades');
  const router = useRouter();

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">{t('list.caption')}</caption>
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="w-[18%] px-3 py-3 font-medium">{t('list.trade')}</th>
              <th className="w-[22%] px-3 py-3 font-medium">{t('list.strategy')}</th>
              <th className="w-[16%] px-3 py-3 font-medium">{t('list.account')}</th>
              <th className="w-[15%] px-3 py-3 font-medium">{t('list.execution')}</th>
              <th className="w-[14%] px-3 py-3 font-medium">{t('list.trader')}</th>
              <th className="w-[15%] px-3 py-3 font-medium">{t('list.system')}</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {trades.map((trade) => (
              <tr key={trade.tradeId} className="hover:bg-muted/30 align-top">
                <td className="p-0">
                  <Link
                    href={`/app/trades?trade=${trade.tradeId}`}
                    aria-current={selectedTradeId === trade.tradeId ? 'true' : undefined}
                    className="focus-visible:ring-ring block min-h-11 px-3 py-3 outline-none focus-visible:ring-2"
                  >
                    <span className="block font-semibold">{trade.symbol}</span>
                    <span className="text-muted-foreground block text-xs">
                      {t(`direction.${trade.direction}`)} · {trade.occurredAtDisplay}
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <span className="block font-medium break-words">{trade.strategyName}</span>
                  <span className="text-muted-foreground block text-xs break-words">
                    {trade.setupName} ·{' '}
                    {t('common.version', { number: trade.strategyVersionNumber })}
                  </span>
                </td>
                <td className="px-3 py-3 break-words">{trade.tradingAccountName}</td>
                <td className="px-3 py-3">
                  <TradeStatusBadge status={trade.status} />
                </td>
                <td className="space-y-2 px-3 py-3">
                  <RValue value={trade.actualR} />
                  <div>
                    <TradeOutcomeBadge outcome={trade.traderOutcome} />
                  </div>
                </td>
                <td className="space-y-2 px-3 py-3">
                  <SystemStatusBadge status={trade.systemStatus} />
                  <div>
                    <RValue value={trade.systemR} />
                  </div>
                  <div>
                    <TradeOutcomeBadge outcome={trade.systemOutcome} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {trades.map((trade) => (
          <Link
            key={trade.tradeId}
            href={`/app/trades?trade=${trade.tradeId}`}
            aria-current={selectedTradeId === trade.tradeId ? 'true' : undefined}
            className="border-border bg-card focus-visible:ring-ring flex min-h-11 flex-col gap-3 rounded-lg border p-4 outline-none focus-visible:ring-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span className="block text-base font-semibold">{trade.symbol}</span>
                <span className="text-muted-foreground text-sm">
                  {t(`direction.${trade.direction}`)} · {trade.occurredAtDisplay}
                </span>
              </div>
              <TradeStatusBadge status={trade.status} />
            </div>
            <div className="text-sm">
              <span className="font-medium">{trade.strategyName}</span>
              <span className="text-muted-foreground block break-words">
                {trade.setupName} · {t('common.version', { number: trade.strategyVersionNumber })}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs">{t('list.trader')}</span>
                <RValue value={trade.actualR} />
              </div>
              <div>
                <span className="text-muted-foreground block text-xs">{t('list.system')}</span>
                <div className="mt-1">
                  <SystemStatusBadge status={trade.systemStatus} />
                </div>
                <RValue value={trade.systemR} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {hasCursor || nextCursor !== null ? (
        <nav aria-label={t('pagination.label')} className="flex items-center justify-between gap-3">
          <Button variant="outline" disabled={!hasCursor} onClick={() => router.back()}>
            <ArrowLeft aria-hidden="true" /> {t('pagination.previous')}
          </Button>
          {nextCursor === null ? (
            <Button variant="outline" disabled>
              {t('pagination.next')} <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href={`/app/trades?cursor=${encodeURIComponent(nextCursor)}`}>
                {t('pagination.next')} <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          )}
        </nav>
      ) : null}
    </div>
  );
}
