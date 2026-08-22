'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { daysInMonth } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { TradeCalendarDayBucket, WorkspaceTradeDaySummary } from '@/server/dal/trade-calendar';
import { formatR } from '@/components/trades/trade-format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Link, useRouter } from '@/i18n/navigation';

type Axis = 'trader' | 'system';

export interface TradingCalendarProps {
  readonly year: number;
  readonly month: number; // 1-12
  /** BCP 47 locale, e.g. `'en-GB'`/`'th'` — matches `TradeDetail`'s own `locale` prop exactly. */
  readonly locale: string;
  /** `YYYY-MM-DD` in the workspace's persisted IANA timezone — computed server-side, never `new Date()` client-side. */
  readonly todayDate: string;
  readonly selectedDate: string | null;
  readonly trader: readonly TradeCalendarDayBucket[];
  readonly system: readonly TradeCalendarDayBucket[];
  readonly traderTotalR: string | null;
  readonly systemTotalR: string | null;
  readonly tradingDays: number;
  readonly daySummary: WorkspaceTradeDaySummary | null;
}

function monthQuery(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function shiftMonth(year: number, month: number, delta: 1 | -1): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.trunc(total / 12), month: (((total % 12) + 12) % 12) + 1 };
}

/**
 * Journal navigation, not another Analytics page (Phase 14D). Deliberately
 * omits Expectancy/Profit Factor/Max Drawdown and every other Analytics KPI
 * — those stay in `/app/analytics`. Trader and System are independent axes
 * (CLAUDE.md §1): the toggle changes which axis's R/count values the grid
 * shows, never which Trades the Trade Log below contains (that filter is
 * always the same journal-chronology date — see `page.tsx`).
 */
