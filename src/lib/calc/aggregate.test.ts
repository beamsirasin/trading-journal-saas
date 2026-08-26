import { describe, expect, it } from 'vitest';

import {
  averageLossR,
  averageR,
  averageWinR,
  expectancyR,
  isSystemEligible,
  isTraderEligible,
  outcomeCounts,
  payoffRatio,
  profitFactor,
  selectSystemEligible,
  selectTraderEligible,
  totalR,
  winRate,
  type OutcomeRecord,
} from './aggregate';

describe('totalR', () => {
  it('mixed positive/negative: [3, -1, 2] => 4R', () => {
    expect(totalR(['3', '-1', '2'])).toEqual({ ok: true, value: '4.0000' });
  });

  it('a populated sample exactly totaling zero is distinguishable from empty: [1, -1] => 0R', () => {
    expect(totalR(['1', '-1'])).toEqual({ ok: true, value: '0.0000' });
  });

  it('empty input is never a legitimate 0R sample', () => {
    expect(totalR([])).toEqual({ ok: false, reason: 'no_trades' });
  });

  it('sums at full precision before its one final rounding', () => {
    // Raw sum = 0.00009, which rounds UP to '0.0001'. If each value were
    // rounded to 4dp first (each individually rounds down to '0.0000') and
    // THEN summed, the wrong answer '0.0000' would result instead.
    expect(totalR(['0.00003', '0.00003', '0.00003'])).toEqual({ ok: true, value: '0.0001' });
  });

  it('handles large values without precision loss', () => {
    expect(totalR(['1000000000.0000', '2000000000.0000'])).toEqual({
      ok: true,
      value: '3000000000.0000',
    });
  });

  it('rejects a malformed decimal', () => {
    expect(totalR(['3', 'abc'])).toEqual({ ok: false, reason: 'invalid_decimal' });
  });
});

describe('averageR', () => {
  it('mixed positive/negative', () => {
    expect(averageR(['3', '-1', '2'])).toEqual({ ok: true, value: '1.3333' });
  });

  it('empty input', () => {
    expect(averageR([])).toEqual({ ok: false, reason: 'no_trades' });
  });

  it('includes every eligible Trade in the denominator, even a break-even-magnitude one', () => {
    // A +0.0300R Trade is not discarded merely because it would classify as
    // break-even — averageR works on the R values directly, with no
    // outcome-aware filtering at all.
    expect(averageR(['0.0300', '2', '-1'])).toEqual({ ok: true, value: '0.3433' });
  });
});

describe('expectancyR', () => {
  it('is exactly averageR — same contract, not a second implementation', () => {
    const values = ['3', '-1', '2', '0.0300'];
    expect(expectancyR(values)).toEqual(averageR(values));
  });

  it('empty input', () => {
    expect(expectancyR([])).toEqual({ ok: false, reason: 'no_trades' });
  });
});

function outcome(r: string, outcomeValue: OutcomeRecord['outcome']): OutcomeRecord {
  return { r, outcome: outcomeValue };
}

describe('winRate', () => {
  it('all wins', () => {
    const records = [outcome('2', 'win'), outcome('3', 'win'), outcome('1', 'win')];
    expect(winRate(records)).toEqual({ ok: true, value: '1.0000' });
  });

  it('all losses', () => {
    const records = [outcome('-1', 'loss'), outcome('-2', 'loss')];
    expect(winRate(records)).toEqual({ ok: true, value: '0.0000' });
  });

  it('mixed: 3 wins, 1 loss, 1 break-even => 0.6000, break-even counted in the denominator', () => {
    const records = [
      outcome('2', 'win'),
      outcome('3', 'win'),
      outcome('1', 'win'),
      outcome('-1', 'loss'),
      outcome('0.02', 'break_even'),
    ];
    expect(winRate(records)).toEqual({ ok: true, value: '0.6000' });
  });

  it('all break-even', () => {
    const records = [outcome('0.01', 'break_even'), outcome('-0.02', 'break_even')];
    expect(winRate(records)).toEqual({ ok: true, value: '0.0000' });
  });

  it('empty', () => {
    expect(winRate([])).toEqual({ ok: false, reason: 'no_trades' });
  });

  it('trusts the supplied outcome snapshot rather than reclassifying R', () => {
    // An R value that would classify as a win if reclassified, but is
    // supplied here already labelled break_even — winRate must honor the
    // trusted snapshot, not recompute the classification itself.
    const records = [outcome('5', 'break_even')];
    expect(winRate(records)).toEqual({ ok: true, value: '0.0000' });
  });
});

