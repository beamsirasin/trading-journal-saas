import { isValidTimeZone, offsetMinutesAt, wallClockAsUtcMs, wallClockAt } from './timezone';
import {
  err,
  ok,
  type CalendarDate,
  type ResolveOptions,
  type TimeResult,
  type TimeZoneId,
  type WallClock,
} from './types';

const MINUTE_MS = 60_000;

/**
 * The calendar date a given instant falls on, in a specific zone.
 *
 * This is the function every date-grouped analytic depends on. A trade closed
 * 23:30 in Bangkok belongs to that Bangkok day, not to the following UTC day,
 * and getting this wrong shifts entries between days invisibly.
 */
export function calendarDateIn(instant: Date, timeZone: TimeZoneId): TimeResult<CalendarDate> {
  if (!isValidTimeZone(timeZone)) {
    return err('invalid_timezone', `Unknown IANA timezone: ${String(timeZone)}`);
  }
  if (Number.isNaN(instant.getTime())) {
    return err('invalid_timestamp', 'Instant is an invalid Date.');
  }
  const wall = wallClockAt(instant, timeZone);
  return ok(formatCalendarParts(wall.year, wall.month, wall.day));
}

/** The wall clock in a zone at an instant. */
export function wallClockIn(instant: Date, timeZone: TimeZoneId): TimeResult<WallClock> {
  if (!isValidTimeZone(timeZone)) {
    return err('invalid_timezone', `Unknown IANA timezone: ${String(timeZone)}`);
  }
  if (Number.isNaN(instant.getTime())) {
    return err('invalid_timestamp', 'Instant is an invalid Date.');
  }
  return ok(wallClockAt(instant, timeZone));
}

const DAY_MS = 86_400_000;

/**
 * Converts a wall-clock reading in a zone to an absolute instant.
 *
 * The offset depends on the instant, but the instant is what we are solving
 * for. The fix is to bracket the transition: sample the offset a day either
 * side of the naive timestamp, which is guaranteed to straddle any DST change
 * near it, and test both resulting candidates.
 *
 * An earlier two-pass version failed here. When the naive timestamp and its
 * first candidate both fall on the same side of the transition, both passes
 * return the same offset and the second valid instant is never discovered —
 * so an ambiguous time looked unique and `ambiguous: 'later'` was ignored.
 *
 * Candidates that survive the round-trip check determine the case:
 *   2 -> ambiguous   (fall back: the wall clock happens twice)
 *   1 -> unique      (the ordinary case)
 *   0 -> nonexistent (spring forward: the wall clock never happens)
 */
export function wallClockToInstant(
  wall: WallClock,
  timeZone: TimeZoneId,
  options: ResolveOptions = {},
): TimeResult<Date> {
  if (!isValidTimeZone(timeZone)) {
    return err('invalid_timezone', `Unknown IANA timezone: ${String(timeZone)}`);
  }
  if (!isPlausibleWallClock(wall)) {
    return err('invalid_wall_clock', `Wall clock is out of range: ${JSON.stringify(wall)}`);
  }

  const ambiguous = options.ambiguous ?? 'earlier';
  const nonexistent = options.nonexistent ?? 'after-gap';

  const naiveMs = wallClockAsUtcMs(wall);

  const offsetBefore = offsetMinutesAt(new Date(naiveMs - DAY_MS), timeZone);
  const offsetAfter = offsetMinutesAt(new Date(naiveMs + DAY_MS), timeZone);

  const candidates =
    offsetBefore === offsetAfter
      ? [naiveMs - offsetBefore * MINUTE_MS]
      : [naiveMs - offsetBefore * MINUTE_MS, naiveMs - offsetAfter * MINUTE_MS];

  const valid = candidates.filter((candidate) => roundTrips(candidate, wall, timeZone));

  if (valid.length === 1) {
    return ok(new Date(valid[0] as number));
  }

  if (valid.length > 1) {
    const earlier = Math.min(...valid);
    const later = Math.max(...valid);
    return ok(new Date(ambiguous === 'earlier' ? earlier : later));
  }

  // Nonexistent: the wall clock falls inside a spring-forward gap. Both
  // candidates are wrong, so pick a side of the gap deliberately.
  const beforeGap = Math.min(...candidates);
  const afterGap = Math.max(...candidates);
  return ok(new Date(nonexistent === 'after-gap' ? afterGap : beforeGap));
}

function roundTrips(candidateMs: number, wall: WallClock, timeZone: TimeZoneId): boolean {
  const actual = wallClockAt(new Date(candidateMs), timeZone);
  return (
    actual.year === wall.year &&
    actual.month === wall.month &&
    actual.day === wall.day &&
    actual.hour === wall.hour &&
    actual.minute === wall.minute &&
    actual.second === wall.second
  );
}

