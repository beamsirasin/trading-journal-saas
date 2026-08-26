import { describe, expect, it } from 'vitest';

import {
  averageExecutionGapR,
  executionGapR,
  isComparisonEligible,
  pairedExecutionGapR,
  ruleAdherenceRate,
  selectComparisonEligible,
  systemEdgeCaptured,
  tradeRuleAdherence,
  type PairedRTrade,
  type RuleCheckRecord,
} from './attribution';

function pair(tradeId: string, systemR: string, actualR: string): PairedRTrade {
  return { tradeId, systemR, actualR };
}

describe('executionGapR (per-trade)', () => {
  it('+2 actual / +5 system => -3R (Trader captured less)', () => {
    expect(executionGapR('2', '5')).toEqual({ ok: true, value: '-3.0000' });
  });

  it('-1 actual / +3 system => -4R', () => {
    expect(executionGapR('-1', '3')).toEqual({ ok: true, value: '-4.0000' });
  });

  it('+3 actual / +2 system => +1R (Trader outperformed System, not an error)', () => {
    expect(executionGapR('3', '2')).toEqual({ ok: true, value: '1.0000' });
  });

  it('zero gap when Trader exactly matches System', () => {
    expect(executionGapR('2', '2')).toEqual({ ok: true, value: '0.0000' });
  });

  it('rejects missing input', () => {
    expect(executionGapR(null, '2')).toEqual({ ok: false, reason: 'missing_input' });
    expect(executionGapR('2', undefined)).toEqual({ ok: false, reason: 'missing_input' });
  });

  it('rejects a malformed decimal', () => {
    expect(executionGapR('abc', '2')).toEqual({ ok: false, reason: 'invalid_decimal' });
  });
});

describe('pairedExecutionGapR', () => {
  it('sums per-Trade gap over multiple paired Trades', () => {
    const pairs = [pair('t1', '6', '5'), pair('t2', '4', '3')];
    // gap: (5-6) + (3-4) = -1 + -1 = -2
    expect(pairedExecutionGapR(pairs)).toEqual({ ok: true, value: '-2.0000' });
  });

  it('empty comparable set', () => {
    expect(pairedExecutionGapR([])).toEqual({ ok: false, reason: 'no_comparable_trades' });
  });

  it('is not restricted by System total sign — only System Edge Captured is', () => {
    const pairs = [pair('t1', '5', '2'), pair('t2', '-5', '1')];
    // System total = 0, but paired gap is still a normal, successful
    // result: (2-5) + (1-(-5)) = -3 + 6 = 3
    expect(pairedExecutionGapR(pairs)).toEqual({ ok: true, value: '3.0000' });
  });

  it('equals the sum of per-Trade gap, computed independently', () => {
    const pairs = [pair('t1', '3', '1'), pair('t2', '-2', '0.5'), pair('t3', '10', '9')];
    const aggregate = pairedExecutionGapR(pairs);
    const perTradeSum = pairs.reduce((sum, p) => {
      const result = executionGapR(p.actualR, p.systemR);
      if (!result.ok) throw new Error('expected an ok result');
      return sum + Number.parseFloat(result.value);
    }, 0);
    expect(aggregate.ok).toBe(true);
    if (aggregate.ok) {
      expect(Number.parseFloat(aggregate.value)).toBeCloseTo(perTradeSum, 4);
    }
  });
});

describe('averageExecutionGapR (primary aggregate)', () => {
  it('averages per-Trade gap, each Trade weighted equally', () => {
    const pairs = [pair('t1', '6', '5'), pair('t2', '4', '3')];
    // gap: (5-6) + (3-4) = -2, averaged over 2 Trades = -1
    expect(averageExecutionGapR(pairs)).toEqual({ ok: true, value: '-1.0000' });
  });

  it('matches the frozen example: System +5R, Actual -0.5R => -5.5R', () => {
    expect(averageExecutionGapR([pair('t1', '5', '-0.5')])).toEqual({
      ok: true,
      value: '-5.5000',
    });
  });

  it('empty comparable set', () => {
    expect(averageExecutionGapR([])).toEqual({ ok: false, reason: 'no_comparable_trades' });
  });

  it('is not the same as dividing the total by a differently-sized population', () => {
    const pairs = [pair('t1', '10', '0'), pair('t2', '0', '10'), pair('t3', '0', '10')];
    // per-trade gaps: -10, +10, +10 -> average = 10/3 = 3.3333
    expect(averageExecutionGapR(pairs)).toEqual({ ok: true, value: '3.3333' });
  });
});

