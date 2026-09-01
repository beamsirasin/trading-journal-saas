import {
  parseDashboardFilterState,
  serializeDashboardFilterState,
  type DashboardFilterState,
} from '@/lib/dashboard/filters';

import { isTradeAttentionKind, type TradeAttentionKind } from './constants';
import {
  DEFAULT_TRADES_STATE_FILTER,
  parseTradesStateFilter,
  type TradesStateFilter,
} from './state-filter';

/**
 * THE TRADES WORKSPACE'S URL, PARSED ONCE.
 *
 * The workspace scopes its list and its four summary figures with the SAME
 * canonical filter vocabulary the Dashboard uses — `range`/`from`/`to`,
 * `account`, `strategy`, `setup`, `version`, `unit`. That vocabulary is not
 * re-implemented here: this module hands those keys, and only those keys, to
 * `parseDashboardFilterState` and keeps its result verbatim. A second parser
 * with its own idea of what `range=90d` means is exactly how two surfaces end
 * up disagreeing about which Trades they are describing.
 *
 * What this module DOES own is the workspace's own non-filter state — which
 * top-level population is selected, which Needs Attention bucket is applied,
 * which Trade is open in the Details sheet, and where the keyset pager is.
 * Those keys are meaningless to the Dashboard parser (it would fail closed on
 * every one of them), so they are stripped before delegation and validated
 * here.
 *
 * IT STILL FAILS CLOSED. A key belonging to neither set is an error, not a
 * silently ignored typo — otherwise `?strategyy=<id>` would quietly widen the
 * population to everything while the reader believed a filter was applied.
 */
const FILTER_URL_KEYS = [
  'range',
  'from',
  'to',
  'account',
  'strategy',
  'setup',
  'version',
  'unit',
] as const;

/**
 * The workspace's own keys.
 *
 * `state` is the top-level All / Open / Closed population, `date` the
 * selected-day narrowing, `cursor`/`trail` the keyset pager, `trade`/`tab` the
 * Details sheet.
 *
 * TWO KEYS ARE ACCEPTED BUT NO LONGER ACTED ON, DELIBERATELY. `view` selected
 * the retired Calendar mode and `month` paged its grid; `section` is the
 * retired five-section Trade Detail contract. All three still appear in links
 * traders bookmarked, in browser history, and in the Dashboard's own Needs
 * Attention hrefs (`?view=log&attention=...`). Failing closed on them would
 * turn every one of those into an error page, so they are tolerated and
 * ignored — except `section`, which is still HONOURED (see
 * `parseTradeDetailsTab`). Removing them from this list is a later cleanup,
 * once no link in the wild can still carry one.
 */
const WORKSPACE_URL_KEYS = [
  'state',
  'attention',
  'trade',
  'tab',
  'cursor',
  'trail',
  'date',
  // Tolerated, not acted on — see above.
  'view',
  'month',
  'section',
] as const;

const KNOWN_URL_KEYS = new Set<string>([...FILTER_URL_KEYS, ...WORKSPACE_URL_KEYS]);

export interface TradesWorkspaceState {
  readonly filters: DashboardFilterState;
  /** The top-level population: every Trade, open positions only, or settled Trades only. */
  readonly state: TradesStateFilter;
  readonly attention: TradeAttentionKind | null;
}

export type ParseTradesWorkspaceStateResult =
  | { readonly ok: true; readonly state: TradesWorkspaceState }
  | { readonly ok: false; readonly code: 'invalid_filters' };

function single(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseTradesWorkspaceState(value: unknown): ParseTradesWorkspaceStateResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'invalid_filters' };
  }
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !KNOWN_URL_KEYS.has(key))) {
    return { ok: false, code: 'invalid_filters' };
  }

  // Only the filter keys are forwarded, so the canonical parser never sees a
  // key it is entitled to reject.
  const filterInput: Record<string, unknown> = {};
  for (const key of FILTER_URL_KEYS) {
    if (raw[key] !== undefined) filterInput[key] = raw[key];
  }
  const parsed = parseDashboardFilterState(filterInput);
  if (!parsed.ok) return { ok: false, code: 'invalid_filters' };

  const state = parseTradesStateFilter(single(raw.state));
  const attentionValue = single(raw.attention);
  const attention =
    attentionValue !== undefined && isTradeAttentionKind(attentionValue) ? attentionValue : null;

  return { ok: true, state: { filters: parsed.state, state, attention } };
}

/**
 * The workspace state that must SURVIVE a filter transition, as serializable
 * params for `buildDashboardHref`'s `extraParams`.
 *
 * `state` and `attention` survive: changing the Account or the date range does
 * not mean the reader wanted to leave the population they are working in.
 * `trade`, `tab`, `cursor`, `trail` and `date` deliberately do NOT: page 4 of
 * the old population is not page 4 of the new one, and a Trade that is open in
 * the sheet may not even be in the new scope.
 *
 * The default population is spelled by OMITTING the key rather than by writing
 * `state=all` into every link, so a plain `/app/trades` stays the canonical
 * address of the whole journal.
 */
export function tradesWorkspaceCarryParams(state: TradesWorkspaceState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.state !== DEFAULT_TRADES_STATE_FILTER) params.state = state.state;
  if (state.attention !== null) params.attention = state.attention;
  return params;
}

export const TRADES_WORKSPACE_BASE_PATH = '/app/trades';

/** A canonical Trades workspace href: filter state plus the carried population/bucket. */
export function buildTradesWorkspaceHref(state: TradesWorkspaceState): string {
  const params = serializeDashboardFilterState(state.filters);
  for (const [key, value] of Object.entries(tradesWorkspaceCarryParams(state))) {
    if (!params.has(key)) params.set(key, value);
  }
  return `${TRADES_WORKSPACE_BASE_PATH}?${params.toString()}`;
}
