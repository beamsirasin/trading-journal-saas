/**
 * WHAT THE HISTORICAL CLOSED-TRADE RECORD IS ALLOWED TO MEAN.
 *
 * These are not layout assertions. Every case here is a way the previous model
 * turned an absence into a number, or turned two separate figures into one: a
 * blank amount reaching analytics as a zero, a subtotal standing in for a
 * result, an exit history calling itself complete because the arithmetic worked
 * out, an R stored beside the money it was supposed to be derived from. A green
 * suite here is the claim that a trader can record what they actually remember
 * and nothing downstream will read it as more than that.
 */
import { describe, expect, it } from 'vitest';

import {
  blockingIssues,
  canSave,
  completenessNote,
  derivedActualR,
  derivedTargetR,
  EMPTY_CLOSED_TRADE,
  exitHistoryStatus,
  exitSubtotal,
  finalExitTimeFromExits,
  finalNetPnl,
  finalPnlSource,
  issueFor,
  lifecycle,
  metricEligibility,
  reconciliation,
  validateClosedTrade,
  type ClosedTradeDraft,
} from './closed-trade';
import type { ExitRecord } from './exit-model';

/** The minimum a Fully closed record needs: who and which way. */
const IDENTIFIED: ClosedTradeDraft = {
  ...EMPTY_CLOSED_TRADE,
  symbol: 'XAUUSD',
  direction: 'long',
};

function exit(overrides: Partial<ExitRecord> & { id: string }): ExitRecord {
  return {
    scope: 'part',
    percent: '',
    outcome: 'profit',
    amount: '',
    at: null,
    ...overrides,
  };
}

describe('unrecorded is not a value', () => {
  it('starts both timestamps unrecorded rather than at "now"', () => {
    // The whole reason a historical trade may not be dated by the clock: a
    // record dated today looks exactly like one the trader dated today.
    expect(EMPTY_CLOSED_TRADE.enteredAt).toBeNull();
    expect(EMPTY_CLOSED_TRADE.exitedAt).toBeNull();
  });

  it('starts with no outcome selected, so nothing is pre-answered', () => {
    expect(EMPTY_CLOSED_TRADE.outcome).toBeNull();
    expect(EMPTY_CLOSED_TRADE.finalAmount).toBe('');
  });

  it('keeps a blank final result unknown — not zero and not break-even', () => {
    expect(finalNetPnl(IDENTIFIED)).toBeNull();
    expect(finalNetPnl({ ...IDENTIFIED, outcome: 'profit', finalAmount: '' })).toBeNull();
    expect(finalPnlSource(IDENTIFIED)).toBeNull();
  });

  it('treats break-even as an explicitly KNOWN zero', () => {
    const draft = { ...IDENTIFIED, outcome: 'break_even' as const, finalAmount: '' };
    expect(finalNetPnl(draft)).toBe(0);
    expect(finalPnlSource(draft)).toBe('manual_total');
    expect(metricEligibility(draft).money).toBe(true);
  });

  it('signs the amount from the word the trader chose', () => {
    expect(finalNetPnl({ ...IDENTIFIED, outcome: 'profit', finalAmount: '400.00' })).toBe(400);
    expect(finalNetPnl({ ...IDENTIFIED, outcome: 'loss', finalAmount: '400.00' })).toBe(-400);
  });
});

