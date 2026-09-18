import { describe, expect, it } from 'vitest';

import { deriveTradeResult } from './result';

describe('deriveTradeResult — the Trader axis, and only the Trader axis', () => {
  it('reports the stored trader outcome for a closed Trade', () => {
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: 'win',
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('win');
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: 'loss',
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('loss');
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: 'break_even',
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('break_even');
  });

  it('reports the lifecycle state while there is no settled outcome', () => {
    expect(
      deriveTradeResult({
        status: 'open',
        traderOutcome: null,
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('open');
    expect(
      deriveTradeResult({
        status: 'planned',
        traderOutcome: null,
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('planned');
    expect(
      deriveTradeResult({
        status: 'canceled',
        traderOutcome: null,
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('canceled');
  });

  it('never invents a break-even for a closed Trade with no classification', () => {
    // Printing BE here would claim a tolerance-banded classification that was
    // never made; printing LOSS would be worse still.
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: null,
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('unresolved');
  });

  /*
    An Add Trade contract row's stored outcome was derived from R under the
    pre-contract rules. Printing WIN in the Result column would attribute to
    the trader a judgement they were never asked for (contract §12).
  */
  it('never shows a contract row’s derived outcome as the trader’s answer', () => {
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: 'win',
        traderOutcomeSelected: false,
        recordingContract: 'add_trade_v1',
      }),
    ).toBe('outcome_unanswered');
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: null,
        traderOutcomeSelected: false,
        recordingContract: 'add_trade_v1',
      }),
    ).toBe('outcome_unanswered');
  });

  it('keeps the lifecycle ahead of the outcome question on a contract row', () => {
    expect(
      deriveTradeResult({
        status: 'open',
        traderOutcome: null,
        traderOutcomeSelected: false,
        recordingContract: 'add_trade_v1',
      }),
    ).toBe('open');
  });

  it('lets the lifecycle win over a stale outcome on a reopened Trade', () => {
    expect(
      deriveTradeResult({
        status: 'open',
        traderOutcome: 'win',
        traderOutcomeSelected: false,
        recordingContract: null,
      }),
    ).toBe('open');
  });

  it('shows an outcome the trader selected in After Trade as theirs', () => {
    expect(
      deriveTradeResult({
        status: 'closed',
        traderOutcome: 'break_even',
        traderOutcomeSelected: true,
        recordingContract: 'add_trade_v1',
      }),
    ).toBe('break_even');
  });
});
