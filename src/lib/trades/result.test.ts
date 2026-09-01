import { describe, expect, it } from 'vitest';

import { deriveTradeResult } from './result';

describe('deriveTradeResult — the Trader axis, and only the Trader axis', () => {
  it('reports the stored trader outcome for a closed Trade', () => {
    expect(deriveTradeResult({ status: 'closed', traderOutcome: 'win' })).toBe('win');
    expect(deriveTradeResult({ status: 'closed', traderOutcome: 'loss' })).toBe('loss');
    expect(deriveTradeResult({ status: 'closed', traderOutcome: 'break_even' })).toBe('break_even');
  });

  it('reports the lifecycle state while there is no settled outcome', () => {
    expect(deriveTradeResult({ status: 'open', traderOutcome: null })).toBe('open');
    expect(deriveTradeResult({ status: 'planned', traderOutcome: null })).toBe('planned');
    expect(deriveTradeResult({ status: 'canceled', traderOutcome: null })).toBe('canceled');
  });

  it('never invents a break-even for a closed Trade with no classification', () => {
    // Printing BE here would claim a tolerance-banded classification that was
    // never made; printing LOSS would be worse still.
    expect(deriveTradeResult({ status: 'closed', traderOutcome: null })).toBe('unresolved');
  });

  it('lets the lifecycle win over a stale outcome on a reopened Trade', () => {
    expect(deriveTradeResult({ status: 'open', traderOutcome: 'win' })).toBe('open');
  });
});
