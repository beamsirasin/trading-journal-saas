'use client';

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { AnalyticsCustomDateRange, AnalyticsDatePreset } from '@/lib/analytics/filters';
import { shiftCalendarMonth } from '@/lib/dashboard/calendar-grid';
import {
  buildDateRangePickerMonth,
  resolveDateRangePickerMonths,
  type DateRangePickerMonthPair,
} from '@/lib/dashboard/date-range-calendar';
import {
  applyDashboardDateRangeDraft,
  clearDashboardDateRangeDraft,
  createDashboardDateRangeDraft,
  selectDashboardCustomDate,
  selectDashboardDatePreset,
  type DashboardDateRangeDraft,
} from '@/lib/dashboard/date-range-draft';
import {
  DASHBOARD_DATE_PRESET_ORDER,
  describeAppliedDateRange,
  formatCalendarDateLabel,
  formatCalendarDateRangeLabel,
  formatCalendarMonthLabel,
  summarizeDraftDates,
  type DashboardDatePresetOption,
  type DashboardDateRangeSummary,
} from '@/lib/dashboard/date-range-presentation';
import {
  buildDashboardHref,
  type DashboardFilterState,
  type DashboardHrefOptions,
} from '@/lib/dashboard/filters';
import { cn } from '@/lib/utils';
import { useDashboardStateNavigation } from '@/components/dashboard/dashboard-state-link';
import { Button } from '@/components/ui/button';

import { DateRangeMonthGrid } from './date-range-month-grid';
import { ToolbarDisclosure } from './toolbar-disclosure';
import { ToolbarTrigger } from './toolbar-trigger';

/**
 * The Dashboard's ONE visible Date Range owner.
 *
 * DRAFT IS NOT APPLIED STATE. Everything a reader touches inside the panel —
 * presets, calendar clicks, Clear, month paging — edits a local draft and
 * issues no query, no navigation and no fetch. Apply is the single transition
 * and it happens exactly once per press. That separation is the frozen
 * contract's, not this component's invention: every draft reducer lives in
 * `date-range-draft.ts` and is unit-tested there, so the picker cannot quietly
 * grow a second opinion about what a second click means.
 *
 * TRANSPORT-INDEPENDENT BY CONSTRUCTION. Apply builds a canonical href with
 * `buildDashboardHref` and hands it to `useDashboardStateNavigation`. There is
 * no `window.location`, no `router.push` and no raw anchor anywhere in this
 * subtree, so when a patched Next release makes soft navigation safe again the
 * transport swap happens inside that one hook and nothing here changes.
 */
export function DashboardDateRangeControl({
  filters,
  todayDate,
  dateLocale,
  href,
  className,
}: {
  filters: DashboardFilterState;
  /** The reader's local today in the persisted analytics timezone, resolved server-side. */
  todayDate: string;
  dateLocale: string;
  /**
   * Where this control's transitions land, and what non-filter page state
   * rides along. Omitted on the Dashboard, which keeps the `/app` default.
   */
  href?: DashboardHrefOptions;
  className?: string;
}) {
  const t = useTranslations('dashboard.toolbar.dateRange');
  const navigate = useDashboardStateNavigation();

  const applied = { datePreset: filters.datePreset, customDateRange: filters.customDateRange };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardDateRangeDraft>(() =>
    createDashboardDateRangeDraft(applied),
  );
  const [months, setMonths] = useState<DateRangePickerMonthPair>(() =>
    resolveDateRangePickerMonths(createDashboardDateRangeDraft(applied), todayDate),
  );

  /*
    Opening COPIES applied into draft; closing simply discards whatever the
    draft became. Re-seeding on OPEN rather than on close is what makes
    dismissal — Escape, outside click, the sheet's close button — cancel for
    free, with no separate cancel path that could drift out of agreement with
    it.
  */
  function handleOpenChange(next: boolean) {
    if (next) {
      const seeded = createDashboardDateRangeDraft(applied);
      setDraft(seeded);
      setMonths(resolveDateRangePickerMonths(seeded, todayDate));
    }
    setOpen(next);
  }

  function pageMonths(delta: number) {
    setMonths((current) => {
      const left = shiftCalendarMonth(current.left.year, current.left.month, delta);
      return { left, right: shiftCalendarMonth(left.year, left.month, 1) };
    });
  }

  const applyResult = applyDashboardDateRangeDraft(draft);

  function handleApply() {
    if (!applyResult.ok) return;
    setOpen(false);
    // ONE transition, through the canonical serializer, so Account, Strategy,
    // Setup, Version and unit ride along untouched.
    navigate(
      buildDashboardHref(
        {
          ...filters,
          datePreset: applyResult.applied.datePreset,
          customDateRange: applyResult.applied.customDateRange,
        },
        href,
      ),
    );
  }

  const appliedLabel = useAppliedRangeLabel(applied, dateLocale);

  return (
    <ToolbarDisclosure
      open={open}
      onOpenChange={handleOpenChange}
      title={t('title')}
      popoverClassName="w-[43rem]"
      trigger={
        <ToolbarTrigger
          data-dashboard-toolbar-control="date-range"
          aria-label={t('triggerLabel', { range: appliedLabel })}
          className={className}
          icon={<CalendarDays className="size-4" aria-hidden="true" />}
        >
          {appliedLabel}
        </ToolbarTrigger>
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-dashboard-toolbar-clear="date-range"
            onClick={() => setDraft(clearDashboardDateRangeDraft())}
          >
            {t('clear')}
          </Button>
          <Button
            type="button"
            size="sm"
            data-dashboard-toolbar-apply="date-range"
            disabled={!applyResult.ok}
            onClick={handleApply}
          >
            {t('apply')}
          </Button>
        </div>
      }
    >
      <DateRangePickerBody
        draft={draft}
        months={months}
        todayDate={todayDate}
        dateLocale={dateLocale}
        onSelectDate={(date) => setDraft(selectDashboardCustomDate(draft, date))}
        onSelectPreset={(preset) => setDraft(selectDashboardDatePreset(draft, preset))}
        onPageMonths={pageMonths}
      />
    </ToolbarDisclosure>
  );
}

