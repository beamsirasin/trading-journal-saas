import type { MoneyOutcome } from './add-trade/form-primitives';
import type { Timestamp } from './add-trade/timestamp-picker';

/**
 * THE ONE EXIT MODEL — shared by every surface that records a position closing.
 *
 * THREE SCREENS USED TO DO THIS ARITHMETIC SEPARATELY: the Close trade flow for
 * an already-recorded position, the Record exit action in Trade details, and the
 * multiple-exits editor inside the historical Fully closed form. Three
 * implementations of one contract is three chances for them to disagree, and the
 * disagreement would be invisible — every one of them prints a plausible number.
 * They all call this now.
 *
 * WHAT AN EXIT IS. A reduction of an existing position: when it happened, what
 * it made, and whether anything was left afterwards. That is the whole record.
 *
 * THE PERCENTAGE IS OPTIONAL, AND THAT IS THE CENTRAL CHANGE. A trader who
 * closed part of a position and knows it made 10 USD should not be blocked
 * because they cannot remember whether it was 40% or 45%. Money is what the
 * journal is for; allocation is enrichment. Nothing here infers a percentage
 * from money, price or risk, and nothing invents a remaining percentage when the
 * cumulative allocation is genuinely unknown.
 *
 * MONEY IS NEVER RE-WEIGHTED. An exit's amount is already the proceeds of
 * closing its fraction. Multiplying it by that fraction a second time is the
 * single most consequential error available here — 40% at +80 USD becomes
 * +0.14R instead of +0.80R against a 100 USD risk — so no function in this file
 * multiplies an amount by a percentage, and none divides by a
 * percentage-adjusted risk.
 */

/** `all_remaining` leaves nothing open. `part` leaves the position running. */
export type ExitScope = 'all_remaining' | 'part';

export interface ExitRecord {
  readonly id: string;
  readonly scope: ExitScope;
  /**
   * Percent of the ORIGINAL position, as typed. `''` means NOT RECORDED, which
   * is a legitimate and complete state for an exit — never `0`, and never a
   * value to be reconstructed from anything else.
   */
  readonly percent: string;
  /** What the amount means. The signed value is derived, never typed. */
  readonly outcome: MoneyOutcome;
  /** This exit's OWN net result, unsigned. */
  readonly amount: string;
  readonly at: Timestamp | null;
}

/**
 * Whether the trader has told us the exit history is finished.
 *
 * SEPARATE FROM LIFECYCLE ON PURPOSE. A position being closed says nothing
 * about whether every exit that closed it has been written down — see
 * `resultLabel`.
 */
export type ExitHistory = 'complete' | 'incomplete' | 'unknown';

/**
 * THE SIGN COMES FROM THE WORD, AND A BLANK STAYS UNKNOWN.
 *
 * ONE IMPLEMENTATION, because two different things are recorded this way — an
 * exit leg's own proceeds, and a whole trade's final net result — and a second
 * copy is a second chance for a blank to quietly become a zero. `break_even` is
 * a KNOWN zero. An empty amount is not a zero and not a break-even; it is the
 * absence of an answer, and this is the only place that distinction is drawn.
 */
export function signedAmount(outcome: MoneyOutcome | null, amount: string): number | null {
  if (outcome === 'break_even') return 0;
  if (outcome === null) return null;
  if (amount === '') return null;
  const magnitude = Number(amount);
  if (!Number.isFinite(magnitude)) return null;
  return outcome === 'loss' ? -magnitude : magnitude;
}

/** This exit's signed contribution, or `null` while its amount is unanswered. */
export function signedExitAmount(exit: ExitRecord): number | null {
  return signedAmount(exit.outcome, exit.amount);
}

export interface RealizedTotal {
  /** The sum of every exit whose amount is known. */
  readonly total: number;
  /** `true` when every recorded exit carries an amount. */
  readonly everyExitPriced: boolean;
  readonly exitCount: number;
}

/** Cumulative realized money across the recorded exits. Never weighted. */
export function cumulativeRealized(exits: readonly ExitRecord[]): RealizedTotal {
  let total = 0;
  let everyExitPriced = true;
  for (const exit of exits) {
    const value = signedExitAmount(exit);
    if (value === null) everyExitPriced = false;
    else total += value;
  }
  return { total, everyExitPriced, exitCount: exits.length };
}

/**
 * Actual R — cumulative realized money over the ORIGINAL risk at entry.
 *
 * The denominator is frozen at the trade's baseline. It does not move because a
 * stop was trailed, because only part of the position closed, or because an
 * exit's fraction is known. `null` whenever the risk is missing or non-positive:
 * never zero, never infinity.
 */
export function actualR(realized: number, riskAtEntry: number): number | null {
  if (!Number.isFinite(realized)) return null;
  if (!Number.isFinite(riskAtEntry) || riskAtEntry <= 0) return null;
  return realized / riskAtEntry;
}

