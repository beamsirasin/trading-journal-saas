'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { TradeListItem } from '@/server/dal/trades';
import { formatR } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import { SystemStatusBadge, TradeStatusBadge } from '@/components/trades/trade-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

/** Truthful "archived" disclosure for the LIVE Strategy/Setup/Account — never hides the pinned historical label, only annotates it (mirrors Trade Detail, Phase 13G §3/§14/§21). */
function ArchivedNote({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <Badge variant="neutral" className="ml-1.5 px-1.5 py-0 text-[10px]">
      {label}
    </Badge>
  );
}

export type TradeListView = TradeListItem & { readonly occurredAtDisplay: string };

function RValue({ value, label }: { value: string | null; label?: string }) {
  return (
    <span className="block">
      {label === undefined ? null : (
        <span className="text-muted-foreground block text-[11px] tracking-wide uppercase">
          {label}
        </span>
      )}
      <span className="font-mono text-sm tabular-nums">{formatR(value) ?? '—'}</span>
    </span>
  );
}

/**
 * The Actual-side result summary for one list row (Phase 13G §20/§21). A
 * `closed` Trade shows its authoritative final `actualR`; a partially-exited
 * `open` Trade shows remaining % and realized-to-date R (never the closed
 * figure, and never inventing a final number early); every other state
 * (`planned`, an `open` Trade with no Exits yet, `canceled`) falls back to
 * the Plan's own `plannedR` — never a fake `0R`.
 */
type Translation = ReturnType<typeof useTranslations>;

function TraderResult({ trade, t }: { trade: TradeListView; t: Translation }) {
  if (trade.status === 'closed') {
    return (
      <>
        <RValue value={trade.actualR} />
        <div>
          <TradeOutcomeBadge outcome={trade.traderOutcome} />
        </div>
      </>
    );
  }
  if (trade.status === 'open' && trade.closedBps > 0) {
    return (
      <>
        <span className="text-muted-foreground block text-xs">
          {t('list.remainingPercent', { percent: trade.remainingBps / 100 })}
        </span>
        <RValue value={trade.realizedRToDate} label={t('list.realized')} />
      </>
    );
  }
  return <RValue value={trade.plannedR} label={t('field.plannedR')} />;
}

function ConditionsAdherence({ trade }: { trade: TradeListView }) {
  const t = useTranslations('trades');
  if (trade.setupConditionMetCount === null || trade.setupConditionTotalCount === null) return null;
  return (
    <span className="text-muted-foreground block text-xs">
      {t('list.conditionsMet', {
        met: trade.setupConditionMetCount,
        total: trade.setupConditionTotalCount,
      })}
    </span>
  );
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
  const archivedLabel = t('common.archived');

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
                  <span className="block font-medium break-words">
                    {trade.strategyName}
                    <ArchivedNote show={trade.strategyIsArchived} label={archivedLabel} />
                  </span>
                  <span className="text-muted-foreground block text-xs break-words">
                    {trade.setupName} ·{' '}
                    {t('common.version', { number: trade.strategyVersionNumber })}
                    <ArchivedNote show={trade.setupIsArchived} label={archivedLabel} />
                  </span>
                  <ConditionsAdherence trade={trade} />
                </td>
                <td className="px-3 py-3 break-words">
                  {trade.tradingAccountName}
                  <ArchivedNote show={trade.tradingAccountIsArchived} label={archivedLabel} />
                </td>
                <td className="px-3 py-3">
                  <TradeStatusBadge status={trade.status} />
                </td>
                <td className="space-y-2 px-3 py-3">
                  <TraderResult trade={trade} t={t} />
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
              <span className="font-medium">
                {trade.strategyName}
                <ArchivedNote show={trade.strategyIsArchived} label={archivedLabel} />
              </span>
              <span className="text-muted-foreground block break-words">
                {trade.setupName} · {t('common.version', { number: trade.strategyVersionNumber })}
                <ArchivedNote show={trade.setupIsArchived} label={archivedLabel} />
              </span>
              <span className="text-muted-foreground block break-words">
                {trade.tradingAccountName}
                <ArchivedNote show={trade.tradingAccountIsArchived} label={archivedLabel} />
              </span>
              <ConditionsAdherence trade={trade} />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs">{t('list.trader')}</span>
                <TraderResult trade={trade} t={t} />
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
