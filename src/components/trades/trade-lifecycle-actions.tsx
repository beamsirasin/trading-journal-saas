import { useTranslations } from 'next-intl';

import type { TradeDetail } from '@/server/dal/trades';
import {
  IdentityCorrectionDialog,
  PlanCorrectionDialog,
} from '@/components/trades/trade-correction-actions';
import {
  CancelTradeControl,
  DeleteTradeControl,
} from '@/components/trades/trade-destructive-actions';
import {
  ExecutionCorrectionDialog,
  OpenTradeDialog,
} from '@/components/trades/trade-execution-actions';
import { AddExitDialog } from '@/components/trades/trade-exit-actions';
import {
  CorrectSystemDialog,
  MarkSystemNoTradeDialog,
  ResolveSystemDialog,
} from '@/components/trades/trade-system-actions';

export function TradeLifecycleActions({
  trade,
  timezone,
}: {
  trade: TradeDetail;
  timezone: string;
}) {
  const t = useTranslations('trades');
  return (
    <section
      aria-labelledby="trade-actions-heading"
      className="border-border bg-card rounded-lg border p-4 sm:p-5"
    >
      <div className="mb-4">
        <h3 id="trade-actions-heading" className="text-card-title">
          {t('lifecycle.title')}
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">{t('lifecycle.description')}</p>
      </div>
      <div className="grid gap-4">
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('lifecycle.groups.execution')}</h4>
          <div className="flex flex-wrap gap-2">
            {trade.status === 'planned' ? (
              <>
                <OpenTradeDialog trade={trade} timezone={timezone} />
                <CancelTradeControl tradeId={trade.tradeId} />
              </>
            ) : null}
            {trade.status === 'open' ? (
              <>
                <AddExitDialog trade={trade} timezone={timezone} />
                <AddExitDialog trade={trade} timezone={timezone} closeRemaining />
                <ExecutionCorrectionDialog trade={trade} timezone={timezone} />
              </>
            ) : null}
            {trade.status === 'closed' ? (
              <ExecutionCorrectionDialog trade={trade} timezone={timezone} />
            ) : null}
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('lifecycle.groups.corrections')}</h4>
          <div className="flex flex-wrap gap-2">
            <PlanCorrectionDialog trade={trade} />
            <IdentityCorrectionDialog trade={trade} />
          </div>
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('lifecycle.groups.system')}</h4>
          <div className="flex flex-wrap gap-2">
            {trade.systemStatus === 'pending' ? (
              <>
                <ResolveSystemDialog trade={trade} timezone={timezone} />
                <MarkSystemNoTradeDialog tradeId={trade.tradeId} />
              </>
            ) : (
              <CorrectSystemDialog trade={trade} timezone={timezone} />
            )}
          </div>
        </div>
        <div className="border-border border-t pt-4">
          <h4 className="mb-2 text-sm font-semibold">{t('lifecycle.groups.delete')}</h4>
          <DeleteTradeControl tradeId={trade.tradeId} />
        </div>
      </div>
    </section>
  );
}