export function TradingCalendar({
  year,
  month,
  locale,
  todayDate,
  selectedDate,
  trader,
  system,
  traderTotalR,
  systemTotalR,
  tradingDays,
  daySummary,
}: TradingCalendarProps) {
  const t = useTranslations('trades.calendar');
  const router = useRouter();
  const [axis, setAxis] = useState<Axis>('trader');

  const buckets = axis === 'trader' ? trader : system;
  const byDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));

  const totalDays = daysInMonth(year, month);
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // Sunday-first grid (`getUTCDay()`: 0 = Sunday) — the calendar date itself
  // never touches the user's timezone; only Trade buckets do.
  const leadingBlanks = firstOfMonth.getUTCDay();
  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => {
      const day = index + 1;
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }),
  ];

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    // Explicit Gregorian — `th`'s default Buddhist-era calendar (2026 →
    // 2569) would silently disagree with the storage model and every stored
    // year elsewhere in the product. Matches `src/lib/time/format.ts`'s
    // `formatInstant` exactly, for the same reason.
    calendar: 'gregory',
  });

  function selectDate(date: string) {
    const params = new URLSearchParams();
    params.set('view', 'log');
    params.set('month', monthQuery(year, month));
    params.set('date', date);
    router.push(`/app/trades?${params.toString()}`);
  }

  const weekdayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

  return (
    <Card data-testid="trading-calendar">
      <CardHeader className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('title')}</CardTitle>
          <SegmentedControl
            legend={t('axisLegend')}
            value={axis}
            onValueChange={setAxis}
            options={[
              { value: 'trader', label: t('axisTrader') },
              { value: 'system', label: t('axisSystem') },
            ]}
          />
        </div>
        <nav
          aria-label={t('monthNavLabel')}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-1">
            <Link
              href={`/app/trades?view=calendar&month=${monthQuery(prev.year, prev.month)}`}
              aria-label={t('previousMonth')}
              className="hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-md outline-none focus-visible:ring-2"
            >
              <span aria-hidden="true">‹</span>
            </Link>
            <span className="numeric min-w-36 text-center text-sm font-semibold" aria-live="polite">
              {monthLabel}
            </span>
            <Link
              href={`/app/trades?view=calendar&month=${monthQuery(next.year, next.month)}`}
              aria-label={t('nextMonth')}
              className="hover:bg-accent focus-visible:ring-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-md outline-none focus-visible:ring-2"
            >
              <span aria-hidden="true">›</span>
            </Link>
          </div>
          <Link href="/app/trades?view=calendar">
            <Button type="button" variant="outline" size="sm">
              {t('today')}
            </Button>
          </Link>
        </nav>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            {t('monthSummary.trader')}{' '}
            <span className="numeric text-foreground font-semibold">
              {traderTotalR === null ? t('noResults') : formatR(traderTotalR)}
            </span>
          </span>
          <span>
            {t('monthSummary.system')}{' '}
            <span className="numeric text-foreground font-semibold">
              {systemTotalR === null ? t('noResults') : formatR(systemTotalR)}
            </span>
          </span>
          <span>
            {t('monthSummary.tradingDays')}{' '}
            <span className="numeric text-foreground font-semibold">{tradingDays}</span>
          </span>
        </div>

        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {weekdayKeys.map((key) => (
            <div
              key={key}
              className="text-muted-foreground py-1 text-center text-xs font-medium"
              aria-hidden="true"
            >
              {t(`weekday.${key}`)}
            </div>
          ))}
          {cells.map((date, index) => {
            if (date === null) return <div key={`blank-${index}`} aria-hidden="true" />;
            const bucket = byDate.get(date);
            const isToday = date === todayDate;
            const isSelected = date === selectedDate;
            const day = Number(date.slice(-2));
            const rDisplay = bucket === undefined ? null : formatR(bucket.totalR);
            const tone =
              bucket === undefined
                ? 'text-muted-foreground'
                : bucket.totalR.startsWith('-')
                  ? 'text-destructive'
                  : Number(bucket.totalR) === 0
                    ? 'text-muted-foreground'
                    : 'text-positive';
            const fullDateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
              calendar: 'gregory',
            });
            const resultWord = axis === 'trader' ? t('a11yResultTrader') : t('a11yResultSystem');
            const countWord =
              axis === 'trader'
                ? t('a11yCountTrader', { count: bucket?.count ?? 0 })
                : t('a11yCountSystem', { count: bucket?.count ?? 0 });
            const a11yLabel =
              bucket === undefined
                ? t('a11yNoResults', { date: fullDateLabel })
                : t('a11yDaySummary', {
                    date: fullDateLabel,
                    resultWord,
                    r: rDisplay ?? '',
                    countWord,
                  });

            return (
              <button
                key={date}
                type="button"
                onClick={() => selectDate(date)}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={a11yLabel}
                data-calendar-day={date}
                className={cn(
                  'focus-visible:ring-ring flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 text-center transition-colors outline-none focus-visible:ring-2 sm:min-h-20',
                  isSelected
                    ? 'border-primary bg-primary/10 ring-primary ring-1'
                    : 'border-border hover:bg-accent',
                )}
              >
                <span
                  className={cn(
                    'numeric text-xs font-medium',
                    isToday ? 'text-primary font-bold' : 'text-muted-foreground',
                  )}
                >
                  {day}
                </span>
                {rDisplay === null ? null : (
                  <>
                    <span className={cn('numeric text-xs font-semibold sm:text-sm', tone)}>
                      {rDisplay}
                    </span>
                    <span className="text-muted-foreground text-[10px] sm:text-xs">
                      <span className="sm:hidden">{bucket?.count}</span>
                      <span className="hidden sm:inline">{countWord}</span>
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {selectedDate === null ? null : (
          <DaySummaryPanel
            date={selectedDate}
            locale={locale}
            summary={daySummary}
            onClear={() =>
              router.push(`/app/trades?view=calendar&month=${monthQuery(year, month)}`)
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

function DaySummaryPanel({
  date,
  locale,
  summary,
  onClear,
}: {
  readonly date: string;
  readonly locale: string;
  readonly summary: WorkspaceTradeDaySummary | null;
  readonly onClear: () => void;
}) {
  const t = useTranslations('trades.calendar');
  const dateLabel = new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    calendar: 'gregory',
  });

  return (
    <div
      className="border-border bg-muted/40 grid gap-3 rounded-lg border p-4"
      data-testid="calendar-day-summary"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{dateLabel}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {t('clearDate')}
        </Button>
      </div>
      {summary === null ? null : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">{t('daySummary.actualR')}</dt>
            <dd className="numeric font-semibold">
              {summary.actualR === null ? t('noResults') : formatR(summary.actualR)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('daySummary.systemR')}</dt>
            <dd className="numeric font-semibold">
              {summary.systemR === null ? t('noResults') : formatR(summary.systemR)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('daySummary.trades')}</dt>
            <dd className="numeric font-semibold">{summary.trades}</dd>
          </div>
          {summary.open === 0 ? null : (
            <div>
              <dt className="text-muted-foreground">{t('daySummary.open')}</dt>
              <dd className="numeric font-semibold">{summary.open}</dd>
            </div>
          )}
          {summary.pendingSystem === 0 ? null : (
            <div>
              <dt className="text-muted-foreground">{t('daySummary.pendingSystem')}</dt>
              <dd className="numeric font-semibold">{summary.pendingSystem}</dd>
            </div>
          )}
          {summary.unclassified === 0 ? null : (
            <div>
              <dt className="text-muted-foreground">{t('daySummary.unclassified')}</dt>
              <dd className="numeric font-semibold">{summary.unclassified}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
