import { describe, expect, it } from 'vitest';

import {
  buildTradesWorkspaceHref,
  parseTradesWorkspaceState,
  TRADES_WORKSPACE_BASE_PATH,
  tradesWorkspaceCarryParams,
} from './workspace-filters';

function parsed(query: Record<string, string | string[] | undefined>) {
  const result = parseTradesWorkspaceState(query);
  if (!result.ok) throw new Error(`expected a parse, got ${result.code}`);
  return result.state;
}

describe('parseTradesWorkspaceState — the canonical filter vocabulary', () => {
  it('delegates the filter keys and keeps the canonical result verbatim', () => {
    const state = parsed({
      range: 'custom',
      from: '2026-08-01',
      to: '2026-08-31',
      account: 'all',
      strategy: '018f0000-0000-7000-8000-000000000001',
      unit: 'money',
    });

    expect(state.filters.datePreset).toBe('custom');
    expect(state.filters.customDateRange).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(state.filters.accountScope).toEqual({ kind: 'all' });
    expect(state.filters.strategyId).toBe('018f0000-0000-7000-8000-000000000001');
    expect(state.filters.unitMode).toBe('money');
  });

  it('defaults to the whole history rather than a silent window', () => {
    // The Dashboard's own default, inherited rather than redeclared: a
    // workspace that silently hid everything older than 90 days would look
    // empty to a trader whose journal predates it.
    expect(parsed({}).filters.datePreset).toBe('all');
  });

  it('reads the workspace keys the filter parser knows nothing about', () => {
    const state = parsed({
      state: 'open',
      trade: 'anything',
      tab: 'review',
      cursor: 'abc',
      trail: 'a,b',
      date: '2026-08-20',
    });
    expect(state.state).toBe('open');
  });

  it('still tolerates the retired Calendar keys rather than erroring on old links', () => {
    // `?view=log&attention=...` is exactly what the Dashboard's Needs Attention
    // panel links with, and `month`/`section` sit in bookmarks and history.
    // Failing closed on any of them would turn a working link into an error
    // page; they are accepted and simply not acted on.
    const state = parsed({ view: 'calendar', month: '2026-08', section: 'actual' });
    expect(state.state).toBe('all');
  });
});

describe('parseTradesWorkspaceState — the top-level population', () => {
  it('defaults to All Trades', () => {
    expect(parsed({}).state).toBe('all');
  });

  it('reads each state from the URL', () => {
    expect(parsed({ state: 'open' }).state).toBe('open');
    expect(parsed({ state: 'closed' }).state).toBe('closed');
    expect(parsed({ state: 'all' }).state).toBe('all');
  });

  it('widens an unrecognised or repeated state to All rather than failing the page', () => {
    expect(parsed({ state: 'planned' }).state).toBe('all');
    expect(parsed({ state: ['open', 'closed'] }).state).toBe('all');
  });
});

describe('parseTradesWorkspaceState — failing closed', () => {
  it('rejects a key belonging to neither vocabulary', () => {
    // The whole point: a typo must not quietly widen the population to
    // everything while the reader believes a filter is applied.
    expect(parseTradesWorkspaceState({ strategyy: 'x' })).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });

  it('rejects an invalid value inside a key it does own', () => {
    expect(parseTradesWorkspaceState({ range: 'last-fortnight' })).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
    expect(parseTradesWorkspaceState({ unit: 'bananas' })).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });

  it('rejects a repeated filter key rather than choosing one of two intents', () => {
    expect(parseTradesWorkspaceState({ range: ['30d', '90d'] })).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });

  it('rejects a non-object', () => {
    expect(parseTradesWorkspaceState(null).ok).toBe(false);
    expect(parseTradesWorkspaceState([]).ok).toBe(false);
  });
});

describe('parseTradesWorkspaceState — the attention bucket', () => {
  it('accepts every bucket the counting layer can produce', () => {
    for (const bucket of [
      'open',
      'system-pending',
      'unclassified',
      'reviews-pending',
      'needs-details',
    ] as const) {
      expect(parsed({ view: 'log', attention: bucket }).attention).toBe(bucket);
    }
  });

  it('drops an unrecognised or repeated bucket instead of failing the page', () => {
    expect(parsed({ view: 'log', attention: 'nonsense' }).attention).toBeNull();
    expect(parsed({ view: 'log', attention: ['open', 'unclassified'] }).attention).toBeNull();
  });

  it('keeps the bucket whatever the population is — the page is always a list now', () => {
    // The Calendar mode this used to be suppressed for no longer exists.
    expect(parsed({ attention: 'open' }).attention).toBe('open');
    expect(parsed({ state: 'closed', attention: 'reviews-pending' }).attention).toBe(
      'reviews-pending',
    );
  });
});

describe('carrying workspace state through a filter transition', () => {
  it('carries the selected population and the applied bucket', () => {
    // Changing the Account or the date range does not mean the reader wanted
    // to leave the population they are working in.
    const state = parsed({ state: 'open', attention: 'reviews-pending' });
    expect(tradesWorkspaceCarryParams(state)).toEqual({
      state: 'open',
      attention: 'reviews-pending',
    });
  });

  it('spells the default population by omitting the key', () => {
    // `/app/trades` stays the canonical address of the whole journal.
    expect(tradesWorkspaceCarryParams(parsed({}))).toEqual({});
    expect(tradesWorkspaceCarryParams(parsed({ state: 'all' }))).toEqual({});
  });

  it('does not carry the selection or the pager', () => {
    // Page 4 of the old population is not page 4 of the new one, and a Trade
    // open in the sheet may not survive the new scope at all.
    const carried = tradesWorkspaceCarryParams(
      parsed({
        state: 'closed',
        trade: 'x',
        tab: 'review',
        cursor: 'c',
        trail: 't',
        date: '2026-08-20',
      }),
    );
    expect(carried).toEqual({ state: 'closed' });
  });
});

describe('buildTradesWorkspaceHref', () => {
  it('lands on the Trades workspace, never the Dashboard', () => {
    const href = buildTradesWorkspaceHref(parsed({}));
    expect(href.startsWith(`${TRADES_WORKSPACE_BASE_PATH}?`)).toBe(true);
  });

  it('serializes the canonical filter state alongside the carried population', () => {
    const href = buildTradesWorkspaceHref(
      parsed({ range: '30d', state: 'closed', attention: 'open' }),
    );
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('range')).toBe('30d');
    expect(params.get('state')).toBe('closed');
    expect(params.get('attention')).toBe('open');
  });

  it('writes no state key for the default population', () => {
    const href = buildTradesWorkspaceHref(parsed({ range: '30d' }));
    expect(new URLSearchParams(href.slice(href.indexOf('?') + 1)).get('state')).toBeNull();
  });
});
