import { describe, expect, it } from 'vitest';

import {
  contractActualRiskMinor,
  recalculatedTraderOutcome,
  reconcileExitHistory,
  traderOutcomeContradictsPnl,
} from './add-trade-contract';

describe('contractActualRiskMinor — Actual Risk is evidence, never the denominator', () => {
  it.each([
    ['matched', 5_000n, null, 5_000n],
    ['different', 5_000n, 7_000n, 7_000n],
    ['different', 5_000n, null, null],
    ['unknown', 5_000n, null, null],
    [undefined, 5_000n, null, null],
  ] as const)('%s → %s', (answer, riskAtEntryMinor, statedMinor, expected) => {
    expect(contractActualRiskMinor({ answer, riskAtEntryMinor, statedMinor })).toBe(expected);
  });
});

describe('traderOutcomeContradictsPnl — the quiet sign notice', () => {
  it('fires only for Win beside a loss and Loss beside a profit', () => {
    expect(traderOutcomeContradictsPnl('win', -1n)).toBe(true);
    expect(traderOutcomeContradictsPnl('loss', 1n)).toBe(true);
    expect(traderOutcomeContradictsPnl('win', 0n)).toBe(false);
    expect(traderOutcomeContradictsPnl('loss', 0n)).toBe(false);
    expect(traderOutcomeContradictsPnl('break_even', 500n)).toBe(false);
    expect(traderOutcomeContradictsPnl('break_even', -500n)).toBe(false);
  });

  it('is silent when either side is unknown', () => {
    expect(traderOutcomeContradictsPnl(null, -1n)).toBe(false);
    expect(traderOutcomeContradictsPnl('win', null)).toBe(false);
  });
});

describe('recalculatedTraderOutcome — a selected outcome survives recalculation', () => {
  it('keeps the trader’s choice and lets only a derived outcome follow the numbers', () => {
    const selected = { traderOutcome: 'loss', traderOutcomeSelectedAt: new Date() };
    const derived = { traderOutcome: 'loss', traderOutcomeSelectedAt: null };
    expect(recalculatedTraderOutcome(selected, 'win')).toBe('loss');
    expect(recalculatedTraderOutcome(derived, 'win')).toBe('win');
  });
});

describe('reconcileExitHistory — adoption and discrepancy need Complete, fully priced history', () => {
  it('finds a discrepancy only when Complete, fully priced and different', () => {
    expect(
      reconcileExitHistory({
        completeness: 'complete',
        exitPnlMinor: [600n, 400n],
        finalNetPnlMinor: 900n,
      }),
    ).toEqual({ subtotalMinor: 1_000n, adoptable: true, discrepancy: true });
  });

  it.each(['incomplete', 'unknown', null] as const)(
    'never calls a %s history a discrepancy, nor offers it as the result',
    (completeness) => {
      expect(
        reconcileExitHistory({ completeness, exitPnlMinor: [600n, 400n], finalNetPnlMinor: 900n }),
      ).toEqual({ subtotalMinor: 1_000n, adoptable: false, discrepancy: false });
    },
  );

  it('has no subtotal while any exit lacks P&L', () => {
    expect(
      reconcileExitHistory({
        completeness: 'complete',
        exitPnlMinor: [600n, null],
        finalNetPnlMinor: 900n,
      }),
    ).toEqual({ subtotalMinor: null, adoptable: false, discrepancy: false });
  });

  it('offers adoption with no Final Net P&L yet, without calling it a discrepancy', () => {
    expect(
      reconcileExitHistory({
        completeness: 'complete',
        exitPnlMinor: [600n],
        finalNetPnlMinor: null,
      }),
    ).toEqual({ subtotalMinor: 600n, adoptable: true, discrepancy: false });
  });

  it('offers nothing once the subtotal already is the result', () => {
    expect(
      reconcileExitHistory({
        completeness: 'complete',
        exitPnlMinor: [600n, 400n],
        finalNetPnlMinor: 1_000n,
      }),
    ).toEqual({ subtotalMinor: 1_000n, adoptable: false, discrepancy: false });
  });
});
