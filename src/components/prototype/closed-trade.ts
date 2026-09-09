/**
 * THE FULLY CLOSED HISTORICAL RECORD — what is known, what is not, and which
 * number is the truth.
 *
 * WHY THIS FILE EXISTS. A trader writing up a trade that finished last Tuesday
 * knows some of it and not the rest. The previous composition could not hold
 * that: it opened with a risk, a result and a direction already filled in, and
 * its "more than one exit" branch REPLACED the whole-trade result with the sum
 * of whatever legs had been reconstructed. Those are two failures with one root
 * — the form had no representation for "unknown", so it kept putting a
 * plausible value in its place.
 *
 * THREE CONCEPTS THAT MUST NOT MERGE:
 *
 *   PLAN TRUTH      what applied when the trader entered — risk, target, exit
 *                   rule. Any of it may be unknown, and "no fixed target" is an
 *                   ANSWER rather than a blank.
 *   REALIZED TRUTH  what the trade actually made. The authoritative figure is
 *                   the FINAL WHOLE-TRADE net P&L. Individual exits are
 *                   supporting detail about how that total was reached.
 *   REVIEW TRUTH    what the trader learned. It lives in the journal; nothing
 *                   here reads it and nothing here is derived from it.
 *
 * THE HARD RULE, STATED ONCE. The final whole-trade amount and the recorded exit
 * amounts are NEVER added together. `+15` final against `+10` of recorded legs
 * is a trade that made 15 with 5 of its history missing — not a trade that made
 * 25, and not a trade with a fabricated `+5` leg. `finalNetPnl` and
 * `exitSubtotal` are separate functions returning separate figures, and no
 * function in this file combines them.
 *
 * EVERYTHING IS DERIVED. Actual R and Target R are computed from the money and
 * the risk on every read, through `exit-model`'s shared functions — never stored
 * beside them, so `risk = 100, pnl = 200, actual_r = 1.5` is not a state this
 * model can represent.
 *
 * NOTHING HERE TOUCHES REACT. It is the semantics of the record rather than of
 * the screen, so that what the screen means survives being saved.
 */

import type { MoneyOutcome } from './add-trade/form-primitives';
import type { Timestamp } from './add-trade/timestamp-picker';
import {
  actualR,
  cumulativeRealized,
  lifecycleOf,
  money,
  signedAmount,
  targetR,
  type ExitHistory,
  type ExitRecord,
  type Lifecycle,
} from './exit-model';

/**
 * HOW THE AUTHORITATIVE FINAL RESULT WAS ESTABLISHED.
 *
 * `manual_total` — the trader stated the whole-trade net result directly. The
 * ordinary case, and the one the product is built around: a trader reads one
 * figure off a broker statement far more reliably than they reconstruct six
 * legs.
 *
 * `exit_history` — the trader ADOPTED a complete recorded exit history as the
 * result. Reachable only through `adoptExitSubtotal`, only from an explicit
 * activation, and only when the history is declared complete with every leg
 * priced.
 *
 * IT IS STORED, NOT INFERRED, AND THAT IS THE WHOLE POINT. Two records can carry
 * the identical `+400.00` and mean different things — one is a figure the trader
 * read off a statement, the other is a sum they accepted as standing for the
 * trade. Deriving the source from the numbers would make those two
 * indistinguishable, which is exactly how a reconstruction quietly becomes a
 * measurement.
 */
export type FinalPnlSource = 'manual_total' | 'exit_history';

/**
 * WHETHER THE EXIT HISTORY IS FINISHED — four states, not two.
 *
 * `not_recorded` is DERIVED (no legs exist) and is the ordinary state of a
 * perfectly good record. `unknown` is the trader's own "not sure". Neither is a
 * defect and neither may be presented as one. Only `incomplete` is an
 * established gap, because only `incomplete` is something the trader said.
 *
 * NOT OPENING THE EXIT DETAILS PROVES NOTHING. It yields `not_recorded`, which
 * is silent — see `completenessNote`.
 */
