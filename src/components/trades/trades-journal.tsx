import { BookOpen, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import { cn } from '@/lib/utils';
import type { WorkspaceTradeDaySummary } from '@/server/dal/trade-calendar';
import type {
  TradeCreateStrategyOption,
  TradeDetail as TradeDetailModel,
} from '@/server/dal/trades';
import { EmptyState } from '@/components/product/empty-state';
import { TradeDetail } from '@/components/trades/trade-detail';
import { TradeList, type TradeListView } from '@/components/trades/trade-list';
import { TradingCalendar } from '@/components/trades/trading-calendar';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

export interface TradesJournalCalendarProps {
  readonly year: number;
  readonly month: number;
  readonly todayDate: string;
  readonly selectedDate: string | null;
  readonly trader: readonly {
    readonly date: string;
    readonly totalR: string;
    readonly count: number;
  }[];
  readonly system: readonly {
    readonly date: string;
    readonly totalR: string;
    readonly count: number;
  }[];
  readonly traderTotalR: string | null;
  readonly systemTotalR: string | null;
  readonly tradingDays: number;
  readonly daySummary: WorkspaceTradeDaySummary | null;
}

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
  classificationOptions,
  calendar,
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
  classificationOptions: readonly TradeCreateStrategyOption[];
  calendar: TradesJournalCalendarProps;
}) {
  const t = useTranslations('trades');
  const hasSelection = selectedTrade !== null;
  const isDayFiltered = calendar.selectedDate !== null;

  const calendarElement = (
    <TradingCalendar
      year={calendar.year}
      month={calendar.month}
      locale={locale}
      todayDate={calendar.todayDate}
      selectedDate={calendar.selectedDate}
      trader={calendar.trader}
      system={calendar.system}
      traderTotalR={calendar.traderTotalR}
      systemTotalR={calendar.systemTotalR}
      tradingDays={calendar.tradingDays}
      daySummary={calendar.daySummary}
    />
  );

  if (trades.length === 0 && !hasCursor) {
    return (
      <div className="flex flex-col gap-6">
        {calendarElement}
        {!canWrite && writeBlockReason !== null ? (
          <div
            role="status"
            className="border-warning/30 bg-warning/10 rounded-lg border p-4 text-sm"
          >
            {t(`errors.${writeBlockReason}`)}
          </div>
        ) : null}
        {isDayFiltered ? (
          <EmptyState
            icon={BookOpen}
            title={t('calendar.empty.title')}
            description={t('calendar.empty.description')}
            action={
              <Button asChild variant="outline">
                <Link
                  href={`/app/trades?month=${calendar.year}-${String(calendar.month).padStart(2, '0')}`}
                >
                  {t('calendar.clearDate')}
                </Link>
              </Button>
            }
          />
        ) : (
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
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {calendarElement}
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
          <TradeDetail
            trade={selectedTrade}
            timezone={timezone}
            locale={locale}
            canWrite={canWrite}
            classificationOptions={classificationOptions}
          />
        ) : null}
      </div>
    </div>
  );
}