/**
 * The instant at which a zone's calendar day begins.
 *
 * Not always midnight: a few zones start DST at 00:00, so the day begins at
 * 01:00 local. The gap resolution handles that rather than assuming.
 */
export function startOfDayIn(
  date: CalendarDate,
  timeZone: TimeZoneId,
  options: ResolveOptions = {},
): TimeResult<Date> {
  const parsed = parseCalendarParts(date);
  if (!parsed.ok) {
    return parsed;
  }
  const { year, month, day } = parsed.value;
  return wallClockToInstant({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone, options);
}

/**
 * The instant at which a zone's calendar day ends — exclusive, i.e. the start
 * of the next day.
 *
 * Exclusive rather than 23:59:59 because an inclusive end silently drops
 * anything in the final second, and `>= start && < end` is the range form
 * every database query wants.
 */
export function endOfDayExclusiveIn(
  date: CalendarDate,
  timeZone: TimeZoneId,
  options: ResolveOptions = {},
): TimeResult<Date> {
  const parsed = parseCalendarParts(date);
  if (!parsed.ok) {
    return parsed;
  }
  const { year, month, day } = parsed.value;
  // Advance the calendar date by one day using UTC arithmetic, which is safe
  // because it operates on the date fields, not on an instant.
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return wallClockToInstant(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: 0,
      minute: 0,
      second: 0,
    },
    timeZone,
    options,
  );
}

/** Half-open `[start, end)` range covering a calendar day in a zone. */
export function dayRangeIn(
  date: CalendarDate,
  timeZone: TimeZoneId,
): TimeResult<{ start: Date; end: Date }> {
  const start = startOfDayIn(date, timeZone);
  if (!start.ok) return start;
  const end = endOfDayExclusiveIn(date, timeZone);
  if (!end.ok) return end;
  return ok({ start: start.value, end: end.value });
}

function isPlausibleWallClock(wall: WallClock): boolean {
  const componentsAreInRange =
    Number.isInteger(wall.year) &&
    wall.year >= 0 &&
    wall.year <= 9999 &&
    Number.isInteger(wall.month) &&
    Number.isInteger(wall.day) &&
    Number.isInteger(wall.hour) &&
    Number.isInteger(wall.minute) &&
    Number.isInteger(wall.second) &&
    wall.month >= 1 &&
    wall.month <= 12 &&
    wall.day >= 1 &&
    wall.day <= 31 &&
    wall.hour >= 0 &&
    wall.hour <= 23 &&
    wall.minute >= 0 &&
    wall.minute <= 59 &&
    wall.second >= 0 &&
    wall.second <= 59;

  if (!componentsAreInRange) {
    return false;
  }

  return wall.day <= daysInMonth(wall.year, wall.month);
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseCalendarParts(
  date: CalendarDate,
): TimeResult<{ year: number; month: number; day: number }> {
  const match = CALENDAR_DATE_PATTERN.exec(date);
  if (match === null) {
    return err('invalid_calendar_date', `Expected YYYY-MM-DD, received: ${String(date)}`);
  }
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);

  if (month < 1 || month > 12) {
    return err('invalid_calendar_date', `Month out of range in ${date}.`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return err('invalid_calendar_date', `${date} is not a real calendar date.`);
  }

  return ok({ year, month, day });
}

/** Gregorian calendar-length arithmetic (leap years etc.) — never timezone-dependent, unlike everything else in this module. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Half-open `[start, end)` UTC range covering one calendar MONTH in a zone —
 * the same "start of day 1 through start of next month's day 1" composition
 * every caller would otherwise hand-roll (`dayRangeIn` is day-only). Used by
 * the Trading Calendar (Phase 14D) — Analytics deliberately has no month
 * primitive of its own, only relative day-count presets.
 */
export function monthRangeIn(
  year: number,
  month: number,
  timeZone: TimeZoneId,
): TimeResult<{ start: Date; end: Date }> {
  const start = startOfDayIn(formatCalendarParts(year, month, 1), timeZone);
  if (!start.ok) return start;
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const end = startOfDayIn(formatCalendarParts(nextMonth.year, nextMonth.month, 1), timeZone);
  if (!end.ok) return end;
  return ok({ start: start.value, end: end.value });
}

export function formatCalendarParts(year: number, month: number, day: number): CalendarDate {
  const yearText = String(year).padStart(4, '0');
  const monthText = String(month).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${yearText}-${monthText}-${dayText}`;
}
