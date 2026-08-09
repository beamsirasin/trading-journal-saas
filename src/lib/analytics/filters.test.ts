import { describe, expect, it } from 'vitest';

import { parseAnalyticsFilters, resolveAnalyticsDateBounds } from './filters';

const ACCOUNT_ID = '019c43dc-8c6c-7000-8000-000000000001';
const STRATEGY_ID = '019c43dc-8c6c-7000-8000-000000000002';
const SETUP_ID = '019c43dc-8c6c-7000-8000-000000000003';
const VERSION_ID = '019c43dc-8c6c-7000-8000-000000000004';

describe('analytics filter contract', () => {
  it('defaults to the active account and 90 local calendar days', () => {
    expect(parseAnalyticsFilters({})).toEqual({
      ok: true,
      filters: {
        datePreset: '90d',
        accountScope: { kind: 'active' },
        strategyId: null,
        setupId: null,
        strategyVersionId: null,
      },
    });
  });

  it('preserves explicit all-accounts and approved identity filters', () => {
    expect(
      parseAnalyticsFilters({
        datePreset: '30d',
        tradingAccountId: 'all',
        strategyId: STRATEGY_ID,
        setupId: SETUP_ID,
        strategyVersionId: VERSION_ID,
      }),
    ).toEqual({
      ok: true,
      filters: {
        datePreset: '30d',
        accountScope: { kind: 'all' },
        strategyId: STRATEGY_ID,
        setupId: SETUP_ID,
        strategyVersionId: VERSION_ID,
      },
    });
  });

  it('keeps an explicit account UUID distinct from active and all', () => {
    const result = parseAnalyticsFilters({ tradingAccountId: ACCOUNT_ID, datePreset: 'all' });
    expect(result).toMatchObject({
      ok: true,
      filters: { accountScope: { kind: 'account', accountId: ACCOUNT_ID } },
    });
  });

  it.each([
    { datePreset: '7d' },
    { tradingAccountId: 'not-a-uuid' },
    { strategyId: 'not-a-uuid' },
    { workspaceId: ACCOUNT_ID },
    { symbol: 'EURUSD' },
    { direction: 'long' },
  ])('strictly rejects unsupported or malformed input %#', (input) => {
    expect(parseAnalyticsFilters(input)).toEqual({ ok: false, code: 'invalid_filters' });
  });
});

describe('analytics date bounds', () => {
  it('resolves exact 30-day Bangkok bounds from a deterministic instant', () => {
    expect(
      resolveAnalyticsDateBounds('30d', 'Asia/Bangkok', new Date('2026-08-09T12:00:00Z')),
    ).toEqual({
      ok: true,
      bounds: {
        kind: 'bounded',
        start: '2026-07-10T17:00:00.000Z',
        endExclusive: '2026-08-09T17:00:00.000Z',
      },
    });
  });

  it('resolves exact 90-day UTC bounds and an exclusive next-day end', () => {
    expect(resolveAnalyticsDateBounds('90d', 'UTC', new Date('2026-08-09T23:59:59Z'))).toEqual({
      ok: true,
      bounds: {
        kind: 'bounded',
        start: '2026-05-12T00:00:00.000Z',
        endExclusive: '2026-08-10T00:00:00.000Z',
      },
    });
  });

  it('uses DST-aware spring-forward boundaries instead of 30 times 24 hours', () => {
    expect(
      resolveAnalyticsDateBounds('30d', 'America/New_York', new Date('2026-03-08T16:00:00Z')),
    ).toEqual({
      ok: true,
      bounds: {
        kind: 'bounded',
        start: '2026-02-07T05:00:00.000Z',
        endExclusive: '2026-03-09T04:00:00.000Z',
      },
    });
  });

  it('uses DST-aware fall-back boundaries', () => {
    expect(
      resolveAnalyticsDateBounds('30d', 'America/New_York', new Date('2026-11-01T17:00:00Z')),
    ).toEqual({
      ok: true,
      bounds: {
        kind: 'bounded',
        start: '2026-10-03T04:00:00.000Z',
        endExclusive: '2026-11-02T05:00:00.000Z',
      },
    });
  });

  it('returns truly unbounded all-time semantics', () => {
    expect(resolveAnalyticsDateBounds('all', 'Not/AZone', new Date('invalid'))).toEqual({
      ok: true,
      bounds: { kind: 'all', start: null, endExclusive: null },
    });
  });

  it('rejects invalid bounded timezone/reference inputs', () => {
    expect(resolveAnalyticsDateBounds('30d', 'Not/AZone', new Date())).toEqual({
      ok: false,
      code: 'invalid_timezone',
    });
    expect(resolveAnalyticsDateBounds('90d', 'UTC', new Date('invalid'))).toEqual({
      ok: false,
      code: 'invalid_reference_instant',
    });
  });
});