export type ExitHistoryStatus = 'not_recorded' | 'unknown' | 'incomplete' | 'complete';

/**
 * WHETHER THE SUPPORTING EXITS AGREE WITH THE AUTHORITATIVE TOTAL.
 *
 * RECONCILIATION IS GATED ON THE TRADER'S CLAIM, NOT ON THE ARITHMETIC. Only a
 * history the trader has declared COMPLETE can reconcile at all, because only a
 * complete history is one the total is supposed to equal. Legs that happen to
 * sum to the total while the history is undeclared prove that those legs sum to
 * the total — nothing more, and certainly not that they are all of them.
 *
 * `not_applicable` — nothing to compare: no legs, no authoritative total, or a
 *                    leg whose amount is blank, which makes the subtotal itself
 *                    unknowable rather than smaller.
 * `unreconciled`   — legs exist and the history is `unknown` or `incomplete`.
 *                    Whether the figures agree is not asked, because an
 *                    undeclared history has nothing to be measured against.
 * `matched`        — declared COMPLETE and agrees to the cent.
 * `conflict`       — declared COMPLETE and does not. Two statements that cannot
 *                    both be true, and the only one of the four surfaced as a
 *                    problem.
 */
export type ReconciliationStatus = 'not_applicable' | 'matched' | 'unreconciled' | 'conflict';

/**
 * THE RECORD ITSELF.
 *
 * Every text field uses `''` for UNRECORDED and every object field uses `null` —
 * never a zero, never today's date, never a default that reads as an answer.
 * `noFixedTarget` is the one place an absence is asserted rather than left
 * blank, and it is a separate field precisely so the two cannot collapse.
 *
 * The lifecycle is not stored: this path IS the fully-closed path, so the
 * position is closed by construction (see `lifecycle`).
 */
export interface ClosedTradeDraft {
  readonly symbol: string;
  readonly direction: 'long' | 'short' | null;
  /** Unrecorded until the trader picks one. NEVER seeded from the clock. */
  readonly enteredAt: Timestamp | null;
  readonly exitedAt: Timestamp | null;

  /** Plan truth. Any of it may be unrecorded, and that is a saveable state. */
  readonly riskAtEntry: string;
  readonly targetProfit: string;
  /** An explicit answer — "this trade had no fixed target" — not a blank. */
  readonly noFixedTarget: boolean;

  /**
   * WHERE THE AUTHORITATIVE RESULT COMES FROM — and therefore which fields below
   * are meaningful.
   *
   * `manual_total`: `outcome` and `finalAmount` carry the result, and the exits
   * are supporting detail. `exit_history`: the complete exit reconstruction
   * carries it, and `outcome`/`finalAmount` are EMPTY. The two are never
   * populated at once, so there is never a second copy of the money to drift.
   */
  readonly finalSource: FinalPnlSource;

  /** Realized truth, while the source is manual. `null` means nobody has said. */
  readonly outcome: MoneyOutcome | null;
  /** The WHOLE trade's net result, unsigned as typed. `''` is unknown. */
  readonly finalAmount: string;

  /** Supporting detail — unless explicitly adopted. Never summed into a total. */
  readonly exits: readonly ExitRecord[];
  /** The trader's own answer to "are all exits recorded?". */
  readonly exitHistory: ExitHistory;
}

export const EMPTY_CLOSED_TRADE: ClosedTradeDraft = {
  symbol: '',
  direction: null,
  enteredAt: null,
  exitedAt: null,
  riskAtEntry: '',
  targetProfit: '',
  noFixedTarget: false,
  finalSource: 'manual_total',
  outcome: null,
  finalAmount: '',
  exits: [],
  exitHistory: 'unknown',
};

