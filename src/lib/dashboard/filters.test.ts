import { describe, expect, it } from 'vitest';

import {
  buildDashboardHref,
  dashboardAnalyticsInput,
  parseDashboardFilterState,
  serializeDashboardFilterState,
} from './filters';

const ACCOUNT_ID = '019c43dc-8c6c-7000-8000-000000000001';
const STRATEGY_ID = '019c43dc-8c6c-7000-8000-000000000002';
const SETUP_ID = '019c43dc-8c6c-7000-8000-000000000003';
const VERSION_ID = '019c43dc-8c6c-7000-8000-000000000004';

describe('Dashboard filter contract', () => {
  it('defaults to active Account, 90D, no framework filter, and R display mode', () => {
    expect(parseDashboardFilterState({})).toEqual({
      ok: true,
      state: {
        datePreset: '90d',
        customDateRange: null,
        accountScope: { kind: 'active' },
        strategyId: null,
        setupId: null,
        strategyVersionId: null,
        unitMode: 'r',
        dimensions: {
          symbol: null,
          side: null,
          session: null,
          timeframe: null,
          ruleAdherence: null,
          mistake: null,
          emotion: null,
        },
      },
    });
  });

  it('round-trips Account/date/Strategy/Setup, advanced Version, and unit mode', () => {
    const parsed = parseDashboardFilterState({
      range: '30d',
      account: ACCOUNT_ID,
      strategy: STRATEGY_ID,
      setup: SETUP_ID,
      version: VERSION_ID,
      unit: 'money',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDashboardFilterState(parsed.state).toString()).toBe(
      `range=30d&unit=money&account=${ACCOUNT_ID}&strategy=${STRATEGY_ID}&setup=${SETUP_ID}&version=${VERSION_ID}`,
    );
    expect(
      parseDashboardFilterState(Object.fromEntries(serializeDashboardFilterState(parsed.state))),
    ).toEqual(parsed);
    expect(dashboardAnalyticsInput(parsed.state)).toEqual({
      datePreset: '30d',
      tradingAccountId: ACCOUNT_ID,
      strategyId: STRATEGY_ID,
      setupId: SETUP_ID,
      strategyVersionId: VERSION_ID,
    });
  });

  it('serializes all Accounts without inventing an FX policy', () => {
    const parsed = parseDashboardFilterState({ account: 'all', range: 'all', unit: 'percentage' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(buildDashboardHref(parsed.state)).toBe('/app?range=all&unit=percentage&account=all');
  });

  it('round-trips one canonical inclusive custom range into the Analytics input', () => {
    const parsed = parseDashboardFilterState({
      range: 'custom',
      from: '2026-07-10',
      to: '2026-08-12',
      unit: 'r',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(serializeDashboardFilterState(parsed.state).toString()).toBe(
      'range=custom&unit=r&from=2026-07-10&to=2026-08-12',
    );
    expect(dashboardAnalyticsInput(parsed.state)).toEqual({
      datePreset: 'custom',
      fromDate: '2026-07-10',
      toDate: '2026-08-12',
    });
  });

  it.each([
    null,
    { range: '7d' },
    { range: 'custom' },
    { range: 'custom', from: '2026-08-01' },
    { range: 'custom', from: '2026-08-02', to: '2026-08-01' },
    { range: 'custom', from: '2026-02-30', to: '2026-03-01' },
    { range: '30d', from: '2026-08-01', to: '2026-08-02' },
    { account: 'not-a-uuid' },
    { strategy: [STRATEGY_ID] },
    { unit: 'pips' },
    { symbol: 'XAUUSD' },
    { confirmation: 'looks good' },
  ])('fails closed for malformed or unsupported input: %j', (value) => {
    expect(parseDashboardFilterState(value)).toEqual({ ok: false, code: 'invalid_filters' });
  });
});