/**
 * Target R — the planned reward over the ORIGINAL risk at entry.
 *
 * IT LIVES BESIDE `actualR` BECAUSE IT SHARES ITS DENOMINATOR RULE. The two
 * ratios are only comparable because they divide by the same frozen baseline,
 * and a second implementation of "what counts as a usable risk" is exactly how
 * they stop being. Both recording paths call this one function.
 *
 * IT IS NOT A RESULT AND NEVER BECOMES ONE — it says what the trade was set up
 * to pay, not what it paid. `null` whenever either half is missing or the risk
 * is non-positive: never zero, never infinity.
 */
export function targetR(targetProfit: number, riskAtEntry: number): number | null {
  if (!Number.isFinite(targetProfit)) return null;
  if (!Number.isFinite(riskAtEntry) || riskAtEntry <= 0) return null;
  return targetProfit / riskAtEntry;
}

/** Parses a money string to a number, or `null` when it says nothing. */
export function money(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * WHAT THE RECORDED ALLOCATION ACTUALLY SUPPORTS.
 *
 * A cumulative "40% closed · 60% remaining" is a claim, and it is only true when
 * EVERY exit so far has told us its fraction. One exit with an unrecorded
 * percentage makes the running total unknowable — not zero, not "at least 40%",
 * unknowable — and printing a remainder anyway would be inventing precision the
 * record does not have.
 *
 * `closed` is therefore `null` unless every `part` exit carries a percentage.
 * An `all_remaining` exit needs none: it says what it did in words.
 */
export interface Allocation {
  /** Percent of the original position closed so far, or `null` when unknowable. */
  readonly closed: number | null;
  /** What is left, or `null` — either unknowable, or nothing because it closed. */
  readonly remaining: number | null;
}

export function allocation(exits: readonly ExitRecord[]): Allocation {
  if (exits.some((exit) => exit.scope === 'all_remaining')) {
    // The position is closed. Whatever the fractions were, none of it is left.
    return { closed: null, remaining: 0 };
  }

  let closed = 0;
  for (const exit of exits) {
    if (exit.percent === '') return { closed: null, remaining: null };
    const value = Number(exit.percent);
    if (!Number.isFinite(value)) return { closed: null, remaining: null };
    closed += value;
  }
  if (exits.length === 0) return { closed: 0, remaining: 100 };
  return { closed, remaining: Math.max(0, 100 - closed) };
}

/** `40%` where it is whole, `40.5%` where it is not. Never `40.00%`. */
export function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`;
}

export type Lifecycle = 'open' | 'partially_closed' | 'closed';

/**
 * THE POSITION STATE, FROM THE EXITS AND THE TRADER'S OWN DECLARATION.
 *
 * `All remaining` is sufficient on its own: it means nothing was left, even when
 * every earlier exit's fraction is unknown. Allocation adding to 100% also
 * closes it. Nothing else does — an exit history that merely looks complete is
 * not a closure.
 *
 * `declaredClosed` is the historical path's answer. A trader who chose "Fully
 * closed" has already told us the position is closed, and a half-reconstructed
 * exit history must never contradict that by reporting the trade as open again.
 */
export function lifecycleOf(exits: readonly ExitRecord[], declaredClosed: boolean): Lifecycle {
  if (declaredClosed) return 'closed';
  if (exits.length === 0) return 'open';
  if (exits.some((exit) => exit.scope === 'all_remaining')) return 'closed';
  const { closed } = allocation(exits);
  if (closed !== null && closed >= 99.995) return 'closed';
  return 'partially_closed';
}

/**
 * WHAT TO CALL THE MONEY — the distinction this whole pass turns on.
 *
 * A closed position does NOT prove the money is complete. Two independent
 * questions: is anything still open, and is every exit that happened written
 * down? Calling a subtotal "Final" because the lifecycle says closed is exactly
 * the error that makes an incomplete record look authoritative in analytics.
 *
 *   open / partially closed, every exit priced  ->  Net P&L from closed portion
 *   closed, history complete, every exit priced ->  Final net P&L
 *   anything else                               ->  Net P&L from recorded exits
 */
export function resultLabel(input: {
  readonly lifecycle: Lifecycle;
  readonly history: ExitHistory;
  readonly everyExitPriced: boolean;
}): string {
  if (!input.everyExitPriced) return 'Net P&L from recorded exits';
  if (input.lifecycle === 'closed') {
    return input.history === 'complete' ? 'Final net P&L' : 'Net P&L from recorded exits';
  }
  return 'Net P&L from closed portion';
}

/**
 * The position's own status words — and never a percentage the record cannot
 * support. "Partially closed" with an unknown remainder is a complete, valid
 * description of a real trade, and needs no warning attached to it.
 */
export function statusText(lifecycle: Lifecycle, alloc: Allocation): string {
  if (lifecycle === 'closed') return 'Closed';
  if (lifecycle === 'open') return 'Open';
  if (alloc.closed === null || alloc.remaining === null) return 'Partially closed';
  return `${formatPercent(alloc.closed)} closed · ${formatPercent(alloc.remaining)} remaining`;
}
