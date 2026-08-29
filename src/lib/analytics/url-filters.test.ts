import { describe, expect, it } from 'vitest';

import {
  buildAnalyticsViewHref,
  parseAnalyticsUrlFilters,
  parseAnalyticsView,
} from './url-filters';

const STRATEGY_ID = '018f0000-0000-7000-8000-000000000001';
const SETUP_ID = '018f0000-0000-7000-8000-000000000002';
const VERSION_ID = '018f0000-0000-7000-8000-000000000003';

describe('Analytics URL filters', () => {
  it('builds a view link with the complete selected filter scope', () => {
    expect(
      buildAnalyticsViewHref(
        {
          range: 'all',
          from: null,
          to: null,
          account: 'all',
          strategy: STRATEGY_ID,
          setup: SETUP_ID,
          version: VERSION_ID,
        },
        'edge',
      ),
    ).toBe(
      `/app/analytics?view=edge&range=all&account=all&strategy=${STRATEGY_ID}&setup=${SETUP_ID}&version=${VERSION_ID}`,
    );
  });

  it.each([
    ['overview', 'overview'],
    ['results', 'results'],
    ['edge', 'edge'],
    ['behavior', 'behavior'],
    ['invalid', 'overview'],
    [['results'], 'overview'],
    [undefined, 'overview'],
  ])('parses Analytics view %j as %s', (value, expected) => {
    expect(parseAnalyticsView(value)).toBe(expected);
  });
  it('defaults to active Account and 90D', () => {
    expect(parseAnalyticsUrlFilters({})).toEqual({
      ok: true,
      input: {},
      selection: {
        range: '90d',
        from: null,
        to: null,
        account: null,
        strategy: null,
        setup: null,
        version: null,
      },
    });
  });

  it('maps the complete approved URL vocabulary to the 09B contract', () => {
    expect(
      parseAnalyticsUrlFilters({
        range: 'all',
        account: 'all',
        strategy: STRATEGY_ID,
        setup: SETUP_ID,
        version: VERSION_ID,
      }),
    ).toEqual({
      ok: true,
      input: {
        datePreset: 'all',
        tradingAccountId: 'all',
        strategyId: STRATEGY_ID,
        setupId: SETUP_ID,
        strategyVersionId: VERSION_ID,
      },
      selection: {
        range: 'all',
        from: null,
        to: null,
        account: 'all',
        strategy: STRATEGY_ID,
        setup: SETUP_ID,
        version: VERSION_ID,
      },
    });
  });

  it('round-trips canonical custom dates without locale formatting', () => {
    const parsed = parseAnalyticsUrlFilters({
      range: 'custom',
      from: '2026-07-10',
      to: '2026-08-12',
    });
    expect(parsed).toEqual({
      ok: true,
      input: {
        datePreset: 'custom',
        fromDate: '2026-07-10',
        toDate: '2026-08-12',
      },
      selection: {
        range: 'custom',
        from: '2026-07-10',
        to: '2026-08-12',
        account: null,
        strategy: null,
        setup: null,
        version: null,
      },
    });
    if (!parsed.ok) return;
    expect(buildAnalyticsViewHref(parsed.selection, 'overview')).toBe(
      '/app/analytics?view=overview&range=custom&from=2026-07-10&to=2026-08-12',
    );
  });

  it.each([
    { range: '7d' },
    { range: 'custom' },
    { range: 'custom', from: '2026-08-02', to: '2026-08-01' },
    { range: 'all', from: '2026-08-01', to: '2026-08-02' },
    { account: 'not-a-uuid' },
    { strategy: [STRATEGY_ID] },
    { symbol: 'XAUUSD' },
    null,
  ])('rejects malformed or unsupported public filters: %j', (value) => {
    expect(parseAnalyticsUrlFilters(value)).toEqual({ ok: false, code: 'invalid_filters' });
  });

  it('Phase 15D: tolerates the Explore nav\'s "view" key alongside valid filters — it is UI state, never a filter', () => {
    expect(parseAnalyticsUrlFilters({ range: '30d', view: 'edge' })).toEqual({
      ok: true,
      input: { datePreset: '30d' },
      selection: {
        range: '30d',
        from: null,
        to: null,
        account: null,
        strategy: null,
        setup: null,
        version: null,
      },
    });
  });

  it('Phase 15D: "view" alone (no other params) still resolves to the default scope', () => {
    expect(parseAnalyticsUrlFilters({ view: 'behavior' })).toEqual({
      ok: true,
      input: {},
      selection: {
        range: '90d',
        from: null,
        to: null,
        account: null,
        strategy: null,
        setup: null,
        version: null,
      },
    });
  });

  it('Phase 15D: stripping "view" is a named exception, not a broadened allowlist — a genuine unknown key beside it still rejects', () => {
    expect(parseAnalyticsUrlFilters({ view: 'edge', symbol: 'XAUUSD' })).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });
});
