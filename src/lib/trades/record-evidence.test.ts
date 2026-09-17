import { describe, expect, it } from 'vitest';

import {
  tradeExecutionGapEvidence,
  tradeOutcomeEvidence,
  tradeSystemResultEvidence,
} from './record-evidence';

const CONTRACT = { recordingContract: 'add_trade_v1' } as const;
const LEGACY = { recordingContract: null } as const;

describe('Trader Outcome evidence', () => {
  /*
    The pre-contract close still writes a derived `trader_outcome` on a
    contract row. Contract §12 reserves Win / BE / Loss for the trader's own
    answer, so that derived value must never reach a record surface as one.
  */
  it('refuses a derived outcome on an Add Trade contract row', () => {
    expect(tradeOutcomeEvidence({ ...CONTRACT, traderOutcome: 'win' })).toEqual({
      status: 'unavailable',
      reason: 'outcome_not_selected',
    });
    expect(tradeOutcomeEvidence({ ...CONTRACT, traderOutcome: 'loss' })).toEqual({
      status: 'unavailable',
      reason: 'outcome_not_selected',
    });
  });

  it('keeps a legacy row’s classification, marked as legacy-derived', () => {
    expect(tradeOutcomeEvidence({ ...LEGACY, traderOutcome: 'win' })).toEqual({
      status: 'legacy_derived',
      outcome: 'win',
    });
  });

  it('separates “not recorded” from “not answered”', () => {
    // A legacy row with no classification is missing evidence; a contract row
    // is waiting on a question the product has not asked yet. Neither is a BE.
    expect(tradeOutcomeEvidence({ ...LEGACY, traderOutcome: null })).toEqual({
      status: 'unavailable',
      reason: 'not_recorded',
    });
    expect(tradeOutcomeEvidence({ ...CONTRACT, traderOutcome: null })).toEqual({
      status: 'unavailable',
      reason: 'outcome_not_selected',
    });
  });
});

describe('System Result evidence', () => {
  it('gives a contract row no canonical System Result, however its System R was stored', () => {
    expect(
      tradeSystemResultEvidence({ ...CONTRACT, systemStatus: 'resolved', systemR: '3.0000' }),
    ).toEqual({ status: 'unavailable', reason: 'no_canonical_system_result' });
  });

  it('keeps a resolved legacy System R as legacy evidence', () => {
    expect(
      tradeSystemResultEvidence({ ...LEGACY, systemStatus: 'resolved', systemR: '3.0000' }),
    ).toEqual({ status: 'legacy_derived', systemR: '3.0000' });
  });

  it('never reports an unresolved System side as a result', () => {
    expect(
      tradeSystemResultEvidence({ ...LEGACY, systemStatus: 'pending', systemR: null }),
    ).toEqual({ status: 'unavailable', reason: 'not_resolved' });
    expect(
      tradeSystemResultEvidence({ ...LEGACY, systemStatus: 'no_trade', systemR: null }),
    ).toEqual({ status: 'unavailable', reason: 'not_resolved' });
  });

  it('admits nothing as canonical, matching the analytics population gate', () => {
    // `canonicalSystemConditions()` admits no row until a trader-confirmed
    // System Assessment exists. A record surface must not be ahead of it.
    for (const row of [CONTRACT, LEGACY]) {
      const evidence = tradeSystemResultEvidence({
        ...row,
        systemStatus: 'resolved',
        systemR: '1.0000',
      });
      expect(evidence.status).not.toBe('canonical');
    }
  });
});

describe('per-Trade Execution Gap evidence', () => {
  /*
    THE MIXING THIS EXISTS TO STOP. A contract row's Actual R is measured
    against Risk at Entry; its stored System R came from the pre-contract
    model. Their difference is not this Trade's Execution Gap.
  */
  it('offers no Gap on a contract row even when one was derived', () => {
    expect(
      tradeExecutionGapEvidence({
        ...CONTRACT,
        systemStatus: 'resolved',
        systemR: '3.0000',
        executionGapR: '-1.0000',
      }),
    ).toEqual({ status: 'unavailable', reason: 'no_canonical_system_result' });
  });

  it('keeps a legacy row’s derived Gap, marked as legacy-derived', () => {
    expect(
      tradeExecutionGapEvidence({
        ...LEGACY,
        systemStatus: 'resolved',
        systemR: '3.0000',
        executionGapR: '-1.0000',
      }),
    ).toEqual({ status: 'legacy_derived', executionGapR: '-1.0000' });
  });

  it('never fabricates a zero Gap while a side is incomplete', () => {
    expect(
      tradeExecutionGapEvidence({
        ...LEGACY,
        systemStatus: 'pending',
        systemR: null,
        executionGapR: null,
      }),
    ).toEqual({ status: 'unavailable', reason: 'not_comparable' });
  });
});
