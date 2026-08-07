import { describe, expect, it } from 'vitest';

import {
  edgeLeakageR,
  executionEfficiency,
  isComparisonEligible,
  pairedEdgeLeakageR,
  ruleAdherenceRate,
  selectComparisonEligible,
  type PairedRTrade,
  type RuleCheckRecord,
} from './attribution';

function pair(tradeId: string, systemR: string, actualR: string): PairedRTrade {
  return { tradeId, systemR, actualR };
}

describe('edgeLeakageR (per-trade)', () => {
  it('+3 system / +2 actual => +1R leakage (Trader captured less)', () => {
    expect(edgeLeakageR('3', '2')).toEqual({ ok: true, value: '1.0000' });
  });

  it('+3 system / -1 actual => +4R leakage', () => {
    expect(edgeLeakageR('3', '-1')).toEqual({ ok: true, value: '4.0000' });
  });

  it('+2 system / +3 actual => -1R leakage (Trader captured MORE than System, not an error)', () => {
    expect(edgeLeakageR('2', '3')).toEqual({ ok: true, value: '-1.0000' });
  });

  it('zero leakage when Trader exactly matches System', () => {
    expect(edgeLeakageR('2', '2')).toEqual({ ok: true, value: '0.0000' });
  });

  it('rejects missing input', () => {
    expect(edgeLeakageR(null, '2')).toEqual({ ok: false, reason: 'missing_input' });
    expect(edgeLeakageR('2', undefined)).toEqual({ ok: false, reason: 'missing_input' });
  });

  it('rejects a malformed decimal', () => {
    expect(edgeLeakageR('abc', '2')).toEqual({ ok: false, reason: 'invalid_decimal' });
  });
});

describe('pairedEdgeLeakageR', () => {
  it('sums per-Trade leakage over multiple paired Trades', () => {
    const pairs = [pair('t1', '6', '5'), pair('t2', '4', '3')];
    // leakage: (6-5) + (4-3) = 1 + 1 = 2
    expect(pairedEdgeLeakageR(pairs)).toEqual({ ok: true, value: '2.0000' });
  });

  it('empty comparable set', () => {
    expect(pairedEdgeLeakageR([])).toEqual({ ok: false, reason: 'no_comparable_trades' });
  });

  it('is not restricted by System total sign — only executionEfficiency is', () => {
    const pairs = [pair('t1', '5', '2'), pair('t2', '-5', '1')];
    // System total = 0, but paired leakage is still a normal, successful
    // result: (5-2) + (-5-1) = 3 + (-6) = -3
    expect(pairedEdgeLeakageR(pairs)).toEqual({ ok: true, value: '-3.0000' });
  });

  it('equals the sum of per-Trade leakage, computed independently', () => {
    const pairs = [pair('t1', '3', '1'), pair('t2', '-2', '0.5'), pair('t3', '10', '9')];
    const aggregate = pairedEdgeLeakageR(pairs);
    const perTradeSum = pairs.reduce((sum, p) => {
      const result = edgeLeakageR(p.systemR, p.actualR);
      if (!result.ok) throw new Error('expected an ok result');
      return sum + Number.parseFloat(result.value);
    }, 0);
    expect(aggregate.ok).toBe(true);
    if (aggregate.ok) {
      expect(Number.parseFloat(aggregate.value)).toBeCloseTo(perTradeSum, 4);
    }
  });
});