/**
 * THE AUTHORITATIVE RESULT FOR THE WHOLE TRADE, or `null` when it is unknown.
 *
 * ONE FIGURE, FROM ONE DECLARED SOURCE. `null` is not zero and never becomes
 * zero; break-even is a KNOWN zero and the only way a zero gets in here.
 *
 * WHEN THE SOURCE IS `exit_history` THIS READS THE SUBTOTAL LIVE, rather than a
 * copy taken at the moment of adoption. Copying would have produced the exact
 * failure this pass exists to prevent: a trader adopts +400, corrects a leg to
 * +90, and the trade goes on reporting +400 with a reconstruction underneath it
 * that no longer says so. Adoption changes WHICH FIELD IS AUTHORITATIVE, not
 * which number is written down — a state transition rather than a copy between
 * two independent truths.
 *
 * The two sources are never both populated: `adoptExitSubtotal` clears the
 * manual fields and `beginManualEdit` writes them back, so there is never a
 * second copy of the money sitting somewhere to drift out of agreement.
 */
export function finalNetPnl(draft: ClosedTradeDraft): number | null {
  if (draft.finalSource === 'exit_history') return exitSubtotal(draft);
  return signedAmount(draft.outcome, draft.finalAmount);
}

/** How that figure was established, or `null` while there is no figure. */
export function finalPnlSource(draft: ClosedTradeDraft): FinalPnlSource | null {
  return finalNetPnl(draft) === null ? null : draft.finalSource;
}

/**
 * THE OUTCOME WORD FOR THE AUTHORITATIVE RESULT.
 *
 * While the source is manual it is the trader's own choice — the word decides
 * the sign of what they typed. Once the exit history is authoritative the word
 * FOLLOWS the adopted figure, because a trader cannot meaningfully be asked to
 * classify a sum they did not type, and a stored `profit` sitting beside an
 * adopted −80.00 is a contradiction the record should not be able to hold.
 */
export function derivedOutcome(draft: ClosedTradeDraft): MoneyOutcome | null {
  if (draft.finalSource === 'manual_total') return draft.outcome;
  const total = exitSubtotal(draft);
  if (total === null) return null;
  return cents(total) > 0 ? 'profit' : cents(total) < 0 ? 'loss' : 'break_even';
}

/**
 * The recorded legs' subtotal, or `null` when it is not knowable.
 *
 * SUPPORTING DETAIL. It describes how the position was unwound; it is not the
 * trade's result and is never labelled as one. `null` when no legs exist, and
 * `null` when any leg's amount is blank — a running total missing a term is
 * unknown, not smaller.
 */
export function exitSubtotal(draft: ClosedTradeDraft): number | null {
  const realized = cumulativeRealized(draft.exits);
  if (realized.exitCount === 0) return null;
  if (!realized.everyExitPriced) return null;
  return realized.total;
}

/** Cents, so two amounts typed as decimals compare without a float epsilon. */
function cents(value: number): number {
  return Math.round(value * 100);
}

/**
 * THE FOUR STATES, EXACTLY.
 *
 *   not_recorded  no exit details have been entered
 *   unknown       details exist; the trader has not said whether they are all of
 *                 them
 *   incomplete    the trader states that further exits are missing
 *   complete      the trader states that every exit is recorded
 *
 * `not_recorded` is the only one derived, and it is derived from a COUNT rather
 * than from any figure. The other three are the trader's own answer, carried
 * through untouched. No arithmetic on this page can move a record between them —
 * in particular nothing promotes `unknown` to `complete`.
 */
export function exitHistoryStatusOf(exitCount: number, history: ExitHistory): ExitHistoryStatus {
  return exitCount === 0 ? 'not_recorded' : history;
}

export function exitHistoryStatus(draft: ClosedTradeDraft): ExitHistoryStatus {
  return exitHistoryStatusOf(draft.exits.length, draft.exitHistory);
}

