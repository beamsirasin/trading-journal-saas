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
  adoptExitSubtotal,
  applyExitHistory,
  applyExits,
  beginManualEdit,
  blockingIssues,
  canAdoptExitSubtotal,
  canSave,
  completenessNote,
  derivedActualR,
  derivedOutcome,
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

    /*
      PASS 2 DELIBERATELY SUPERSEDES THE PASS 1 SEVERITY HERE.

      Pass 1 made this a warning under its own rule — never refuse a real trade
      for missing information. That rule still governs every other state: a
      history that is `not_recorded`, `unknown` or `incomplete` saves freely.
      A conflict is not missing information. The trader has ASSERTED the
      reconstruction is whole, so the record now holds two contradictory
      statements about the same money, and one of them is guaranteed wrong with
      nothing to say which.
    */
    const issue = issueFor(validateClosedTrade(asserted), 'reconciliation');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toBe(
      'These values don’t match. Review the final result or the recorded exits.',
    );
    expect(canSave(asserted)).toBe(false);
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

/**
 * PASS 2 — PROMOTING A RECONSTRUCTION INTO THE RESULT, AND EVERY ROUTE BACK OUT.
 *
 * The whole risk of this pass is that supporting detail becomes the trade's
 * money without anybody saying so, or goes on being the trade's money after it
 * has stopped supporting that claim. These cases walk the state machine in both
 * directions and check that no transition creates, merges, overwrites or
 * silently reconciles a monetary truth.
 */
describe('adopting a complete exit history', () => {
  const complete = (...amounts: readonly string[]): ClosedTradeDraft => ({
    ...IDENTIFIED,
    exits: amounts.map((amount, index) => exit({ id: `e${index + 1}`, amount })),
    exitHistory: 'complete',
  });

  it('offers adoption only when the history is complete and whole', () => {
    expect(canAdoptExitSubtotal(complete('100.00', '300.00'))).toBe(true);

    // Not declared complete, however neatly it adds up.
    expect(canAdoptExitSubtotal({ ...complete('100.00', '300.00'), exitHistory: 'unknown' })).toBe(
      false,
    );
    expect(
      canAdoptExitSubtotal({ ...complete('100.00', '300.00'), exitHistory: 'incomplete' }),
    ).toBe(false);
    expect(canAdoptExitSubtotal(IDENTIFIED)).toBe(false);
  });

  it('refuses to offer a partial sum as a whole-trade result', () => {
    /*
      THE MOST DANGEROUS OFFER THIS CONTROL COULD MAKE. `+100` beside an unpriced
      leg is not a `+100` trade, and an action reading "Use +100.00 USD as final
      result" would invite the trader to make it one.
    */
    const blankLeg = complete('100.00', '');
    expect(exitSubtotal(blankLeg)).toBeNull();
    expect(canAdoptExitSubtotal(blankLeg)).toBe(false);
    expect(reconciliation(blankLeg)).toBe('not_applicable');
    // A preserved declaration, not a fault: complete-with-a-gap still saves.
    expect(exitHistoryStatus(blankLeg)).toBe('complete');
    expect(canSave(blankLeg)).toBe(true);
  });

  it('never offers to overwrite a result the trader already stated', () => {
    const stated = {
      ...complete('100.00', '300.00'),
      outcome: 'profit' as const,
      finalAmount: '9.00',
    };
    expect(canAdoptExitSubtotal(stated)).toBe(false);
  });

  it('leaves the result unknown until the offer is actually taken', () => {
    const offerable = complete('100.00', '300.00');
    expect(exitSubtotal(offerable)).toBe(400);
    // Being offerable is not being answered.
    expect(finalNetPnl(offerable)).toBeNull();
    expect(finalPnlSource(offerable)).toBeNull();
    expect(metricEligibility(offerable).money).toBe(false);
  });

  it('makes the reconstruction authoritative, and says where the figure came from', () => {
    const adopted = adoptExitSubtotal(complete('100.00', '300.00'));
    expect(finalNetPnl(adopted)).toBe(400);
    expect(finalPnlSource(adopted)).toBe('exit_history');
    expect(reconciliation(adopted)).toBe('matched');
    // No second copy of the money left behind to drift.
    expect(adopted.finalAmount).toBe('');
    expect(adopted.outcome).toBeNull();
  });

  it('derives the outcome word from the adopted figure', () => {
    expect(derivedOutcome(adoptExitSubtotal(complete('100.00', '300.00')))).toBe('profit');
    expect(
      derivedOutcome(
        adoptExitSubtotal({
          ...complete(),
          exits: [exit({ id: 'e1', outcome: 'loss', amount: '80.00' })],
        }),
      ),
    ).toBe('loss');
    expect(
      derivedOutcome(
        adoptExitSubtotal({
          ...complete(),
          exits: [
            exit({ id: 'e1', amount: '50.00' }),
            exit({ id: 'e2', outcome: 'loss', amount: '50.00' }),
          ],
        }),
      ),
    ).toBe('break_even');
  });

  it('derives Actual R from the adopted figure when the risk is known', () => {
    const adopted = adoptExitSubtotal({ ...complete('100.00', '300.00'), riskAtEntry: '200.00' });
    expect(derivedActualR(adopted)).toBe(2);
    expect(metricEligibility(adopted)).toMatchObject({ money: true, r: true });
  });

  it('invents no Actual R when the risk was never recorded', () => {
    const adopted = adoptExitSubtotal(complete('100.00', '300.00'));
    expect(derivedActualR(adopted)).toBeNull();
    expect(metricEligibility(adopted)).toMatchObject({ money: true, r: false });
  });

  it('keeps the reconstruction underneath, unchanged', () => {
    const before = complete('100.00', '300.00');
    const adopted = adoptExitSubtotal(before);
    expect(adopted.exits).toEqual(before.exits);
    expect(exitHistoryStatus(adopted)).toBe('complete');
    expect(exitSubtotal(adopted)).toBe(400);
  });
});

