import {
  parseDashboardFilterState,
  serializeDashboardFilterState,
  type DashboardFilterState,
} from '@/lib/dashboard/filters';

import { isTradeAttentionKind, type TradeAttentionKind } from './constants';
import { parseTradesView, type TradesView } from './view';

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
 * view is showing, which Needs Attention bucket is applied, which Trade is
 * open in the Details sheet, and where the keyset pager is. Those keys are
 * meaningless to the Dashboard parser (it would fail closed on every one of
 * them), so they are stripped before delegation and validated here.
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
 * `month`/`date` belong to the Trading Calendar view, `cursor`/`trail` to the
 * keyset pager, `trade`/`tab` to the Details sheet. All of them predate this
 * pass except `tab`, and all of them keep working exactly as before.
 *
 * `section` is the RETIRED five-section Trade Detail contract
 * (`lib/trades/section.ts`). It is still accepted, and still honoured, because
 * a link a trader bookmarked or shared last week must not start failing
 * closed — see {@link legacySectionTab}.
 */
const WORKSPACE_URL_KEYS = [
  'view',
  'attention',
  'trade',
  'tab',
  'section',
  'cursor',
  'trail',
  'month',
  'date',
] as const;

const KNOWN_URL_KEYS = new Set<string>([...FILTER_URL_KEYS, ...WORKSPACE_URL_KEYS]);

export interface TradesWorkspaceState {
  readonly filters: DashboardFilterState;
  readonly view: TradesView;
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

  const view = parseTradesView(single(raw.view));
  // A bucket filter belongs to the list, so it is dropped in Calendar view
  // rather than silently narrowing a month grid the reader cannot see it in.
  const attentionValue = single(raw.attention);
  const attention =
    view === 'log' && attentionValue !== undefined && isTradeAttentionKind(attentionValue)
      ? attentionValue
      : null;

  return { ok: true, state: { filters: parsed.state, view, attention } };
}

/**
 * The workspace state that must SURVIVE a filter transition, as serializable
 * params for `buildDashboardHref`'s `extraParams`.
 *
 * `view` and `attention` survive: changing the date range does not mean the
 * reader wanted to leave the Calendar or clear the bucket they are working
 * through. `trade`, `tab`, `cursor`, `trail` and `date` deliberately do NOT:
 * page 4 of the old population is not page 4 of the new one, and a Trade
 * that is open in the sheet may not even be in the new scope.
 */
export function tradesWorkspaceCarryParams(state: TradesWorkspaceState): Record<string, string> {
  const params: Record<string, string> = { view: state.view };
  if (state.attention !== null) params.attention = state.attention;
  return params;
}

export const TRADES_WORKSPACE_BASE_PATH = '/app/trades';

/** A canonical Trades workspace href: filter state plus the carried view/bucket. */
export function buildTradesWorkspaceHref(state: TradesWorkspaceState): string {
  const params = serializeDashboardFilterState(state.filters);
  for (const [key, value] of Object.entries(tradesWorkspaceCarryParams(state))) {
    if (!params.has(key)) params.set(key, value);
  }
  return `${TRADES_WORKSPACE_BASE_PATH}?${params.toString()}`;
}