export function reconciliation(draft: ClosedTradeDraft): ReconciliationStatus {
  const status = exitHistoryStatus(draft);
  if (status === 'not_recorded') return 'not_applicable';

  /*
    THE COMPARISON IS ONLY ASKED ONCE THE TRADER HAS CLAIMED COMPLETENESS.

    An `unknown` or `incomplete` history is not a failed reconciliation — it is
    an unattempted one. Reaching for the arithmetic first is how a coincidence
    ("these two legs happen to sum to the total") turns into a finding, which is
    precisely the inference this model exists to refuse.
  */
  if (status !== 'complete') return 'unreconciled';

  const final = finalNetPnl(draft);
  const subtotal = exitSubtotal(draft);
  // Declared complete, but with nothing to measure: no authoritative total, or a
  // leg whose amount is blank, which makes the subtotal unknowable not smaller.
  if (final === null || subtotal === null) return 'not_applicable';

  return cents(final) === cents(subtotal) ? 'matched' : 'conflict';
}

/**
 * WHETHER A COMPLETE RECONSTRUCTION MAY BE OFFERED AS THE RESULT.
 *
 * THREE CONDITIONS, ALL NECESSARY. The trader has declared the history COMPLETE;
 * every leg carries an amount, so the subtotal is a whole figure rather than a
 * partial one; and there is no authoritative result yet, because adoption fills
 * a gap and never overwrites something the trader already stated.
 *
 * A DECLARED-COMPLETE HISTORY WITH A BLANK LEG IS NOT OFFERABLE. `+100` and an
 * unpriced leg is not a `+100` trade — `exitSubtotal` returns `null` rather than
 * a smaller number, so nothing here can offer it. That is the single most
 * dangerous thing this control could do, and the guard is one line because the
 * subtotal already refuses to be partial.
 */
export function canAdoptExitSubtotal(draft: ClosedTradeDraft): boolean {
  if (exitHistoryStatus(draft) !== 'complete') return false;
  if (exitSubtotal(draft) === null) return false;
  return finalNetPnl(draft) === null;
}

/**
 * ADOPT THE COMPLETE RECONSTRUCTION AS THE TRADE'S RESULT.
 *
 * Only ever from an explicit activation — nothing in this file calls it, and no
 * arithmetic reaches it. The manual fields are CLEARED rather than filled with
 * the subtotal: leaving a copy behind would recreate the two-truths problem one
 * layer down, where the copy is invisible and drifts silently.
 */
export function adoptExitSubtotal(draft: ClosedTradeDraft): ClosedTradeDraft {
  if (!canAdoptExitSubtotal(draft)) return draft;
  return { ...draft, finalSource: 'exit_history', outcome: null, finalAmount: '' };
}

/**
 * TAKE THE ADOPTED FIGURE BACK INTO MANUAL EDITING.
 *
 * The money the trader accepted is written into the manual fields as it stands,
 * so the field they are about to edit opens on the value they adopted rather
 * than empty. That is not fabrication: it is the figure this record already
 * asserted, moved into the slot that now owns it.
 *
 * THE SOURCE FLIPS AT THE SAME INSTANT. A record cannot go on claiming its money
 * came from a complete reconstruction once a person has started typing over it —
 * and once it is `manual_total`, the reconstruction underneath becomes something
 * to reconcile AGAINST rather than the thing being reported.
 */
export function beginManualEdit(draft: ClosedTradeDraft): ClosedTradeDraft {
  if (draft.finalSource === 'manual_total') return draft;
  const adopted = finalNetPnl(draft);
  const outcome = derivedOutcome(draft);
  return {
    ...draft,
    finalSource: 'manual_total',
    outcome,
    finalAmount: adopted === null ? '' : Math.abs(adopted).toFixed(2),
  };
}

/**
 * A COMPLETENESS ANSWER, APPLIED SAFELY.
 *
 * Leaving `complete` while the exit history is the authoritative source would
 * strand the record: its money would be sourced from a reconstruction it no
 * longer claims is whole. Deleting the money instead is worse — the trader
 * accepted that figure, and a form that silently empties a result because a
 * neighbouring answer changed has destroyed something a person entered.
 *
 * So the figure is KEPT and its provenance is corrected: it becomes the trader's
 * own stated total, and the exits go back to being supporting detail. Nothing is
 * invented, nothing is lost, and no record survives claiming a completeness it
 * has just withdrawn.
 */
