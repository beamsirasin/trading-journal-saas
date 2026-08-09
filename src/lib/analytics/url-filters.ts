import {
  parseAnalyticsFilters,
  type AnalyticsDatePreset,
  type AnalyticsFilterInput,
} from './filters';

const URL_FILTER_KEYS = ['range', 'account', 'strategy', 'setup', 'version'] as const;
const URL_FILTER_KEY_SET = new Set<string>(URL_FILTER_KEYS);

export interface AnalyticsUrlSelection {
  readonly range: AnalyticsDatePreset;
  readonly account: string | null;
  readonly strategy: string | null;
  readonly setup: string | null;
  readonly version: string | null;
}

export type ParseAnalyticsUrlFiltersResult =
  | {
      readonly ok: true;
      readonly input: AnalyticsFilterInput;
      readonly selection: AnalyticsUrlSelection;
    }
  | { readonly ok: false; readonly code: 'invalid_filters' };

/**
 * Maps the public Analytics URL vocabulary onto the closed 09B filter input.
 * Unknown keys and array values are rejected so a malformed link never
 * broadens into a valid but unintended population.
 */
export function parseAnalyticsUrlFilters(value: unknown): ParseAnalyticsUrlFiltersResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_filters' };
  }

  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !URL_FILTER_KEY_SET.has(key))) {
    return { ok: false, code: 'invalid_filters' };
  }
  for (const key of URL_FILTER_KEYS) {
    const item = raw[key];
    if (item !== undefined && typeof item !== 'string') {
      return { ok: false, code: 'invalid_filters' };
    }
  }

  const input = {
    ...(raw.range === undefined ? {} : { datePreset: raw.range as string }),
    ...(raw.account === undefined ? {} : { tradingAccountId: raw.account as string }),
    ...(raw.strategy === undefined ? {} : { strategyId: raw.strategy as string }),
    ...(raw.setup === undefined ? {} : { setupId: raw.setup as string }),
    ...(raw.version === undefined ? {} : { strategyVersionId: raw.version as string }),
  };
  const parsed = parseAnalyticsFilters(input);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    input: input as AnalyticsFilterInput,
    selection: {
      range: parsed.filters.datePreset,
      account:
        parsed.filters.accountScope.kind === 'active'
          ? null
          : parsed.filters.accountScope.kind === 'all'
            ? 'all'
            : parsed.filters.accountScope.accountId,
      strategy: parsed.filters.strategyId,
      setup: parsed.filters.setupId,
      version: parsed.filters.strategyVersionId,
    },
  };
}