describe('outcomeCounts', () => {
  it('exposes W / BE / L counts from persisted outcomes without reclassifying R', () => {
    expect(
      outcomeCounts([
        outcome('-5', 'win'),
        outcome('9', 'break_even'),
        outcome('0', 'loss'),
        outcome('1', 'win'),
      ]),
    ).toEqual({ wins: 2, breakEvens: 1, losses: 1 });
  });
});

describe('averageWinR / averageLossR / payoffRatio', () => {
  it('averageWinR over multiple wins: +2R, +4R => +3R', () => {
    const records = [outcome('2', 'win'), outcome('4', 'win'), outcome('-1', 'loss')];
    expect(averageWinR(records)).toEqual({ ok: true, value: '3.0000' });
  });

  it('averageLossR over multiple losses: -1R, -2R => -1.5R (signed, not a magnitude)', () => {
    const records = [outcome('2', 'win'), outcome('-1', 'loss'), outcome('-2', 'loss')];
    expect(averageLossR(records)).toEqual({ ok: true, value: '-1.5000' });
  });

  it('averageWinR with no wins present', () => {
    expect(averageWinR([outcome('-1', 'loss')])).toEqual({ ok: false, reason: 'no_wins' });
  });

  it('averageLossR with no losses present', () => {
    expect(averageLossR([outcome('2', 'win')])).toEqual({ ok: false, reason: 'no_losses' });
  });

  it('break-even Trades participate in neither average', () => {
    const records = [outcome('2', 'win'), outcome('-1', 'loss'), outcome('0.02', 'break_even')];
    expect(averageWinR(records)).toEqual({ ok: true, value: '2.0000' });
    expect(averageLossR(records)).toEqual({ ok: true, value: '-1.0000' });
  });

  it('payoffRatio: averageWin +3R / abs(averageLoss -1.5R) => 2.0000', () => {
    const records = [
      outcome('2', 'win'),
      outcome('4', 'win'),
      outcome('-1', 'loss'),
      outcome('-2', 'loss'),
    ];
    expect(payoffRatio(records)).toEqual({ ok: true, value: '2.0000' });
  });

  it('payoffRatio with no wins', () => {
    expect(payoffRatio([outcome('-1', 'loss')])).toEqual({ ok: false, reason: 'no_wins' });
  });

  it('payoffRatio with no losses', () => {
    expect(payoffRatio([outcome('2', 'win')])).toEqual({ ok: false, reason: 'no_losses' });
  });
});

describe('profitFactor', () => {
  it('a normal mixed sample', () => {
    expect(profitFactor(['3', '-1', '2'])).toEqual({ ok: true, value: '5.0000' });
  });

  it('no trades', () => {
    expect(profitFactor([])).toEqual({ ok: false, reason: 'no_trades' });
  });

  it('only profits => no_losses', () => {
    expect(profitFactor(['2', '3'])).toEqual({ ok: false, reason: 'no_losses' });
  });

  it('only losses => a successful 0.0000, never a failure', () => {
    expect(profitFactor(['-2', '-3'])).toEqual({ ok: true, value: '0.0000' });
  });

  it('every R exactly zero => no_profit_or_loss', () => {
    expect(profitFactor(['0', '0.0000'])).toEqual({ ok: false, reason: 'no_profit_or_loss' });
  });

  it('small break-even-classified R values still contribute their sign to gross positive/negative', () => {
    // profitFactor never receives or consults an outcome classification —
    // it reads only the sign of R itself.
    expect(profitFactor(['0.0300', '-0.0300'])).toEqual({ ok: true, value: '1.0000' });
  });

  it('sums gross positive/negative at full precision before its one final rounding', () => {
    expect(profitFactor(['0.00003', '0.00003', '0.00003', '-0.00001'])).toEqual({
      ok: true,
      // grossPositive = 0.00009, grossNegative = -0.00001 -> ratio = 9 exactly
      value: '9.0000',
    });
  });

  it('never returns Infinity', () => {
    const result = profitFactor(['5', '5', '5']);
    expect(result.ok).toBe(false); // no_losses, not Infinity
  });
});

