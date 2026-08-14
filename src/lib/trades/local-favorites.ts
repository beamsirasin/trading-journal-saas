/**
 * Pure, storage-agnostic Symbol/Timeframe/Session favorites and recents for
 * the Trade creation wizard. No persisted server column exists for this data
 * (`user_preferences` has no favorites/JSON column — see CLAUDE.md §11
 * assumption tracking and the Founder-UAT slice report for why this is
 * deliberately browser-local, not workspace-synced, until a schema decision
 * is made). Every function here takes/returns plain data; the React hook
 * that wires this to `window.localStorage` lives in
 * `src/components/trades/use-trade-plan-favorites.ts`.
 */

export type TradePlanFavoriteField = 'symbol' | 'timeframe' | 'session';

export interface FavoritesState {
  readonly favorites: readonly string[];
  readonly recents: readonly string[];
}

export const EMPTY_FAVORITES_STATE: FavoritesState = { favorites: [], recents: [] };

const MAX_FAVORITES = 12;
const MAX_RECENTS = 8;
const STORAGE_VERSION = 'v1';

/**
 * Scoped per workspace (never globally) so a browser shared across multiple
 * Workspaces never mixes one Workspace's Symbols into another's suggestions
 * — the closest this browser-local mechanism can get to CLAUDE.md §4's
 * tenant-isolation spirit without a real persisted, workspace-scoped column.
 */
export function favoritesStorageKey(field: TradePlanFavoriteField, workspaceId: string): string {
  return `tradingos.trade-plan.${field}.${STORAGE_VERSION}.${workspaceId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Never throws — a corrupt/foreign value at this key is treated as empty, never a crash. */
export function parseFavoritesState(raw: string | null): FavoritesState {
  if (raw === null) return EMPTY_FAVORITES_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !isStringArray((parsed as { favorites?: unknown }).favorites) ||
      !isStringArray((parsed as { recents?: unknown }).recents)
    ) {
      return EMPTY_FAVORITES_STATE;
    }
    return {
      favorites: (parsed as { favorites: string[] }).favorites,
      recents: (parsed as { recents: string[] }).recents,
    };
  } catch {
    return EMPTY_FAVORITES_STATE;
  }
}

export function serializeFavoritesState(state: FavoritesState): string {
  return JSON.stringify(state);
}

export function toggleFavorite(state: FavoritesState, value: string): FavoritesState {
  const normalized = value.trim();
  if (normalized === '') return state;
  const exists = state.favorites.includes(normalized);
  const favorites = exists
    ? state.favorites.filter((item) => item !== normalized)
    : [...state.favorites, normalized].slice(0, MAX_FAVORITES);
  return { ...state, favorites };
}

/** Most-recent-first, deduplicated, capped — called once a Trade is actually created. */
export function recordRecent(state: FavoritesState, value: string): FavoritesState {
  const normalized = value.trim();
  if (normalized === '') return state;
  const recents = [normalized, ...state.recents.filter((item) => item !== normalized)].slice(
    0,
    MAX_RECENTS,
  );
  return { ...state, recents };
}
