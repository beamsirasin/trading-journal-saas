import { useTranslations } from 'next-intl';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { HeroMetric } from '@/components/product/summary-primitives';
import { IdentityCorrectionDialog } from '@/components/trades/trade-correction-actions';
import {
  CancelTradeControl,
  DeleteTradeControl,
} from '@/components/trades/trade-destructive-actions';
import { ArchivedBadge } from '@/components/trades/trade-detail-primitives';
import { formatR, formatTradeInstant } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import { SystemStatusBadge, TradeStatusBadge } from '@/components/trades/trade-status-badge';

function actualHero(
  trade: TradeDetailModel,
  t: ReturnType<typeof useTranslations<'trades'>>,
): { value: string; supporting?: React.ReactNode } {
  if (trade.status === 'closed') {
    return {
      value: formatR(trade.actualR) ?? t('common.notAvailable'),
      supporting: <TradeOutcomeBadge outcome={trade.traderOutcome} />,
    };
  }
  if (trade.status === 'open') {
    if (trade.closedBps > 0) {
      return {
        value: formatR(trade.realizedRToDate) ?? '—',
        supporting: t('detail.overview.remainingPercent', { percent: trade.remainingBps / 100 }),
      };
    }
    return { value: t('status.execution.open') };
  }
  if (trade.status === 'planned') return { value: t('status.execution.planned') };
  return { value: t('status.execution.canceled') };
}

function systemHero(
  trade: TradeDetailModel,
  t: ReturnType<typeof useTranslations<'trades'>>,
): { value: string; supporting?: React.ReactNode } {
  if (trade.systemStatus === 'resolved') {
    return {
      value: formatR(trade.systemR) ?? t('common.notAvailable'),
      supporting: <TradeOutcomeBadge outcome={trade.systemOutcome} />,
    };
  }
  if (trade.systemStatus === 'pending') return { value: t('status.system.pending') };
  return { value: t('status.system.no_trade') };
}

/**
 * Trade Overview — Phase 15E, the first screen (brief §2). Identity, Actual/
 * System hero, paired Execution Gap ONLY when both sides are truthfully
 * final (brief §3 — never a provisional/invented Gap), and quiet Trade-level
 * administrative actions (Edit identity, Cancel for a legacy `planned` row,
 * Delete) — deliberately NOT a hero CTA (brief §35/§36), just small,
 * secondarily-positioned controls below the hero row. Archive/Restore do not
 * apply to Trades (CLAUDE.md A7 — Trades soft-delete via `deleted_at`, the
 * one deliberate exception to the app's `is_archived` convention; no
 * Trade-level Archive/Restore exists to place).
 */
export function TradeOverviewHeader({
  trade,
  timezone,
  locale,
  canWrite,
}: {
  trade: TradeDetailModel;
  timezone: string;
  locale: string;
  canWrite: boolean;
}) {
  const t = useTranslations('trades');
  const actual = actualHero(trade, t);
  const system = systemHero(trade, t);
  const archivedLabel = t('common.archived');
  const createdAt = formatTradeInstant(trade.createdAt, timezone, locale);

  return (
    <header className="border-border bg-card flex flex-col gap-5 rounded-lg border p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{t(`direction.${trade.direction}`)}</p>
          <h2 id="trade-detail-heading" className="text-2xl font-semibold tracking-tight">
            {trade.symbol}
          </h2>
          <p className="text-muted-foreground mt-1 inline-flex flex-wrap items-center gap-2 text-sm">
            {trade.tradingAccountName}
            <ArchivedBadge show={trade.tradingAccountIsArchived} label={archivedLabel} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TradeStatusBadge status={trade.status} />
          <SystemStatusBadge status={trade.systemStatus} />
        </div>
      </div>

      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <HeroMetric
          label={t('detail.overview.actual')}
          value={actual.value}
          supporting={actual.supporting}
        />
        <HeroMetric
          label={t('detail.overview.system')}
          value={system.value}
          supporting={system.supporting}
        />
        {trade.executionGapR === null ? null : (
          <HeroMetric label={t('field.executionGap')} value={formatR(trade.executionGapR) ?? '—'} />
        )}
      </div>

      {createdAt === null ? null : (
        <p className="text-muted-foreground text-xs">
          {t('detail.overview.logged', { date: createdAt })}
        </p>
      )}

      {!canWrite ? null : (
        <details className="border-border border-t pt-4">
          <summary className="text-muted-foreground hover:text-foreground min-h-11 cursor-pointer py-3 text-sm font-medium">
            {t('detail.overview.administration')}
          </summary>
          <div className="flex flex-wrap gap-2 pt-2">
            <IdentityCorrectionDialog trade={trade} />
            {trade.status === 'planned' ? <CancelTradeControl tradeId={trade.tradeId} /> : null}
            <DeleteTradeControl tradeId={trade.tradeId} />
          </div>
        </details>
      )}
    </header>
  );
}
