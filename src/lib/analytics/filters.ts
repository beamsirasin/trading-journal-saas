import { z } from 'zod';

import {
  calendarDateIn,
  endOfDayExclusiveIn,
  formatCalendarParts,
  parseCalendarParts,
  startOfDayIn,
} from '@/lib/time';

export const ANALYTICS_DATE_PRESETS = [
  'today',
  'week',
  'month',
  '30d',
  '90d',
  'quarter',
  'ytd',
  'all',
  'custom',
] as const;
export type AnalyticsDatePreset = (typeof ANALYTICS_DATE_PRESETS)[number];

export interface AnalyticsCustomDateRange {
  /** Inclusive local calendar date in canonical `YYYY-MM-DD` form. */
  readonly from: string;
  /** Inclusive local calendar date in canonical `YYYY-MM-DD` form. */
  readonly to: string;
}

export type AnalyticsAccountScope =
  | { readonly kind: 'active' }
  | { readonly kind: 'all' }
  | { readonly kind: 'account'; readonly accountId: string };

export interface AnalyticsFilters {
  readonly datePreset: AnalyticsDatePreset;
  readonly customDateRange: AnalyticsCustomDateRange | null;
  readonly accountScope: AnalyticsAccountScope;
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

const CalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => parseCalendarParts(value).ok);

export const AnalyticsFilterInputSchema = z
  .object({
    datePreset: z.enum(ANALYTICS_DATE_PRESETS).optional(),
    fromDate: CalendarDateSchema.optional(),
    toDate: CalendarDateSchema.optional(),
    tradingAccountId: z.union([z.literal('all'), z.string().uuid()]).optional(),
    strategyId: z.string().uuid().optional(),
    setupId: z.string().uuid().optional(),
    strategyVersionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const preset = value.datePreset ?? '90d';
    const hasFrom = value.fromDate !== undefined;
    const hasTo = value.toDate !== undefined;
    if (preset === 'custom') {
      if (!hasFrom || !hasTo || (hasFrom && hasTo && value.fromDate! > value.toDate!)) {
        context.addIssue({ code: 'custom', message: 'Custom range requires fromDate <= toDate.' });
      }
    } else if (hasFrom || hasTo) {
      context.addIssue({
        code: 'custom',
        message: 'fromDate and toDate are valid only when datePreset is custom.',
      });
    }
  });

export type AnalyticsFilterInput = z.input<typeof AnalyticsFilterInputSchema>;

export type ParseAnalyticsFiltersResult =
  | { readonly ok: true; readonly filters: AnalyticsFilters }
  | { readonly ok: false; readonly code: 'invalid_filters' };

/**
 * Parses untrusted URL/filter input into the one closed Phase 09 filter model.
 * Omission is meaningful: no account key means the trusted active-account
 * context, while the literal `all` opts into all workspace accounts.
 */
export function parseAnalyticsFilters(input: unknown): ParseAnalyticsFiltersResult {
  const parsed = AnalyticsFilterInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid_filters' };

  const accountScope: AnalyticsAccountScope =
    parsed.data.tradingAccountId === undefined
      ? { kind: 'active' }
      : parsed.data.tradingAccountId === 'all'
        ? { kind: 'all' }
        : { kind: 'account', accountId: parsed.data.tradingAccountId };

  return {
    ok: true,
    filters: {
      datePreset: parsed.data.datePreset ?? '90d',
      customDateRange:
        parsed.data.datePreset === 'custom'
          ? { from: parsed.data.fromDate!, to: parsed.data.toDate! }
          : null,
      accountScope,
      strategyId: parsed.data.strategyId ?? null,
      setupId: parsed.data.setupId ?? null,
      strategyVersionId: parsed.data.strategyVersionId ?? null,
    },
  };
}

export type AnalyticsDateBounds =
  | { readonly kind: 'all'; readonly start: null; readonly endExclusive: null }
  | {
      readonly kind: 'bounded';
      readonly start: string;
      readonly endExclusive: string;
    };

export type ResolveAnalyticsDateBoundsResult =
  | { readonly ok: true; readonly bounds: AnalyticsDateBounds }
  | {
      readonly ok: false;
      readonly code: 'invalid_date_range' | 'invalid_reference_instant' | 'invalid_timezone';
    };

