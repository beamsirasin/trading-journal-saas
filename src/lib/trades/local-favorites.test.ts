import { describe, expect, it } from 'vitest';

import {
  EMPTY_FAVORITES_STATE,
  favoritesStorageKey,
  parseFavoritesState,
  recordRecent,
  serializeFavoritesState,
  toggleFavorite,
  type FavoritesState,
} from './local-favorites';

describe('favoritesStorageKey', () => {
  it('scopes the key per field and per workspace', () => {
    const symbolKey = favoritesStorageKey('symbol', 'workspace-a');
    const timeframeKey = favoritesStorageKey('timeframe', 'workspace-a');
    const otherWorkspaceKey = favoritesStorageKey('symbol', 'workspace-b');
    expect(symbolKey).not.toBe(timeframeKey);
    expect(symbolKey).not.toBe(otherWorkspaceKey);
    expect(symbolKey).toContain('workspace-a');
  });
});

describe('parseFavoritesState', () => {
  it('returns empty state for null, malformed JSON, or a foreign shape', () => {
    expect(parseFavoritesState(null)).toEqual(EMPTY_FAVORITES_STATE);
    expect(parseFavoritesState('not json')).toEqual(EMPTY_FAVORITES_STATE);
    expect(parseFavoritesState('{"foo":"bar"}')).toEqual(EMPTY_FAVORITES_STATE);
    expect(parseFavoritesState('{"favorites":[1,2],"recents":[]}')).toEqual(EMPTY_FAVORITES_STATE);
  });

  it('round-trips a well-formed state through serialize/parse', () => {
    const state = { favorites: ['XAUUSD', 'BTCUSD'], recents: ['EURUSD'] };
    expect(parseFavoritesState(serializeFavoritesState(state))).toEqual(state);
  });
});

describe('toggleFavorite', () => {
  it('adds a new favorite, trimmed, and ignores a blank value', () => {
    const next = toggleFavorite(EMPTY_FAVORITES_STATE, '  XAUUSD  ');
    expect(next.favorites).toEqual(['XAUUSD']);
    expect(toggleFavorite(EMPTY_FAVORITES_STATE, '   ')).toBe(EMPTY_FAVORITES_STATE);
  });

  it('removes an existing favorite (toggle off)', () => {
    const withFavorite = { favorites: ['XAUUSD'], recents: [] };
    expect(toggleFavorite(withFavorite, 'XAUUSD').favorites).toEqual([]);
  });

  it('caps the favorites list rather than growing unbounded', () => {
    const many = Array.from({ length: 12 }, (_, i) => `SYM${i}`);
    let state: FavoritesState = { favorites: many, recents: [] };
    state = toggleFavorite(state, 'ONE_MORE');
    expect(state.favorites.length).toBe(12);
  });
});

describe('recordRecent', () => {
  it('prepends, dedupes, and caps recents', () => {
    let state = EMPTY_FAVORITES_STATE;
    for (const value of ['A', 'B', 'C', 'A']) {
      state = recordRecent(state, value);
    }
    expect(state.recents).toEqual(['A', 'C', 'B']);
  });

  it('caps recents at 8 entries', () => {
    let state = EMPTY_FAVORITES_STATE;
    for (let i = 0; i < 10; i++) {
      state = recordRecent(state, `V${i}`);
    }
    expect(state.recents.length).toBe(8);
    expect(state.recents[0]).toBe('V9');
  });

  it('ignores a blank value', () => {
    expect(recordRecent(EMPTY_FAVORITES_STATE, '   ')).toBe(EMPTY_FAVORITES_STATE);
  });
});
