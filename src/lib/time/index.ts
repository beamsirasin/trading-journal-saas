/**
 * Time and timezone primitives.
 *
 * Storage contract (CLAUDE.md §7): every timestamp is stored as UTC. Display
 * and every date-grouped analytic use the user's configured IANA timezone.
 * The server's local timezone is never consulted, and no locale-formatted
 * date string is ever persisted.
 *
 * See docs/decisions/0003-time-model.md for the DST resolution rules.
 *
 * NOT SUPPORTED YET (deliberately):
 *   - trading sessions, market hours, holiday calendars  -> later phase
 *   - business-day arithmetic                            -> later phase
 *   - durations and intervals                            -> add when needed
 *   - relative formatting ("3 hours ago")                -> presentation layer
 *   - historical zones before the IANA database's coverage
 */

export {
  isValidTimeZone,
  observesDstInYear,
  offsetMinutesAt,
  wallClockAsUtcMs,
  wallClockAt,
} from './timezone';

export { createFixedClock, systemClock, type Clock } from './clock';

export {
  calendarDateIn,
  dayRangeIn,
  endOfDayExclusiveIn,
  formatCalendarParts,
  parseCalendarParts,
  startOfDayIn,
  wallClockIn,
} from './convert';

export { parseCalendarDate, parseInstant, toIsoUtc } from './parse';

export {
  formatInstant,
  formatOffset,
  type FormatInstantOptions,
  type InstantStyle,
} from './format';

export type {
  CalendarDate,
  ResolveOptions,
  TimeError,
  TimeErrorCode,
  TimeResult,
  TimeZoneId,
  WallClock,
} from './types';

/** Common zones referenced across the product. Not an exhaustive list. */
export const TIME_ZONES = {
  UTC: 'UTC',
  BANGKOK: 'Asia/Bangkok',
  NEW_YORK: 'America/New_York',
  LONDON: 'Europe/London',
  TOKYO: 'Asia/Tokyo',
  SYDNEY: 'Australia/Sydney',
} as const;