describe('systemEdgeCaptured', () => {
  it('System total +10R / Actual total +8R => 0.8000', () => {
    const pairs = [pair('t1', '6', '5'), pair('t2', '4', '3')];
    expect(systemEdgeCaptured(pairs)).toEqual({ ok: true, value: '0.8000' });
  });

  it('efficiency > 1: System total +10R / Actual total +12R => 1.2000, never clamped', () => {
    expect(systemEdgeCaptured([pair('t1', '10', '12')])).toEqual({ ok: true, value: '1.2000' });
  });

  it('negative efficiency: System total +10R / Actual total -2R => -0.2000', () => {
    expect(systemEdgeCaptured([pair('t1', '10', '-2')])).toEqual({ ok: true, value: '-0.2000' });
  });

  it('System total exactly zero => system_has_no_edge', () => {
    const pairs = [pair('t1', '5', '2'), pair('t2', '-5', '1')];
    expect(systemEdgeCaptured(pairs)).toEqual({ ok: false, reason: 'system_has_no_edge' });
  });

  it('System total negative => system_has_no_edge', () => {
    expect(systemEdgeCaptured([pair('t1', '-5', '2')])).toEqual({
      ok: false,
      reason: 'system_has_no_edge',
    });
  });

  it('empty comparable set', () => {
    expect(systemEdgeCaptured([])).toEqual({ ok: false, reason: 'no_comparable_trades' });
  });

  it('never returns Infinity for any successful input', () => {
    const result = systemEdgeCaptured([pair('t1', '0.0001', '1000')]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toMatch(/NaN|Infinity/i);
  });
});

describe('isComparisonEligible / selectComparisonEligible', () => {
  const base = {
    status: 'closed',
    deletedAt: null,
    actualR: '2',
    traderOutcome: 'win' as const,
    actualExitedAt: new Date('2026-08-01T10:00:00Z'),
    systemStatus: 'resolved',
    systemR: '3',
    systemOutcome: 'win' as const,
    systemExitedAt: new Date('2026-08-01T09:00:00Z'),
  };

  it('eligible only when both the Actual and System axes are complete', () => {
    expect(isComparisonEligible(base)).toBe(true);
    expect(isComparisonEligible({ ...base, actualR: null })).toBe(false);
    expect(isComparisonEligible({ ...base, traderOutcome: null })).toBe(false);
    expect(isComparisonEligible({ ...base, actualExitedAt: null })).toBe(false);
    expect(isComparisonEligible({ ...base, systemR: null })).toBe(false);
    expect(isComparisonEligible({ ...base, systemOutcome: null })).toBe(false);
    expect(isComparisonEligible({ ...base, systemExitedAt: null })).toBe(false);
    expect(isComparisonEligible({ ...base, status: 'open' })).toBe(false);
    expect(isComparisonEligible({ ...base, systemStatus: 'pending' })).toBe(false);
    expect(isComparisonEligible({ ...base, deletedAt: new Date() })).toBe(false);
  });

  it('a closed Trader Trade with a still-pending System side is not comparison-eligible', () => {
    // Mirrors the Phase 07D brief's own example: Trader-eligible does not
    // imply comparison-eligible.
    expect(isComparisonEligible({ ...base, systemStatus: 'pending', systemR: null })).toBe(false);
  });

  it('selectComparisonEligible filters an array to only the eligible subset', () => {
    const trades = [
      { ...base, id: 't1' },
      { ...base, id: 't2', systemStatus: 'pending', systemR: null },
    ];
    expect(selectComparisonEligible(trades)).toEqual([{ ...base, id: 't1' }]);
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

describe('tradeRuleAdherence', () => {
  const check = (tradeId: string, status: RuleCheckRecord['status'], isRequired = true) => ({
    tradeId,
    status,
    isRequired,
  });

  it('classifies fully resolved required checks per Trade', () => {
    const result = tradeRuleAdherence([
      check('compliant', 'followed'),
      check('compliant', 'not_applicable'),
      check('non-compliant', 'followed'),
      check('non-compliant', 'violated'),
    ]);
    expect(result).toEqual({
      evaluatedTradeCount: 2,
      compliantTradeCount: 1,
      nonCompliantTradeCount: 1,
      incompleteTradeCount: 0,
      notApplicableTradeCount: 0,
      rate: { ok: true, value: '0.5000' },
    });
  });

  it('does not silently count not_checked as followed', () => {
    const result = tradeRuleAdherence([
      check('incomplete', 'followed'),
      check('incomplete', 'not_checked'),
    ]);
    expect(result).toMatchObject({
      evaluatedTradeCount: 0,
      incompleteTradeCount: 1,
      rate: { ok: false, reason: 'no_evaluated_trades' },
    });
  });

  it('treats all-not-applicable required rules as resolved but not an evaluated Trade', () => {
    expect(tradeRuleAdherence([check('n-a', 'not_applicable')])).toMatchObject({
      evaluatedTradeCount: 0,
      notApplicableTradeCount: 1,
      rate: { ok: false, reason: 'no_evaluated_trades' },
    });
  });

  it('keeps optional rule metadata outside the trade-level compliance classification', () => {
    expect(
      tradeRuleAdherence([
        check('trade', 'followed'),
        check('trade', 'violated', false),
        check('trade', 'not_checked', false),
      ]),
    ).toMatchObject({
      evaluatedTradeCount: 1,
      compliantTradeCount: 1,
      nonCompliantTradeCount: 0,
      incompleteTradeCount: 0,
      rate: { ok: true, value: '1.0000' },
    });
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

  it('systemEdgeCaptured is unchanged by input array permutation', () => {
    const pairs = [pair('t1', '3', '2'), pair('t2', '4', '5'), pair('t3', '3', '1')];
    const permuted = [pairs[2], pairs[0], pairs[1]] as PairedRTrade[];
    expect(systemEdgeCaptured(pairs)).toEqual(systemEdgeCaptured(permuted));
  });

  it('pairedExecutionGapR is unchanged by input array permutation', () => {
    const pairs = [pair('t1', '3', '2'), pair('t2', '4', '5'), pair('t3', '3', '1')];
    const permuted = [pairs[2], pairs[0], pairs[1]] as PairedRTrade[];
    expect(pairedExecutionGapR(pairs)).toEqual(pairedExecutionGapR(permuted));
  });

  it('no successful attribution result is NaN or Infinity', () => {
    const results = [
      executionGapR('3', '2'),
      pairedExecutionGapR([pair('t1', '3', '2')]),
      averageExecutionGapR([pair('t1', '3', '2')]),
      systemEdgeCaptured([pair('t1', '3', '2')]),
      ruleAdherenceRate([ruleCheck('followed'), ruleCheck('violated')]),
    ];
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).not.toMatch(/NaN|Infinity/i);
    }
  });
});
