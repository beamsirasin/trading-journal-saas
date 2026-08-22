import { z } from 'zod';

import type { StatusKind } from '@/lib/status/status-kind';

/**
 * The shared deep-link/section-navigation contract for Trade Detail —
 * Phase 15B (docs/phases/PHASE-15-ux-simplification.md §30/§38, and the
 * Phase 15B brief's "DEEP ACTION NAVIGATION"/"TRADE SECTION NAVIGATION
 * FOUNDATION"). This module is pure and has no React/DOM dependency so it is
 * independently unit-testable and reusable by both the server page (parsing
 * `?section=`) and the client nav component (deriving status).
 *
 * Five sections only, matching Phase 15A's frozen Trade Detail IA — this is
 * NOT a sequential wizard and no section is ever disabled because another is
 * incomplete (brief §12).
 */
export const TRADE_DETAIL_SECTIONS = ['actual', 'system', 'strategy', 'entry', 'review'] as const;
export type TradeDetailSection = (typeof TRADE_DETAIL_SECTIONS)[number];

/**
 * Phase 15E — the default landing section when `?section=` is absent or
 * invalid. `actual` answers "what did I actually do?", the most natural
 * first question about any Trade (mirrored by Trade Overview's own hero,
 * which leads with Actual R first) — never a forced sequence, just a
 * sensible starting point the user is free to leave immediately via any nav
 * item (brief §5: this is navigation by workflow, not a wizard).
 */
export const DEFAULT_TRADE_DETAIL_SECTION: TradeDetailSection = 'actual';

/** Zod-validated at the server boundary (CLAUDE.md §4) — an unrecognized value parses to `null`, never throws. */
export const TradeDetailSectionSchema = z.enum(TRADE_DETAIL_SECTIONS);

/**
 * Parses an untrusted `?section=` query value. Returns `null` for anything
 * absent or invalid — callers must treat `null` as "no section requested"
 * and fall back to {@link DEFAULT_TRADE_DETAIL_SECTION} rather than crashing
 * (brief §9).
 */
export function parseTradeDetailSection(value: string | undefined): TradeDetailSection | null {
  if (value === undefined) return null;
  const result = TradeDetailSectionSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The minimal Trade fields the status derivation below reads — a narrow view onto `TradeDetail` (`server/dal/trades.ts`), never the whole model, so this stays independently testable with small fixtures. */
export interface TradeSectionStatusInput {
  readonly status: 'planned' | 'open' | 'closed' | 'canceled';
  readonly systemStatus: 'pending' | 'resolved' | 'no_trade';
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly setupConditionState: 'recorded' | 'not_recorded' | 'not_configured';
  readonly confidence: number | null;
  readonly emotionsRecordedAt: string | null;
  readonly confirmationNotes: string | null;
  readonly reviewNotes: string | null;
  readonly ruleChecks: readonly { readonly checkStatus: string }[];
}

/**
 * Derives a `StatusKind` per section from fields the DAL already returns —
 * no new calculation, no new persisted field, just presence/count logic a
 * human would eyeball (CLAUDE.md §6/§10: this is presentation, not a new
 * formula, and produces a qualitative state, never a numeric completeness
 * score).
 */
export function deriveTradeSectionStatuses(
  trade: TradeSectionStatusInput,
): Record<TradeDetailSection, StatusKind> {
  const actual: StatusKind =
    trade.status === 'closed'
      ? 'complete'
      : trade.status === 'open'
        ? 'active'
        : trade.status === 'planned'
          ? 'needs_attention'
          : 'not_recorded'; // canceled — factual, never an error

  const system: StatusKind =
    trade.systemStatus === 'resolved'
      ? 'complete'
      : trade.systemStatus === 'pending'
        ? 'needs_attention'
        : 'not_recorded'; // no_trade — factual, never an error

  const strategy: StatusKind =
    trade.strategyId !== null && trade.setupId !== null
      ? 'complete'
      : trade.strategyId !== null
        ? 'partial'
        : 'not_recorded';

  const entryRecordedCount =
    (trade.setupConditionState === 'not_recorded' ? 0 : 1) +
    (trade.confidence === null ? 0 : 1) +
    (trade.emotionsRecordedAt === null ? 0 : 1) +
    (trade.confirmationNotes === null ? 0 : 1);
  const entry: StatusKind =
    entryRecordedCount === 4 ? 'complete' : entryRecordedCount === 0 ? 'not_recorded' : 'partial';

  // Rules only count toward the total when a snapshot actually exists — an
  // empty snapshot (no applicable Rules at all) is excluded from the
  // denominator entirely, not treated as vacuously satisfied, so a Trade
  // with no Rules and no Review notes correctly reads `not_recorded`, never
  // a misleading `partial`.
  const hasRuleSnapshot = trade.ruleChecks.length > 0;
  const rulesAddressed =
    hasRuleSnapshot && trade.ruleChecks.some((check) => check.checkStatus !== 'not_checked');
  const reviewApplicableCount = 1 + (hasRuleSnapshot ? 1 : 0);
  const reviewRecordedCount = (trade.reviewNotes === null ? 0 : 1) + (rulesAddressed ? 1 : 0);
  const review: StatusKind =
    reviewRecordedCount === reviewApplicableCount
      ? 'complete'
      : reviewRecordedCount === 0
        ? 'not_recorded'
        : 'partial';

  return { actual, system, strategy, entry, review };
}