export function applyExitHistory(draft: ClosedTradeDraft, history: ExitHistory): ClosedTradeDraft {
  const next = { ...draft, exitHistory: history };
  if (draft.finalSource !== 'exit_history') return next;
  if (exitHistoryStatusOf(next.exits.length, history) === 'complete') return next;
  return beginManualEdit(next);
}

/**
 * AN EXIT EDIT, APPLIED SAFELY.
 *
 * While the reconstruction is the source, changing it MOVES THE RESULT — that is
 * what having chosen it as the source means, and `finalNetPnl` reads it live so
 * Actual R and the outcome word follow without anything being recomputed here.
 *
 * The exception is an edit that destroys the basis: a leg blanked, or the last
 * leg removed, leaves no whole subtotal to be authoritative. Same treatment as a
 * withdrawn completeness answer — keep the money the trader accepted, correct
 * its provenance to manual, and let the remaining legs be supporting detail.
 */
export function applyExits(
  draft: ClosedTradeDraft,
  exits: readonly ExitRecord[],
): ClosedTradeDraft {
  if (draft.finalSource !== 'exit_history') return { ...draft, exits };

  const next = { ...draft, exits };
  const stillWhole = exitHistoryStatus(next) === 'complete' && exitSubtotal(next) !== null;
  if (stillWhole) return next;

  // Materialise from the draft as it stood, BEFORE the basis was destroyed.
  return { ...beginManualEdit(draft), exits };
}

/** The position is closed because this path says so — not because of the legs. */
export function lifecycle(draft: ClosedTradeDraft): Lifecycle {
  return lifecycleOf(draft.exits, true);
}

/**
 * ACTUAL R — the authoritative final result over the ORIGINAL risk at entry.
 *
 * Derived on every read, never stored. Editing the risk moves it; a missing or
 * non-positive risk makes it UNAVAILABLE, which is `null` and must never be
 * rendered as `0R`.
 */
export function derivedActualR(draft: ClosedTradeDraft): number | null {
  const final = finalNetPnl(draft);
  if (final === null) return null;
  const risk = money(draft.riskAtEntry);
  return risk === null ? null : actualR(final, risk);
}

/** TARGET R — the planned reward over the same risk. Absent when no target. */
export function derivedTargetR(draft: ClosedTradeDraft): number | null {
  if (draft.noFixedTarget) return null;
  const reward = money(draft.targetProfit);
  const risk = money(draft.riskAtEntry);
  if (reward === null || risk === null) return null;
  return targetR(reward, risk);
}

/**
 * WHICH ANALYSES THIS RECORD MAY ENTER — and, by omission, which it must not.
 *
 * An incomplete historical trade is not defective; it is eligible for fewer
 * things. A known P&L with an unrecorded risk belongs in every monetary metric
 * and in none of the R metrics. An unknown P&L contributes NOTHING — not a zero,
 * not a break-even, not a loss. This is what makes it safe to let the trader
 * save exactly what they remember.
 */
export interface MetricEligibility {
  /** Net P&L, win rate, profit factor in money — anything needing the result. */
  readonly money: boolean;
  /** Actual R, expectancy in R, R-based drawdown. */
  readonly r: boolean;
  /** Time of day, holding period, anything bucketed by when it opened. */
  readonly timing: boolean;
}

export function metricEligibility(draft: ClosedTradeDraft): MetricEligibility {
  return {
    money: finalNetPnl(draft) !== null,
    r: derivedActualR(draft) !== null,
    timing: draft.enteredAt !== null,
  };
}

function instant(value: Timestamp): string {
  return `${value.date}T${value.time}`;
}

/**
 * A FINAL EXIT TIME MAY COME FROM A LEG ONLY WHEN THAT LEG CLOSED THE POSITION.
 *
 * The previous form derived it from the LATEST recorded leg, whatever that leg
 * was. On a half-reconstructed history the latest recorded leg is routinely a
 * partial one that merely happens to be the last thing written down — so the
 * trade got a final exit time that was really a mid-trade timestamp. A wrong
 * record that looks like a right one, and one nothing downstream could detect.
 *
 * `all_remaining` is the one leg that says, in the trader's own words, that
 * nothing was left afterwards. Only that leg's time can stand for the trade's.
 * This returns a SUGGESTION for the trader to accept; nothing writes it.
 */
