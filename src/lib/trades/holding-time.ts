/**
 * HOW LONG THE POSITION WAS HELD.
 *
 * A duration between two stored UTC instants, which is timezone-independent
 * by construction — the elapsed time between an entry and an exit is the same
 * number of minutes in Bangkok as in London, so this is one of the few date
 * facts in the product that does NOT need the reader's zone (CLAUDE.md
 * section 7 governs which local DAY something belongs to, which is a
 * different question and still resolved elsewhere).
 *
 * Deliberately NOT a financial calculation: no money, no R, no rounding that
 * anything downstream depends on. It exists purely so Overview can answer
 * "how long was I in this?" without a component doing date arithmetic inline.
 *
 * Returns structured parts rather than a formatted string, so the presentation
 * layer owns the wording and this module stays free of translation concerns.
 */
export interface TradeHoldingTime {
  readonly days: number;
  readonly hours: number;
  readonly minutes: number;
  /** Total whole minutes — the single value a caller should compare or sort on. */
  readonly totalMinutes: number;
}

/**
 * `null` whenever the duration is not a real, non-negative fact: either
 * timestamp missing (a Trade never entered, or still open), either one
 * unparseable, or an exit that precedes its own entry. A negative holding time
 * is corrupt data and is reported as unavailable rather than rendered as a
 * confident negative number.
 */
export function tradeHoldingTime(
  enteredAt: string | null,
  exitedAt: string | null,
): TradeHoldingTime | null {
  if (enteredAt === null || exitedAt === null) return null;
  const start = Date.parse(enteredAt);
  const end = Date.parse(exitedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const totalMinutes = Math.floor((end - start) / 60_000);
  if (totalMinutes < 0) return null;
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  };
}
