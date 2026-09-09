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
 * `manual_total` — the trader stated the whole-trade net result directly. It is
 * the only source this pass can produce, and the one the product is built
 * around: a trader reads one figure off a broker statement far more reliably
 * than they reconstruct six legs.
 *
 * `exit_history` — the total was ADOPTED from a complete recorded exit history.
 * Reserved, and deliberately unreachable until the reconciliation pass: adopting
 * a subtotal as a final result is a claim about completeness, and completeness
 * is something only the trader can assert (see `ExitHistoryStatus`).
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
 * `not_applicable` — nothing to compare: no final total, no legs, or a leg whose
 *                    amount is blank, which makes the subtotal itself unknowable
 *                    rather than smaller.
 * `matched`        — they agree to the cent. THIS IS NOT COMPLETENESS. Two legs
 *                    that happen to sum to the total prove only that they sum to
 *                    the total; the trade may still have had a third.
 * `unreconciled`   — they differ, and the record already accounts for it: the
 *                    trader has said the history is incomplete, or has not said.
 *                    An expected difference, not a contradiction.
 * `conflict`       — they differ while the trader asserts the history is
 *                    COMPLETE. Two statements that cannot both be true, and the
 *                    only one of the four surfaced as a problem.
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

  /** Realized truth. `outcome === null` means nobody has said profit or loss. */
  readonly outcome: MoneyOutcome | null;
  /** The WHOLE trade's net result, unsigned as typed. `''` is unknown. */
  readonly finalAmount: string;

  /** Supporting detail only. Never summed into the final result. */
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
  outcome: null,
  finalAmount: '',
  exits: [],
  exitHistory: 'unknown',
};

/**
 * THE AUTHORITATIVE RESULT FOR THE WHOLE TRADE, or `null` when it is unknown.
 *
 * `null` is not zero and never becomes zero. Break-even is a KNOWN zero and is
 * the only way a zero gets in here. The recorded exits are not consulted: their
 * subtotal is a different figure answering a different question.
 */
export function finalNetPnl(draft: ClosedTradeDraft): number | null {
  return signedAmount(draft.outcome, draft.finalAmount);
}

/** How that figure was established, or `null` while there is no figure. */
export function finalPnlSource(draft: ClosedTradeDraft): FinalPnlSource | null {
  return finalNetPnl(draft) === null ? null : 'manual_total';
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

export function exitHistoryStatus(draft: ClosedTradeDraft): ExitHistoryStatus {
  if (draft.exits.length === 0) return 'not_recorded';
  return draft.exitHistory;
}

export function reconciliation(draft: ClosedTradeDraft): ReconciliationStatus {
  const final = finalNetPnl(draft);
  const subtotal = exitSubtotal(draft);
  if (final === null || subtotal === null) return 'not_applicable';
  if (cents(final) === cents(subtotal)) return 'matched';
  return exitHistoryStatus(draft) === 'complete' ? 'conflict' : 'unreconciled';
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

  if (reconciliation(draft) === 'conflict') {
    issues.push({
      field: 'reconciliation',
      severity: 'warning',
      message:
        'Your recorded exits do not add up to the final result, and the history is marked complete. One of the two needs correcting.',
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
