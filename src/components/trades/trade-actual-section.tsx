import { useTranslations } from 'next-intl';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { DetailRow, SectionTitle } from '@/components/trades/trade-detail-primitives';
import {
  ExecutionCorrectionDialog,
  OpenTradeDialog,
} from '@/components/trades/trade-execution-actions';
import { AddExitDialog, CorrectExitDialog } from '@/components/trades/trade-exit-actions';
import { formatR, formatTradeInstant, formatTradeMoney } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';

/** ACTUAL answers only “what did I actually do?” System Plan ownership lives in SystemSection. */
export function ActualSection({
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
  const money = (value: string | null) =>
    formatTradeMoney(value, trade.tradingAccountBaseCurrency) ?? '—';

  if (trade.status === 'canceled') {
    return (
      <section aria-labelledby="trade-actual-heading" className="grid gap-5">
        <SectionTitle id="trade-actual-heading">{t('detail.nav.actual')}</SectionTitle>
        <p className="text-muted-foreground text-sm">{t('detail.notOpened')}</p>
      </section>
    );
  }

  if (trade.status === 'planned') {
    return (
      <section aria-labelledby="trade-actual-heading" className="grid gap-5">
        <SectionTitle id="trade-actual-heading">{t('detail.nav.actual')}</SectionTitle>
        <p className="text-muted-foreground text-sm">{t('detail.needsExecutionDetails')}</p>
        {canWrite ? (
          <section aria-labelledby="trade-actual-actions-heading" className="grid gap-3">
            <h4 id="trade-actual-actions-heading" className="font-semibold">
              {t('detail.actualGroups.actions')}
            </h4>
            <div className="flex flex-wrap gap-2">
              <OpenTradeDialog trade={trade} timezone={timezone} />
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  const isClosed = trade.status === 'closed';
  const isPartial = !isClosed && trade.closedBps > 0;
  const positionStatus = isClosed
    ? t('status.execution.closed')
    : isPartial
      ? t('detail.actualGroups.partial')
      : t('status.execution.open');

  return (
    <section aria-labelledby="trade-actual-heading" className="grid gap-6">
      <SectionTitle id="trade-actual-heading">{t('detail.nav.actual')}</SectionTitle>

      <section aria-labelledby="trade-actual-result-heading" className="grid gap-3">
        <h4 id="trade-actual-result-heading" className="font-semibold">
          {t('detail.actualGroups.result')}
        </h4>
        {isClosed ? (
          <div className="flex flex-wrap items-baseline gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{t('field.actualR')}</span>
              <span className="text-metric numeric">
                {formatR(trade.actualR) ?? t('common.notAvailable')}
              </span>
            </div>
            <TradeOutcomeBadge outcome={trade.traderOutcome} />
          </div>
        ) : isPartial ? (
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{t('field.realizedRToDate')}</span>
            <span className="text-metric numeric">{formatR(trade.realizedRToDate) ?? '—'}</span>
          </div>
        ) : (
          <p className="text-sm font-medium">{t('detail.actualGroups.resultOpen')}</p>
        )}
      </section>

      <section aria-labelledby="trade-actual-position-heading" className="grid gap-3">
        <h4 id="trade-actual-position-heading" className="font-semibold">
          {t('detail.actualGroups.position')}
        </h4>
        <dl className="divide-border divide-y">
          <DetailRow label={t('detail.actualGroups.positionStatus')} value={positionStatus} />
          {isPartial ? (
            <DetailRow label={t('field.remainingPercent')} value={`${trade.remainingBps / 100}%`} />
          ) : null}
          {trade.netPnlMinor === null ? null : (
            <DetailRow label={t('field.netPnl')} value={money(trade.netPnlMinor)} />
          )}
        </dl>
      </section>

      <section aria-labelledby="trade-actual-execution-heading" className="grid gap-3">
        <h4 id="trade-actual-execution-heading" className="font-semibold">
          {t('detail.actualGroups.execution')}
        </h4>
        <dl className="divide-border divide-y">
          <DetailRow
            label={t('field.actualResultMode')}
            value={
              trade.actualResultMode === null
                ? t('common.notAvailable')
                : t(`lifecycle.execution.${trade.actualResultMode}Mode`)
            }
          />
          {trade.actualResultMode === 'price' ? (
            <>
              <DetailRow
                label={t('field.actualEntry')}
                value={trade.actualEntry ?? t('common.notAvailable')}
              />
              <DetailRow
                label={t('field.initialStop')}
                value={trade.actualInitialStop ?? t('common.notAvailable')}
              />
              {trade.actualPositionSize === null ? null : (
                <DetailRow label={t('field.actualPositionSize')} value={trade.actualPositionSize} />
              )}
            </>
          ) : trade.actualResultMode === 'money' ? (
            <DetailRow label={t('field.initialRisk')} value={money(trade.actualInitialRiskMinor)} />
          ) : null}
          <DetailRow label={t('field.enteredAt')} value={instant(trade.enteredAt)} />
        </dl>
      </section>

      <section aria-labelledby="trade-actual-exits-heading" className="grid gap-3">
        <h4 id="trade-actual-exits-heading" className="font-semibold">
          {t('detail.actualGroups.exits')}
        </h4>
        {trade.exits.length === 0 && trade.actualExit === null ? (
          <p className="text-muted-foreground text-sm">{t('detail.actualGroups.noExits')}</p>
        ) : (
          <dl className="divide-border divide-y">
            {trade.actualExit === null ? null : (
              <DetailRow label={t('field.exit')} value={trade.actualExit} />
            )}
            {trade.grossPnlMinor === null ? null : (
              <DetailRow label={t('field.grossPnl')} value={money(trade.grossPnlMinor)} />
            )}
            <DetailRow label={t('field.commission')} value={money(trade.commissionMinor)} />
            <DetailRow label={t('field.fees')} value={money(trade.feesMinor)} />
            <DetailRow label={t('field.swap')} value={money(trade.swapMinor)} />
            {trade.exits.length === 0 ? null : (
              <DetailRow label={t('field.closedPercent')} value={`${trade.closedBps / 100}%`} />
            )}
            {trade.exitedAt === null ? null : (
              <DetailRow label={t('field.exitedAt')} value={instant(trade.exitedAt)} />
            )}
          </dl>
        )}
        {trade.exits.map((exit) => (
          <article
            key={exit.exitId}
            className="border-border grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]"
          >
            <div className="grid gap-1 text-sm">
              <h5 className="font-semibold">
                {t('lifecycle.execution.exitNumber', { sequence: exit.sequence })}
              </h5>
              <p>
                {t('field.closedPercent')}:{' '}
                {(exit.closedBps / 100).toFixed(exit.closedBps % 100 === 0 ? 0 : 2)}%
              </p>
              {exit.exitPrice === null ? null : (
                <p>
                  {t('field.exit')}: {exit.exitPrice}
                </p>
              )}
              {exit.realizedPnlMinor === null ? null : (
                <p>
                  {t('field.realizedPnl')}: {money(exit.realizedPnlMinor)}
                </p>
              )}
              <p>
                {t('field.exitedAt')}: {instant(exit.exitedAt)}
              </p>
              {exit.exitReason === null ? null : (
                <p>
                  {t('field.exitReason')}: {exit.exitReason}
                </p>
              )}
            </div>
            {canWrite ? <CorrectExitDialog trade={trade} exit={exit} timezone={timezone} /> : null}
          </article>
        ))}
      </section>

      {canWrite ? (
        <section aria-labelledby="trade-actual-actions-heading" className="grid gap-3">
          <h4 id="trade-actual-actions-heading" className="font-semibold">
            {t('detail.actualGroups.actions')}
          </h4>
          <div className="flex flex-wrap gap-2">
            {isClosed ? (
              <ExecutionCorrectionDialog trade={trade} timezone={timezone} />
            ) : (
              <>
                <AddExitDialog trade={trade} timezone={timezone} />
                <AddExitDialog trade={trade} timezone={timezone} closeRemaining />
                <ExecutionCorrectionDialog trade={trade} timezone={timezone} />
              </>
            )}
          </div>
        </section>
      ) : null}
    </section>
  );
}
