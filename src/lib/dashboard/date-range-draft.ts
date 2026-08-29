import {
  parseAnalyticsFilters,
  type AnalyticsCustomDateRange,
  type AnalyticsDatePreset,
} from '@/lib/analytics/filters';
import { parseCalendarParts } from '@/lib/time';

export interface AppliedDashboardDateRange {
  readonly datePreset: AnalyticsDatePreset;
  readonly customDateRange: AnalyticsCustomDateRange | null;
}

/**
 * Temporary picker state. It is deliberately independent from the applied
 * URL-backed Dashboard state: editing either date cannot trigger a query.
 */
export interface DashboardDateRangeDraft {
  readonly datePreset: AnalyticsDatePreset;
  readonly from: string | null;
  readonly to: string | null;
}

export type ApplyDashboardDateRangeDraftResult =
  | { readonly ok: true; readonly applied: AppliedDashboardDateRange }
  | { readonly ok: false; readonly code: 'incomplete_or_invalid_range' };

export function createDashboardDateRangeDraft(
  applied: AppliedDashboardDateRange,
): DashboardDateRangeDraft {
  return {
    datePreset: applied.datePreset,
    from: applied.customDateRange?.from ?? null,
    to: applied.customDateRange?.to ?? null,
  };
}

/** A quick preset changes draft state only; the caller still has to Apply. */
export function selectDashboardDatePreset(
  draft: DashboardDateRangeDraft,
  preset: AnalyticsDatePreset,
): DashboardDateRangeDraft {
  if (preset === 'custom') {
    return draft.datePreset === 'custom' ? draft : { datePreset: 'custom', from: null, to: null };
  }
  return { datePreset: preset, from: null, to: null };
}

/**
 * Calendar selection is predictable and touch-friendly:
 * - an empty or complete selection starts again from the clicked date;
 * - a second date on/after start completes the range;
 * - an earlier second date is ordered automatically (clicked date becomes start).
 */
export function selectDashboardCustomDate(
  draft: DashboardDateRangeDraft,
  date: string,
): DashboardDateRangeDraft {
  if (!parseCalendarParts(date).ok) return draft;
  if (draft.datePreset !== 'custom' || draft.from === null || draft.to !== null) {
    return { datePreset: 'custom', from: date, to: null };
  }
  return date >= draft.from
    ? { datePreset: 'custom', from: draft.from, to: date }
    : { datePreset: 'custom', from: date, to: draft.from };
}

/** Clear selects All in the draft. It does not mutate applied state until Apply. */
export function clearDashboardDateRangeDraft(): DashboardDateRangeDraft {
  return { datePreset: 'all', from: null, to: null };
}

/**
 * The sole draft -> applied transition. A future picker passes this result to
 * DashboardStateNavigation exactly once; it does not navigate while editing.
 */
export function applyDashboardDateRangeDraft(
  draft: DashboardDateRangeDraft,
): ApplyDashboardDateRangeDraftResult {
  const parsed = parseAnalyticsFilters({
    datePreset: draft.datePreset,
    ...(draft.from === null ? {} : { fromDate: draft.from }),
    ...(draft.to === null ? {} : { toDate: draft.to }),
  });
  if (!parsed.ok) return { ok: false, code: 'incomplete_or_invalid_range' };
  return {
    ok: true,
    applied: {
      datePreset: parsed.filters.datePreset,
      customDateRange: parsed.filters.customDateRange,
    },
  };
}
