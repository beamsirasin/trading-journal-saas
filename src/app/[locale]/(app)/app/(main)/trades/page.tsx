import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { authorizeWorkspaceMutation } from '@/lib/entitlements/resolve';
import { calendarDateIn, dayRangeIn, monthRangeIn } from '@/lib/time';
import { TradeIdSchema } from '@/lib/trades/schemas';
import { parseTradesAttention, parseTradesView } from '@/lib/trades/view';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import {
  getWorkspaceTradeCalendarMonth,
  getWorkspaceTradeDaySummary,
} from '@/server/dal/trade-calendar';
import {
  getTradeCreateOptions,
  getWorkspaceTradeDetail,
  listWorkspaceTrades,
} from '@/server/dal/trades';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { TradesJournal } from '@/components/trades/trades-journal';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type SearchValue = string | string[] | undefined;
type PageSearchParams = {
  trade?: SearchValue;
  cursor?: SearchValue;
  trail?: SearchValue;
  month?: SearchValue;
  date?: SearchValue;
  view?: SearchValue;
  attention?: SearchValue;
};

const TRADE_LOG_PAGE_SIZE = 10;

const DATE_LOCALE: Record<string, string> = { en: 'en-GB', th: 'th' };
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function singleSearchValue(value: SearchValue): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'trades' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/trades'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/trades'),
    },
  };
}

export default async function TradesPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  const tradeParam = singleSearchValue(query.trade);
  const cursor = singleSearchValue(query.cursor);
  const trail = singleSearchValue(query.trail) ?? '';
  const monthParam = singleSearchValue(query.month);
  const dateParam = singleSearchValue(query.date);
  const view = parseTradesView(query.view);
  const attention = view === 'log' ? parseTradesAttention(query.attention) : null;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('trades');

  // Timezone must be known before any Calendar/Log date-range resolution —
  // fetched first, on its own, rather than inside the batched Promise.all
  // below (CLAUDE.md §7: never bucket by a naive UTC day).
  const preferences = await getCurrentUserPreferences();
  const timezone = preferences.timezone;

  const todayResult = calendarDateIn(new Date(), timezone);
  const todayDate = todayResult.ok ? todayResult.value : '1970-01-01';
  const [todayYear, todayMonthNum] = todayDate.split('-').map(Number) as [number, number];

  const monthMatch = monthParam === undefined ? null : MONTH_PATTERN.exec(monthParam);
  const year = monthMatch ? Number(monthMatch[1]) : todayYear;
  const month = monthMatch ? Number(monthMatch[2]) : todayMonthNum;
  const monthRangeResult =
    month >= 1 && month <= 12 ? monthRangeIn(year, month, timezone) : { ok: false as const };
  // An invalid month (out-of-range, or a resolution failure) falls back to
  // the current local month rather than ever crashing the page.
  const resolvedYear = monthRangeResult.ok ? year : todayYear;
  const resolvedMonth = monthRangeResult.ok ? month : todayMonthNum;
  const resolvedMonthRange = monthRangeResult.ok
    ? monthRangeResult.value
    : (() => {
        const fallback = monthRangeIn(todayYear, todayMonthNum, timezone);
        if (!fallback.ok) throw new Error('trades page: month bounds resolution failed for today');
        return fallback.value;
      })();

  const selectedDate = dateParam !== undefined && DATE_PATTERN.test(dateParam) ? dateParam : null;
  const selectedDayRange = selectedDate === null ? null : dayRangeIn(selectedDate, timezone);
  const journalDateRange =
    selectedDayRange !== null && selectedDayRange.ok ? selectedDayRange.value : undefined;

  const [page, entitlement, createOptions, calendarMonth, daySummary] = await Promise.all([
    listWorkspaceTrades({
      cursor: cursor ?? null,
      limit: TRADE_LOG_PAGE_SIZE,
      ...(journalDateRange === undefined ? {} : { journalDateRange }),
      // One bucket, filtered by the same predicate the Dashboard panel
      // counted it with. It used to be spelled out here as
      // `systemStatus: pending`, which is how a fifth bucket could be added
      // to the counts with nothing to list it.
      ...(attention === null ? {} : { attention }),
    }),
    getWorkspaceEntitlement(),
    getTradeCreateOptions(),
    getWorkspaceTradeCalendarMonth({
      year: resolvedYear,
      month: resolvedMonth,
      timezone,
      monthRange: resolvedMonthRange,
    }),
    journalDateRange === undefined
      ? Promise.resolve(null)
      : getWorkspaceTradeDaySummary({ dayRange: journalDateRange }),
  ]);
  const parsedTradeId = tradeParam === undefined ? null : TradeIdSchema.safeParse(tradeParam);
  const requestedTradeId =
    parsedTradeId !== null && parsedTradeId.success ? parsedTradeId.data : null;
  const detailResult =
    requestedTradeId === null ? null : await getWorkspaceTradeDetail(requestedTradeId);
  const selectedTradeCandidate =
    detailResult !== null && detailResult.ok ? detailResult.trade : null;
  const selectedTrade =
    attention === 'system-pending' && selectedTradeCandidate?.systemStatus !== 'pending'
      ? null
      : selectedTradeCandidate;
  const writeAuthorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');
  const dateLocale = DATE_LOCALE[locale] ?? 'en-GB';
  const trades = page.items.map((trade) => ({
    ...trade,
    occurredAtDisplay:
      formatTradeInstant(trade.occurredAt, preferences.timezone, dateLocale) ?? '—',
  }));

  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          writeAuthorization.allowed && (page.items.length > 0 || selectedDate !== null) ? (
            <Button asChild>
              <Link href="/app/trades/new">
                <Plus aria-hidden="true" />
                {t('logTrade')}
              </Link>
            </Button>
          ) : null
        }
      />
      <TradesJournal
        view={view}
        attention={attention}
        trades={trades}
        nextCursor={page.nextCursor}
        currentCursor={cursor ?? null}
        cursorTrail={trail}
        selectedTrade={selectedTrade}
        selectedTradeId={selectedTrade?.tradeId ?? null}
        canWrite={writeAuthorization.allowed}
        writeBlockReason={writeAuthorization.allowed ? null : writeAuthorization.code}
        timezone={preferences.timezone}
        locale={dateLocale}
        classificationOptions={createOptions.strategies}
        calendar={{
          year: resolvedYear,
          month: resolvedMonth,
          todayDate,
          selectedDate,
          trader: calendarMonth.trader,
          system: calendarMonth.system,
          traderTotalR: calendarMonth.traderTotalR,
          systemTotalR: calendarMonth.systemTotalR,
          tradingDays: calendarMonth.tradingDays,
          daySummary,
        }}
      />
    </Container>
  );
}