describe('isTraderEligible / selectTraderEligible', () => {
  const base = {
    status: 'closed',
    deletedAt: null,
    actualR: '2.0000',
    traderOutcome: 'win' as const,
    exitedAt: new Date('2026-08-01T00:00:00Z'),
  };

  it('eligible when closed, not deleted, actualR and traderOutcome present — regardless of system status', () => {
    expect(isTraderEligible(base)).toBe(true);
  });

  it('ineligible when not closed', () => {
    expect(isTraderEligible({ ...base, status: 'open' })).toBe(false);
    expect(isTraderEligible({ ...base, status: 'planned' })).toBe(false);
    expect(isTraderEligible({ ...base, status: 'canceled' })).toBe(false);
  });

  it('ineligible when soft-deleted', () => {
    expect(isTraderEligible({ ...base, deletedAt: new Date() })).toBe(false);
  });

  it('ineligible when actualR or traderOutcome is missing', () => {
    expect(isTraderEligible({ ...base, actualR: null })).toBe(false);
    expect(isTraderEligible({ ...base, traderOutcome: null })).toBe(false);
  });

  it('ineligible without an Actual exit timestamp', () => {
    expect(isTraderEligible({ ...base, exitedAt: null })).toBe(false);
  });

  it('selectTraderEligible filters an array to only the eligible subset', () => {
    const trades = [
      { ...base },
      { ...base, status: 'open', actualR: null, traderOutcome: null },
      { ...base, deletedAt: new Date() },
    ];
    expect(selectTraderEligible(trades)).toEqual([base]);
  });
});

describe('isSystemEligible / selectSystemEligible', () => {
  const base = {
    systemStatus: 'resolved',
    deletedAt: null,
    systemR: '3.0000',
    systemOutcome: 'win' as const,
    systemExitedAt: new Date('2026-08-01T00:00:00Z'),
  };

  it('eligible only when system_status is resolved', () => {
    expect(isSystemEligible(base)).toBe(true);
    expect(
      isSystemEligible({ ...base, systemStatus: 'pending', systemR: null, systemOutcome: null }),
    ).toBe(false);
    expect(
      isSystemEligible({ ...base, systemStatus: 'no_trade', systemR: null, systemOutcome: null }),
    ).toBe(false);
  });

  it('pending and no_trade are never treated as eligible, never as a 0R sample', () => {
    expect(isSystemEligible({ ...base, systemStatus: 'pending' })).toBe(false);
    expect(isSystemEligible({ ...base, systemStatus: 'no_trade' })).toBe(false);
  });

  it('ineligible when soft-deleted', () => {
    expect(isSystemEligible({ ...base, deletedAt: new Date() })).toBe(false);
  });

  it('ineligible without a System exit timestamp', () => {
    expect(isSystemEligible({ ...base, systemExitedAt: null })).toBe(false);
  });

  it('selectSystemEligible filters an array to only the eligible subset', () => {
    const trades = [
      { ...base },
      { ...base, systemStatus: 'pending', systemR: null, systemOutcome: null },
    ];
    expect(selectSystemEligible(trades)).toEqual([base]);
  });
});

describe('invariants', () => {
  it('expectancyR always equals averageR for the same input', () => {
    const samples = [
      ['1', '2', '3'],
      ['-1', '-2'],
      ['0.0300', '2', '-1', '0'],
    ];
    for (const values of samples) {
      expect(expectancyR(values)).toEqual(averageR(values));
    }
  });

  it('no successful aggregate result is NaN or Infinity', () => {
    const results = [
      totalR(['1', '-2', '3']),
      averageR(['1', '-2', '3']),
      winRate([outcome('1', 'win'), outcome('-1', 'loss')]),
      averageWinR([outcome('1', 'win')]),
      averageLossR([outcome('-1', 'loss')]),
      payoffRatio([outcome('1', 'win'), outcome('-1', 'loss')]),
      profitFactor(['1', '-2', '3']),
    ];
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).not.toMatch(/NaN|Infinity/i);
    }
  });
});