export function finalExitTimeFromExits(exits: readonly ExitRecord[]): Timestamp | null {
  const settling = exits.filter(
    (exit): exit is ExitRecord & { at: Timestamp } =>
      exit.scope === 'all_remaining' && exit.at !== null,
  );
  const latest = settling.reduce<(ExitRecord & { at: Timestamp }) | null>(
    (best, exit) => (best === null || instant(exit.at) > instant(best.at) ? exit : best),
    null,
  );
  return latest === null ? null : latest.at;
}

/** `true` when the exit is known to be at or after the entry, or unknowable. */
export function timestampsOrdered(draft: ClosedTradeDraft): boolean {
  if (draft.enteredAt === null || draft.exitedAt === null) return true;
  return instant(draft.exitedAt) >= instant(draft.enteredAt);
}

export type IssueField =
  | 'symbol'
  | 'direction'
  | 'riskAtEntry'
  | 'targetProfit'
  | 'outcome'
  | 'finalAmount'
  | 'exitedAt'
  | 'exitTime'
  | 'exits'
  | 'reconciliation';

export interface ValidationIssue {
  readonly field: IssueField;
  /** `error` blocks Save. `warning` is stated and saved anyway. */
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/**
 * WHAT MAY NOT BE SAVED — a deliberately short list.
 *
 * MISSING IS NOT INVALID. Every unrecorded field on this form is saveable: the
 * times, the risk, the target, the exit plan, the result, the journal. What is
 * refused is a value that is WRONG, or a pair of values that CONTRADICT — a
 * non-positive risk, an exit before the entry, a "profit" of zero, an exit
 * history asserted complete that does not add up to the total it claims to
 * compose.
 *
 * The conflict is a WARNING rather than an error: the trade genuinely happened
 * and the trader is entitled to save what they know. What it must never do is
 * pass silently, because a stored contradiction nothing flagged is a record that
 * will be read later as reconciled.
 */
export function validateClosedTrade(draft: ClosedTradeDraft): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (draft.symbol.trim() === '') {
    issues.push({ field: 'symbol', severity: 'error', message: 'Enter the symbol you traded.' });
  }
  if (draft.direction === null) {
    issues.push({ field: 'direction', severity: 'error', message: 'Choose Long or Short.' });
  }

  if (draft.riskAtEntry !== '') {
    const risk = money(draft.riskAtEntry);
    if (risk === null || risk <= 0) {
      issues.push({
        field: 'riskAtEntry',
        severity: 'error',
        message: 'Risk at entry must be above zero. Leave it blank if you cannot recall it.',
      });
    }
  }

  if (draft.targetProfit !== '' && !draft.noFixedTarget) {
    const reward = money(draft.targetProfit);
    if (reward === null || reward <= 0) {
      issues.push({
        field: 'targetProfit',
        severity: 'error',
        message: 'Target profit must be above zero, or leave it blank.',
      });
    }
  }

  if (draft.finalAmount !== '' && draft.outcome === null) {
    issues.push({
      field: 'outcome',
      severity: 'error',
      message: 'Say whether the trade finished in profit, in loss, or at break-even.',
    });
  }

  if (draft.finalAmount !== '' && (draft.outcome === 'profit' || draft.outcome === 'loss')) {
    const amount = money(draft.finalAmount);
    if (amount === null || amount < 0) {
      issues.push({
        field: 'finalAmount',
        severity: 'error',
        message: 'Enter the amount without a sign — Profit or Loss above decides it.',
      });
    } else if (cents(amount) === 0) {
      issues.push({
        field: 'finalAmount',
        severity: 'error',
        message: 'A net result of zero is break-even. Choose Break-even, or enter the amount.',
      });
    }
  }

