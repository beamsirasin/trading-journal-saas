import { describe, expect, it } from 'vitest';

import {
  adoptHistoricalExitSubtotal,
  applyHistoricalExitCorrection,
  beginHistoricalManualFinalEdit,
  deriveHistoricalExecutionSnapshot,
  deriveHistoricalReconciliation,
  historicalExitSubtotal,
  type HistoricalExecutionState,
} from './historical-execution';

function state(overrides: Partial<HistoricalExecutionState> = {}): HistoricalExecutionState {
  return {
    actualInitialRiskMinor: 100n,
    finalPnlMinor: null,
    finalPnlSource: null,
    exitHistoryCompleteness: 'complete',
    exits: [{ realizedPnlMinor: 100n }, { realizedPnlMinor: 300n }],
    ...overrides,
  };
}

function adopted(overrides: Partial<HistoricalExecutionState> = {}): HistoricalExecutionState {
  return {
    ...state(),
    finalPnlMinor: 400n,
    finalPnlSource: 'exit_history',
    ...overrides,
  };
}

describe('historical execution provenance transitions', () => {
  it('calculates an exact bigint subtotal and refuses missing legs', () => {
    expect(historicalExitSubtotal([{ realizedPnlMinor: 9_007_199_254_740_993n }])).toBe(
      9_007_199_254_740_993n,
    );
    expect(historicalExitSubtotal([])).toBeNull();
    expect(
      historicalExitSubtotal([{ realizedPnlMinor: 100n }, { realizedPnlMinor: null }]),
    ).toBeNull();
  });

  it.each([
    [400n, 'win', '4.0000'],
    [-150n, 'loss', '-1.5000'],
    [0n, 'break_even', '0.0000'],
  ] as const)('explicitly adopts %s and derives %s', (subtotal, outcome, actualR) => {
    const result = adoptHistoricalExitSubtotal(state({ exits: [{ realizedPnlMinor: subtotal }] }));
    expect(result).toMatchObject({
      ok: true,
      state: { finalPnlMinor: subtotal, finalPnlSource: 'exit_history' },
      snapshot: { traderOutcome: outcome, actualR, reconciliation: 'matched' },
    });
  });

  it('keeps Actual R unknown when risk is unknown while preserving outcome', () => {
    const result = adoptHistoricalExitSubtotal(state({ actualInitialRiskMinor: null }));
    expect(result).toMatchObject({ ok: true, snapshot: { traderOutcome: 'win', actualR: null } });
  });

  it.each([
    ['unknown completeness', state({ exitHistoryCompleteness: 'unknown' })],
    ['incomplete history', state({ exitHistoryCompleteness: 'incomplete' })],
    [
      'unpriced history',
      state({ exits: [{ realizedPnlMinor: 100n }, { realizedPnlMinor: null }] }),
    ],
    ['existing final', state({ finalPnlMinor: 400n, finalPnlSource: 'manual_total' })],
  ])('does not adopt %s', (_label, input) => {
    expect(adoptHistoricalExitSubtotal(input)).toEqual({
      ok: false,
      code: 'exit_history_not_adoptable',
    });
  });

  it.each([
    ['edit', [{ realizedPnlMinor: 100n }, { realizedPnlMinor: 250n }], 350n],
    [
      'add',
      [{ realizedPnlMinor: 100n }, { realizedPnlMinor: 300n }, { realizedPnlMinor: -25n }],
      375n,
    ],
    ['remove', [{ realizedPnlMinor: 300n }], 300n],
  ] as const)('%s follows a valid adopted history', (_label, exits, expected) => {
    const result = applyHistoricalExitCorrection(adopted(), {
      exitHistoryCompleteness: 'complete',
      exits,
    });
    expect(result).toMatchObject({
      ok: true,
      state: { finalPnlMinor: expected, finalPnlSource: 'exit_history' },
      snapshot: { reconciliation: 'matched' },
    });
  });

  it.each([
    ['incomplete', 'incomplete', [{ realizedPnlMinor: 100n }]],
    ['unknown', 'unknown', [{ realizedPnlMinor: 100n }]],
    ['unpriced', 'complete', [{ realizedPnlMinor: null }]],
  ] as const)(
    'freezes the accepted final when the basis becomes %s',
    (_label, completeness, exits) => {
      const result = applyHistoricalExitCorrection(adopted(), {
        exitHistoryCompleteness: completeness,
        exits,
      });
      expect(result).toMatchObject({
        ok: true,
        state: { finalPnlMinor: 400n, finalPnlSource: 'manual_total' },
      });
    },
  );

  it('manual editing takes ownership even when the value still equals the subtotal', () => {
    const result = beginHistoricalManualFinalEdit(adopted(), 400n);
    expect(result).toMatchObject({
      ok: true,
      state: { finalPnlMinor: 400n, finalPnlSource: 'manual_total' },
      snapshot: { reconciliation: 'matched' },
    });
  });

  it('requires resolution when a manual edit conflicts with declared-complete exits', () => {
    expect(beginHistoricalManualFinalEdit(adopted(), 401n)).toEqual({
      ok: false,
      code: 'historical_exit_conflict',
    });
  });

  it('later exit edits never overwrite a manually owned result or promote it by equality', () => {
    const changed = applyHistoricalExitCorrection(
      { ...adopted(), finalPnlSource: 'manual_total' },
      { exitHistoryCompleteness: 'complete', exits: [{ realizedPnlMinor: 400n }] },
    );
    expect(changed).toMatchObject({
      ok: true,
      state: { finalPnlMinor: 400n, finalPnlSource: 'manual_total' },
    });
  });

  it('rejects a complete conflicting correction but permits incomplete disagreement', () => {
    const manual = { ...adopted(), finalPnlSource: 'manual_total' as const };
    expect(
      applyHistoricalExitCorrection(manual, {
        exitHistoryCompleteness: 'complete',
        exits: [{ realizedPnlMinor: 399n }],
      }),
    ).toEqual({ ok: false, code: 'historical_exit_conflict' });
    expect(
      applyHistoricalExitCorrection(manual, {
        exitHistoryCompleteness: 'incomplete',
        exits: [{ realizedPnlMinor: 399n }],
      }),
    ).toMatchObject({ ok: true, snapshot: { reconciliation: 'unreconciled' } });
  });

  it('keeps a complete fully priced history with no final result offerable but unchanged', () => {
    const input = state();
    expect(deriveHistoricalExecutionSnapshot(input)).toMatchObject({
      exitSubtotalMinor: 400n,
      reconciliation: 'not_applicable',
      canAdoptExitSubtotal: true,
    });
    expect(input).toMatchObject({ finalPnlMinor: null, finalPnlSource: null });
  });

  it('derives every reconciliation state without persisting one', () => {
    expect(
      deriveHistoricalReconciliation(state({ exits: [], exitHistoryCompleteness: null })),
    ).toBe('not_recorded');
    expect(deriveHistoricalReconciliation(state({ exitHistoryCompleteness: null }))).toBe(
      'unreconciled',
    );
    expect(deriveHistoricalReconciliation(adopted())).toBe('matched');
    expect(deriveHistoricalReconciliation({ ...adopted(), finalPnlMinor: 401n })).toBe('conflict');
    expect(deriveHistoricalReconciliation(state({ exits: [{ realizedPnlMinor: null }] }))).toBe(
      'not_applicable',
    );
  });

  it('preserves a legacy null source until an explicit ownership transition', () => {
    const legacy = state({ finalPnlMinor: 400n, finalPnlSource: null });
    expect(deriveHistoricalExecutionSnapshot(legacy)).toMatchObject({
      reconciliation: 'matched',
      canAdoptExitSubtotal: false,
    });
  });
});
