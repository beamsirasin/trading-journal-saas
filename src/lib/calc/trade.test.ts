import { describe, expect, it } from 'vitest';

import { CALC_VERSION } from '@/config/trade-calc';

import * as tradeModule from './trade';
import {
  actualR,
  classifyOutcome,
  composePlanned,
  composeSystemResolve,
  composeTraderClose,
  plannedR,
  resolveSystemR,
  systemGrossR,
  systemR,
} from './trade';

describe('plannedR', () => {
  it('long: Entry 100 / Stop 90 / Target 130 => +3R', () => {
    expect(plannedR('long', '100', '90', '130')).toEqual({ ok: true, value: '3.0000' });
  });

  it('short: Entry 100 / Stop 110 / Target 70 => +3R', () => {
    expect(plannedR('short', '100', '110', '70')).toEqual({ ok: true, value: '3.0000' });
  });

  it('fractional FX-like prices', () => {
    expect(plannedR('long', '1.10000', '1.09500', '1.11000')).toEqual({
      ok: true,
      value: '2.0000',
    });
  });

  it('JPY-like 2-3 decimal prices', () => {
    expect(plannedR('long', '150.500', '150.250', '151.000')).toEqual({
      ok: true,
      value: '2.0000',
    });
  });

  it('crypto-like high-precision prices', () => {
    expect(plannedR('long', '43000.00000001', '42900.00000001', '43300.00000001')).toEqual({
      ok: true,
      value: '3.0000',
    });
  });

  it('rejects zero risk (Stop equals Entry)', () => {
    expect(plannedR('long', '100', '100', '130')).toEqual({ ok: false, reason: 'zero_risk' });
  });

  it('rejects a wrong-side long Stop', () => {
    expect(plannedR('long', '100', '105', '130')).toEqual({
      ok: false,
      reason: 'invalid_risk_direction',
    });
  });

  it('rejects a wrong-side short Stop', () => {
    expect(plannedR('short', '100', '95', '70')).toEqual({
      ok: false,
      reason: 'invalid_risk_direction',
    });
  });

  it('rejects a wrong-side long Target (below Entry) without turning it into a positive R', () => {
    const result = plannedR('long', '100', '90', '95');
    expect(result).toEqual({ ok: false, reason: 'invalid_target_direction' });
  });

  it('rejects a long Target exactly at Entry (zero reward is not strictly profitable)', () => {
    expect(plannedR('long', '100', '90', '100')).toEqual({
      ok: false,
      reason: 'invalid_target_direction',
    });
  });

  it('rejects a wrong-side short Target (above Entry) without turning it into a positive R', () => {
    const result = plannedR('short', '100', '110', '105');
    expect(result).toEqual({ ok: false, reason: 'invalid_target_direction' });
  });

  it('rejects a malformed decimal', () => {
    expect(plannedR('long', 'abc', '90', '130')).toEqual({
      ok: false,
      reason: 'invalid_decimal',
    });
  });

  it('handles a huge but representable decimal input', () => {
    expect(
      plannedR(
        'long',
        '99999999999.0000000000',
        '99999999998.0000000000',
        '100000000002.0000000000',
      ),
    ).toEqual({ ok: true, value: '3.0000' });
  });
});

describe('actualR', () => {
  it('+2R', () => {
    expect(actualR(2000n, 1000n)).toEqual({ ok: true, value: '2.0000' });
  });

  it('-1R', () => {
    expect(actualR(-1000n, 1000n)).toEqual({ ok: true, value: '-1.0000' });
  });

  it('exact 0', () => {
    expect(actualR(0n, 1000n)).toEqual({ ok: true, value: '0.0000' });
  });

  it('+0.03R', () => {
    expect(actualR(3n, 100n)).toEqual({ ok: true, value: '0.0300' });
  });

  it('negative net P&L', () => {
    expect(actualR(-500n, 2000n)).toEqual({ ok: true, value: '-0.2500' });
  });

  it('extremely large bigint values, exact division', () => {
    expect(actualR(10_000_000_000_000_000_000n, 2_000_000_000_000_000_000n)).toEqual({
      ok: true,
      value: '5.0000',
    });
  });

  it('non-divisible bigint ratio rounds deterministically', () => {
    // 100 / 3 = 33.3333... — 5th decimal digit is 3, rounds down.
    expect(actualR(100n, 3n)).toEqual({ ok: true, value: '33.3333' });
  });

  it('rejects zero risk', () => {
    expect(actualR(1000n, 0n)).toEqual({ ok: false, reason: 'invalid_initial_risk' });
  });

  it('rejects negative risk', () => {
    expect(actualR(1000n, -500n)).toEqual({ ok: false, reason: 'invalid_initial_risk' });
  });

  it('rejects missing input', () => {
    expect(actualR(null, 1000n)).toEqual({ ok: false, reason: 'missing_input' });
    expect(actualR(1000n, undefined)).toEqual({ ok: false, reason: 'missing_input' });
  });
});