describe('R is derived, never a second stored truth', () => {
  const withRisk = { ...IDENTIFIED, riskAtEntry: '200.00' };

  it('derives Actual R from the final result over the risk at entry', () => {
    expect(derivedActualR({ ...withRisk, outcome: 'profit', finalAmount: '400.00' })).toBe(2);
    expect(derivedActualR({ ...withRisk, outcome: 'loss', finalAmount: '100.00' })).toBe(-0.5);
  });

  it('derives Target R from the target over the same risk', () => {
    expect(derivedTargetR({ ...withRisk, targetProfit: '1000.00' })).toBe(5);
  });

  it('reports R as UNAVAILABLE when the risk is unknown — never 0R', () => {
    const noRisk = { ...IDENTIFIED, outcome: 'profit' as const, finalAmount: '400.00' };
    expect(derivedActualR(noRisk)).toBeNull();
    expect(derivedTargetR({ ...noRisk, targetProfit: '1000.00' })).toBeNull();
  });

  it('reports R as unavailable for a zero or negative risk, never an infinity', () => {
    const zero = { ...IDENTIFIED, riskAtEntry: '0', outcome: 'profit' as const, finalAmount: '10' };
    expect(derivedActualR(zero)).toBeNull();
    expect(derivedActualR({ ...zero, riskAtEntry: '-5' })).toBeNull();
  });

  it('moves every derived R when the historical risk is edited afterwards', () => {
    const before = {
      ...withRisk,
      targetProfit: '400.00',
      outcome: 'profit' as const,
      finalAmount: '400.00',
    };
    expect(derivedActualR(before)).toBe(2);
    expect(derivedTargetR(before)).toBe(2);

    const after = { ...before, riskAtEntry: '100.00' };
    expect(derivedActualR(after)).toBe(4);
    expect(derivedTargetR(after)).toBe(4);
  });

  it('has no Target R while No fixed target stands, and keeps the typed value', () => {
    const declared = { ...withRisk, targetProfit: '1000.00', noFixedTarget: true };
    expect(derivedTargetR(declared)).toBeNull();
    // Kept, so the declaration is reversible without retyping.
    expect(declared.targetProfit).toBe('1000.00');
    expect(derivedTargetR({ ...declared, noFixedTarget: false })).toBe(5);
  });

  it('keeps a missing target distinct from an explicit absence', () => {
    expect(EMPTY_CLOSED_TRADE.targetProfit).toBe('');
    expect(EMPTY_CLOSED_TRADE.noFixedTarget).toBe(false);
  });
});

describe('the authoritative total and its supporting exits', () => {
  /* The case from the specification, in full: a trader who knows the trade made
     15 and can only recall one 10 leg. */
  const partial: ClosedTradeDraft = {
    ...IDENTIFIED,
    outcome: 'profit',
    finalAmount: '15.00',
    exits: [exit({ id: 'e1', amount: '10.00' })],
    exitHistory: 'incomplete',
  };

  it('never adds the final amount to the component exits', () => {
    expect(finalNetPnl(partial)).toBe(15);
    expect(exitSubtotal(partial)).toBe(10);
    // The two are separate figures. 25 is not producible from this record, and
    // the missing 5 is not a leg anyone may invent.
    expect(finalNetPnl(partial)).not.toBe(25);
    expect(partial.exits).toHaveLength(1);
  });

  it('leaves the final result untouched by whatever the legs say', () => {
    const moreLegs = { ...partial, exits: [...partial.exits, exit({ id: 'e2', amount: '1.00' })] };
    expect(finalNetPnl(moreLegs)).toBe(15);
  });

  /*
    THE MAPPING, EXACTLY. Reconciliation is gated on the trader's completeness
    claim, never on the arithmetic:

      not_recorded         -> not_applicable
      unknown / incomplete -> unreconciled
      complete + matching  -> matched
      complete + differing -> conflict
  */
  it('does not attempt a reconciliation while the history is undeclared', () => {
    expect(reconciliation(partial)).toBe('unreconciled');
    expect(reconciliation({ ...partial, exitHistory: 'unknown' })).toBe('unreconciled');
  });

  it('reconciles only once the trader declares the history complete', () => {
    const adds = {
      ...IDENTIFIED,
      outcome: 'profit' as const,
      finalAmount: '15.00',
      exits: [exit({ id: 'e1', amount: '10.00' }), exit({ id: 'e2', amount: '5.00' })],
    };
    // The figures agree. That is arithmetic, and it reconciles nothing on its own.
    expect(exitSubtotal(adds)).toBe(15);
    expect(reconciliation(adds)).toBe('unreconciled');

    expect(reconciliation({ ...adds, exitHistory: 'complete' })).toBe('matched');
  });

  it('never lets agreeing figures promote unknown to complete', () => {
    const adds = {
      ...IDENTIFIED,
      outcome: 'profit' as const,
      finalAmount: '15.00',
      exits: [exit({ id: 'e1', amount: '10.00' }), exit({ id: 'e2', amount: '5.00' })],
    };
    expect(exitHistoryStatus(adds)).toBe('unknown');
    expect(completenessNote(adds)).toBeNull();
  });

  it('calls a difference a conflict only when the history is asserted complete', () => {
    const asserted = { ...partial, exitHistory: 'complete' as const };
    expect(reconciliation(asserted)).toBe('conflict');
    const warning = issueFor(validateClosedTrade(asserted), 'reconciliation');
    expect(warning?.severity).toBe('warning');
    // Stated, but never a reason to refuse a real trade.
    expect(canSave(asserted)).toBe(true);
  });

  it('cannot know a subtotal while any leg is unpriced', () => {
    const unpriced = { ...partial, exits: [...partial.exits, exit({ id: 'e2' })] };
    expect(exitSubtotal(unpriced)).toBeNull();
    // Even asserted complete: an unknowable subtotal is not a failed comparison.
    expect(reconciliation({ ...unpriced, exitHistory: 'complete' })).toBe('not_applicable');
  });

  it('has nothing to reconcile against while the final result is unknown', () => {
    const noTotal = {
      ...IDENTIFIED,
      exits: [exit({ id: 'e1', amount: '10.00' })],
      exitHistory: 'complete' as const,
    };
    expect(finalNetPnl(noTotal)).toBeNull();
    expect(reconciliation(noTotal)).toBe('not_applicable');
  });

  it('has no subtotal at all when no exits were recorded', () => {
    expect(exitSubtotal(IDENTIFIED)).toBeNull();
    expect(reconciliation({ ...IDENTIFIED, outcome: 'profit', finalAmount: '15.00' })).toBe(
      'not_applicable',
    );
  });
});