  if (!timestampsOrdered(draft)) {
    issues.push({
      field: 'exitedAt',
      severity: 'error',
      message: 'The final exit cannot be before the entry.',
    });
  }

  if (draft.exits.some((exit) => exit.amount !== '' && money(exit.amount) === null)) {
    issues.push({
      field: 'exits',
      severity: 'error',
      message: 'One of the recorded exits has an amount that is not a number.',
    });
  }
  if (
    draft.exits.some((exit) => {
      if (exit.percent === '') return false;
      const percent = Number(exit.percent);
      return !Number.isFinite(percent) || percent <= 0 || percent > 100;
    })
  ) {
    issues.push({
      field: 'exits',
      severity: 'error',
      message: "An exit's share of the position must be above 0% and no more than 100%.",
    });
  }

  /*
    A DECLARED-COMPLETE HISTORY THAT DOES NOT ADD UP NOW BLOCKS THE SAVE.

    IT WAS A WARNING IN PASS 1, AND THAT WAS THE WEAKER READING. The Pass 1
    rule — never refuse a real trade for missing information — is untouched and
    still governs every other state here: `not_recorded`, `unknown` and
    `incomplete` all save freely, because each is an honest description of a
    partly remembered trade. A `conflict` is not one of those. The trader has
    ASSERTED that the reconstruction is whole, and a whole reconstruction that
    disagrees with the total it claims to compose is two contradictory statements
    about the same money. Saving it would put a record into the journal that is
    guaranteed wrong in one of two places, with nothing recording which.

    The refusal names both figures and neither verdict — see the message. It is
    the trader's to resolve, and either side may be the one that is wrong.
  */
  if (reconciliation(draft) === 'conflict') {
    issues.push({
      field: 'reconciliation',
      severity: 'error',
      message: 'These values don’t match. Review the final result or the recorded exits.',
    });
  }

  /*
    TWO CLOSING TIMES, AND NO GROUNDS TO PREFER EITHER.

    An `All remaining` leg says when the position finished; so does the Final exit
    time field. When both exist and disagree, one of them is wrong and the record
    cannot tell which — so it says so and changes nothing. A form that silently
    took the leg's time would overwrite something the trader typed; one that
    silently kept the field would ignore something they recorded.

    A WARNING, NOT A REFUSAL. Unlike a monetary conflict this costs no money and
    misstates no result; it is a detail to reconcile, and a trader who cannot
    remember which is right must still be able to save the trade.
  */
  const closingLegTime = finalExitTimeFromExits(draft.exits);
  if (
    closingLegTime !== null &&
    draft.exitedAt !== null &&
    instant(closingLegTime) !== instant(draft.exitedAt)
  ) {
    issues.push({
      field: 'exitTime',
      severity: 'warning',
      message: `Your final exit time and the exit that closed the position (${closingLegTime.date} ${closingLegTime.time}) are different.`,
    });
  }

  return issues;
}

/** Blocking issues only. Warnings are stated, not enforced. */
export function blockingIssues(draft: ClosedTradeDraft): readonly ValidationIssue[] {
  return validateClosedTrade(draft).filter((issue) => issue.severity === 'error');
}

export function canSave(draft: ClosedTradeDraft): boolean {
  return blockingIssues(draft).length === 0;
}

/** The first issue for a field, so a control can state its own problem. */
export function issueFor(
  issues: readonly ValidationIssue[],
  field: IssueField,
): ValidationIssue | null {
  return issues.find((issue) => issue.field === field) ?? null;
}

/**
 * THE ONLY STATUS THIS PATH MAY VOLUNTEER — and usually there is none.
 *
 * An incompleteness has to be ESTABLISHED before it is stated. The trader saying
 * "no, not all exits are recorded" establishes it. Leaving the exit details
 * unopened establishes nothing at all, and labelling that record as lacking
 * would put a defect notice on the ordinary way this form is used.
 */
export function completenessNote(draft: ClosedTradeDraft): string | null {
  return exitHistoryStatus(draft) === 'incomplete' ? 'Closed · Exit history incomplete' : null;
}