describe('systemGrossR', () => {
  it('long, Entry 100 / Stop 90: exit 130 => +3R', () => {
    expect(systemGrossR('long', '100', '90', '130')).toEqual({ ok: true, value: '3.0000' });
  });

  it('long, Entry 100 / Stop 90: exit exactly at Entry => 0R', () => {
    expect(systemGrossR('long', '100', '90', '100')).toEqual({ ok: true, value: '0.0000' });
  });

  it('long, Entry 100 / Stop 90: exit at Stop => -1R', () => {
    expect(systemGrossR('long', '100', '90', '90')).toEqual({ ok: true, value: '-1.0000' });
  });

  it('long, Entry 100 / Stop 90: partial-loss exit at 95 => -0.5R', () => {
    expect(systemGrossR('long', '100', '90', '95')).toEqual({ ok: true, value: '-0.5000' });
  });

  it('short, Entry 100 / Stop 110: exit 70 => +3R', () => {
    expect(systemGrossR('short', '100', '110', '70')).toEqual({ ok: true, value: '3.0000' });
  });

  it('short, Entry 100 / Stop 110: exit at Stop => -1R', () => {
    expect(systemGrossR('short', '100', '110', '110')).toEqual({ ok: true, value: '-1.0000' });
  });

  it('does NOT require the exit price to be on the profitable side (unlike plannedR)', () => {
    // A losing System exit is a legitimate, representable outcome.
    const result = systemGrossR('long', '100', '90', '80');
    expect(result.ok).toBe(true);
  });
});

describe('systemR', () => {
  it('zero system cost leaves gross R unchanged', () => {
    expect(systemR('long', '100', '90', '130', '0')).toEqual({ ok: true, value: '3.0000' });
  });

  it('positive system cost reduces a profitable gross R', () => {
    expect(systemR('long', '100', '90', '130', '0.1')).toEqual({ ok: true, value: '2.9000' });
  });

  it('positive system cost increases the magnitude of a loss', () => {
    expect(systemR('long', '100', '90', '90', '0.05')).toEqual({ ok: true, value: '-1.0500' });
  });

  it('never clamps a loss at zero', () => {
    // gross R = (80 - 100) / (100 - 90) = -2.0; systemR = -2.0 - 0.5 = -2.5
    const result = systemR('long', '100', '90', '80', '0.5');
    expect(result).toEqual({ ok: true, value: '-2.5000' });
  });

  it('rejects a negative system cost', () => {
    expect(systemR('long', '100', '90', '130', '-0.1')).toEqual({
      ok: false,
      reason: 'invalid_system_cost',
    });
  });

  it('rejects missing system cost', () => {
    expect(systemR('long', '100', '90', '130', undefined)).toEqual({
      ok: false,
      reason: 'missing_input',
    });
  });
});