describe('a missing exit history is not an open position and not a defect', () => {
  it('keeps the trade closed — this path said so, the legs did not', () => {
    expect(lifecycle(IDENTIFIED)).toBe('closed');
    expect(lifecycle({ ...IDENTIFIED, exits: [exit({ id: 'e1', amount: '10.00' })] })).toBe(
      'closed',
    );
  });

  it('reports no exits as not_recorded, and says nothing about it', () => {
    expect(exitHistoryStatus(IDENTIFIED)).toBe('not_recorded');
    expect(completenessNote(IDENTIFIED)).toBeNull();
    expect(reconciliation(IDENTIFIED)).toBe('not_applicable');
    // Not opening the disclosure establishes nothing, so nothing is claimed.
    expect(completenessNote({ ...IDENTIFIED, exitHistory: 'incomplete' })).toBeNull();
  });

  it('carries the four states exactly as the trader left them', () => {
    const withLeg = (history: 'unknown' | 'incomplete' | 'complete') => ({
      ...IDENTIFIED,
      exits: [exit({ id: 'e1', amount: '10.00' })],
      exitHistory: history,
    });
    // `not_recorded` is the one derived state, and it is derived from a COUNT.
    expect(exitHistoryStatus(IDENTIFIED)).toBe('not_recorded');
    expect(exitHistoryStatus(withLeg('unknown'))).toBe('unknown');
    expect(exitHistoryStatus(withLeg('incomplete'))).toBe('incomplete');
    expect(exitHistoryStatus(withLeg('complete'))).toBe('complete');
  });

  it('states incompleteness only once the trader has established it', () => {
    const established = {
      ...IDENTIFIED,
      exits: [exit({ id: 'e1', amount: '10.00' })],
      exitHistory: 'incomplete' as const,
    };
    expect(completenessNote(established)).toBe('Closed · Exit history incomplete');
  });
});

describe('the final exit time is never taken from just any leg', () => {
  const partialLeg = exit({ id: 'e1', at: { date: '2026-09-01', time: '14:15' } });
  const settlingLeg = exit({
    id: 'e2',
    scope: 'all_remaining',
    at: { date: '2026-09-01', time: '12:02' },
  });

  it('offers nothing when the latest leg only closed part of the position', () => {
    expect(finalExitTimeFromExits([partialLeg])).toBeNull();
  });

  it('offers the time of the leg that closed the position, even when earlier', () => {
    expect(finalExitTimeFromExits([partialLeg, settlingLeg])).toEqual({
      date: '2026-09-01',
      time: '12:02',
    });
  });

  it('offers nothing when the settling leg carries no time', () => {
    expect(finalExitTimeFromExits([exit({ id: 'e3', scope: 'all_remaining' })])).toBeNull();
  });
});