/** The applied state, in words, for the toolbar button and its accessible name. */
function useAppliedRangeLabel(
  applied: {
    readonly datePreset: AnalyticsDatePreset;
    readonly customDateRange: AnalyticsCustomDateRange | null;
  },
  dateLocale: string,
): string {
  const t = useTranslations('dashboard.toolbar.dateRange');
  const description = describeAppliedDateRange(applied);
  if (description.kind === 'custom') {
    return (
      formatCalendarDateRangeLabel(description.from, description.to, dateLocale) ?? t('presets.all')
    );
  }
  // An applied range is always complete — the URL parser rejects a half
  // custom range — so `custom-pending` cannot reach the button. Falling back
  // to the unbounded label rather than throwing keeps a hypothetical future
  // preset from taking the toolbar down with it.
  return description.kind === 'preset' ? t(`presets.${description.preset}`) : t('presets.all');
}

/**
 * The panel body, identical in the desktop popover and the mobile sheet.
 *
 * Composition differs only through Tailwind: the preset list is a column
 * beside the calendars above `md` and a wrapping chip row below it, and the
 * two months sit side by side above `md` and stack below. Nothing is
 * duplicated and nothing is shrunk — the mobile sheet is TALLER than the
 * popover, not smaller, which is the whole reason it is a sheet.
 */
function DateRangePickerBody({
  draft,
  months,
  todayDate,
  dateLocale,
  onSelectDate,
  onSelectPreset,
  onPageMonths,
}: {
  draft: DashboardDateRangeDraft;
  months: DateRangePickerMonthPair;
  todayDate: string;
  dateLocale: string;
  onSelectDate: (date: string) => void;
  onSelectPreset: (preset: DashboardDatePresetOption) => void;
  onPageMonths: (delta: number) => void;
}) {
  const t = useTranslations('dashboard.toolbar.dateRange');
  const summary = summarizeDraftDates(draft, todayDate);

  const grids = [months.left, months.right].map((month) =>
    buildDateRangePickerMonth({
      year: month.year,
      month: month.month,
      draft,
      todayDate,
      // Every canonical preset is period-to-date and no Trade can be recorded
      // in the future, so a future date is offered but never selectable.
      maxDate: todayDate,
    }),
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DraftSummary summary={summary} dateLocale={dateLocale} />

      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:gap-5">
        <div className="min-w-0 flex-1">
          <nav
            aria-label={t('monthNavLabel')}
            className="mb-1 flex items-center justify-between gap-2"
          >
            <MonthPageButton
              direction="previous"
              label={t('previousMonth')}
              onClick={() => onPageMonths(-1)}
            />
            <MonthPageButton
              direction="next"
              label={t('nextMonth')}
              onClick={() => onPageMonths(1)}
            />
          </nav>
          <div className="grid min-w-0 gap-5 md:grid-cols-2">
            {grids.map((grid) => (
              <DateRangeMonthGrid
                key={`${grid.year}-${grid.month}`}
                month={grid}
                monthLabel={formatCalendarMonthLabel(grid.year, grid.month, dateLocale)}
                onSelect={onSelectDate}
                dateLocale={dateLocale}
              />
            ))}
          </div>
        </div>

        <PresetList draft={draft} onSelectPreset={onSelectPreset} />
      </div>
    </div>
  );
}

