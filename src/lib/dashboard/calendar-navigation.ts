import { isCalendarMode, type CalendarMode } from './calendar';
import { serializeDashboardFilterState, type DashboardFilterState } from './filters';

/**
 * THE CALENDAR'S OWN URL VOCABULARY, ORTHOGONAL TO THE DASHBOARD FILTERS.
 *
 * Two parsers share one URL. `parseDashboardFilterState` owns
 * `range`/`from`/`to`/`account`/`strategy`/`setup`/`version`/`unit`; this owns
 * `month`/`mode`/`day`/`trade`. Neither reads the other's keys, and both fail
 * closed on anything they do not recognise — so a malformed calendar
 * parameter can never quietly widen an analytics population, and a malformed
 * filter can never quietly move the calendar.
 *
 * URL-BACKED, NOT COMPONENT STATE. The Phase 14D calendar kept its axis in a
 * `useState`, so a refresh silently reset the mode and a shared link never
 * carried it. Every dimension a reader can change here — the month, the mode,
 * the selected day, the opened Trade — is in the address bar, which is what
 * makes deep linking, browser Back and refresh work without a single line of
 * bespoke history handling.
 */
export const CALENDAR_URL_KEYS = ['month', 'mode', 'day', 'trade'] as const;

export type CalendarUrlKey = (typeof CALENDAR_URL_KEYS)[number];

/**
 * The filter module's keys, tolerated here and owned there — the exact mirror
 * of the `FOREIGN_URL_KEYS` list in `filters.ts`. Both parsers stay genuinely
 * fail-closed: each rejects anything that is in neither list, so a typo'd
 * parameter is still an error rather than a silently ignored one.
 */
const FOREIGN_URL_KEYS = [
  'range',
  'from',
  'to',
  'account',
  'strategy',
  'setup',
  'version',
  'unit',
] as const;
const ALLOWED_URL_KEYS = new Set<string>([...CALENDAR_URL_KEYS, ...FOREIGN_URL_KEYS]);

export const DEFAULT_CALENDAR_MODE: CalendarMode = 'actual';

/** `YYYY-MM`. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** `YYYY-MM-DD`. A real calendar date, not merely the right shape. */
const DAY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CalendarNavigationState {
  readonly mode: CalendarMode;
  /** `null` means "the current local month", resolved against the user's timezone by the caller. */
  readonly month: { readonly year: number; readonly month: number } | null;
  /** The Day Review's selected local date, or `null` when no day is open. */
  readonly selectedDate: string | null;
  /** The Quick Preview's Trade, or `null`. Only meaningful with a selected day. */
  readonly selectedTradeId: string | null;
}

export type ParseCalendarNavigationResult =
  | { readonly ok: true; readonly state: CalendarNavigationState }
  | { readonly ok: false; readonly code: 'invalid_calendar_navigation' };

function isRealCalendarDate(value: string): boolean {
  const match = DAY_PATTERN.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match;
  // Rejects 2026-02-31 and friends: a shape check alone would let a
  // non-existent day become a Day Review request the DAL cannot satisfy.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
  );
}

/**
 * Parses the Calendar/Day Review/Quick Preview navigation layer.
 *
 * Fails closed, exactly as the Dashboard filter parser does: an unknown key,
 * an array value, an impossible date or a malformed Trade id is rejected
 * rather than partially honoured. A `day` outside the requested `month` is
 * also rejected — a Day Review for August opened under a September calendar
 * is an inconsistent state that would silently show the reader the wrong
 * context.
 */
