import { z } from 'zod';

/**
 * WHEN THE TRADER IS RECORDING — the one decision Log a trade now asks before
 * it shows a form.
 *
 * These two are not a view toggle. They are two genuinely different journaling
 * situations, and which one applies changes what the form can truthfully ask
 * for:
 *
 *   at_entry      the outcome is not known yet. The trade is being planned or
 *                 has just been entered, so there is a plan, a risk and a
 *                 confidence to capture — and no result to record.
 *
 *   after_trade   the trade is over. There is a final result to record
 *                 alongside the plan it was taken on, which is what makes the
 *                 System-versus-Trader comparison possible at all.
 *
 * The vocabulary lives here, free of React and of the form, so the route that
 * parses it and the form that renders in it cannot drift on what the two
 * values are.
 */
export const RECORDING_TIMINGS = ['at_entry', 'after_trade'] as const;

export type RecordingTiming = (typeof RECORDING_TIMINGS)[number];

export const RecordingTimingSchema = z.enum(RECORDING_TIMINGS);

/**
 * Parses an untrusted `?timing=`.
 *
 * `null` — meaning "no mode chosen yet, show the choice" — for anything
 * absent, repeated or unrecognised. There is deliberately no default: a
 * default would be this flow quietly deciding for the trader which of the two
 * situations they are in, and getting it wrong half the time. An invalid value
 * therefore returns to the choice rather than guessing at it, which is also
 * what makes a hand-edited URL safe.
 */
export function parseRecordingTiming(value: string | string[] | undefined): RecordingTiming | null {
  if (typeof value !== 'string') return null;
  const result = RecordingTimingSchema.safeParse(value);
  return result.success ? result.data : null;
}
