import { describe, expect, it } from 'vitest';

import { equityCurveR, maximumDrawdownR, type EquityInputRecord } from './equity';

function record(id: string, occurredAt: string, r: string): EquityInputRecord {
  return { id, occurredAt: new Date(occurredAt), r };
}

describe('equityCurveR', () => {
  it('returns no_trades for an empty sequence', () => {
    expect(equityCurveR([])).toEqual({ ok: false, reason: 'no_trades' });
  });

  it("produces the brief's own worked example: [+2, -1, +3] -> [+2, +1, +4]", () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '2'),
      record('t2', '2026-01-02T00:00:00Z', '-1'),
      record('t3', '2026-01-03T00:00:00Z', '3'),
    ];
    const result = equityCurveR(records);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.cumulativeR)).toEqual(['2.0000', '1.0000', '4.0000']);
    expect(result.value.map((p) => p.tradeId)).toEqual(['t1', 't2', 't3']);
  });

  it('sorts by occurrence timestamp ascending regardless of input array order', () => {
    const records = [
      record('t3', '2026-01-03T00:00:00Z', '3'),
      record('t1', '2026-01-01T00:00:00Z', '2'),
      record('t2', '2026-01-02T00:00:00Z', '-1'),
    ];
    const result = equityCurveR(records);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.tradeId)).toEqual(['t1', 't2', 't3']);
    expect(result.value.map((p) => p.cumulativeR)).toEqual(['2.0000', '1.0000', '4.0000']);
  });

  it('breaks equal timestamps by id ascending, deterministically', () => {
    const sameTime = '2026-01-01T00:00:00Z';
    const records = [record('b', sameTime, '1'), record('a', sameTime, '1')];
    const result = equityCurveR(records);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((p) => p.tradeId)).toEqual(['a', 'b']);
    expect(result.value.map((p) => p.cumulativeR)).toEqual(['1.0000', '2.0000']);
  });

  it('never mutates the caller-supplied array', () => {
    const records = [
      record('t2', '2026-01-02T00:00:00Z', '-1'),
      record('t1', '2026-01-01T00:00:00Z', '2'),
    ];
    const original = [...records];
    equityCurveR(records);
    expect(records).toEqual(original);
  });

  it('rejects a malformed R value', () => {
    expect(equityCurveR([record('t1', '2026-01-01T00:00:00Z', 'abc')])).toEqual({
      ok: false,
      reason: 'invalid_decimal',
    });
  });
});

