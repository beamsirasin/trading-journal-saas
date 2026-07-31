import { parseCalendarParts } from './convert';
import { err, ok, type CalendarDate, type TimeResult } from './types';

/**
 * Strict ISO 8601 instant parsing.
 *
 * `new Date(string)` is deliberately not exposed: it accepts almost anything,
 * falls back to implementation-defined parsing, and — critically — reads a
 * bare `"2026-07-31 10:00"` as LOCAL time on whatever machine runs it. That
 * makes output depend on server configuration, which this module exists to
 * prevent.
 *
 * Accepted: a date-time with an explicit UTC `Z` or a numeric offset.
 *   2026-07-31T10:00:00Z
 *   2026-07-31T10:00:00.123Z
 *   2026-07-31T17:00:00+07:00
 *
 * Rejected: anything without an offset, and bare calendar dates. A timestamp
 * without a zone is not an instant, and guessing one is the bug.
 */
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

export function parseInstant(input: string): TimeResult<Date> {
  if (typeof input !== 'string' || input.trim() === '') {
    return err('invalid_timestamp', 'Timestamp is empty.');
  }

  const trimmed = input.trim();
  const match = ISO_INSTANT_PATTERN.exec(trimmed);
  if (match === null) {
    return err(
      'invalid_timestamp',
      `"${input}" is not an ISO 8601 instant with an explicit offset (e.g. 2026-07-31T10:00:00Z).`,
    );
  }

  const [, year, month, day] = match;
  const calendar = parseCalendarParts(`${year as string}-${month as string}-${day as string}`);
  if (!calendar.ok) {
    return err('invalid_timestamp', `"${input}" contains an impossible calendar date.`);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return err('invalid_timestamp', `"${input}" is not a valid instant.`);
  }

  const hour = Number.parseInt(match[4] as string, 10);
  const minute = Number.parseInt(match[5] as string, 10);
  const second = match[6] === undefined ? 0 : Number.parseInt(match[6], 10);
  // 24:00:00 is legal ISO 8601 but ambiguous in practice; leap seconds are
  // not representable. Both are refused rather than silently shifted.
  if (hour > 23 || minute > 59 || second > 59) {
    return err('invalid_timestamp', `"${input}" has an out-of-range time component.`);
  }

  return ok(parsed);
}

/** Strict `YYYY-MM-DD` parsing. Rejects impossible dates such as 2026-02-30. */
export function parseCalendarDate(input: string): TimeResult<CalendarDate> {
  if (typeof input !== 'string' || input.trim() === '') {
    return err('invalid_calendar_date', 'Calendar date is empty.');
  }
  const trimmed = input.trim();
  const parts = parseCalendarParts(trimmed);
  if (!parts.ok) {
    return parts;
  }
  return ok(trimmed);
}

/**
 * The canonical storage form for an instant: ISO 8601 in UTC.
 * Never persist a locale-formatted string — it is lossy and unparseable.
 */
export function toIsoUtc(instant: Date): TimeResult<string> {
  if (Number.isNaN(instant.getTime())) {
    return err('invalid_timestamp', 'Instant is an invalid Date.');
  }
  return ok(instant.toISOString());
}