describe('what may be saved', () => {
  it('saves a trade carrying nothing but its identity', () => {
    expect(canSave(IDENTIFIED)).toBe(true);
    expect(blockingIssues(IDENTIFIED)).toEqual([]);
  });

  it('invents no metric values for such a trade', () => {
    expect(finalNetPnl(IDENTIFIED)).toBeNull();
    expect(derivedActualR(IDENTIFIED)).toBeNull();
    expect(derivedTargetR(IDENTIFIED)).toBeNull();
    expect(metricEligibility(IDENTIFIED)).toEqual({ money: false, r: false, timing: false });
  });

  it('keeps a known result usable for money while its R stays unavailable', () => {
    const known = { ...IDENTIFIED, outcome: 'profit' as const, finalAmount: '400.00' };
    expect(metricEligibility(known)).toEqual({ money: true, r: false, timing: false });
    expect(canSave(known)).toBe(true);
  });

  it('admits an entry time only to the analyses that need one', () => {
    const timed = { ...IDENTIFIED, enteredAt: { date: '2026-09-01', time: '09:41' } };
    expect(metricEligibility(timed).timing).toBe(true);
    expect(metricEligibility(IDENTIFIED).timing).toBe(false);
  });

  it('refuses a trade with no symbol or no direction', () => {
    expect(canSave(EMPTY_CLOSED_TRADE)).toBe(false);
    expect(canSave({ ...IDENTIFIED, symbol: '   ' })).toBe(false);
    expect(canSave({ ...IDENTIFIED, direction: null })).toBe(false);
  });

  it('refuses a final exit that precedes the entry', () => {
    const reversed = {
      ...IDENTIFIED,
      enteredAt: { date: '2026-09-02', time: '09:41' },
      exitedAt: { date: '2026-09-01', time: '14:32' },
    };
    expect(canSave(reversed)).toBe(false);
    expect(issueFor(validateClosedTrade(reversed), 'exitedAt')?.severity).toBe('error');
  });

  it('accepts either timestamp alone, because half a history is still a history', () => {
    expect(canSave({ ...IDENTIFIED, enteredAt: { date: '2026-09-02', time: '09:41' } })).toBe(true);
    expect(canSave({ ...IDENTIFIED, exitedAt: { date: '2026-09-01', time: '14:32' } })).toBe(true);
  });

  it('refuses a non-positive or unparseable risk, but never a blank one', () => {
    expect(canSave({ ...IDENTIFIED, riskAtEntry: '' })).toBe(true);
    expect(canSave({ ...IDENTIFIED, riskAtEntry: '0' })).toBe(false);
    expect(canSave({ ...IDENTIFIED, riskAtEntry: '-10' })).toBe(false);
    expect(canSave({ ...IDENTIFIED, riskAtEntry: 'about two hundred' })).toBe(false);
  });

  it('refuses an amount whose meaning nobody chose', () => {
    expect(canSave({ ...IDENTIFIED, finalAmount: '400.00' })).toBe(false);
    expect(
      issueFor(validateClosedTrade({ ...IDENTIFIED, finalAmount: '400' }), 'outcome'),
    ).not.toBeNull();
  });

  it('refuses a Profit or Loss of zero, and names break-even instead', () => {
    const zero = { ...IDENTIFIED, outcome: 'profit' as const, finalAmount: '0' };
    expect(canSave(zero)).toBe(false);
    expect(issueFor(validateClosedTrade(zero), 'finalAmount')?.message).toContain('break-even');
  });

  it('refuses a signed amount, because the word above it carries the sign', () => {
    expect(canSave({ ...IDENTIFIED, outcome: 'loss', finalAmount: '-400' })).toBe(false);
  });

  it('refuses an exit share outside 0–100%, but accepts an unrecorded one', () => {
    const legs = (percent: string) => ({
      ...IDENTIFIED,
      exits: [exit({ id: 'e1', percent, amount: '10' })],
    });
    expect(canSave(legs(''))).toBe(true);
    expect(canSave(legs('40'))).toBe(true);
    expect(canSave(legs('0'))).toBe(false);
    expect(canSave(legs('140'))).toBe(false);
  });
});
