import type { TimeZoneId, WallClock } from './types';

/**
 * Timezone offset lookup, built on `Intl.DateTimeFormat`.
 *
 * No timezone database is bundled. The runtime's ICU data is the source of
 * truth, which means offsets and DST rules stay current without a dependency
 * that needs periodic updating — the usual failure mode of bundled tz data.
 *
 * Requires a full-ICU runtime. Node 14+ and every current browser ship one.
 */

const formatterCache = new Map<TimeZoneId, Intl.DateTimeFormat>();

function getFormatter(timeZone: TimeZoneId): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      era: 'short',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Whether the runtime recognises this IANA identifier.
 *
 * `Intl.DateTimeFormat` throws a RangeError for unknown zones, which is the
 * only reliable check available — there is no enumerable list guaranteed
 * across runtimes.
 */
export function isValidTimeZone(timeZone: unknown): timeZone is TimeZoneId {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the wall clock in `timeZone` at a given instant.
 * Throws only if the zone is invalid — validate first.
 */
export function wallClockAt(instant: Date, timeZone: TimeZoneId): WallClock {
  const parts = getFormatter(timeZone).formatToParts(instant);

  const lookup = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? '' : part.value;
  };

  const year = Number.parseInt(lookup('year'), 10);
  // BC dates would otherwise silently read as positive years. Not expected in
  // this product, but a wrong sign is worse than a rejected input.
  const era = lookup('era');
  const signedYear = era === 'BC' || era === 'B' ? -(year - 1) : year;

  return {
    year: signedYear,
    month: Number.parseInt(lookup('month'), 10),
    day: Number.parseInt(lookup('day'), 10),
    hour: Number.parseInt(lookup('hour'), 10),
    minute: Number.parseInt(lookup('minute'), 10),
    second: Number.parseInt(lookup('second'), 10),
  };
}

/** Milliseconds since the epoch for a wall clock interpreted as if it were UTC. */
export function wallClockAsUtcMs(wall: WallClock): number {
  const utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  // Date.UTC maps years 0-99 into 1900-1999. Undo that for correctness.
  if (wall.year >= 0 && wall.year <= 99) {
    const corrected = new Date(utc);
    corrected.setUTCFullYear(wall.year);
    return corrected.getTime();
  }
  return utc;
}

/**
 * UTC offset in minutes at a given instant, positive east of Greenwich.
 * `Asia/Bangkok` -> 420. `America/New_York` -> -300 or -240 depending on DST.
 *
 * Derived by formatting the instant into the zone's wall clock and measuring
 * the difference from UTC. Sub-second precision is discarded because
 * `formatToParts` has none, and no real zone has a sub-second offset.
 */
export function offsetMinutesAt(instant: Date, timeZone: TimeZoneId): number {
  const wall = wallClockAt(instant, timeZone);
  const asUtc = wallClockAsUtcMs(wall);
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return (asUtc - instantSeconds) / 60_000;
}

/**
 * Supported IANA identifiers straight from the runtime's own ICU data — no
 * bundled timezone dataset, matching this module's own "no bundled tz
 * database" philosophy. `Intl.supportedValuesOf` is not guaranteed on every
 * runtime, so `null` signals "fall back to a plain validated text input"
 * rather than a broken dropdown. Shared by every timezone `<select>` in the
 * product (onboarding, account create/edit) so the fallback behavior can
 * never drift between them.
 */
export function listSupportedTimeZones(): string[] | null {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    return supported !== undefined && supported.length > 0 ? supported : null;
  } catch {
    return null;
  }
}

/** A UX suggestion only — always re-validated against `isValidTimeZone` before use, never trusted as-is. */
export function detectBrowserTimeZone(): string | null {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(detected) ? detected : null;
  } catch {
    return null;
  }
}

/** True when the zone observes a different offset at some point in the given year. */
export function observesDstInYear(timeZone: TimeZoneId, year: number): boolean {
  const firstDay = new Date(Date.UTC(year, 0, 1, 12));
  const baseline = offsetMinutesAt(firstDay, timeZone);

  // Sampling only January and July misses temporary changes such as Morocco's
  // Ramadan suspension. Daily noon samples cover any real DST season without
  // making assumptions about hemisphere or transition month.
  for (let day = 1; day <= 366; day += 1) {
    const sample = new Date(Date.UTC(year, 0, 1 + day, 12));
    if (sample.getUTCFullYear() !== year) {
      break;
    }
    if (offsetMinutesAt(sample, timeZone) !== baseline) {
      return true;
    }
  }

  return false;
}
