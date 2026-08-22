import {
  parseAnalyticsFilters,
  type AnalyticsDatePreset,
  type AnalyticsFilterInput,
} from './filters';

const URL_FILTER_KEYS = ['range', 'account', 'strategy', 'setup', 'version'] as const;
const URL_FILTER_KEY_SET = new Set<string>(URL_FILTER_KEYS);

export const ANALYTICS_VIEWS = ['overview', 'results', 'edge', 'behavior'] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

export function parseAnalyticsView(value: unknown): AnalyticsView {
  return typeof value === 'string' && (ANALYTICS_VIEWS as readonly string[]).includes(value)
    ? (value as AnalyticsView)
    : 'overview';
}

export interface AnalyticsUrlSelection {
  readonly range: AnalyticsDatePreset;
  readonly account: string | null;
  readonly strategy: string | null;
  readonly setup: string | null;
  readonly version: string | null;
}

export function buildAnalyticsViewHref(
  selection: AnalyticsUrlSelection,
  view: AnalyticsView,
): string {
  const params = new URLSearchParams({ view, range: selection.range });
  if (selection.account !== null) params.set('account', selection.account);
  if (selection.strategy !== null) params.set('strategy', selection.strategy);
  if (selection.setup !== null) params.set('setup', selection.setup);
  if (selection.version !== null) params.set('version', selection.version);
  return `/app/analytics?${params.toString()}`;
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
 *
 * `view` is the one deliberate exception (Phase 15D's `AnalyticsExploreNav`,
 * `?view=overview|results|edge|behavior`) — client-only UI state read
 * exclusively via `useSearchParams` on the page it scrolls within, never a
 * filter and never passed to any DAL/service call. It is stripped BEFORE the
 * unknown-key check below rather than added to `URL_FILTER_KEY_SET`, so this
 * function's own filter vocabulary stays exactly as closed as before; only
 * one specific, understood, harmless key is tolerated, not an open door for
 * arbitrary unrecognized params.
 */
export function parseAnalyticsUrlFilters(value: unknown): ParseAnalyticsUrlFiltersResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_filters' };
  }

  const { view: _view, ...raw } = value as Record<string, unknown>;
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
