import { describe, expect, it } from 'vitest';

import { CALC_VERSION } from '@/config/trade-calc';

import * as tradeModule from './trade';
import {
  actualR,
  classifyOutcome,
  composePlanned,
  composePlannedR,
  composeRealizedActual,
  composeSystemResolve,
  composeTraderClose,
  composeTraderCloseV2,
  moneyPlannedR,
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

describe('moneyPlannedR', () => {
  it('+2R from a reward twice the risk', () => {
    expect(moneyPlannedR(1000n, 2000n)).toEqual({ ok: true, value: '2.0000' });
  });

  it('0R when reward is exactly zero (a valid break-even-or-better plan)', () => {
    expect(moneyPlannedR(1000n, 0n)).toEqual({ ok: true, value: '0.0000' });
  });

  it('rejects a non-positive planned risk', () => {
    expect(moneyPlannedR(0n, 1000n)).toEqual({ ok: false, reason: 'invalid_planned_risk' });
    expect(moneyPlannedR(-1000n, 1000n)).toEqual({ ok: false, reason: 'invalid_planned_risk' });
  });

  it('rejects a negative planned reward', () => {
    expect(moneyPlannedR(1000n, -1n)).toEqual({ ok: false, reason: 'invalid_planned_reward' });
  });

  it('treats an absent reward as missing_input, not an error about risk', () => {
    expect(moneyPlannedR(1000n, null)).toEqual({ ok: false, reason: 'missing_input' });
    expect(moneyPlannedR(1000n, undefined)).toEqual({ ok: false, reason: 'missing_input' });
  });

  it('treats an absent risk as missing_input', () => {
    expect(moneyPlannedR(null, 1000n)).toEqual({ ok: false, reason: 'missing_input' });
  });

  it('never crosses a JS number — a value far beyond Number.MAX_SAFE_INTEGER stays exact', () => {
    const risk = 10_000_000_000_000_000n;
    const reward = 30_000_000_000_000_000n;
    expect(moneyPlannedR(risk, reward)).toEqual({ ok: true, value: '3.0000' });
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

describe('Actual execution V2 Exit composition', () => {
  const priceExits = [
    { closedBps: 5_000, exitPrice: '120' },
    { closedBps: 2_500, exitPrice: '140' },
    { closedBps: 2_500, exitPrice: '160' },
  ] as const;

  it('weights Price-mode long Exit legs exactly once: 50%@+2R, 25%@+4R, 25%@+6R', () => {
    expect(
      composeRealizedActual({
        actualResultMode: 'price',
        direction: 'long',
        actualEntry: '100',
        actualInitialStop: '90',
        exits: priceExits,
      }),
    ).toEqual({
      ok: true,
      value: { closedBps: 10_000, realizedR: '3.5000', realizedPnlMinor: null },
    });
  });

  it('uses the direction-aware equivalent for a short Trade', () => {
    expect(
      composeRealizedActual({
        actualResultMode: 'price',
        direction: 'short',
        actualEntry: '100',
        actualInitialStop: '110',
        exits: [
          { closedBps: 5_000, exitPrice: '80' },
          { closedBps: 2_500, exitPrice: '60' },
          { closedBps: 2_500, exitPrice: '40' },
        ],
      }),
    ).toMatchObject({ ok: true, value: { realizedR: '3.5000' } });
  });

  it('does not clamp a Price Exit beyond the initial Stop', () => {
    expect(
      composeRealizedActual({
        actualResultMode: 'price',
        direction: 'long',
        actualEntry: '100',
        actualInitialStop: '90',
        exits: [{ closedBps: 10_000, exitPrice: '80' }],
      }),
    ).toMatchObject({ ok: true, value: { realizedR: '-2.0000' } });
  });

  it('represents a Price break-even Exit exactly', () => {
    expect(
      composeTraderCloseV2({
        actualResultMode: 'price',
        direction: 'long',
        actualEntry: '100',
        actualInitialStop: '90',
        exits: [{ closedBps: 10_000, exitPrice: '100' }],
      }),
    ).toMatchObject({
      ok: true,
      value: { actualR: '0.0000', traderOutcome: 'break_even' },
    });
  });

  it('sums Money-mode leg P&L without multiplying by closed_bps again', () => {
    expect(
      composeRealizedActual({
        actualResultMode: 'money',
        direction: 'long',
        actualInitialRiskMinor: 100n,
        exits: [
          { closedBps: 5_000, realizedPnlMinor: 100n },
          { closedBps: 2_500, realizedPnlMinor: 100n },
          { closedBps: 2_500, realizedPnlMinor: 150n },
        ],
      }),
    ).toEqual({
      ok: true,
      value: { closedBps: 10_000, realizedR: '3.5000', realizedPnlMinor: 350n },
    });
  });

  it('handles mixed negative and positive Money legs', () => {
    expect(
      composeRealizedActual({
        actualResultMode: 'money',
        direction: 'long',
        actualInitialRiskMinor: 100n,
        exits: [
          { closedBps: 3_333, realizedPnlMinor: -25n },
          { closedBps: 3_333, realizedPnlMinor: 50n },
          { closedBps: 3_334, realizedPnlMinor: 75n },
        ],
      }),
    ).toMatchObject({
      ok: true,
      value: { closedBps: 10_000, realizedR: '1.0000', realizedPnlMinor: 100n },
    });
  });

  it('keeps exact integer closed_bps and rejects totals above 10000', () => {
    expect(
      composeRealizedActual({
        actualResultMode: 'money',
        direction: 'long',
        actualInitialRiskMinor: 100n,
        exits: [
          { closedBps: 3_333, realizedPnlMinor: 1n },
          { closedBps: 3_333, realizedPnlMinor: 1n },
          { closedBps: 3_334, realizedPnlMinor: 1n },
        ],
      }),
    ).toMatchObject({ ok: true, value: { closedBps: 10_000 } });
    expect(
      composeRealizedActual({
        actualResultMode: 'money',
        direction: 'long',
        actualInitialRiskMinor: 100n,
        exits: [
          { closedBps: 5_001, realizedPnlMinor: 1n },
          { closedBps: 5_000, realizedPnlMinor: 1n },
        ],
      }),
    ).toEqual({ ok: false, reason: 'invalid_closed_bps' });
  });

  it('applies the canonical final outcome tolerance', () => {
    const context = {
      actualResultMode: 'price',
      direction: 'long',
      actualEntry: '100',
      actualInitialStop: '90',
    } as const;
    expect(
      composeTraderCloseV2({
        ...context,
        exits: [{ closedBps: 10_000, exitPrice: '100.5' }],
      }),
    ).toMatchObject({ ok: true, value: { actualR: '0.0500', traderOutcome: 'break_even' } });
    expect(
      composeTraderCloseV2({
        ...context,
        exits: [{ closedBps: 10_000, exitPrice: '100.501' }],
      }),
    ).toMatchObject({ ok: true, value: { actualR: '0.0501', traderOutcome: 'win' } });
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

  it.each([
    ['System Win / Trader Win', 1000n, '110', 'win', 'win'],
    ['System Win / Trader Loss', -1000n, '110', 'loss', 'win'],
    ['System Loss / Trader Win', 1000n, '90', 'win', 'loss'],
    ['System Loss / Trader Loss', -1000n, '90', 'loss', 'loss'],
  ] as const)(
    'records the %s quadrant without coupling the outcome axes',
    (_label, netPnlMinor, systemExit, traderOutcome, systemOutcome) => {
      const trader = composeTraderClose(netPnlMinor, 1000n);
      const system = composeSystemResolve('long', '100', '90', systemExit, '0');

      expect(trader.ok && trader.value.traderOutcome).toBe(traderOutcome);
      expect(system.ok && system.value.systemOutcome).toBe(systemOutcome);
    },
  );

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

describe('composePlannedR — combined Price + Money (migration 0010)', () => {
  const base = {
    direction: 'long',
    plannedEntry: null as string | null,
    plannedStop: null as string | null,
    plannedTarget: null as string | null,
    plannedRiskMinor: null as bigint | null,
    plannedRewardMinor: null as bigint | null,
  };

  it('Price-only: Entry/Stop/Target present, Money entirely absent', () => {
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '90',
      plannedTarget: '130',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        priceR: '3.0000',
        moneyR: null,
        plannedR: '3.0000',
        source: 'price',
        mismatch: false,
      },
    });
  });

  it('Price-only, no Target: risk shape still validated, plannedR stays null', () => {
    const result = composePlannedR({ ...base, plannedEntry: '100', plannedStop: '90' });
    expect(result).toEqual({
      ok: true,
      value: { priceR: null, moneyR: null, plannedR: null, source: 'none', mismatch: false },
    });
  });

  it('Money-only: risk/reward present, Price entirely absent', () => {
    const result = composePlannedR({
      ...base,
      plannedRiskMinor: 1000n,
      plannedRewardMinor: 3000n,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        priceR: null,
        moneyR: '3.0000',
        plannedR: '3.0000',
        source: 'money',
        mismatch: false,
      },
    });
  });

  it('Money-only, no Reward: risk validated, plannedR stays null', () => {
    const result = composePlannedR({ ...base, plannedRiskMinor: 1000n });
    expect(result).toEqual({
      ok: true,
      value: { priceR: null, moneyR: null, plannedR: null, source: 'none', mismatch: false },
    });
  });

  it('neither Price nor Money present at all: a legitimate, non-error empty snapshot', () => {
    expect(composePlannedR(base)).toEqual({
      ok: true,
      value: { priceR: null, moneyR: null, plannedR: null, source: 'none', mismatch: false },
    });
  });

  it('Both present and agreeing exactly: Price precedence, mismatch false', () => {
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '90',
      plannedTarget: '130',
      plannedRiskMinor: 1000n,
      plannedRewardMinor: 3000n,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        priceR: '3.0000',
        moneyR: '3.0000',
        plannedR: '3.0000',
        source: 'both',
        mismatch: false,
      },
    });
  });

  it('Both present, exactly at the 0.0500R tolerance boundary: accepted, no mismatch', () => {
    // Price R = 3.0000 (reward 30 / risk 10). Money R = 3050/1000 = 3.0500 —
    // difference is exactly PLANNED_R_AGREEMENT_TOLERANCE_R (0.0500), and the
    // comparison is strictly-greater-than, so the boundary value itself must
    // still agree.
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '90',
      plannedTarget: '130',
      plannedRiskMinor: 1000n,
      plannedRewardMinor: 3050n,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.mismatch).toBe(false);
  });

  it('Both present, one minor unit beyond the 0.0500R tolerance boundary: mismatch true', () => {
    // Money R = 3051/1000 = 3.0510 — difference from Price R (3.0000) is
    // 0.0510, one ten-thousandth of an R beyond the 0.0500 tolerance.
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '90',
      plannedTarget: '130',
      plannedRiskMinor: 1000n,
      plannedRewardMinor: 3051n,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.mismatch).toBe(true);
  });

  it('Both present, well beyond tolerance: mismatch true, Price-precedence value still returned', () => {
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '90',
      plannedTarget: '130', // priceR = 3.0000
      plannedRiskMinor: 1000n,
      plannedRewardMinor: 5000n, // moneyR = 5.0000
    });
    expect(result).toEqual({
      ok: true,
      value: {
        priceR: '3.0000',
        moneyR: '5.0000',
        plannedR: '3.0000',
        source: 'both',
        mismatch: true,
      },
    });
  });

  it('rejects an invalid Price pair even when Money is valid', () => {
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '110', // wrong side for long
      plannedRiskMinor: 1000n,
      plannedRewardMinor: 2000n,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_risk_direction' });
  });

  it('rejects an invalid Money risk even when Price is valid', () => {
    const result = composePlannedR({
      ...base,
      plannedEntry: '100',
      plannedStop: '90',
      plannedRiskMinor: -1000n,
      plannedRewardMinor: 2000n,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_planned_risk' });
  });

  it('rejects a Price fragment: Entry without Stop', () => {
    expect(composePlannedR({ ...base, plannedEntry: '100' })).toEqual({
      ok: false,
      reason: 'missing_input',
    });
  });

  it('rejects a Price fragment: Target without Entry/Stop', () => {
    expect(composePlannedR({ ...base, plannedTarget: '130' })).toEqual({
      ok: false,
      reason: 'missing_input',
    });
  });

  it('rejects a Money fragment: Reward without Risk', () => {
    expect(composePlannedR({ ...base, plannedRewardMinor: 2000n })).toEqual({
      ok: false,
      reason: 'missing_input',
    });
  });

  it('never crosses Number for the Money side inside a combined computation', () => {
    const result = composePlannedR({
      ...base,
      plannedRiskMinor: 10_000_000_000_000_000n,
      plannedRewardMinor: 30_000_000_000_000_000n,
    });
    expect(result.ok && result.value.moneyR).toBe('3.0000');
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
        'composePlannedR',
        'composeRealizedActual',
        'composeSystemResolve',
        'composeTraderClose',
        'composeTraderCloseV2',
        'moneyPlannedR',
        'plannedR',
        'resolveSystemR',
        'systemGrossR',
        'systemR',
      ].sort(),
    );
  });

  it('moneyPlannedR takes only two bigint account-currency inputs — no price, quantity, or multiplier parameter', () => {
    expect(moneyPlannedR.length).toBe(2);
  });

  it('actualR takes only two bigint account-currency inputs — no price, quantity, or multiplier parameter', () => {
    expect(actualR.length).toBe(2);
  });
});