function MonthPageButton({
  direction,
  label,
  onClick,
}: {
  direction: 'previous' | 'next';
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      data-range-month-nav={direction}
      aria-label={label}
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring inline-flex size-9 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * Start and end, spelled out, before anything else in the panel — and spelled
 * out for PRESETS too, not only for custom ranges. "Last 90 days" is a claim
 * about two specific dates, and a picker that will not say which two is asking
 * to be trusted rather than read. The dates come from the canonical preset
 * arithmetic, so they are the same two the server will bound the query with.
 *
 * The pending state is a real message rather than an em dash: a reader who has
 * clicked one date needs to be told the picker is waiting for a second one —
 * the same thing Apply's disabled state is saying, said in words.
 */
function DraftSummary({
  summary,
  dateLocale,
}: {
  summary: DashboardDateRangeSummary;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.toolbar.dateRange');

  const start =
    summary.kind === 'bounded'
      ? formatCalendarDateLabel(summary.from, dateLocale)
      : summary.kind === 'pending' && summary.from !== null
        ? formatCalendarDateLabel(summary.from, dateLocale)
        : null;
  const end = summary.kind === 'bounded' ? formatCalendarDateLabel(summary.to, dateLocale) : null;

  return (
    <div
      data-range-summary={summary.kind}
      className="border-border bg-secondary/50 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2.5"
    >
      {summary.kind === 'all' ? (
        <p className="text-foreground min-w-0 text-sm font-medium">{t('presets.all')}</p>
      ) : (
        <>
          <SummaryEndpoint label={t('startDate')} value={start} />
          <span aria-hidden="true" className="text-subtle-foreground shrink-0 text-sm">
            &rarr;
          </span>
          <SummaryEndpoint label={t('endDate')} value={end} pending={summary.kind === 'pending'} />
        </>
      )}
      {summary.kind === 'pending' ? (
        <p role="status" className="text-muted-foreground w-full text-xs leading-snug">
          {t('pendingEndDate')}
        </p>
      ) : null}
    </div>
  );
}

function SummaryEndpoint({
  label,
  value,
  pending = false,
}: {
  label: string;
  value: string | null;
  pending?: boolean;
}) {
  const t = useTranslations('dashboard.toolbar.dateRange');
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-subtle-foreground text-label uppercase">{label}</span>
      <span
        className={cn(
          'numeric truncate text-sm font-medium',
          value === null ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {value ?? (pending ? t('selectEndDate') : '—')}
      </span>
    </div>
  );
}

/**
 * Quick presets edit the DRAFT and nothing else.
 *
 * `aria-pressed`, not `aria-current`: nothing has navigated, and announcing
 * "current page" for a range the Dashboard has not adopted yet would tell a
 * screen reader user the opposite of what Apply is for.
 */
function PresetList({
  draft,
  onSelectPreset,
}: {
  draft: DashboardDateRangeDraft;
  onSelectPreset: (preset: DashboardDatePresetOption) => void;
}) {
  const t = useTranslations('dashboard.toolbar.dateRange');
  return (
    <div
      role="group"
      aria-label={t('presetsLabel')}
      className="border-border flex min-w-0 shrink-0 flex-wrap gap-1.5 md:w-40 md:flex-col md:flex-nowrap md:gap-0.5 md:border-l md:pt-10 md:pl-4"
    >
      {DASHBOARD_DATE_PRESET_ORDER.map((preset) => {
        const isSelected = draft.datePreset === preset;
        return (
          <button
            key={preset}
            type="button"
            data-range-preset={preset}
            aria-pressed={isSelected}
            onClick={() => onSelectPreset(preset)}
            className={cn(
              'focus-visible:ring-ring inline-flex min-h-9 items-center rounded-md px-3 text-sm outline-none focus-visible:ring-2 md:w-full md:justify-start',
              isSelected
                ? 'bg-secondary text-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {t(`presets.${preset}`)}
          </button>
        );
      })}
    </div>
  );
}