describe('after adoption, every route back out', () => {
  const adopted = adoptExitSubtotal({
    ...IDENTIFIED,
    riskAtEntry: '200.00',
    exits: [exit({ id: 'e1', amount: '100.00' }), exit({ id: 'e2', amount: '300.00' })],
    exitHistory: 'complete',
  });

  it('tracks its own reconstruction when a leg is corrected', () => {
    /*
      The source is still the exit history, so the result IS the exit history. A
      stale +400 sitting over a reconstruction that now says +390 is precisely
      the drift a copy-on-adopt would have produced.
    */
    const corrected = applyExits(adopted, [
      exit({ id: 'e1', amount: '90.00' }),
      exit({ id: 'e2', amount: '300.00' }),
    ]);
    expect(finalNetPnl(corrected)).toBe(390);
    expect(finalPnlSource(corrected)).toBe('exit_history');
    expect(derivedActualR(corrected)).toBe(1.95);
    expect(reconciliation(corrected)).toBe('matched');
  });

  it('re-derives the outcome word when a correction crosses zero', () => {
    const flipped = applyExits(adopted, [
      exit({ id: 'e1', outcome: 'loss', amount: '100.00' }),
      exit({ id: 'e2', outcome: 'loss', amount: '300.00' }),
    ]);
    expect(finalNetPnl(flipped)).toBe(-400);
    expect(derivedOutcome(flipped)).toBe('loss');
  });

  it('becomes the trader’s own total the moment they edit the amount', () => {
    const editing = beginManualEdit(adopted);
    expect(editing.finalSource).toBe('manual_total');
    // Opens on the figure they accepted rather than empty: the record already
    // asserted it, and it has only moved into the field that now owns it.
    expect(editing.finalAmount).toBe('400.00');
    expect(editing.outcome).toBe('profit');
    expect(finalNetPnl(editing)).toBe(400);
    expect(finalPnlSource(editing)).toBe('manual_total');
  });

  it('reconciles a manually overridden amount against the reconstruction again', () => {
    const same = beginManualEdit(adopted);
    expect(reconciliation(same)).toBe('matched');

    const overridden = { ...same, finalAmount: '380.00' };
    expect(finalNetPnl(overridden)).toBe(380);
    expect(finalPnlSource(overridden)).toBe('manual_total');
    expect(exitSubtotal(overridden)).toBe(400);
    expect(reconciliation(overridden)).toBe('conflict');
    // And the two figures are never combined into 780.
    expect(finalNetPnl(overridden)).not.toBe(780);
  });

  it('stops claiming exit provenance when completeness is withdrawn', () => {
    for (const history of ['unknown', 'incomplete'] as const) {
      const withdrawn = applyExitHistory(adopted, history);
      // The money survives: deleting what a person accepted because a
      // neighbouring answer changed destroys their input.
      expect(finalNetPnl(withdrawn)).toBe(400);
      // But it no longer claims a complete reconstruction stands behind it.
      expect(finalPnlSource(withdrawn)).toBe('manual_total');
      expect(exitHistoryStatus(withdrawn)).toBe(history);
      expect(reconciliation(withdrawn)).toBe('unreconciled');
    }
  });

  it('stops claiming exit provenance when a leg loses its amount', () => {
    const broken = applyExits(adopted, [
      exit({ id: 'e1', amount: '100.00' }),
      exit({ id: 'e2', amount: '' }),
    ]);
    expect(finalNetPnl(broken)).toBe(400);
    expect(finalPnlSource(broken)).toBe('manual_total');
    // Never the partial +100 a blank-as-zero reading would have produced.
    expect(finalNetPnl(broken)).not.toBe(100);
    expect(exitSubtotal(broken)).toBeNull();
    expect(reconciliation(broken)).toBe('not_applicable');
  });

  it('stops claiming exit provenance when the last leg is removed', () => {
    const emptied = applyExits(adopted, []);
    expect(finalNetPnl(emptied)).toBe(400);
    expect(finalPnlSource(emptied)).toBe('manual_total');
    expect(exitHistoryStatus(emptied)).toBe('not_recorded');
    expect(reconciliation(emptied)).toBe('not_applicable');
  });

  it('leaves a manually sourced record alone through the same edits', () => {
    const manual = { ...IDENTIFIED, outcome: 'profit' as const, finalAmount: '400.00' };
    expect(applyExitHistory(manual, 'incomplete').finalAmount).toBe('400.00');
    expect(applyExits(manual, [exit({ id: 'e1', amount: '10.00' })]).finalSource).toBe(
      'manual_total',
    );
  });
});

