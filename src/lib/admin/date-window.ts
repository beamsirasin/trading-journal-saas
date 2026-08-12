import {
  calendarDateIn,
  endOfDayExclusiveIn,
  formatCalendarParts,
  parseCalendarParts,
  startOfDayIn,
  TIME_ZONES,
  type CalendarDate,
} from '@/lib/time';

/**
 * The operator dashboard's one fixed activity window — 30 UTC calendar days,
 * including today. Operator timezone is LOCKED to UTC (Phase 11's own
 * contract): unlike `src/lib/analytics/filters.ts`'s `resolveAnalyticsDateBounds`,
 * which resolves the SAME kind of window in a per-account IANA timezone for a
 * single tenant, this helper takes no timezone parameter at all — mixing
 * tenant timezones into one cross-tenant operator chart would be
 * meaningless, so `'UTC'` is not a caller choice here, it is the only value.
 *
 * Built from the same `src/lib/time` primitives that module uses
 * (`calendarDateIn`, `parseCalendarParts`, `formatCalendarParts`,
 * `startOfDayIn`, `endOfDayExclusiveIn`) rather than importing that
 * analytics-domain module directly — admin code must not carry customer/
 * tenant assumptions, and the underlying calendar arithmetic is generic.
 *
 * Calendar arithmetic happens on date FIELDS via `Date.UTC`'s own overflow
 * handling (never by subtracting `30 * 24` hours from an instant), so month
 * and year boundaries resolve correctly with no special-casing.
 */

const WINDOW_DAYS = 30;

export interface Utc30DayWindow {
  /** 30 entries, oldest first, including today, each `YYYY-MM-DD`. */
  readonly days: readonly CalendarDate[];
  /** UTC midnight of `days[0]` (29 calendar days before today) — inclusive. */
  readonly startInclusive: Date;
  /** UTC midnight of the day after `days[29]` (today) — exclusive. */
  readonly endExclusive: Date;
}

function addUtcCalendarDays(date: CalendarDate, offsetDays: number): CalendarDate {
  const parsed = parseCalendarParts(date);
  if (!parsed.ok) {
    throw new Error(`resolveUtc30DayWindow: ${parsed.error.message}`);
  }
  // Noon anchor avoids any midnight-adjacent floating-point/rounding edge in
  // the UTC-to-UTC conversion below — harmless since only the resulting
  // calendar date (not the time-of-day) is read back out.
  const shifted = new Date(
    Date.UTC(parsed.value.year, parsed.value.month - 1, parsed.value.day + offsetDays, 12),
  );
  return formatCalendarParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * Resolves the locked "last 30 UTC calendar days, including today" window
 * for a given instant. Deterministic and pure — the caller supplies `now`.
 */
export function resolveUtc30DayWindow(now: Date): Utc30DayWindow {
  if (Number.isNaN(now.getTime())) {
    throw new Error('resolveUtc30DayWindow: `now` is an invalid Date.');
  }
  const today = calendarDateIn(now, TIME_ZONES.UTC);
  if (!today.ok) {
    // Unreachable in practice — 'UTC' is always a valid IANA zone — but the
    // underlying primitive is Result-typed, so this stays a real branch
    // rather than a non-null assertion.
    throw new Error(`resolveUtc30DayWindow: ${today.error.message}`);
  }

  const days = Array.from({ length: WINDOW_DAYS }, (_, index) =>
    addUtcCalendarDays(today.value, -(WINDOW_DAYS - 1) + index),
  );
  const firstDay = days[0];
  const lastDay = days[WINDOW_DAYS - 1];
  if (firstDay === undefined || lastDay === undefined) {
    throw new Error('resolveUtc30DayWindow: failed to construct the 30-day window.');
  }

  const start = startOfDayIn(firstDay, TIME_ZONES.UTC);
  const end = endOfDayExclusiveIn(lastDay, TIME_ZONES.UTC);
  if (!start.ok || !end.ok) {
    throw new Error('resolveUtc30DayWindow: failed to resolve UTC day boundaries.');
  }

  return { days, startInclusive: start.value, endExclusive: end.value };
}

/**
 * Merges sparse `{day, count}` rows (as returned by a `GROUP BY` query) into
 * the full 30-day window, defaulting missing days to zero — the window's own
 * `days` order is authoritative, never the query's row order.
 */
export function fillUtc30DayCounts(
  window: Utc30DayWindow,
  counted: readonly { readonly day: CalendarDate; readonly count: number }[],
): readonly { readonly day: CalendarDate; readonly count: number }[] {
  const byDay = new Map(counted.map((row) => [row.day, row.count]));
  return window.days.map((day) => ({ day, count: byDay.get(day) ?? 0 }));
}