export function parseCalendarNavigation(value: unknown): ParseCalendarNavigationResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_calendar_navigation' };
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !ALLOWED_URL_KEYS.has(key))) {
    return { ok: false, code: 'invalid_calendar_navigation' };
  }
  for (const key of CALENDAR_URL_KEYS) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      return { ok: false, code: 'invalid_calendar_navigation' };
    }
  }

  const modeRaw = raw.mode as string | undefined;
  if (modeRaw !== undefined && !isCalendarMode(modeRaw)) {
    return { ok: false, code: 'invalid_calendar_navigation' };
  }
  const mode: CalendarMode = modeRaw === undefined ? DEFAULT_CALENDAR_MODE : modeRaw;

  const monthRaw = raw.month as string | undefined;
  let month: CalendarNavigationState['month'] = null;
  if (monthRaw !== undefined) {
    const match = MONTH_PATTERN.exec(monthRaw);
    if (match === null) return { ok: false, code: 'invalid_calendar_navigation' };
    month = { year: Number(match[1]), month: Number(match[2]) };
  }

  const dayRaw = raw.day as string | undefined;
  let selectedDate: string | null = null;
  if (dayRaw !== undefined) {
    if (!isRealCalendarDate(dayRaw)) return { ok: false, code: 'invalid_calendar_navigation' };
    if (month !== null && dayRaw.slice(0, 7) !== monthRaw) {
      return { ok: false, code: 'invalid_calendar_navigation' };
    }
    selectedDate = dayRaw;
  }

  const tradeRaw = raw.trade as string | undefined;
  let selectedTradeId: string | null = null;
  if (tradeRaw !== undefined) {
    if (!UUID_PATTERN.test(tradeRaw)) return { ok: false, code: 'invalid_calendar_navigation' };
    // A Trade can only be previewed FROM a day. Accepting `trade` without
    // `day` would create a second, undocumented way to open the preview and
    // leave the Calendar without the context the reader came from.
    if (selectedDate === null) return { ok: false, code: 'invalid_calendar_navigation' };
    selectedTradeId = tradeRaw;
  }

  return { ok: true, state: { mode, month, selectedDate, selectedTradeId } };
}

export function formatCalendarMonthParam(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * Serializes filters AND calendar navigation into one canonical query string.
 *
 * Every link the Calendar renders goes through this, which is what guarantees
 * that opening a day, changing the mode, paging the month or opening a Trade
 * NEVER drops the Dashboard's Account/Strategy/Setup/range scope. The Phase
 * 14D calendar rebuilt its query string from scratch on each navigation and
 * dropped everything it did not personally know about; this cannot, because
 * the filter half is produced by the filters module itself.
 *
 * Defaults are omitted rather than written: no `mode=actual`, no `day` when
 * nothing is selected, no `trade` when nothing is open. A closed Day Review
 * and a Day Review that was never opened produce the same URL.
 */
export function serializeCalendarState(
  filters: DashboardFilterState,
  navigation: CalendarNavigationState,
): URLSearchParams {
  const params = serializeDashboardFilterState(filters);
  if (navigation.mode !== DEFAULT_CALENDAR_MODE) params.set('mode', navigation.mode);
  if (navigation.month !== null) {
    params.set('month', formatCalendarMonthParam(navigation.month.year, navigation.month.month));
  }
  if (navigation.selectedDate !== null) params.set('day', navigation.selectedDate);
  if (navigation.selectedTradeId !== null) params.set('trade', navigation.selectedTradeId);
  return params;
}

/** The href for one calendar navigation change, with everything else preserved. */
export function buildCalendarHref(
  path: string,
  filters: DashboardFilterState,
  navigation: CalendarNavigationState,
): string {
  const query = serializeCalendarState(filters, navigation).toString();
  return query === '' ? path : `${path}?${query}`;
}

/** Opening a day keeps the month and mode, and closes any open Trade preview. */
export function selectDayNavigation(
  navigation: CalendarNavigationState,
  date: string,
): CalendarNavigationState {
  return { ...navigation, selectedDate: date, selectedTradeId: null };
}

/** Closing the Day Review also closes the Trade preview it contained. */
export function clearDayNavigation(navigation: CalendarNavigationState): CalendarNavigationState {
  return { ...navigation, selectedDate: null, selectedTradeId: null };
}

/**
 * Changing mode keeps the month but clears the selected day: the day's
 * population and even its date axis differ per mode, so carrying a selection
 * across would open a Day Review for a day that may hold nothing in the new
 * mode.
 */
export function selectModeNavigation(
  navigation: CalendarNavigationState,
  mode: CalendarMode,
): CalendarNavigationState {
  return { ...navigation, mode, selectedDate: null, selectedTradeId: null };
}