describe('two closing times', () => {
  const closing = { date: '2026-09-01', time: '14:15' };

  it('surfaces a disagreement rather than choosing a side', () => {
    const draft = {
      ...IDENTIFIED,
      exitedAt: { date: '2026-09-01', time: '16:00' },
      exits: [exit({ id: 'e1', scope: 'all_remaining', amount: '10.00', at: closing })],
    };
    const issue = issueFor(validateClosedTrade(draft), 'exitTime');
    expect(issue?.severity).toBe('warning');
    expect(issue?.message).toContain('14:15');
    // Neither value is altered, and a real trade is not refused over it.
    expect(draft.exitedAt).toEqual({ date: '2026-09-01', time: '16:00' });
    expect(canSave(draft)).toBe(true);
  });

  it('says nothing when they agree', () => {
    const draft = {
      ...IDENTIFIED,
      exitedAt: closing,
      exits: [exit({ id: 'e1', scope: 'all_remaining', amount: '10.00', at: closing })],
    };
    expect(issueFor(validateClosedTrade(draft), 'exitTime')).toBeNull();
  });

  it('says nothing when only a partial leg carries a time', () => {
    const draft = {
      ...IDENTIFIED,
      exitedAt: { date: '2026-09-01', time: '16:00' },
      exits: [exit({ id: 'e1', amount: '10.00', at: closing })],
    };
    expect(finalExitTimeFromExits(draft.exits)).toBeNull();
    expect(issueFor(validateClosedTrade(draft), 'exitTime')).toBeNull();
  });
});

describe('what a conflict does and does not block', () => {
  const legs = [exit({ id: 'e1', amount: '380.00' })];
  const stated = { ...IDENTIFIED, outcome: 'profit' as const, finalAmount: '400.00', exits: legs };

  it('blocks the save only for a declared-complete contradiction', () => {
    expect(reconciliation({ ...stated, exitHistory: 'complete' })).toBe('conflict');
    expect(canSave({ ...stated, exitHistory: 'complete' })).toBe(false);
  });

  it('never blocks the ordinary incomplete historical states', () => {
    expect(canSave({ ...stated, exitHistory: 'unknown' })).toBe(true);
    expect(canSave({ ...stated, exitHistory: 'incomplete' })).toBe(true);
    expect(canSave({ ...IDENTIFIED, outcome: 'profit', finalAmount: '400.00' })).toBe(true);
    // Declared complete but not monetarily comparable is not a contradiction.
    expect(
      canSave({ ...stated, exits: [exit({ id: 'e1', amount: '' })], exitHistory: 'complete' }),
    ).toBe(true);
  });
});
