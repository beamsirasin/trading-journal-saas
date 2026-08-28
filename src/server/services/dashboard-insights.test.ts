import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';

import { getDashboardInsightData } from './dashboard-insights';

const { getDashboardInsightRawData } = vi.hoisted(() => ({
  getDashboardInsightRawData: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/dal/dashboard-insights', () => ({ getDashboardInsightRawData }));

const ACCOUNT_ID = '019c43dc-8c6c-7000-8000-000000000001';
const STRATEGY_ID = '019c43dc-8c6c-7000-8000-000000000002';
const SETUP_ID = '019c43dc-8c6c-7000-8000-000000000003';
const REFERENCE = new Date('2026-09-01T12:00:00.000Z');
const FILTERS: DashboardFilterState = {
  datePreset: '30d',
  accountScope: { kind: 'account', accountId: ACCOUNT_ID },
  strategyId: STRATEGY_ID,
  setupId: SETUP_ID,
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
};

describe('Dashboard Insight service orchestration', () => {
  beforeEach(() => {
    getDashboardInsightRawData.mockReset();
    getDashboardInsightRawData.mockResolvedValue({
      ok: true,
      data: {
        scope: {
          datePreset: '30d',
          dateBounds: {
            kind: 'bounded',
            start: '2026-08-03T00:00:00.000Z',
            endExclusive: '2026-09-02T00:00:00.000Z',
          },
          accountScope: { kind: 'account', accountId: ACCOUNT_ID, source: 'explicit' },
          strategyId: STRATEGY_ID,
          setupId: SETUP_ID,
          strategyVersionId: null,
        },
        actualTrades: [],
        systemTrades: [],
        emotions: [],
        ruleChecks: [],
        mistakes: [],
      },
    });
  });

  it('uses one server boundary and preserves Account/date/Strategy/Setup scope', async () => {
    const result = await getDashboardInsightData(FILTERS, { referenceInstant: REFERENCE });
    expect(getDashboardInsightRawData).toHaveBeenCalledTimes(1);
    expect(getDashboardInsightRawData).toHaveBeenCalledWith(
      {
        datePreset: '30d',
        tradingAccountId: ACCOUNT_ID,
        strategyId: STRATEGY_ID,
        setupId: SETUP_ID,
      },
      { referenceInstant: REFERENCE },
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'available',
        scope: { strategyId: STRATEGY_ID, setupId: SETUP_ID },
        strategy: { status: 'no_eligible_trades' },
        psychology: { status: 'no_eligible_trades' },
        discipline: { status: 'no_eligible_trades' },
      },
    });
  });

  it('passes authenticated filter failures through without composition', async () => {
    getDashboardInsightRawData.mockResolvedValueOnce({ ok: false, code: 'invalid_filters' });
    await expect(getDashboardInsightData(FILTERS)).resolves.toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });
});
