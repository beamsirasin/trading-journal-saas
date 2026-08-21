import { describe, expect, it } from 'vitest';

import { parseAnalyticsUrlFilters } from './url-filters';

const STRATEGY_ID = '018f0000-0000-7000-8000-000000000001';
const SETUP_ID = '018f0000-0000-7000-8000-000000000002';
const VERSION_ID = '018f0000-0000-7000-8000-000000000003';

describe('Analytics URL filters', () => {
  it('defaults to active Account and 90D', () => {
    expect(parseAnalyticsUrlFilters({})).toEqual({
      ok: true,
      input: {},
      selection: { range: '90d', account: null, strategy: null, setup: null, version: null },
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
        account: 'all',
        strategy: STRATEGY_ID,
        setup: SETUP_ID,
        version: VERSION_ID,
      },
    });
  });

  it.each([
    { range: '7d' },
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
      selection: { range: '30d', account: null, strategy: null, setup: null, version: null },
    });
  });

  it('Phase 15D: "view" alone (no other params) still resolves to the default scope', () => {
    expect(parseAnalyticsUrlFilters({ view: 'behavior' })).toEqual({
      ok: true,
      input: {},
      selection: { range: '90d', account: null, strategy: null, setup: null, version: null },
    });
  });

  it('Phase 15D: stripping "view" is a named exception, not a broadened allowlist — a genuine unknown key beside it still rejects', () => {
    expect(parseAnalyticsUrlFilters({ view: 'edge', symbol: 'XAUUSD' })).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });
});
