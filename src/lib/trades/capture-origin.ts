import { isContractRow, type CaptureOrigin } from './add-trade-contract';

/**
 * WHEN AN ANSWER WAS CAPTURED, AS A RECORD SURFACE MAY SAY IT (contract §7, §9;
 * UX Rules §2.8, §4.7, §9.4).
 *
 * A contract row stores the origin of each answer, and that is the truth: at
 * entry, during the trade, or recalled after close. A legacy row never carried
 * the question; for its Strategy and Setup the first-assignment timestamp still
 * tells "captured at entry" from "added after entry" (Phase 14C), and for
 * everything else nothing can be claimed.
 */
export type CaptureOriginLabel = CaptureOrigin | 'legacy_at_entry' | 'legacy_after_entry';

export function captureOriginLabel(
  trade: { readonly recordingContract: string | null; readonly enteredAt: string | null },
  origin: CaptureOrigin | null,
  legacyAssignedAt: string | null = null,
): CaptureOriginLabel | null {
  if (isContractRow(trade)) return origin;
  if (legacyAssignedAt === null || trade.enteredAt === null) return null;
  return Date.parse(legacyAssignedAt) <= Date.parse(trade.enteredAt)
    ? 'legacy_at_entry'
    : 'legacy_after_entry';
}
