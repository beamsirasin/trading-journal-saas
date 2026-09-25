import { describe, expect, it } from 'vitest';

import { exitHistoryStatus, formatShare, type AfterTradeDraft } from './after-trade-draft';

type Exit = AfterTradeDraft['exits'][number];

function exit(overrides: Partial<Exit>): Exit {
  return {
    id: crypto.randomUUID(),
    scope: '',
    pnl: '',
    closedPercent: '',
    exitedAt: '',
    price: '',
    reason: '',
    ...overrides,
  };
}

describe('exitHistoryStatus — what the recorded exits account for', () => {
  it('reads no exits as none, ignoring blank rows', () => {
    expect(exitHistoryStatus([exit({})])).toEqual({
      count: 0,
      kind: 'none',
      accountedBps: null,
    });
  });

  it('reads one All remaining exit as a full close in one exit', () => {
    expect(exitHistoryStatus([exit({ scope: 'all_remaining', pnl: '80' })])).toEqual({
      count: 1,
      kind: 'single_full',
      accountedBps: 10_000,
    });
  });

  it('reads one exit of 100% as a full close in one exit', () => {
    expect(exitHistoryStatus([exit({ closedPercent: '100' })])).toMatchObject({
      kind: 'single_full',
      accountedBps: 10_000,
    });
  });

  it('sums stated shares for partial exits, and says how much is left', () => {
    const status = exitHistoryStatus([
      exit({ scope: 'part', closedPercent: '40' }),
      exit({ closedPercent: '20' }),
    ]);
    expect(status).toEqual({
      count: 2,
      kind: 'partial',
      accountedBps: 6_000,
    });
  });

  it('never invents a share: one unstated percentage makes it unknown', () => {
    expect(exitHistoryStatus([exit({ closedPercent: '50' }), exit({ pnl: '30' })])).toMatchObject({
      count: 2,
      kind: 'partial',
      accountedBps: null,
    });
    // An invalid entry is not a share either.
    expect(exitHistoryStatus([exit({ closedPercent: 'abc' })])).toMatchObject({
      accountedBps: null,
    });
  });

  it('lets an All remaining exit close whatever the partial exits left', () => {
    expect(
      exitHistoryStatus([
        exit({ scope: 'part', closedPercent: '50' }),
        exit({ scope: 'all_remaining' }),
      ]),
    ).toMatchObject({ count: 2, kind: 'partial', accountedBps: 10_000 });
  });
});

describe('formatShare', () => {
  it('drops trailing zeros and keeps two places otherwise', () => {
    expect(formatShare(6_000)).toBe('60');
    expect(formatShare(3_333)).toBe('33.33');
    expect(formatShare(10_000)).toBe('100');
  });
});