describe('executionEfficiency', () => {
  it('System total +10R / Actual total +8R => 0.8000', () => {
    const pairs = [pair('t1', '6', '5'), pair('t2', '4', '3')];
    expect(executionEfficiency(pairs)).toEqual({ ok: true, value: '0.8000' });
  });

  it('efficiency > 1: System total +10R / Actual total +12R => 1.2000, never clamped', () => {
    expect(executionEfficiency([pair('t1', '10', '12')])).toEqual({ ok: true, value: '1.2000' });
  });

  it('negative efficiency: System total +10R / Actual total -2R => -0.2000', () => {
    expect(executionEfficiency([pair('t1', '10', '-2')])).toEqual({ ok: true, value: '-0.2000' });
  });

  it('System total exactly zero => system_has_no_edge', () => {
    const pairs = [pair('t1', '5', '2'), pair('t2', '-5', '1')];
    expect(executionEfficiency(pairs)).toEqual({ ok: false, reason: 'system_has_no_edge' });
  });

  it('System total negative => system_has_no_edge', () => {
    expect(executionEfficiency([pair('t1', '-5', '2')])).toEqual({
      ok: false,
      reason: 'system_has_no_edge',
    });
  });

  it('empty comparable set', () => {
    expect(executionEfficiency([])).toEqual({ ok: false, reason: 'no_comparable_trades' });
  });

  it('never returns Infinity for any successful input', () => {
    const result = executionEfficiency([pair('t1', '0.0001', '1000')]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toMatch(/NaN|Infinity/i);
  });
});

describe('isComparisonEligible / selectComparisonEligible', () => {
  it('eligible only when both Actual R and System R exist', () => {
    expect(isComparisonEligible({ actualR: '2', systemR: '3' })).toBe(true);
    expect(isComparisonEligible({ actualR: '2', systemR: null })).toBe(false);
    expect(isComparisonEligible({ actualR: null, systemR: '3' })).toBe(false);
    expect(isComparisonEligible({ actualR: null, systemR: null })).toBe(false);
  });

  it('a closed Trader Trade with a still-pending System side is not comparison-eligible', () => {
    // Mirrors the Phase 07D brief's own example: Trader-eligible does not
    // imply comparison-eligible.
    expect(isComparisonEligible({ actualR: '2', systemR: null })).toBe(false);
  });

  it('selectComparisonEligible filters an array to only the eligible subset', () => {
    const trades = [
      { id: 't1', actualR: '2', systemR: '3' },
      { id: 't2', actualR: '2', systemR: null },
    ];
    expect(selectComparisonEligible(trades)).toEqual([{ id: 't1', actualR: '2', systemR: '3' }]);
  });

  it('mismatched/unpaired populations cannot be accidentally compared — PairedRTrade always couples one Trade id to both its own R values', () => {
    // The type itself is the guard: a PairedRTrade cannot be constructed
    // from a System R belonging to one Trade and an Actual R belonging to
    // another — both fields live on the same record, keyed by the same
    // tradeId, never assembled from two independently-filtered arrays.
    const pairs: PairedRTrade[] = [pair('t1', '3', '2')];
    expect(pairs[0]?.tradeId).toBe('t1');
  });
});

function ruleCheck(status: RuleCheckRecord['status']): RuleCheckRecord {
  return { status };
}

describe('ruleAdherenceRate', () => {
  it('8 followed, 2 violated, 1 not_applicable, 1 not_checked => 0.8000', () => {
    const checks = [
      ...Array.from({ length: 8 }, () => ruleCheck('followed')),
      ...Array.from({ length: 2 }, () => ruleCheck('violated')),
      ruleCheck('not_applicable'),
      ruleCheck('not_checked'),
    ];
    expect(ruleAdherenceRate(checks)).toEqual({ ok: true, value: '0.8000' });
  });

  it('all followed', () => {
    const checks = [ruleCheck('followed'), ruleCheck('followed'), ruleCheck('followed')];
    expect(ruleAdherenceRate(checks)).toEqual({ ok: true, value: '1.0000' });
  });

  it('all violated', () => {
    const checks = [ruleCheck('violated'), ruleCheck('violated')];
    expect(ruleAdherenceRate(checks)).toEqual({ ok: true, value: '0.0000' });
  });

  it('not_applicable is excluded from both numerator and denominator', () => {
    const checks = [
      ruleCheck('followed'),
      ruleCheck('not_applicable'),
      ruleCheck('not_applicable'),
    ];
    expect(ruleAdherenceRate(checks)).toEqual({ ok: true, value: '1.0000' });
  });

  it('not_checked is excluded from both numerator and denominator', () => {
    const checks = [ruleCheck('violated'), ruleCheck('not_checked'), ruleCheck('not_checked')];
    expect(ruleAdherenceRate(checks)).toEqual({ ok: true, value: '0.0000' });
  });

  it('no objectively evaluated checks (only not_applicable/not_checked) => no_rule_checks', () => {
    const checks = [ruleCheck('not_applicable'), ruleCheck('not_checked')];
    expect(ruleAdherenceRate(checks)).toEqual({ ok: false, reason: 'no_rule_checks' });
  });

  it('an empty check list => no_rule_checks', () => {
    expect(ruleAdherenceRate([])).toEqual({ ok: false, reason: 'no_rule_checks' });
  });
});

describe('invariants', () => {
  it('ruleAdherenceRate is always between 0 and 1 (inclusive) when successful', () => {
    const samples: RuleCheckRecord['status'][][] = [
      ['followed'],
      ['violated'],
      ['followed', 'violated', 'not_applicable', 'not_checked'],
      Array.from({ length: 7 }, (_, i) => (i % 2 === 0 ? 'followed' : 'violated')),
    ];
    for (const statuses of samples) {
      const result = ruleAdherenceRate(statuses.map((status) => ({ status })));
      expect(result.ok).toBe(true);
      if (result.ok) {
        const value = Number.parseFloat(result.value);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('executionEfficiency is unchanged by input array permutation', () => {
    const pairs = [pair('t1', '3', '2'), pair('t2', '4', '5'), pair('t3', '3', '1')];
    const permuted = [pairs[2], pairs[0], pairs[1]] as PairedRTrade[];
    expect(executionEfficiency(pairs)).toEqual(executionEfficiency(permuted));
  });

  it('pairedEdgeLeakageR is unchanged by input array permutation', () => {
    const pairs = [pair('t1', '3', '2'), pair('t2', '4', '5'), pair('t3', '3', '1')];
    const permuted = [pairs[2], pairs[0], pairs[1]] as PairedRTrade[];
    expect(pairedEdgeLeakageR(pairs)).toEqual(pairedEdgeLeakageR(permuted));
  });

  it('no successful attribution result is NaN or Infinity', () => {
    const results = [
      edgeLeakageR('3', '2'),
      pairedEdgeLeakageR([pair('t1', '3', '2')]),
      executionEfficiency([pair('t1', '3', '2')]),
      ruleAdherenceRate([ruleCheck('followed'), ruleCheck('violated')]),
    ];
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).not.toMatch(/NaN|Infinity/i);
    }
  });
});
