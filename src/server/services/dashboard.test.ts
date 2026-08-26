import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';

import { getDashboardPageData } from './dashboard';

const { getDashboardRawData } = vi.hoisted(() => ({
  getDashboardRawData: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/dal/analytics', () => ({ getDashboardRawData }));

const FILTERS: DashboardFilterState = {
  datePreset: '30d',
  accountScope: { kind: 'account', accountId: '019c43dc-8c6c-7000-8000-000000000001' },
  strategyId: '019c43dc-8c6c-7000-8000-000000000002',
  setupId: '019c43dc-8c6c-7000-8000-000000000003',
  strategyVersionId: null,
  unitMode: 'money',
  dimensions: {
    symbol: null,
    side: null,
    session: null,
    timeframe: null,
    ruleAdherence: null,
    mistake: null,
    emotion: null,
  },
};

describe('Dashboard service orchestration', () => {
  beforeEach(() => {
    getDashboardRawData.mockReset();
    getDashboardRawData.mockResolvedValue({
      ok: true,
      data: {
        filters: {
          datePreset: '30d',
          dateBounds: {
            kind: 'bounded',
            start: '2026-07-11T00:00:00.000Z',
            endExclusive: '2026-08-10T00:00:00.000Z',
          },
          timezone: 'UTC',
          accountScope: {
            kind: 'account',
            accountId: '019c43dc-8c6c-7000-8000-000000000001',
            source: 'explicit',
          },
          strategyId: '019c43dc-8c6c-7000-8000-000000000002',
          setupId: '019c43dc-8c6c-7000-8000-000000000003',
          strategyVersionId: null,
        },
        account: {
          kind: 'account',
          source: 'explicit',
          account: {
            id: '019c43dc-8c6c-7000-8000-000000000001',
            name: 'Explicit',
            accountMode: 'live',
            baseCurrency: 'USD',
            startingBalance: '10000',
          },
        },
        trader: [],
        system: [],
        paired: [],
        attention: {
          openTrades: 0,
          pendingSystemOutcomes: 0,
          unclassifiedTrades: 0,
          reviewsPending: 0,
          needsExecutionDetails: 0,
        },
        recentTrades: [],
      },
    });
  });

  it('uses one narrow DAL bundle and propagates Account/date/Strategy/Setup exactly', async () => {
    const result = await getDashboardPageData(FILTERS, {
      referenceInstant: new Date('2026-08-09T12:00:00Z'),
    });
    expect(getDashboardRawData).toHaveBeenCalledTimes(1);
    expect(getDashboardRawData).toHaveBeenCalledWith(
      {
        datePreset: '30d',
        tradingAccountId: '019c43dc-8c6c-7000-8000-000000000001',
        strategyId: '019c43dc-8c6c-7000-8000-000000000002',
        setupId: '019c43dc-8c6c-7000-8000-000000000003',
      },
      { referenceInstant: new Date('2026-08-09T12:00:00Z') },
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        filters: FILTERS,
        scope: {
          datePreset: '30d',
          strategyId: FILTERS.strategyId,
          setupId: FILTERS.setupId,
        },
        availability: { trader: 'empty', system: 'empty', comparison: 'empty' },
      },
    });
  });

  /**
   * D5A adds the paired trade series, the daily rollup and the Gap
   * distribution — all composed in memory from the Population C records the
   * D2 bundle ALREADY fetches. If a future change gives the series its own
   * read, this call count is what catches it: the Dashboard's whole
   * architecture is one bundle, not one fetch per widget.
   */
  it('composes the D5 comparison series from the existing bundle, with no extra read', async () => {
    const result = await getDashboardPageData(FILTERS);
    expect(getDashboardRawData).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.comparison.status).toBe('empty');
    if (result.data.comparison.status !== 'empty') throw new Error('unreachable');
    expect(result.data.comparison.reason).toBe('no_comparable_trades');
    expect(result.data.comparison.summary.comparableCount).toBe(0);
  });

  it('passes through scope failures without composing widget data', async () => {
    getDashboardRawData.mockResolvedValueOnce({ ok: false, code: 'invalid_filters' });
    await expect(getDashboardPageData(FILTERS)).resolves.toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });
});
