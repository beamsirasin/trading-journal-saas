import { isValidTimeZone, offsetMinutesAt } from './timezone';
import { err, ok, type TimeResult, type TimeZoneId } from './types';

/**
 * Display formatting.
 *
 * Every function requires an explicit timezone. There is no overload that
 * falls back to the runtime's zone, because on a server that zone is a
 * deployment detail and on a client it is whatever the user's laptop says —
 * neither is the user's configured timezone.
 *
 * Formatted output is for display only. It is never persisted and never
 * parsed back; `toIsoUtc` is the storage form.
 */

export type InstantStyle = 'date' | 'time' | 'datetime' | 'datetime-with-zone';

export interface FormatInstantOptions {
  readonly style?: InstantStyle;
  /** BCP 47 locale. Default `'en-GB'` for unambiguous day-month ordering. */
  readonly locale?: string;
}

const STYLE_OPTIONS: Record<InstantStyle, Intl.DateTimeFormatOptions> = {
  date: { year: 'numeric', month: 'short', day: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  datetime: {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  },
  'datetime-with-zone': {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  },
};

export function formatInstant(
  instant: Date,
  timeZone: TimeZoneId,
  options: FormatInstantOptions = {},
): TimeResult<string> {
  if (!isValidTimeZone(timeZone)) {
    return err('invalid_timezone', `Unknown IANA timezone: ${String(timeZone)}`);
  }
  if (Number.isNaN(instant.getTime())) {
    return err('invalid_timestamp', 'Instant is an invalid Date.');
  }

  const style = options.style ?? 'datetime';
  const locale = options.locale ?? 'en-GB';

  const formatter = new Intl.DateTimeFormat(locale, {
    ...STYLE_OPTIONS[style],
    timeZone,
  });

  return ok(formatter.format(instant));
}

/**
 * The UTC offset as a display string: `+07:00`, `-04:00`, `+00:00`.
 * Useful for showing users which zone a timestamp was interpreted in.
 */
export function formatOffset(instant: Date, timeZone: TimeZoneId): TimeResult<string> {
  if (!isValidTimeZone(timeZone)) {
    return err('invalid_timezone', `Unknown IANA timezone: ${String(timeZone)}`);
  }
  if (Number.isNaN(instant.getTime())) {
    return err('invalid_timestamp', 'Instant is an invalid Date.');
  }

  const totalMinutes = offsetMinutesAt(instant, timeZone);
  const sign = totalMinutes < 0 ? '-' : '+';
  const magnitude = Math.abs(totalMinutes);
  const hours = String(Math.floor(magnitude / 60)).padStart(2, '0');
  const minutes = String(magnitude % 60).padStart(2, '0');

  return ok(`${sign}${hours}:${minutes}`);
}
