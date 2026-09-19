import { useTranslations } from 'next-intl';

import { isContractRow } from '@/lib/trades/add-trade-contract';
import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { PlanCorrectionDialog } from '@/components/trades/trade-correction-actions';
import { DetailRow, SectionTitle } from '@/components/trades/trade-detail-primitives';
import { LegacyEvidenceBadge } from '@/components/trades/trade-evidence';
import { formatR, formatTradeInstant, formatTradeMoney } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

function SystemPlan({ trade, canWrite }: { trade: TradeDetailModel; canWrite: boolean }) {
  const t = useTranslations('trades');
  const money = (value: string | null) =>
    formatTradeMoney(value, trade.tradingAccountBaseCurrency) ?? '—';
  const hasPricePlan = trade.plannedEntry !== null && trade.plannedStop !== null;
  const hasMoneyPlan = trade.plannedRiskMinor !== null;

  return (
    <section
      aria-labelledby="trade-system-plan-heading"
      className="border-border bg-muted/20 grid gap-4 rounded-lg border p-4"
    >
      <div>
        <h4 id="trade-system-plan-heading" className="font-semibold">
          {t('detail.systemPlan.title')}
        </h4>
        {hasPricePlan ? (
          <p className="text-muted-foreground mt-1 text-sm">{t('detail.systemPlan.byPrice')}</p>
        ) : hasMoneyPlan ? (
          <p className="text-muted-foreground mt-1 text-sm">{t('detail.systemPlan.byMoney')}</p>
        ) : null}
      </div>

      {!hasPricePlan && !hasMoneyPlan ? (
        <p className="text-muted-foreground text-sm">{t('detail.systemPlan.notRecorded')}</p>
      ) : (
        <dl className="divide-border divide-y">
          {hasPricePlan ? (
            <>
              <DetailRow label={t('field.entry')} value={trade.plannedEntry} />
              <DetailRow label={t('field.stopLoss')} value={trade.plannedStop} />
              {trade.plannedTarget === null ? null : (
                <DetailRow label={t('field.takeProfit')} value={trade.plannedTarget} />
              )}
              <DetailRow
                label={t('field.plannedR')}
                value={formatR(trade.plannedR) ?? t('common.notAvailable')}
              />
              {trade.plannedPositionSize === null ? null : (
                <DetailRow label={t('field.positionSize')} value={trade.plannedPositionSize} />
              )}
            </>
          ) : (
            <>
              <DetailRow
                label={t('detail.systemPlan.risk')}
                value={money(trade.plannedRiskMinor)}
              />
              {trade.plannedRewardMinor === null ? null : (
                <DetailRow
                  label={t('detail.systemPlan.targetReward')}
                  value={money(trade.plannedRewardMinor)}
                />
              )}
              <DetailRow
                label={t('field.plannedR')}
                value={formatR(trade.plannedR) ?? t('common.notAvailable')}
              />
            </>
          )}
        </dl>
      )}

      {hasPricePlan && hasMoneyPlan ? (
        <details className="border-border border-t pt-3">
          <summary className="text-muted-foreground hover:text-foreground min-h-11 cursor-pointer py-2 text-sm font-medium">
            {t('detail.systemPlan.legacyDetails')}
          </summary>
          <dl className="divide-border divide-y pt-2">
            <DetailRow label={t('detail.systemPlan.risk')} value={money(trade.plannedRiskMinor)} />
            {trade.plannedRewardMinor === null ? null : (
              <DetailRow
                label={t('detail.systemPlan.targetReward')}
                value={money(trade.plannedRewardMinor)}
              />
            )}
          </dl>
        </details>
      ) : null}

      {canWrite ? (
        <div>
          <PlanCorrectionDialog trade={trade} />
        </div>
      ) : null}
    </section>
  );
}

function resolutionSummary(
  trade: TradeDetailModel,
  t: ReturnType<typeof useTranslations<'trades'>>,
) {
  switch (trade.systemResolutionKind) {
    case 'money_target':
      return t('detail.systemOutcome.target');
    case 'money_stop':
      return t('detail.systemOutcome.stop');
    case 'money_break_even':
      return t('detail.systemOutcome.breakEven');
    case 'money_custom':
      return t('detail.systemOutcome.custom');
    case 'price_exit':
      if (trade.systemExitReason === 'target_hit') return t('detail.systemOutcome.target');
      if (trade.systemExitReason === 'stop_hit') return t('detail.systemOutcome.stop');
      if (trade.systemExitReason === 'break_even_rule') return t('detail.systemOutcome.breakEven');
      return t('detail.systemOutcome.custom');
    default:
      return t('common.notAvailable');
  }
}

