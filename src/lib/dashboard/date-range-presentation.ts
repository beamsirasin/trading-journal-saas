import { resolveLocalDatePresetRange } from '@/lib/analytics/filters';
import { parseCalendarParts } from '@/lib/time';

import type { AppliedDashboardDateRange, DashboardDateRangeDraft } from './date-range-draft';

/**
 * THE TOOLBAR'S PRESET ORDER, AND ONLY THE TOOLBAR'S.
 *
 * `ANALYTICS_DATE_PRESETS` is the closed URL vocabulary and includes
 * `custom`; this is the quick-pick LIST a reader sees, which deliberately
 * does not. Custom is established by touching the calendar, not by pressing a
 * button that selects nothing — a "Custom" preset row would either be inert
 * or would have to invent a range on the reader's behalf.
 *
 * The order runs shortest-to-longest and then unbounded, so scanning down the
 * list widens the question monotonically.
 */
export const DASHBOARD_DATE_PRESET_ORDER = [
  'today',
  'week',
  'month',
  '30d',
  '90d',
  'quarter',
  'ytd',
  'all',
] as const;

export type DashboardDatePresetOption = (typeof DASHBOARD_DATE_PRESET_ORDER)[number];

/**
 * What a range IS, with no locale, no translation and no formatting attached.
 *
 * Presentation components turn this into words. Keeping the decision pure is
 * what lets the toolbar button, the picker summary and the tests all agree on
 * "this is an incomplete custom draft" without three separate opinions about
 * when a custom range counts as finished.
 */
export type DashboardDateRangeDescription =
  | { readonly kind: 'preset'; readonly preset: DashboardDatePresetOption }
  | { readonly kind: 'custom'; readonly from: string; readonly to: string }
  | { readonly kind: 'custom-pending'; readonly from: string | null };

function describe(
  preset: string,
  from: string | null,
  to: string | null,
): DashboardDateRangeDescription {
  if (preset !== 'custom') {
    // A preset outside the quick-pick list cannot occur through the parser,
    // but describing it as `all` rather than throwing keeps a future preset
    // from crashing a toolbar that has not learned its label yet.
    return DASHBOARD_DATE_PRESET_ORDER.includes(preset as DashboardDatePresetOption)
      ? { kind: 'preset', preset: preset as DashboardDatePresetOption }
      : { kind: 'preset', preset: 'all' };
  }
  if (from === null || to === null) return { kind: 'custom-pending', from };
  return { kind: 'custom', from, to };
}

/** The applied, URL-backed range. Always complete — the parser guarantees it. */
export function describeAppliedDateRange(
  applied: AppliedDashboardDateRange,
): DashboardDateRangeDescription {
  return describe(
    applied.datePreset,
    applied.customDateRange?.from ?? null,
    applied.customDateRange?.to ?? null,
  );
}

/** The open picker's temporary range, which may legitimately be half-finished. */
export function describeDraftDateRange(
  draft: DashboardDateRangeDraft,
): DashboardDateRangeDescription {
  return describe(draft.datePreset, draft.from, draft.to);
}

/**
 * A calendar date is a DATE, not an instant, so it is formatted at UTC noon
 * and read back in UTC. Formatting `2026-07-10` through the viewer's own zone
 * would render it as the 9th for anyone west of Greenwich — the exact class
 * of bug CLAUDE.md §7 exists to prevent, arriving through the presentation
 * layer instead of the query layer.
 */
function toUtcNoon(date: string): Date | null {
  const parts = parseCalendarParts(date);
  if (!parts.ok) return null;
  return new Date(Date.UTC(parts.value.year, parts.value.month - 1, parts.value.day, 12));
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
};

/** `Jul 10, 2026` in the reader's locale, or `null` for an unparseable date. */
export function formatCalendarDateLabel(date: string, locale: string): string | null {
  const instant = toUtcNoon(date);
  if (instant === null) return null;
  return new Intl.DateTimeFormat(locale, DATE_FORMAT).format(instant);
}

/**
 * `Jul 10 – Aug 12, 2026`, collapsing whatever the locale considers redundant
 * across the two endpoints.
 *
 * `formatRange` is what produces the shared-year form rather than a hand-rolled
 * "same year? drop the first year" rule that would be wrong in every locale
 * that orders the parts differently. It is guarded because the method is a
 * later addition to `Intl` than the formatter itself, and a toolbar label is
 * not worth a hard failure — the fallback simply spells both dates out.
 */
export function formatCalendarDateRangeLabel(
  from: string,
  to: string,
  locale: string,
): string | null {
  const start = toUtcNoon(from);
  const end = toUtcNoon(to);
  if (start === null || end === null) return null;
  const formatter = new Intl.DateTimeFormat(locale, DATE_FORMAT);
  if (typeof formatter.formatRange === 'function') {
    return formatter.formatRange(start, end);
  }
  return `${formatter.format(start)} – ${formatter.format(end)}`;
}

/** `July 2026` in the reader's locale — the heading over one picker month. */
export function formatCalendarMonthLabel(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

/**
 * The inclusive local dates a draft currently stands for.
 *
 * `pending` is the half-finished custom selection, and it is the state that
 * blocks Apply. Everything else resolves to real dates a reader can check
 * against the calendar in front of them, INCLUDING presets: "Last 90 days" is
 * a claim about two specific dates, and a picker that will not say which two
 * is asking to be trusted rather than read.
 */
export type DashboardDateRangeSummary =
  | { readonly kind: 'bounded'; readonly from: string; readonly to: string }
  | { readonly kind: 'all' }
  | { readonly kind: 'pending'; readonly from: string | null };

/**
 * Resolves a draft's dates through the CANONICAL preset arithmetic
 * (`resolveLocalDatePresetRange`), never through a second copy of it. The
 * dates shown in the picker are therefore the same dates the server will
 * bound the query with, resolved from the same `localToday`.
 */
export function summarizeDraftDates(
  draft: DashboardDateRangeDraft,
  localToday: string,
): DashboardDateRangeSummary {
  if (draft.datePreset === 'all') return { kind: 'all' };
  if (draft.datePreset === 'custom') {
    return draft.from !== null && draft.to !== null
      ? { kind: 'bounded', from: draft.from, to: draft.to }
      : { kind: 'pending', from: draft.from };
  }
  const resolved = resolveLocalDatePresetRange(draft.datePreset, localToday);
  return resolved.ok
    ? { kind: 'bounded', from: resolved.from, to: resolved.to }
    : { kind: 'pending', from: null };
}
