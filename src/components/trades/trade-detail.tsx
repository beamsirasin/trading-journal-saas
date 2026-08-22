import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { deriveTradeSectionStatuses } from '@/lib/trades/section';
import type {
  TradeCreateStrategyOption,
  TradeDetail as TradeDetailModel,
} from '@/server/dal/trades';
import { ActualSection } from '@/components/trades/trade-actual-section';
import { EntrySnapshotSection } from '@/components/trades/trade-entry-section';
import { TradeOverviewHeader } from '@/components/trades/trade-overview-header';
import { ReviewSection } from '@/components/trades/trade-review-section';
import { TradeSectionNav } from '@/components/trades/trade-section-nav';
import { StrategySetupSection } from '@/components/trades/trade-strategy-section';
import { SystemSection } from '@/components/trades/trade-system-section';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * Trade Detail — Phase 15E. A thin orchestrator: Trade Overview (identity,
 * hero, quiet Trade-level actions) followed by one of five conceptual
 * sections at a time (`TradeSectionNav`, which owns the "?section=" switch).
 * Every mutation now lives beside the information it changes — see each
 * section component's own doc comment for its exact action ownership.
 */
export function TradeDetail({
  trade,
  timezone,
  locale,
  canWrite,
  classificationOptions,
}: {
  trade: TradeDetailModel;
  timezone: string;
  locale: string;
  canWrite: boolean;
  classificationOptions: readonly TradeCreateStrategyOption[];
}) {
  const t = useTranslations('trades');

  return (
    <article className="flex min-w-0 flex-col gap-5" aria-labelledby="trade-detail-heading">
      <Button asChild variant="ghost" className="w-fit lg:hidden">
        <Link href="/app/trades">
          <ArrowLeft aria-hidden="true" /> {t('detail.back')}
        </Link>
      </Button>

      <TradeOverviewHeader trade={trade} timezone={timezone} locale={locale} canWrite={canWrite} />

      <TradeSectionNav
        tradeId={trade.tradeId}
        statuses={deriveTradeSectionStatuses(trade)}
        sections={{
          actual: (
            <ActualSection trade={trade} timezone={timezone} locale={locale} canWrite={canWrite} />
          ),
          system: (
            <SystemSection trade={trade} timezone={timezone} locale={locale} canWrite={canWrite} />
          ),
          strategy: (
            <StrategySetupSection
              trade={trade}
              canWrite={canWrite}
              classificationOptions={classificationOptions}
            />
          ),
          entry: <EntrySnapshotSection trade={trade} canWrite={canWrite} />,
          review: <ReviewSection trade={trade} canWrite={canWrite} />,
        }}
      />
    </article>
  );
}