function addCalendarDays(date: string, days: number): string | null {
  const parsed = parseCalendarParts(date);
  if (!parsed.ok) return null;
  const shifted = new Date(
    Date.UTC(parsed.value.year, parsed.value.month - 1, parsed.value.day + days, 12),
  );
  return formatCalendarParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/**
 * THE PRESET ARITHMETIC, AS LOCAL CALENDAR DATES AND NOTHING ELSE.
 *
 * Extracted so the Dashboard's Date Range picker can show a reader the exact
 * inclusive dates a quick preset stands for WITHOUT reimplementing any of it.
 * CLAUDE.md §6 forbids a second copy of a definition living in the UI; this is
 * the one definition, and both the query bounds below and the picker summary
 * read it.
 *
 * Rolling 30/90-day compatibility is today plus the preceding 29/89 dates.
 * `week`, `month`, `quarter` and `ytd` are period-to-date through the user's
 * local today; week starts Monday, which is a product contract and does not
 * vary by browser locale. Calendar arithmetic happens on date fields, never by
 * subtracting fixed hours.
 *
 * `localToday` is always a date the CALLER resolved in the user's persisted
 * analytics timezone. Nothing here calls `new Date()` for "now".
 */
export function resolveLocalDatePresetRange(
  preset: Exclude<AnalyticsDatePreset, 'all' | 'custom'>,
  localToday: string,
): { readonly ok: true; readonly from: string; readonly to: string } | { readonly ok: false } {
  const todayParts = parseCalendarParts(localToday);
  if (!todayParts.ok) return { ok: false };
  const { year, month } = todayParts.value;

  let startDate: string;
  if (preset === 'today') {
    startDate = localToday;
  } else if (preset === '30d' || preset === '90d') {
    const dayCount = preset === '30d' ? 30 : 90;
    const rollingStart = addCalendarDays(localToday, -(dayCount - 1));
    if (rollingStart === null) return { ok: false };
    startDate = rollingStart;
  } else if (preset === 'week') {
    const utcDay = new Date(Date.UTC(year, month - 1, todayParts.value.day, 12)).getUTCDay();
    const daysSinceMonday = (utcDay + 6) % 7;
    const weekStart = addCalendarDays(localToday, -daysSinceMonday);
    if (weekStart === null) return { ok: false };
    startDate = weekStart;
  } else if (preset === 'month') {
    startDate = formatCalendarParts(year, month, 1);
  } else if (preset === 'quarter') {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    startDate = formatCalendarParts(year, quarterStartMonth, 1);
  } else {
    startDate = formatCalendarParts(year, 1, 1);
  }

  return { ok: true, from: startDate, to: localToday };
}

/**
 * Resolves the canonical user-local calendar presets to half-open UTC bounds.
 *
 * The preset arithmetic itself lives in `resolveLocalDatePresetRange` above;
 * this function owns only the timezone resolution around it and the custom
 * range's validation. Existing time primitives own timezone/DST resolution.
 */
export function resolveAnalyticsDateBounds(
  preset: AnalyticsDatePreset,
  timeZone: string,
  referenceInstant: Date,
  customDateRange: AnalyticsCustomDateRange | null = null,
): ResolveAnalyticsDateBoundsResult {
  if (preset === 'all') {
    return { ok: true, bounds: { kind: 'all', start: null, endExclusive: null } };
  }

  let startDate: string;
  let endDate: string;
  if (preset === 'custom') {
    if (
      customDateRange === null ||
      !parseCalendarParts(customDateRange.from).ok ||
      !parseCalendarParts(customDateRange.to).ok ||
      customDateRange.from > customDateRange.to
    ) {
      return { ok: false, code: 'invalid_date_range' };
    }
    startDate = customDateRange.from;
    endDate = customDateRange.to;
  } else {
    if (Number.isNaN(referenceInstant.getTime())) {
      return { ok: false, code: 'invalid_reference_instant' };
    }

    const localToday = calendarDateIn(referenceInstant, timeZone);
    if (!localToday.ok) return { ok: false, code: 'invalid_timezone' };

    const resolved = resolveLocalDatePresetRange(preset, localToday.value);
    if (!resolved.ok) return { ok: false, code: 'invalid_reference_instant' };
    startDate = resolved.from;
    endDate = resolved.to;
  }

  const start = startOfDayIn(startDate, timeZone);
  const endExclusive = endOfDayExclusiveIn(endDate, timeZone);
  if (!start.ok || !endExclusive.ok) return { ok: false, code: 'invalid_timezone' };

  return {
    ok: true,
    bounds: {
      kind: 'bounded',
      start: start.value.toISOString(),
      endExclusive: endExclusive.value.toISOString(),
    },
  };
}
