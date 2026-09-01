import { describe, expect, it } from 'vitest';

import { TRADE_STATUSES } from './constants';
import {
  DEFAULT_TRADES_STATE_FILTER,
  parseTradesStateFilter,
  TRADES_STATE_FILTERS,
  tradesStateFilterStatus,
} from './state-filter';

describe('the three Trades workspace populations', () => {
  it('offers All, Open and Closed, in that order', () => {
    expect([...TRADES_STATE_FILTERS]).toEqual(['all', 'open', 'closed']);
  });

  it('defaults to All Trades', () => {
    expect(DEFAULT_TRADES_STATE_FILTER).toBe('all');
    expect(parseTradesStateFilter(undefined)).toBe('all');
  });

  it('offers no Calendar mode: the page is a Trade Log at all times', () => {
    expect(TRADES_STATE_FILTERS as readonly string[]).not.toContain('calendar');
    expect(TRADES_STATE_FILTERS as readonly string[]).not.toContain('log');
  });
});

describe('parseTradesStateFilter', () => {
  it('accepts every state', () => {
    for (const state of TRADES_STATE_FILTERS) {
      expect(parseTradesStateFilter(state)).toBe(state);
    }
  });

  it('widens to All rather than failing on an unrecognised or repeated value', () => {
    // Showing the whole journal is never wrong, only wider than asked — and
    // the control itself will show which state is applied.
    expect(parseTradesStateFilter('planned')).toBe('all');
    expect(parseTradesStateFilter('calendar')).toBe('all');
    expect(parseTradesStateFilter(['open', 'closed'])).toBe('all');
    expect(parseTradesStateFilter('')).toBe('all');
  });
});

describe('tradesStateFilterStatus — the canonical lifecycle value each state means', () => {
  it('narrows Open to exactly the canonical open status', () => {
    expect(tradesStateFilterStatus('open')).toBe('open');
  });

  it('narrows Closed to exactly the canonical closed status', () => {
    expect(tradesStateFilterStatus('closed')).toBe('closed');
  });

  it('adds no condition at all for All Trades', () => {
    expect(tradesStateFilterStatus('all')).toBeNull();
  });

  it('only ever returns a real member of the Trade lifecycle vocabulary', () => {
    // This is what keeps the control a routing decision rather than a second
    // definition of what "open" means.
    for (const state of TRADES_STATE_FILTERS) {
      const status = tradesStateFilterStatus(state);
      if (status !== null) expect(TRADE_STATUSES).toContain(status);
    }
  });

  it('leaves PLANNED and CANCELED out of both narrowed populations', () => {
    // A planned Trade was never entered — there is no exposure to call open —
    // and a canceled one never produced a result to call closed. Neither is
    // reachable through Open or Closed; both remain visible under All Trades.
    const narrowed = TRADES_STATE_FILTERS.map(tradesStateFilterStatus).filter(
      (status) => status !== null,
    );
    expect(narrowed).not.toContain('planned');
    expect(narrowed).not.toContain('canceled');
    expect(new Set(narrowed)).toEqual(new Set(['open', 'closed']));
  });
});
