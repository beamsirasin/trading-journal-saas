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

/**
 * ACTUAL — Phase 15E. Answers "what did I actually do?" Owns every
 * Actual-lifecycle mutation (brief §12, load-bearing): Partial Close, Close
 * Trade/Close Remaining, per-exit correction, the legacy-planned "Add
 * execution details" transition, and the general execution correction —
 * relocated verbatim from the former generic "Lifecycle Actions" card, now
 * colocated with the data they change. A `canceled` or legacy `planned` row
 * shows friendly compatibility copy, never the raw status name (Phase 14E).
 * Price mode and Money mode both stay first-class: fields are shown or
 * omitted purely by presence (`actualEntry`/`actualInitialStop` vs. the
 * money fields), never forced into the other shape.
 */
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
      <section aria-labelledby="trade-actual-heading">
        <SectionTitle id="trade-actual-heading">{t('detail.sections.execution')}</SectionTitle>
        <p className="text-muted-foreground text-sm">{t('detail.notOpened')}</p>
      </section>
    );
  }

  if (trade.status === 'planned') {
    return (
      <section aria-labelledby="trade-actual-heading">
        <SectionTitle id="trade-actual-heading">{t('detail.sections.execution')}</SectionTitle>
        <p className="text-muted-foreground mb-4 text-sm">{t('detail.needsExecutionDetails')}</p>
        {canWrite ? <OpenTradeDialog trade={trade} timezone={timezone} /> : null}
      </section>
    );
  }

  const isClosed = trade.status === 'closed';
  const isPartial = !isClosed && trade.closedBps > 0;

  return (
    <section aria-labelledby="trade-actual-heading" className="grid gap-5">
      <SectionTitle id="trade-actual-heading">{t('detail.sections.execution')}</SectionTitle>

      {/* Compact final answer first (brief §11) — never let exit-leg history compete with it visually. A label stays attached to the value (never colour/size alone) so the number's meaning survives for assistive tech and reads unambiguously in isolation. */}
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
        <div className="flex flex-wrap items-baseline gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">{t('field.realizedRToDate')}</span>
            <span className="text-metric numeric">{formatR(trade.realizedRToDate) ?? '—'}</span>
          </div>
        </div>
      ) : null}

      {canWrite ? (
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
      ) : null}

      <dl className="divide-border divide-y">
        <DetailRow
          label={t('field.actualResultMode')}
          value={
            trade.actualResultMode === null
              ? '—'
              : t(`lifecycle.execution.${trade.actualResultMode}Mode`)
          }
        />
        <DetailRow label={t('field.actualEntry')} value={trade.actualEntry ?? '—'} />
        <DetailRow label={t('field.initialStop')} value={trade.actualInitialStop ?? '—'} />
        {trade.actualPositionSize === null ? null : (
          <DetailRow label={t('field.actualPositionSize')} value={trade.actualPositionSize} />
        )}
        <DetailRow label={t('field.initialRisk')} value={money(trade.actualInitialRiskMinor)} />
        {trade.actualExit === null ? null : (
          <DetailRow label={t('field.exit')} value={trade.actualExit} />
        )}
        {trade.grossPnlMinor === null ? null : (
          <DetailRow label={t('field.grossPnl')} value={money(trade.grossPnlMinor)} />
        )}
        <DetailRow label={t('field.commission')} value={money(trade.commissionMinor)} />
        <DetailRow label={t('field.fees')} value={money(trade.feesMinor)} />
        <DetailRow label={t('field.swap')} value={money(trade.swapMinor)} />
        {trade.netPnlMinor === null ? null : (
          <DetailRow label={t('field.netPnl')} value={money(trade.netPnlMinor)} />
        )}
        {trade.exits.length === 0 ? null : (
          <>
            <DetailRow label={t('field.closedPercent')} value={`${trade.closedBps / 100}%`} />
            <DetailRow label={t('field.remainingPercent')} value={`${trade.remainingBps / 100}%`} />
          </>
        )}
        {/* Always present, even Open with zero Exits — a truthful "Not
            available" (never a blank or fabricated 0) until the final Actual
            R genuinely exists (CLAUDE.md §6). */}
        <DetailRow
          label={t('field.actualR')}
          value={formatR(trade.actualR) ?? t('common.notAvailable')}
        />
        <DetailRow
          label={t('field.traderOutcome')}
          value={<TradeOutcomeBadge outcome={trade.traderOutcome} />}
        />
        <DetailRow label={t('field.enteredAt')} value={instant(trade.enteredAt)} />
        {trade.exitedAt === null ? null : (
          <DetailRow label={t('field.exitedAt')} value={instant(trade.exitedAt)} />
        )}
      </dl>

      {trade.exits.length === 0 ? null : (
        <div className="grid gap-3">
          {trade.exits.map((exit) => (
            <article
              key={exit.exitId}
              className="border-border grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto]"
            >
              <div className="grid gap-1 text-sm">
                <h4 className="font-semibold">
                  {t('lifecycle.execution.exitNumber', { sequence: exit.sequence })}
                </h4>
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
              {canWrite ? (
                <CorrectExitDialog trade={trade} exit={exit} timezone={timezone} />
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
