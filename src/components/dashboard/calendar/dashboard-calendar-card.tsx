import { CalendarRange } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { CalendarMode, CalendarMonthModel } from '@/lib/dashboard/calendar';
import {
  buildCalendarGrid,
  CALENDAR_WEEKDAY_KEYS,
  type CalendarGridCell,
} from '@/lib/dashboard/calendar-grid';
import {
  CALENDAR_MODE_ORDER,
  calendarDayClassificationKey,
  calendarDayPrimaryR,
  calendarDayTone,
  calendarDayTradeCount,
  calendarMonthDays,
} from '@/lib/dashboard/calendar-presentation';
import { dashboardLayoutItem, dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { DashboardStateLink } from '@/components/dashboard/dashboard-state-link';
import { MetricInfo } from '@/components/dashboard/kpi/metric-info';
import { Card } from '@/components/ui/card';

const LAYOUT = dashboardLayoutItem('calendar.performance');

/**
 * Every link this card renders, built by the caller.
 *
 * The hrefs come from `serializeCalendarState` on the server, which is what
 * guarantees that changing mode, paging the month or opening a day never
 * drops the Dashboard's Account/Strategy/Setup/range scope. Handing them in
 * as strings keeps this component free of the filter and navigation modules
 * entirely — it cannot construct a URL, so it cannot construct a wrong one.
 */
export interface DashboardCalendarHrefs {
  readonly modes: Readonly<Record<CalendarMode, string>>;
  readonly previousMonth: string;
  readonly nextMonth: string;
  /** `null` when the grid is already showing the month containing today. */
  readonly currentMonth: string | null;
  /** Populated dates only — a date with nothing eligible is not a link. */
  readonly days: Readonly<Record<string, string>>;
}

export interface DashboardCalendarCardProps {
  readonly month: CalendarMonthModel;
  readonly mode: CalendarMode;
  readonly year: number;
  readonly monthNumber: number;
  /** The local date in the WORKSPACE's timezone, resolved server-side. */
  readonly todayDate: string | null;
  readonly selectedDate: string | null;
  readonly dateLocale: string;
  readonly hrefs: DashboardCalendarHrefs;
  readonly className?: string;
}

/**
 * D6B — the Dashboard Calendar.
 *
 * ONE IMPLEMENTATION, THREE MODES. The mode selects which population and
 * which date axis D6A composed the month from (Actual on `exited_at`, System
 * on `system_exited_at`, Gap on Population C anchored to `exited_at`); it
 * does not select a second component. The three are not a display toggle over
 * one dataset, so the card states which question it is answering underneath
 * the control rather than letting one grid imply the three share a Trade
 * universe.
 *
 * Server-driven, like every other Dashboard widget: it receives a composed
 * `CalendarMonthModel` and a set of hrefs, fetches nothing, and calculates
 * nothing. Every figure in every square was rounded once, server-side, by the
 * calc engine.
 */
export function DashboardCalendarCard({
  month,
  mode,
  year,
  monthNumber,
  todayDate,
  selectedDate,
  dateLocale,
  hrefs,
  className,
}: DashboardCalendarCardProps) {
  const t = useTranslations('dashboard.calendar');
  const headingId = 'dashboard-calendar-heading';

  const days = calendarMonthDays(month);
  const grid = buildCalendarGrid({ year, month: monthNumber, days, todayDate, selectedDate });
  const monthLabel = formatMonthLabel(year, monthNumber, dateLocale);

  return (
    <section
      {...dashboardWidgetAttributes(LAYOUT)}
      aria-labelledby={headingId}
      data-calendar-mode={mode}
      data-calendar-month={monthKey(year, monthNumber)}
      data-calendar-status={month.status}
      className={cn('min-w-0', className)}
    >
      <Card
        data-dashboard-panel="calendar"
        className="@container/calendar flex h-full min-w-0 flex-col gap-4 p-3 sm:p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-primary/10 text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg">
              <CalendarRange className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id={headingId} className="text-card-title">
                {t('title')}
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm leading-snug text-pretty">
                {t(`modeDescription.${mode}`)}
              </p>
            </div>
          </div>
          <MetricInfo triggerLabel={t('infoTrigger')} title={t('title')}>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{t('help')}</p>
          </MetricInfo>
        </div>

        <CalendarModeControl mode={mode} hrefs={hrefs} />

        <CalendarMonthNav
          monthLabel={monthLabel}
          previousHref={hrefs.previousMonth}
          nextHref={hrefs.nextMonth}
          currentHref={hrefs.currentMonth}
        />

        {month.status === 'error' ? (
          <CalendarStateBlock tone="error" title={t('states.errorTitle')}>
            {t('states.errorDescription')}
          </CalendarStateBlock>
        ) : month.status === 'empty' ? (
          <CalendarStateBlock tone="empty" title={t('states.emptyTitle')}>
            {t(`states.emptyDescription.${mode}`)}
          </CalendarStateBlock>
        ) : (
          <>
            <CalendarMonthSummary month={month} mode={mode} />
            <CalendarGridView
              cells={grid.cells}
              dateLocale={dateLocale}
              hrefs={hrefs}
              populatedDayCount={days.length}
            />
          </>
        )}
      </Card>
    </section>
  );
}

/**
 * Mode is chosen with LINKS, not a client toggle.
 *
 * The Phase 14D calendar kept its axis in a `useState`, so a refresh silently
 * reset it and a shared link never carried it. Here the mode is a URL
 * parameter and each option is an ordinary navigation, which makes deep
 * linking, Back and refresh work with no history code at all — and keeps the
 * whole card renderable on the server.
 */
function CalendarModeControl({
  mode,
  hrefs,
}: {
  mode: CalendarMode;
  hrefs: DashboardCalendarHrefs;
}) {
  const t = useTranslations('dashboard.calendar');
  return (
    <nav aria-label={t('modeLegend')} data-calendar-mode-control="">
      <div className="border-border bg-background flex min-w-0 rounded-lg border p-1">
        {CALENDAR_MODE_ORDER.map((candidate) => (
          <DashboardStateLink
            key={candidate}
            href={hrefs.modes[candidate]}
            data-calendar-mode-option={candidate}
            aria-current={candidate === mode ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring inline-flex min-h-10 min-w-0 flex-1 items-center justify-center truncate rounded-md px-2 text-sm font-medium outline-none focus-visible:ring-2',
              candidate === mode
                ? 'bg-surface-raised text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`mode.${candidate}`)}
          </DashboardStateLink>
        ))}
      </div>
    </nav>
  );
}

function CalendarMonthNav({
  monthLabel,
  previousHref,
  nextHref,
  currentHref,
}: {
  monthLabel: string;
  previousHref: string;
  nextHref: string;
  currentHref: string | null;
}) {
  const t = useTranslations('dashboard.calendar');
  return (
    <nav
      aria-label={t('monthNavLabel')}
      className="flex min-w-0 items-center justify-between gap-2"
    >
      <DashboardStateLink
        href={previousHref}
        data-calendar-nav="previous"
        aria-label={t('previousMonth')}
        className="hover:bg-accent focus-visible:ring-ring inline-flex size-10 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
      >
        <span aria-hidden="true">&lsaquo;</span>
      </DashboardStateLink>
      <span
        data-calendar-month-label=""
        className="numeric min-w-0 truncate text-center text-sm font-semibold"
        aria-live="polite"
      >
        {monthLabel}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        {currentHref === null ? null : (
          <DashboardStateLink
            href={currentHref}
            data-calendar-nav="current"
            className="text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:ring-ring inline-flex min-h-10 items-center rounded-md px-2 text-xs font-medium outline-none focus-visible:ring-2"
          >
            {t('thisMonth')}
          </DashboardStateLink>
        )}
        <DashboardStateLink
          href={nextHref}
          data-calendar-nav="next"
          aria-label={t('nextMonth')}
          className="hover:bg-accent focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-2"
        >
          <span aria-hidden="true">&rsaquo;</span>
        </DashboardStateLink>
      </div>
    </nav>
  );
}

function CalendarMonthSummary({
  month,
  mode,
}: {
  month: Extract<CalendarMonthModel, { status: 'available' }>;
  mode: CalendarMode;
}) {
  const t = useTranslations('dashboard.calendar');
  const total = formatAnalyticsMetric({ status: 'available', value: month.totals.totalR }, 'r');
  return (
    <dl
      data-calendar-summary=""
      className="text-muted-foreground flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-xs"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="uppercase">{t(`summary.total.${mode}`)}</dt>
        <dd
          data-calendar-summary-total=""
          className={cn(
            'numeric text-base leading-6 font-semibold',
            total.status === 'available' && total.tone === 'positive' && 'text-positive',
            total.status === 'available' && total.tone === 'negative' && 'text-negative',
            total.status === 'available' && total.tone === 'neutral' && 'text-foreground',
          )}
        >
          {total.status === 'available' ? total.text : t('notAvailableShort')}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="uppercase">{t('summary.days')}</dt>
        <dd className="numeric text-foreground text-base leading-6 font-semibold">
          {month.totals.populatedDayCount}
        </dd>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="uppercase">
          {t(`summary.trades.${mode === 'gap' ? 'paired' : 'eligible'}`)}
        </dt>
        <dd className="numeric text-foreground text-base leading-6 font-semibold">
          {month.totals.eligibleTradeCount}
        </dd>
      </div>
    </dl>
  );
}

function CalendarGridView({
  cells,
  dateLocale,
  hrefs,
  populatedDayCount,
}: {
  cells: readonly (CalendarGridCell | null)[];
  dateLocale: string;
  hrefs: DashboardCalendarHrefs;
  populatedDayCount: number;
}) {
  const t = useTranslations('dashboard.calendar');
  const totalDateCount = cells.filter((cell) => cell !== null).length;
  return (
    <div className="min-w-0">
      {/*
        The blank squares are decorative: they carry no result, and announcing
        twenty bare numbers ahead of each populated day would bury the days
        that matter. This one sentence says what the grid contains instead,
        and every populated cell then carries its own full summary.
      */}
      <p className="sr-only">
        {t('gridSummary', { populated: populatedDayCount, total: totalDateCount })}
      </p>
      <div className="grid grid-cols-7 gap-0.5 @[22rem]/calendar:gap-1" data-calendar-grid="">
        {CALENDAR_WEEKDAY_KEYS.map((key) => (
          <div
            key={key}
            aria-hidden="true"
            className="text-subtle-foreground pb-1 text-center text-[11px] font-medium"
          >
            {t(`weekday.${key}`)}
          </div>
        ))}
        {cells.map((cell, index) =>
          cell === null ? (
            <div key={`blank-${index}`} aria-hidden="true" />
          ) : (
            <CalendarCell
              key={cell.date}
              cell={cell}
              dateLocale={dateLocale}
              href={hrefs.days[cell.date] ?? null}
            />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * One square.
 *
 * A date with no eligible Trades renders as an ordinary, quiet month-grid
 * cell — NOT as a 0R performance day. That difference is the whole point of
 * D6A's sparse days: an eligible day that happened to total 0.00R shows its
 * zero, its Trade count and a neutral tone, while a day with nothing eligible
 * shows only its date and is not clickable at all. Collapsing the two would
 * put roughly three hundred invented flat days a year on screen.
 */
function CalendarCell({
  cell,
  dateLocale,
  href,
}: {
  cell: CalendarGridCell;
  dateLocale: string;
  href: string | null;
}) {
  const t = useTranslations('dashboard.calendar');

  if (cell.day === null || href === null) {
    return (
      <div
        data-calendar-cell="empty"
        data-calendar-date={cell.date}
        aria-hidden="true"
        className={cn(
          'flex min-h-13 flex-col rounded-md border border-transparent px-0.5 py-1 @[22rem]/calendar:px-1',
          cell.isToday && 'border-border border-dashed',
        )}
      >
        <span className="numeric text-subtle-foreground text-[11px] leading-4">
          {cell.dayOfMonth}
        </span>
      </div>
    );
  }

  const day = cell.day;
  const tone = calendarDayTone(day);
  const formatted = formatAnalyticsMetric(
    { status: 'available', value: calendarDayPrimaryR(day) },
    'r',
  );
  const count = calendarDayTradeCount(day);
  const rText = formatted.status === 'available' ? formatted.text : t('notAvailableShort');
  const dateLabel = formatFullDate(cell.date, dateLocale);

  const summary =
    day.mode === 'gap'
      ? t('cellSummary.gap', { date: dateLabel, gap: rText, paired: count })
      : t('cellSummary.performance', {
          date: dateLabel,
          total: rText,
          trades: count,
          wins: day.wins,
          breakEvens: day.breakEvens,
          losses: day.losses,
        });

  return (
    <DashboardStateLink
      href={href}
      data-calendar-cell="populated"
      data-calendar-date={cell.date}
      data-calendar-tone={tone}
      aria-current={cell.isSelected ? 'page' : undefined}
      aria-label={[
        summary,
        t(`classification.${calendarDayClassificationKey(day)}`),
        cell.isToday ? t('today') : null,
      ]
        .filter((part) => part !== null)
        .join(' ')}
      className={cn(
        'focus-visible:ring-ring flex min-h-13 min-w-0 flex-col justify-between rounded-md border px-0.5 py-1 transition-colors outline-none focus-visible:ring-2 @[22rem]/calendar:px-1',
        // Restrained by design: a tint, a border and an emphasised value —
        // never a saturated block. A profitable month should not read as a
        // wall of green, and the sign is always present in the text itself,
        // so colour reinforces the direction and never carries it alone.
        tone === 'positive' && 'border-positive/35 bg-positive/8 hover:bg-positive/15',
        tone === 'negative' && 'border-negative/35 bg-negative/8 hover:bg-negative/15',
        tone === 'neutral' && 'border-border bg-muted/40 hover:bg-muted/70',
        cell.isSelected && 'ring-primary ring-2',
        cell.isToday && !cell.isSelected && 'border-primary/60',
      )}
    >
      <span className="numeric text-muted-foreground text-[11px] leading-4" aria-hidden="true">
        {cell.dayOfMonth}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'numeric text-[11px] leading-4 font-semibold @[22rem]/calendar:text-[13px]',
          tone === 'positive' && 'text-positive',
          tone === 'negative' && 'text-negative',
          tone === 'neutral' && 'text-foreground',
        )}
      >
        {/*
          §24 — when the column narrows, the trailing unit is the first thing
          to go, because it is the least informative glyph in the square. The
          date and the figure itself never shrink into an ellipsis, and the
          accessible name always carries the full signed R value.
        */}
        <span className="@[22rem]/calendar:hidden">{rText.replace(/R$/, '')}</span>
        <span className="hidden @[22rem]/calendar:inline">{rText}</span>
      </span>
      {/*
        Secondary detail appears on the WIDGET's own width, not the viewport's:
        this card is five of twelve columns, so a 1280px page and a 1920px page
        give it very different room. Below the threshold the W/BE/L line is the
        first thing dropped — the date and the R value never shrink.
      */}
      <span
        aria-hidden="true"
        className="text-muted-foreground hidden truncate text-[10px] leading-4 @[23rem]/calendar:block"
      >
        {day.mode === 'gap'
          ? t('cellSecondary.gap', { paired: count })
          : t('cellSecondary.performance', {
              wins: day.wins,
              breakEvens: day.breakEvens,
              losses: day.losses,
            })}
      </span>
    </DashboardStateLink>
  );
}

function CalendarStateBlock({
  tone,
  title,
  children,
}: {
  tone: 'empty' | 'error';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-calendar-state={tone}
      {...(tone === 'error' ? { role: 'alert' as const } : {})}
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-lg border border-dashed p-4',
        tone === 'error' ? 'border-destructive/40' : 'border-border',
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>
    </div>
  );
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * `timeZone: 'UTC'` on a date-only value is not a timezone decision — it stops
 * `Intl` re-interpreting the midnight the string parses to in the SERVER's
 * zone and shifting the label back a day. `calendar: 'gregory'` is explicit
 * because `th`'s default Buddhist era would render 2026 as 2569 and silently
 * disagree with every stored year in the product.
 */
function formatMonthLabel(year: number, month: number, locale: string): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    calendar: 'gregory',
  });
}

function formatFullDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
    calendar: 'gregory',
  });
}
