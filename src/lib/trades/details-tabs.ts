import { z } from 'zod';

/**
 * TRADE DETAILS — the six tabs, named for this product's own workflow.
 *
 * The order is the order a Trade is lived through, and each name answers one
 * question a trader actually asks:
 *
 *   Overview   what happened?
 *   Plan       what did I intend, and what would the system have done?
 *   Execution  what did I actually do, leg by leg?
 *   Review     was the idea good, did I follow it, what affected me?
 *   Chart      what did it look like?
 *   Notes      what did I write down?
 *
 * ALL SIX ALWAYS RENDER. The Dashboard's Quick Preview derives its tab list
 * from the Trade and hides empty ones, which is right for a preview; it is
 * wrong here. This is the surface a trader works IN, and a tab that vanishes
 * when a Trade has no chart is also the tab they were looking for in order to
 * add one. Each panel carries its own honest unavailable state instead
 * (CLAUDE.md §8: an empty state says what to do next).
 */
export const TRADE_DETAILS_TABS = [
  'overview',
  'plan',
  'execution',
  'review',
  'chart',
  'notes',
] as const;

export type TradeDetailsTab = (typeof TRADE_DETAILS_TABS)[number];

/** Where a Trade opens when the URL names no tab. */
export const DEFAULT_TRADE_DETAILS_TAB: TradeDetailsTab = 'overview';

export const TradeDetailsTabSchema = z.enum(TRADE_DETAILS_TABS);

/**
 * Parses an untrusted `?tab=`. Anything absent, repeated, or unrecognised
 * resolves to {@link DEFAULT_TRADE_DETAILS_TAB} rather than throwing — a
 * hand-edited URL must never be able to blank the sheet.
 *
 * The tab carries no authorization surface of its own: `?trade=` continues
 * through the fully authorized DAL path unchanged, and this only chooses
 * which already-fetched panel is visible.
 */
export function parseTradeDetailsTab(
  value: string | string[] | undefined,
  /** The retired `?section=` value, honoured only when no `?tab=` is present. */
  legacySection?: string | string[] | undefined,
): TradeDetailsTab {
  if (typeof value === 'string') {
    const result = TradeDetailsTabSchema.safeParse(value);
    if (result.success) return result.data;
  }
  return legacySectionTab(legacySection) ?? DEFAULT_TRADE_DETAILS_TAB;
}

/**
 * THE RETIRED FIVE-SECTION CONTRACT, STILL HONOURED.
 *
 * Trade Detail used to navigate by `?section=` over five sections — actual,
 * system, strategy, entry, review. Those links exist in bookmarks, in shared
 * URLs and in browser history, and this pass must not turn them into a page
 * that silently opens somewhere else.
 *
 * Each old section maps to the tab that now holds its content:
 *
 *   actual    -> execution   what the trader actually did
 *   system    -> plan        the counterfactual, which lives with the plan
 *   strategy  -> plan        classification moved in beside it
 *   entry     -> plan        confidence, checklist and entry context moved in
 *   review    -> review      unchanged
 *
 * An unrecognised value returns `null` and the caller falls back to the
 * default, exactly as it does for an unrecognised `?tab=`.
 */
const LEGACY_SECTION_TAB: Readonly<Record<string, TradeDetailsTab>> = {
  actual: 'execution',
  system: 'plan',
  strategy: 'plan',
  entry: 'plan',
  review: 'review',
};

function legacySectionTab(value: string | string[] | undefined): TradeDetailsTab | null {
  if (typeof value !== 'string') return null;
  return LEGACY_SECTION_TAB[value] ?? null;
}
