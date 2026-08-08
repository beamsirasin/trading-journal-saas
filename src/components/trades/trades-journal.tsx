import { BookOpen, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import { cn } from '@/lib/utils';
import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { EmptyState } from '@/components/product/empty-state';
import { TradeDetail } from '@/components/trades/trade-detail';
import { TradeList, type TradeListView } from '@/components/trades/trade-list';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export function TradesJournal({
  trades,
  nextCursor,
  hasCursor,
  selectedTrade,
  selectedTradeId,
  canWrite,
  writeBlockReason,
  timezone,
  locale,
}: {
  trades: readonly TradeListView[];
  nextCursor: string | null;
  hasCursor: boolean;
  selectedTrade: TradeDetailModel | null;
  selectedTradeId: string | null;
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
  timezone: string;
  locale: string;
}) {
  const t = useTranslations('trades');
  const hasSelection = selectedTrade !== null;

  if (trades.length === 0 && !hasCursor) {
    return (
      <div className="flex flex-col gap-4">
        {!canWrite && writeBlockReason !== null ? (
          <div
            role="status"
            className="border-warning/30 bg-warning/10 rounded-lg border p-4 text-sm"
          >
            {t(`errors.${writeBlockReason}`)}
          </div>
        ) : null}
        <EmptyState
          icon={BookOpen}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            canWrite ? (
              <Button asChild>
                <Link href="/app/trades/new">
                  <Plus aria-hidden="true" />
                  {t('logTrade')}
                </Link>
              </Button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!canWrite && writeBlockReason !== null ? (
        <div
          role="status"
          className="border-warning/30 bg-warning/10 rounded-lg border p-4 text-sm"
        >
          {t(`errors.${writeBlockReason}`)}
        </div>
      ) : null}
      <div
        className={cn(
          'grid min-w-0 items-start gap-6',
          hasSelection && 'lg:grid-cols-[minmax(430px,0.85fr)_minmax(0,1.15fr)]',
        )}
      >
        <div className={cn('min-w-0', hasSelection && 'hidden lg:block')}>
          <TradeList
            trades={trades}
            selectedTradeId={selectedTradeId}
            nextCursor={nextCursor}
            hasCursor={hasCursor}
          />
        </div>
        {hasSelection ? (
          <TradeDetail trade={selectedTrade} timezone={timezone} locale={locale} />
        ) : null}
      </div>
    </div>
  );
}
