import { describe, expect, it } from 'vitest';

import type { AfterTradeDraft } from './after-trade-draft';
import { exitHistoryStatus, formatShare } from './exit-history-status';

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
    expect(exitHistoryStatus([exit({})], 'unanswered')).toEqual({
      count: 0,
      kind: 'none',
      accountedBps: null,
      completeness: 'unanswered',
    });
  });

  it('reads one All remaining exit as a full close in one exit', () => {
    expect(exitHistoryStatus([exit({ scope: 'all_remaining', pnl: '80' })], 'unanswered')).toEqual({
      count: 1,
      kind: 'single_full',
      accountedBps: 10_000,
      completeness: 'unanswered',
    });
  });

  it('reads one exit of 100% as a full close in one exit', () => {
    expect(exitHistoryStatus([exit({ closedPercent: '100' })], 'complete')).toMatchObject({
      kind: 'single_full',
      accountedBps: 10_000,
    });
  });

  it('sums stated shares for partial exits, and says how much is left', () => {
    const status = exitHistoryStatus(
      [exit({ scope: 'part', closedPercent: '40' }), exit({ closedPercent: '20' })],
      'incomplete',
    );
    expect(status).toEqual({
      count: 2,
      kind: 'partial',
      accountedBps: 6_000,
      completeness: 'incomplete',
    });
  });

  it('never invents a share: one unstated percentage makes it unknown', () => {
    expect(
      exitHistoryStatus([exit({ closedPercent: '50' }), exit({ pnl: '30' })], 'unanswered'),
    ).toMatchObject({ count: 2, kind: 'partial', accountedBps: null });
    // An invalid entry is not a share either.
    expect(exitHistoryStatus([exit({ closedPercent: 'abc' })], 'unanswered')).toMatchObject({
      accountedBps: null,
    });
  });

  it('lets an All remaining exit close whatever the partial exits left', () => {
    expect(
      exitHistoryStatus(
        [exit({ scope: 'part', closedPercent: '50' }), exit({ scope: 'all_remaining' })],
        'complete',
      ),
    ).toMatchObject({ count: 2, kind: 'partial', accountedBps: 10_000 });
  });

  it('passes the explicit completeness answer through unchanged', () => {
    for (const answer of ['unanswered', 'complete', 'incomplete', 'unknown'] as const) {
      expect(exitHistoryStatus([exit({ pnl: '1' })], answer).completeness).toBe(answer);
    }
  });
});

describe('formatShare', () => {
  it('drops trailing zeros and keeps two places otherwise', () => {
    expect(formatShare(6_000)).toBe('60');
    expect(formatShare(3_333)).toBe('33.33');
    expect(formatShare(10_000)).toBe('100');
  });
});
