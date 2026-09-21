'use client';

import { useReducer } from 'react';

import {
  EMPTY_FAVORITES_STATE,
  favoritesStorageKey,
  parseFavoritesState,
  recordRecent,
  serializeFavoritesState,
  toggleFavorite,
  type FavoritesState,
  type TradePlanFavoriteField,
} from '@/lib/trades/local-favorites';
import { useIsHydrated } from '@/hooks/use-is-hydrated';

function readFavoritesFromStorage(key: string): FavoritesState {
  try {
    return parseFavoritesState(window.localStorage.getItem(key));
  } catch {
    return EMPTY_FAVORITES_STATE;
  }
}

/**
 * Browser-`localStorage`-backed Symbol/Timeframe/Session favorites and
 * recents for one Trade-creation session. Deliberately NOT a server
 * preference (see `src/lib/trades/local-favorites.ts`'s doc comment).
 *
 * Follows this codebase's existing `useIsHydrated` idiom
 * (`src/hooks/use-is-hydrated.ts`, already used by `theme-selector.tsx`) for
 * `localStorage`-derived UI: render the empty/server snapshot until
 * hydrated, then read `localStorage` directly at render time — never a
 * `useEffect` that calls `setState`, which cascades an extra render and is
 * flagged by this project's React Compiler lint rule. A tiny `useReducer`
 * counter forces a re-render after a write, since the source of truth is
 * `localStorage` itself, not local component state. No manual `useCallback`
 * — this codebase relies on the React Compiler's automatic memoization
 * (see `theme-selector.tsx`/`use-is-hydrated.ts`, neither of which hand-write
 * one either).
 */
export function useTradePlanFavorites(field: TradePlanFavoriteField, workspaceId: string) {
  const key = favoritesStorageKey(field, workspaceId);
  const isHydrated = useIsHydrated();
  const [, forceRerender] = useReducer((tick: number) => tick + 1, 0);

  const state = isHydrated ? readFavoritesFromStorage(key) : EMPTY_FAVORITES_STATE;

  function persist(next: FavoritesState) {
    try {
      window.localStorage.setItem(key, serializeFavoritesState(next));
    } catch {
      /* Storage unavailable/full/blocked (private browsing) — favorites degrade to session-only, never a hard failure. */
    }
    forceRerender();
  }

  function toggle(value: string) {
    persist(toggleFavorite(state, value));
  }

  function recordUse(value: string) {
    persist(recordRecent(state, value));
  }

  return { favorites: state.favorites, recents: state.recents, toggle, recordUse };
}
