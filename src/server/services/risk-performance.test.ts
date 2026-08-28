import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';

import { getRiskPerformanceData } from './risk-performance';

const { getRiskPerformanceRawData } = vi.hoisted(() => ({
  getRiskPerformanceRawData: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/server/dal/risk-performance', () => ({ getRiskPerformanceRawData }));

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

describe('Risk Performance service orchestration', () => {
  beforeEach(() => {
    getRiskPerformanceRawData.mockReset();
    getRiskPerformanceRawData.mockResolvedValue({
      ok: true,
      data: {
        filters: {
          datePreset: '30d',
          dateBounds: {
            kind: 'bounded',
            start: '2026-08-03T00:00:00.000Z',
            endExclusive: '2026-09-02T00:00:00.000Z',
          },
          timezone: 'UTC',
          accountScope: { kind: 'account', accountId: ACCOUNT_ID, source: 'explicit' },
          strategyId: STRATEGY_ID,
          setupId: SETUP_ID,
          strategyVersionId: null,
        },
        account: {
          kind: 'account',
          source: 'explicit',
          account: {
            id: ACCOUNT_ID,
            name: 'Risk Account',
            accountMode: 'live',
            baseCurrency: 'USD',
            startingBalance: '10000.0000000000',
          },
        },
        asOf: REFERENCE,
        trades: [
          {
            tradeId: 'old',
            actualExitedAt: new Date('2026-07-01T00:00:00Z'),
            netPnlMinor: 50_000n,
            baseCurrency: 'USD',
          },
          {
            tradeId: 'visible',
            actualExitedAt: new Date('2026-08-15T00:00:00Z'),
            netPnlMinor: -10_000n,
            baseCurrency: 'USD',
          },
        ],
      },
    });
  });

  it('runs one focused DAL bundle and composes Account-level values independently of Strategy/Setup', async () => {
    const result = await getRiskPerformanceData(FILTERS, { referenceInstant: REFERENCE });
    expect(getRiskPerformanceRawData).toHaveBeenCalledTimes(1);
    expect(getRiskPerformanceRawData).toHaveBeenCalledWith(
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
        openingBalanceMinor: '1050000',
        endingBalanceMinor: '1040000',
        periodNetPnlMinor: '-10000',
        scope: {
          balanceUniverse: 'selected_account_lifetime_through_as_of',
          analyticalFilters: { effect: 'not_applied_to_account_balance' },
        },
      },
    });
  });

  it('passes authenticated scope failures through without composition', async () => {
    getRiskPerformanceRawData.mockResolvedValueOnce({ ok: false, code: 'invalid_filters' });
    await expect(getRiskPerformanceData(FILTERS)).resolves.toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });
});
