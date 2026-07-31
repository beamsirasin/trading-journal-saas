/**
 * Time primitives — framework independent.
 *
 * The model distinguishes three things that are routinely conflated, and
 * conflating them is how "the trade shows on the wrong day" bugs happen:
 *
 *   Instant       an absolute moment, stored UTC. `Date` is used as the
 *                 carrier, but it is always treated as an instant — never as
 *                 a local wall-clock value.
 *   CalendarDate  a date with no time and no zone: "2026-07-31". What a user
 *                 means by "my trades on Friday".
 *   WallClock     what a clock on the wall reads: 2026-07-31 23:30, with no
 *                 offset. Only becomes an Instant once a zone is applied.
 *
 * The server's local timezone is never consulted. Every conversion takes an
 * explicit IANA zone.
 */

/** IANA timezone identifier, e.g. `Asia/Bangkok`. Validate with `isValidTimeZone`. */
export type TimeZoneId = string;

/** `YYYY-MM-DD`, no time, no zone. */
export type CalendarDate = string;

/** A local wall-clock reading, with no zone attached. */
export interface WallClock {
  readonly year: number;
  /** 1-12, not the 0-11 that `Date` uses. */
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export type TimeResult<T> = { ok: true; value: T } | { ok: false; error: TimeError };

export type TimeErrorCode =
  'invalid_timezone' | 'invalid_timestamp' | 'invalid_calendar_date' | 'invalid_wall_clock';

export interface TimeError {
  readonly code: TimeErrorCode;
  readonly message: string;
}

export const ok = <T>(value: T): TimeResult<T> => ({ ok: true, value });

export const err = <T = never>(code: TimeErrorCode, message: string): TimeResult<T> => ({
  ok: false,
  error: { code, message },
});

/**
 * How to resolve a wall-clock time that DST makes ambiguous or nonexistent.
 *
 * Ambiguous — clocks go back, so 01:30 happens twice.
 * Nonexistent — clocks go forward, so 02:30 never happens.
 *
 * Defaults are `'earlier'` and `'after-gap'`. Both are arbitrary but must be
 * consistent, documented, and tested: an unstated choice here silently shifts
 * an hour of trades.
 */
export interface ResolveOptions {
  /** For ambiguous times. Default `'earlier'` (the first occurrence). */
  readonly ambiguous?: 'earlier' | 'later';
  /** For nonexistent times. Default `'after-gap'` (skip forward). */
  readonly nonexistent?: 'after-gap' | 'before-gap';
}