describe('resolveSystemR (system status wrapper)', () => {
  it('pending returns an explicit unresolved result, never 0R', () => {
    const result = resolveSystemR({
      systemStatus: 'pending',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(result).toEqual({ ok: false, reason: 'unresolved_system_outcome' });
  });

  it('no_trade returns an explicit system_no_trade result, never 0R', () => {
    const result = resolveSystemR({
      systemStatus: 'no_trade',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(result).toEqual({ ok: false, reason: 'system_no_trade' });
  });

  it('resolved calculates from the resolved inputs', () => {
    const result = resolveSystemR({
      systemStatus: 'resolved',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
      systemExitPrice: '130',
      systemCostR: '0',
    });
    expect(result).toEqual({ ok: true, value: '3.0000' });
  });
});

describe('classifyOutcome', () => {
  const cases: [string, 'win' | 'loss' | 'break_even'][] = [
    ['0.0000', 'break_even'],
    ['0.0500', 'break_even'],
    ['-0.0500', 'break_even'],
    ['0.0501', 'win'],
    ['-0.0501', 'loss'],
    ['2.0000', 'win'],
    ['-1.0000', 'loss'],
  ];

  it.each(cases)('%s -> %s', (r, expected) => {
    expect(classifyOutcome(r)).toEqual({ ok: true, value: expected });
  });

  it('rejects a malformed R string', () => {
    expect(classifyOutcome('abc')).toEqual({ ok: false, reason: 'invalid_decimal' });
  });

  it('rejects missing input', () => {
    expect(classifyOutcome(undefined)).toEqual({ ok: false, reason: 'missing_input' });
  });

  it('classifies a value with more input precision than the persisted 4dp form consistently', () => {
    // '0.05001' is above tolerance at full precision, and remains so even
    // though the persisted snapshot form would round it to '0.0500'
    // (break-even) — classification here is intentionally performed on the
    // exact string passed in, not on a pre-rounded value.
    expect(classifyOutcome('0.05001')).toEqual({ ok: true, value: 'win' });
  });
});

describe('per-Trade snapshot composition', () => {
  it('planned +3R / actual +2R / system pending — Trader close succeeds independently of System', () => {
    const planned = composePlanned('long', '100', '90', '130');
    expect(planned).toEqual({ ok: true, value: { plannedR: '3.0000' } });

    const trader = composeTraderClose(2000n, 1000n);
    expect(trader).toEqual({
      ok: true,
      value: { actualR: '2.0000', traderOutcome: 'win', calcVersion: CALC_VERSION },
    });

    const system = resolveSystemR({
      systemStatus: 'pending',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(system).toEqual({ ok: false, reason: 'unresolved_system_outcome' });
  });

  it('actual -1R / system +3R — system win, trader loss (the valuable quadrant)', () => {
    const trader = composeTraderClose(-1000n, 1000n);
    expect(trader).toEqual({
      ok: true,
      value: { actualR: '-1.0000', traderOutcome: 'loss', calcVersion: CALC_VERSION },
    });

    const system = composeSystemResolve('long', '100', '90', '130', '0');
    expect(system).toEqual({
      ok: true,
      value: { systemR: '3.0000', systemOutcome: 'win', calcVersion: CALC_VERSION },
    });
  });

  it('actual +2R / system +3R — both sides win, System still captured more', () => {
    const trader = composeTraderClose(2000n, 1000n);
    expect(trader.ok && trader.value.actualR).toBe('2.0000');

    const system = composeSystemResolve('long', '100', '90', '130', '0');
    expect(system.ok && system.value.systemR).toBe('3.0000');
  });

  it('no_trade System status never blocks an independently-closed Trader side', () => {
    const trader = composeTraderClose(500n, 1000n);
    expect(trader.ok).toBe(true);

    const system = resolveSystemR({
      systemStatus: 'no_trade',
      direction: 'long',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(system).toEqual({ ok: false, reason: 'system_no_trade' });
  });

  it('every composed snapshot stamps calc_version exactly 1', () => {
    expect(CALC_VERSION).toBe(1);
    const trader = composeTraderClose(2000n, 1000n);
    const system = composeSystemResolve('long', '100', '90', '130', '0');
    expect(trader.ok && trader.value.calcVersion).toBe(1);
    expect(system.ok && system.value.calcVersion).toBe(1);
  });
});

describe('precision — engine does not regress to binary floating point', () => {
  it('a Planned R built from 0.1/0.2/0.3-shaped prices is exact', () => {
    // Entry 0.3, Stop 0.1 (risk 0.2), Target 0.7 (reward 0.4) => R = 2
    // 0.3 - 0.1 in native floating point is 0.19999999999999998, not 0.2.
    expect(plannedR('long', '0.3', '0.1', '0.7')).toEqual({ ok: true, value: '2.0000' });
  });

  it('high-precision instrument prices (8 decimals, crypto-like) round exactly once', () => {
    expect(systemGrossR('long', '43210.12345678', '43000.00000001', '43420.24691355')).toEqual({
      ok: true,
      value: '1.0000',
    });
  });
});

describe('invariant / property checks', () => {
  const riskValues = [1n, 3n, 7n, 1000n, 999_999n, 10_000_000_000n];

  it.each(riskValues)('actualR(risk, risk) == 1R for risk=%s', (risk) => {
    expect(actualR(risk, risk)).toEqual({ ok: true, value: '1.0000' });
  });

  it.each(riskValues)('actualR(-risk, risk) == -1R for risk=%s', (risk) => {
    expect(actualR(-risk, risk)).toEqual({ ok: true, value: '-1.0000' });
  });

  const mirroredPairs: [string, string, string, string, string, string][] = [
    ['100', '90', '130', '100', '110', '70'],
    ['1.1000', '1.0950', '1.1100', '1.1000', '1.1050', '1.0900'],
    ['50000', '49000', '53000', '50000', '51000', '47000'],
  ];

  it.each(mirroredPairs)(
    'long(entry=%s,stop=%s,target=%s) and mirrored short(entry=%s,stop=%s,target=%s) produce the same R',
    (longEntry, longStop, longTarget, shortEntry, shortStop, shortTarget) => {
      const long = plannedR('long', longEntry, longStop, longTarget);
      const short = plannedR('short', shortEntry, shortStop, shortTarget);
      expect(long.ok).toBe(true);
      expect(short.ok).toBe(true);
      expect(long.ok && short.ok && long.value).toBe(short.ok && short.value);
    },
  );

  it('increasing systemCostR never increases systemR for a fixed gross R', () => {
    const costs = ['0', '0.1', '0.5', '1.0', '2.5'];
    const results = costs.map((cost) => {
      const result = systemR('long', '100', '90', '130', cost);
      if (!result.ok) throw new Error('expected an ok result');
      return Number.parseFloat(result.value);
    });
    for (let i = 1; i < results.length; i += 1) {
      expect(results[i]).toBeLessThanOrEqual(results[i - 1] as number);
    }
  });

  it('classifyOutcome is symmetric outside the tolerance band', () => {
    const magnitudes = ['0.0501', '0.1000', '1.0000', '10.0000'];
    for (const magnitude of magnitudes) {
      const positive = classifyOutcome(magnitude);
      const negative = classifyOutcome(`-${magnitude}`);
      expect(positive).toEqual({ ok: true, value: 'win' });
      expect(negative).toEqual({ ok: true, value: 'loss' });
    }
  });

  it('classifyOutcome is symmetric inside the tolerance band', () => {
    const magnitudes = ['0.0000', '0.0100', '0.0500'];
    for (const magnitude of magnitudes) {
      expect(classifyOutcome(magnitude)).toEqual({ ok: true, value: 'break_even' });
      expect(classifyOutcome(`-${magnitude}`)).toEqual({ ok: true, value: 'break_even' });
    }
  });

  it('no successful calculation ever returns NaN or Infinity in its string output', () => {
    const successfulResults = [
      plannedR('long', '100', '90', '130'),
      plannedR('short', '1.1', '1.2', '0.9'),
      actualR(2000n, 1000n),
      actualR(-500n, 3n),
      systemGrossR('long', '100', '90', '95'),
      systemR('short', '100', '110', '70', '0.25'),
    ];
    for (const result of successfulResults) {
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toMatch(/NaN|Infinity/i);
      }
    }
  });

  it('no calculation throws for any documented failure input — every failure is a CalcResult', () => {
    expect(() => plannedR('long', 'garbage', '90', '130')).not.toThrow();
    expect(() => actualR(1000n, 0n)).not.toThrow();
    expect(() => systemR('long', '100', '90', '130', '-1')).not.toThrow();
    expect(() => classifyOutcome('garbage')).not.toThrow();
  });
});

describe('no monetary price-derived P&L (regression protection)', () => {
  /**
   * This module must never gain a function that computes authoritative
   * currency P&L from `price difference × quantity × contract multiplier` —
   * that formula is not universally valid across instruments/currencies (see
   * this file's own top-of-module comment and `docs/calculation-spec.md`).
   * The closed export list below is the actual regression guard: a future
   * addition matching a price×quantity×multiplier shape would fail this
   * test and require a deliberate, reviewed decision to widen it.
   */
  it('exports exactly the approved Phase 07C calculation functions', () => {
    const exportedNames = Object.keys(tradeModule).sort();
    expect(exportedNames).toEqual(
      [
        'actualR',
        'classifyOutcome',
        'composePlanned',
        'composeSystemResolve',
        'composeTraderClose',
        'plannedR',
        'resolveSystemR',
        'systemGrossR',
        'systemR',
      ].sort(),
    );
  });

  it('actualR takes only two bigint account-currency inputs — no price, quantity, or multiplier parameter', () => {
    expect(actualR.length).toBe(2);
  });
});