/** Read-only System Plan/outcome surface; assessment writes live only in Review. */
export function SystemSection({
  trade,
  timezone,
  locale,
  canWrite,
  onOpenAssessment,
}: {
  trade: TradeDetailModel;
  timezone: string;
  locale: string;
  canWrite: boolean;
  onOpenAssessment?: () => void;
}) {
  const t = useTranslations('trades');
  const instant = (value: string | null) => formatTradeInstant(value, timezone, locale) ?? '—';

  return (
    <section aria-labelledby="trade-system-heading" className="grid gap-6">
      <SectionTitle id="trade-system-heading">{t('detail.nav.system')}</SectionTitle>

      {/*
        A contract row's Risk at Entry and Target are the trader's intent, read
        back with the Plan tab's own Risk and Target — never relabelled as a
        System Plan. System semantics for it belong to System Assessment.
      */}
      {isContractRow(trade) ? null : <SystemPlan trade={trade} canWrite={canWrite} />}

      <section
        aria-labelledby="trade-system-outcome-heading"
        className="border-border grid gap-4 rounded-lg border p-4"
      >
        <h4 id="trade-system-outcome-heading" className="font-semibold">
          {t('detail.systemOutcome.title')}
        </h4>

        {trade.systemStatus === 'pending' ? (
          <>
            <div>
              <p className="font-medium">{t('status.system.pending')}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('detail.systemOutcome.pending')}
              </p>
            </div>
          </>
        ) : trade.systemStatus === 'no_trade' ? (
          <>
            <p className="font-medium">{t('detail.systemOutcome.noTrade')}</p>
          </>
        ) : trade.systemStatus === 'cannot_determine' ? (
          <p className="font-medium">{t('status.system.cannot_determine')}</p>
        ) : (
          <>
            {/*
              LEGACY EVIDENCE, NAMED (contract §28). Every stored System
              result predates the trader-confirmed System Assessment, so this
              section shows the figures it has while saying what they are —
              rather than letting them read as this Trade's canonical System
              Result beside a canonical Actual R.
            */}
            <p
              data-system-legacy-note=""
              className="text-muted-foreground border-border bg-muted/30 rounded-md border px-3 py-2 text-sm"
            >
              {t('evidence.systemLegacyNote')}
            </p>
            <div className="flex flex-wrap items-baseline gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
                  {trade.systemR === null
                    ? t('lifecycle.system.assessment.gross')
                    : t('field.systemR')}
                  <LegacyEvidenceBadge />
                </span>
                <span className="text-metric numeric">
                  {formatR(trade.systemR ?? trade.systemGrossR) ?? t('common.notAvailable')}
                </span>
              </div>
              {trade.systemOutcome === null ? null : (
                <TradeOutcomeBadge outcome={trade.systemOutcome} />
              )}
            </div>
            <p className="text-sm font-medium">{resolutionSummary(trade, t)}</p>
            <details className="border-border border-t pt-3">
              <summary className="text-muted-foreground hover:text-foreground min-h-11 cursor-pointer py-2 text-sm font-medium">
                {t('detail.systemOutcome.details')}
              </summary>
              <dl className="divide-border divide-y pt-2">
                {trade.systemExitPrice === null ? null : (
                  <DetailRow label={t('field.exit')} value={trade.systemExitPrice} />
                )}
                {trade.systemGrossRInput === null ? null : (
                  <DetailRow
                    label={t('lifecycle.system.grossSystemR')}
                    value={formatR(trade.systemGrossRInput) ?? '—'}
                  />
                )}
                <DetailRow
                  label={t('field.systemExitedAt')}
                  value={instant(trade.systemExitedAt)}
                />
                <DetailRow
                  label={t('field.systemCostR')}
                  value={formatR(trade.systemCostR) ?? t('lifecycle.system.assessment.notRecorded')}
                />
                <DetailRow
                  label={t('field.systemResolvedAt')}
                  value={instant(trade.systemResolvedAt)}
                />
              </dl>
            </details>
          </>
        )}

        {canWrite ? (
          <div>
            {onOpenAssessment === undefined ? (
              <Button asChild variant="outline">
                <Link href={`/app/trades?trade=${trade.tradeId}&section=review`}>
                  {t('lifecycle.system.assessment.openInReview')}
                </Link>
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={onOpenAssessment}>
                {t('lifecycle.system.assessment.openInReview')}
              </Button>
            )}
          </div>
        ) : null}
      </section>
    </section>
  );
}
