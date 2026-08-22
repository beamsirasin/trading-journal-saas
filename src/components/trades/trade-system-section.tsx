import { useTranslations } from 'next-intl';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { DetailRow, SectionTitle } from '@/components/trades/trade-detail-primitives';
import { formatR, formatTradeInstant } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import {
  CorrectSystemDialog,
  MarkSystemNoTradeDialog,
  ResolveSystemDialog,
} from '@/components/trades/trade-system-actions';

/**
 * SYSTEM — Phase 15E. Answers "what would the System have produced?"
 * Genuinely independent of Actual (brief §14): a Trade may show Actual
 * Closed here alongside System Pending, or Actual Open alongside System
 * Resolved — neither implies the other is blocked. Owns Update/Mark
 * No Trade/Correct (brief §15), relocated verbatim from the former generic
 * "Lifecycle Actions" card.
 */
export function SystemSection({
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
  const instant = (value: string | null) => formatTradeInstant(value, timezone, locale) ?? '—';

  if (trade.systemStatus === 'pending') {
    return (
      <section aria-labelledby="trade-system-heading" className="grid gap-4">
        <SectionTitle id="trade-system-heading">{t('detail.sections.system')}</SectionTitle>
        <p className="text-muted-foreground text-sm">{t('detail.systemPending')}</p>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <ResolveSystemDialog trade={trade} timezone={timezone} />
            <MarkSystemNoTradeDialog tradeId={trade.tradeId} />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="trade-system-heading" className="grid gap-4">
      <SectionTitle id="trade-system-heading">{t('detail.sections.system')}</SectionTitle>

      {trade.systemStatus === 'no_trade' ? (
        <p className="text-muted-foreground text-sm">{t('detail.systemNoTrade')}</p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{t('field.systemR')}</span>
            <span className="text-metric numeric">
              {formatR(trade.systemR) ?? t('common.notAvailable')}
            </span>
          </div>
          <TradeOutcomeBadge outcome={trade.systemOutcome} />
        </div>
      )}

      {canWrite ? (
        <div>
          <CorrectSystemDialog trade={trade} timezone={timezone} />
        </div>
      ) : null}

      {trade.systemStatus === 'no_trade' ? null : (
        <dl className="divide-border divide-y">
          <DetailRow
            label={t('field.systemResolutionKind')}
            value={
              trade.systemResolutionKind === null
                ? '—'
                : t(`systemResolutionKind.${trade.systemResolutionKind}`)
            }
          />
          {trade.systemExitPrice === null ? null : (
            <DetailRow label={t('field.exit')} value={trade.systemExitPrice} />
          )}
          {trade.systemGrossRInput === null ? null : (
            <DetailRow
              label={t('lifecycle.system.grossSystemR')}
              value={formatR(trade.systemGrossRInput) ?? '—'}
            />
          )}
          <DetailRow label={t('field.systemExitedAt')} value={instant(trade.systemExitedAt)} />
          <DetailRow
            label={t('field.systemExitReason')}
            value={
              trade.systemExitReason === null ? '—' : t(`systemReason.${trade.systemExitReason}`)
            }
          />
          <DetailRow label={t('field.systemCostR')} value={formatR(trade.systemCostR) ?? '—'} />
          <DetailRow label={t('field.systemResolvedAt')} value={instant(trade.systemResolvedAt)} />
          {trade.executionGapR === null ? null : (
            <DetailRow
              label={t('field.executionGap')}
              value={<span className="font-mono tabular-nums">{formatR(trade.executionGapR)}</span>}
            />
          )}
        </dl>
      )}
    </section>
  );
}
