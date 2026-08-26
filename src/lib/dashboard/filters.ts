import {
  parseAnalyticsFilters,
  type AnalyticsAccountScope,
  type AnalyticsDatePreset,
  type AnalyticsFilterInput,
} from '@/lib/analytics/filters';

export const DASHBOARD_UNIT_MODES = ['money', 'r', 'percentage'] as const;
export type DashboardUnitMode = (typeof DASHBOARD_UNIT_MODES)[number];

/**
 * Stable extension point for structured dimensions that are deliberately not
 * public Dashboard filters in D2. Widen a field only when its end-to-end data
 * contract is implemented; widgets do not need a new top-level filter shape.
 */
export interface DashboardDimensionFilterState {
  readonly symbol: null;
  readonly side: null;
  readonly session: null;
  readonly timeframe: null;
  readonly ruleAdherence: null;
  readonly mistake: null;
  readonly emotion: null;
}

export interface DashboardFilterState {
  readonly datePreset: AnalyticsDatePreset;
  readonly accountScope: AnalyticsAccountScope;
  readonly strategyId: string | null;
  readonly setupId: string | null;
  /** Advanced/internal dimension in D2; the Dashboard UI does not expose it yet. */
  readonly strategyVersionId: string | null;
  /** Display preference only. It never changes population eligibility or stored values. */
  readonly unitMode: DashboardUnitMode;
  readonly dimensions: DashboardDimensionFilterState;
}

const URL_KEYS = ['range', 'account', 'strategy', 'setup', 'version', 'unit'] as const;
const URL_KEY_SET = new Set<string>(URL_KEYS);

export type ParseDashboardFilterStateResult =
  | { readonly ok: true; readonly state: DashboardFilterState }
  | { readonly ok: false; readonly code: 'invalid_filters' };

/**
 * Canonical Dashboard URL parser. It adapts the existing Analytics identity
 * and date vocabulary instead of introducing competing account/range rules.
 * Unknown keys and array values fail closed.
 */
export function parseDashboardFilterState(value: unknown): ParseDashboardFilterStateResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_filters' };
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !URL_KEY_SET.has(key))) {
    return { ok: false, code: 'invalid_filters' };
  }
  for (const key of URL_KEYS) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') {
      return { ok: false, code: 'invalid_filters' };
    }
  }

  const unitMode = raw.unit ?? 'r';
  if (!(DASHBOARD_UNIT_MODES as readonly unknown[]).includes(unitMode)) {
    return { ok: false, code: 'invalid_filters' };
  }

  const input = {
    ...(raw.range === undefined ? {} : { datePreset: raw.range }),
    ...(raw.account === undefined ? {} : { tradingAccountId: raw.account }),
    ...(raw.strategy === undefined ? {} : { strategyId: raw.strategy }),
    ...(raw.setup === undefined ? {} : { setupId: raw.setup }),
    ...(raw.version === undefined ? {} : { strategyVersionId: raw.version }),
  };
  const parsed = parseAnalyticsFilters(input);
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    state: {
      ...parsed.filters,
      unitMode: unitMode as DashboardUnitMode,
      dimensions: {
        symbol: null,
        side: null,
        session: null,
        timeframe: null,
        ruleAdherence: null,
        mistake: null,
        emotion: null,
      },
    },
  };
}

/** Canonical, stable URL serialization for Dashboard filter state. */
export function serializeDashboardFilterState(state: DashboardFilterState): URLSearchParams {
  const params = new URLSearchParams({ range: state.datePreset, unit: state.unitMode });
  if (state.accountScope.kind === 'all') params.set('account', 'all');
  else if (state.accountScope.kind === 'account') {
    params.set('account', state.accountScope.accountId);
  }
  if (state.strategyId !== null) params.set('strategy', state.strategyId);
  if (state.setupId !== null) params.set('setup', state.setupId);
  if (state.strategyVersionId !== null) params.set('version', state.strategyVersionId);
  return params;
}

export function buildDashboardHref(state: DashboardFilterState): string {
  return `/app?${serializeDashboardFilterState(state).toString()}`;
}

/** Adapts the canonical Dashboard state to the shared Analytics scope resolver. */
export function dashboardAnalyticsInput(state: DashboardFilterState): AnalyticsFilterInput {
  return {
    datePreset: state.datePreset,
    ...(state.accountScope.kind === 'all'
      ? { tradingAccountId: 'all' as const }
      : state.accountScope.kind === 'account'
        ? { tradingAccountId: state.accountScope.accountId }
        : {}),
    ...(state.strategyId === null ? {} : { strategyId: state.strategyId }),
    ...(state.setupId === null ? {} : { setupId: state.setupId }),
    ...(state.strategyVersionId === null ? {} : { strategyVersionId: state.strategyVersionId }),
  };
}