describe('maximumDrawdownR', () => {
  it('returns no_trades for an empty sequence', () => {
    expect(maximumDrawdownR([])).toEqual({ ok: false, reason: 'no_trades' });
  });

  it('one loss from starting zero: [-1R] -> drawdown 1R', () => {
    const records = [record('t1', '2026-01-01T00:00:00Z', '-1')];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '1.0000' });
  });

  it('brief example: [+2R, -1R] -> cumulative +2, +1 -> drawdown 1R', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '2'),
      record('t2', '2026-01-02T00:00:00Z', '-1'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '1.0000' });
  });

  it('brief example — deep peak-to-trough: [+2R, -4R, +1R] -> cumulative +2, -2, -1 -> drawdown 4R', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '2'),
      record('t2', '2026-01-02T00:00:00Z', '-4'),
      record('t3', '2026-01-03T00:00:00Z', '1'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '4.0000' });
  });

  it('brief example — monotonic winners: [+1R, +1R, +1R] -> drawdown 0R', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '1'),
      record('t2', '2026-01-02T00:00:00Z', '1'),
      record('t3', '2026-01-03T00:00:00Z', '1'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '0.0000' });
  });

  it('recovery to previous peak: [+3, -2, +2] -> cumulative +3, +1, +3 -> drawdown 2R', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '3'),
      record('t2', '2026-01-02T00:00:00Z', '-2'),
      record('t3', '2026-01-03T00:00:00Z', '2'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '2.0000' });
  });

  it('new high after recovery: [+3, -2, +2, +1] -> cumulative +3, +1, +3, +4 -> drawdown still 2R', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '3'),
      record('t2', '2026-01-02T00:00:00Z', '-2'),
      record('t3', '2026-01-03T00:00:00Z', '2'),
      record('t4', '2026-01-04T00:00:00Z', '1'),
    ];
    const curve = equityCurveR(records);
    expect(curve.ok && curve.value.at(-1)?.cumulativeR).toBe('4.0000');
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '2.0000' });
  });

  it('an exact-zero sequence (every R exactly zero) has zero drawdown', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '0.0000'),
      record('t2', '2026-01-02T00:00:00Z', '0.0000'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '0.0000' });
  });

  it('equal timestamps use the deterministic id tie-break, and drawdown is unaffected either way', () => {
    const sameTime = '2026-01-01T00:00:00Z';
    const recordsAscending = [record('a', sameTime, '2'), record('b', sameTime, '-3')];
    const recordsDescending = [record('b', sameTime, '-3'), record('a', sameTime, '2')];
    // Regardless of input array order, sorting always puts "a" first (id
    // tie-break), so cumulative is always +2, -1 -> drawdown 3R.
    expect(maximumDrawdownR(recordsAscending)).toEqual({ ok: true, value: '3.0000' });
    expect(maximumDrawdownR(recordsDescending)).toEqual({ ok: true, value: '3.0000' });
  });

  it('permuting input array order never changes the result when timestamps/ids are unchanged', () => {
    const base = [
      record('t1', '2026-01-01T00:00:00Z', '2'),
      record('t2', '2026-01-02T00:00:00Z', '-4'),
      record('t3', '2026-01-03T00:00:00Z', '1'),
    ];
    const permutations = [
      [base[0], base[1], base[2]],
      [base[2], base[1], base[0]],
      [base[1], base[0], base[2]],
      [base[2], base[0], base[1]],
    ];
    const results = permutations.map((permutation) =>
      maximumDrawdownR(permutation as EquityInputRecord[]),
    );
    for (const result of results) {
      expect(result).toEqual({ ok: true, value: '4.0000' });
    }
  });

  it('high-precision R values are summed before rounding — drawdown from raw cumulative differs from what early-rounding would give', () => {
    // Raw cumulative: 0.00003, 0.00006, 0.00002 -> peak 0.00006 -> drawdown
    // at t3 = 0.00006 - 0.00002 = 0.00004, which rounds DOWN to '0.0000'.
    // If each cumulative point were rounded to 4dp before drawdown tracking
    // (the bug this design avoids), the sequence would instead be
    // 0.0000, 0.0001, 0.0000 -> a drawdown of 0.0001 — a different, wrong
    // answer. This proves the implementation sums/tracks at full precision.
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '0.00003'),
      record('t2', '2026-01-02T00:00:00Z', '0.00003'),
      record('t3', '2026-01-03T00:00:00Z', '-0.00004'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '0.0000' });
  });

  it('rejects a malformed R value', () => {
    expect(maximumDrawdownR([record('t1', '2026-01-01T00:00:00Z', 'abc')])).toEqual({
      ok: false,
      reason: 'invalid_decimal',
    });
  });
});

describe('invariants', () => {
  it('maximum drawdown is never negative across a battery of sequences', () => {
    const sequences: string[][] = [
      ['1', '1', '1'],
      ['-1', '-1', '-1'],
      ['3', '-5', '2', '-1', '4'],
      ['0', '0', '0'],
    ];
    for (const values of sequences) {
      const records = values.map((r, index) =>
        record(`t${index}`, `2026-01-0${index + 1}T00:00:00Z`, r),
      );
      const result = maximumDrawdownR(records);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Number.parseFloat(result.value)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('a monotonically non-decreasing cumulative R sequence has exactly 0 drawdown', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '1'),
      record('t2', '2026-01-02T00:00:00Z', '0'),
      record('t3', '2026-01-03T00:00:00Z', '2'),
      record('t4', '2026-01-04T00:00:00Z', '0.5'),
    ];
    expect(maximumDrawdownR(records)).toEqual({ ok: true, value: '0.0000' });
  });

  it('no successful result is NaN or Infinity', () => {
    const records = [
      record('t1', '2026-01-01T00:00:00Z', '999999999.9999'),
      record('t2', '2026-01-02T00:00:00Z', '-999999999.9999'),
    ];
    const curve = equityCurveR(records);
    const drawdown = maximumDrawdownR(records);
    expect(curve.ok).toBe(true);
    expect(drawdown.ok).toBe(true);
    if (curve.ok) {
      for (const point of curve.value) expect(point.cumulativeR).not.toMatch(/NaN|Infinity/i);
    }
    if (drawdown.ok) expect(drawdown.value).not.toMatch(/NaN|Infinity/i);
  });
});
