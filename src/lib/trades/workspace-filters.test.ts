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
      view: 'calendar',
      trade: 'anything',
      tab: 'review',
      cursor: 'abc',
      trail: 'a,b',
      month: '2026-08',
      date: '2026-08-20',
      section: 'actual',
    });
    expect(state.view).toBe('calendar');
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

  it('drops the bucket in Calendar view, where a list filter has nothing to filter', () => {
    expect(parsed({ view: 'calendar', attention: 'open' }).attention).toBeNull();
  });
});

describe('carrying workspace state through a filter transition', () => {
  it('carries the view and the applied bucket', () => {
    const state = parsed({ view: 'log', attention: 'reviews-pending' });
    expect(tradesWorkspaceCarryParams(state)).toEqual({
      view: 'log',
      attention: 'reviews-pending',
    });
  });

  it('omits the bucket key entirely when none is applied', () => {
    expect(tradesWorkspaceCarryParams(parsed({ view: 'log' }))).toEqual({ view: 'log' });
  });

  it('does not carry the selection or the pager', () => {
    // Page 4 of the old population is not page 4 of the new one, and a Trade
    // open in the sheet may not survive the new scope at all.
    const carried = tradesWorkspaceCarryParams(
      parsed({
        view: 'log',
        trade: 'x',
        tab: 'review',
        cursor: 'c',
        trail: 't',
        date: '2026-08-20',
      }),
    );
    expect(carried).toEqual({ view: 'log' });
  });
});

describe('buildTradesWorkspaceHref', () => {
  it('lands on the Trades workspace, never the Dashboard', () => {
    const href = buildTradesWorkspaceHref(parsed({ view: 'log' }));
    expect(href.startsWith(`${TRADES_WORKSPACE_BASE_PATH}?`)).toBe(true);
  });

  it('serializes the canonical filter state alongside the carried view', () => {
    const href = buildTradesWorkspaceHref(parsed({ range: '30d', view: 'log', attention: 'open' }));
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('range')).toBe('30d');
    expect(params.get('view')).toBe('log');
    expect(params.get('attention')).toBe('open');
  });
});
