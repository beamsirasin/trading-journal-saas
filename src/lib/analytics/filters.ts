import { z } from 'zod';

import {
  calendarDateIn,
  endOfDayExclusiveIn,
  formatCalendarParts,
  parseCalendarParts,
  startOfDayIn,
} from '@/lib/time';

export const ANALYTICS_DATE_PRESETS = ['30d', '90d', 'all'] as const;
export type AnalyticsDatePreset = (typeof ANALYTICS_DATE_PRESETS)[number];

export type AnalyticsAccountScope =
  | { readonly kind: 'active' }
  | { readonly kind: 'all' }
  | { readonly kind: 'account'; readonly accountId: string };

export interface AnalyticsFilters {
  readonly datePreset: AnalyticsDatePreset;
  readonly accountScope: AnalyticsAccountScope;
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

export const AnalyticsFilterInputSchema = z
  .object({
    datePreset: z.enum(ANALYTICS_DATE_PRESETS).optional(),
    tradingAccountId: z.union([z.literal('all'), z.string().uuid()]).optional(),
    strategyId: z.string().uuid().optional(),
    setupId: z.string().uuid().optional(),
    strategyVersionId: z.string().uuid().optional(),
  })
  .strict();

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
  | { readonly ok: false; readonly code: 'invalid_reference_instant' | 'invalid_timezone' };

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
 * Resolves 30/90 user-local calendar days to half-open UTC bounds. Calendar
 * arithmetic happens on date fields, never by subtracting N * 24 hours, and
 * the existing time primitives own all timezone/DST resolution.
 */
export function resolveAnalyticsDateBounds(
  preset: AnalyticsDatePreset,
  timeZone: string,
  referenceInstant: Date,
): ResolveAnalyticsDateBoundsResult {
  if (preset === 'all') {
    return { ok: true, bounds: { kind: 'all', start: null, endExclusive: null } };
  }
  if (Number.isNaN(referenceInstant.getTime())) {
    return { ok: false, code: 'invalid_reference_instant' };
  }

  const localToday = calendarDateIn(referenceInstant, timeZone);
  if (!localToday.ok) return { ok: false, code: 'invalid_timezone' };

  const dayCount = preset === '30d' ? 30 : 90;
  const startDate = addCalendarDays(localToday.value, -(dayCount - 1));
  if (startDate === null) return { ok: false, code: 'invalid_reference_instant' };

  const start = startOfDayIn(startDate, timeZone);
  const endExclusive = endOfDayExclusiveIn(localToday.value, timeZone);
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
