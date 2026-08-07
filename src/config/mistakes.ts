import { MISTAKE_SEVERITIES, type MistakeSeverity } from '@/lib/trades/constants';

/**
 * The mistake-taxonomy configuration CLAUDE.md §6 (assumption A2) and
 * `docs/calculation-spec.md` §5 both name: severity weights, and the nine
 * canonical system mistake types seeded by
 * `drizzle/0008_trade_domain_and_discipline.sql`.
 *
 * This file is the one place both the migration's seed values and a future
 * Phase 07C/08 discipline-score reader are checked against — the migration
 * itself cannot import TypeScript, so its `INSERT` statements duplicate these
 * exact key/label/severity/weight/sort_order values by hand; a change here
 * without a matching new migration is a drift bug, not a live config.
 * `mistake_types.default_weight` is what the database actually stores per
 * row — this module's `MISTAKE_SEVERITY_WEIGHTS` is the general severity ->
 * weight framework (unused by the nine canonical rows below in Phase 07 —
 * see `CANONICAL_SYSTEM_MISTAKE_TYPES`'s own comment), and what a future
 * workspace-defined custom mistake type's default weight suggestion would
 * read from once that phase's UI exists.
 *
 * Editing a weight here (and in a future migration) never rewrites history:
 * `trade_mistakes.weight_at_time`/`severity_at_time` snapshot the values in
 * effect when a trade was saved, exactly as `docs/data-dictionary.md`
 * requires.
 */

export const MISTAKE_SEVERITY_WEIGHTS: Readonly<Record<MistakeSeverity, string>> = {
  minor: '0.15',
  moderate: '0.35',
  severe: '0.60',
};

export interface CanonicalMistakeType {
  readonly key: string;
  readonly label: string;
  readonly severity: MistakeSeverity;
  readonly defaultWeight: string;
  readonly sortOrder: number;
}

/**
 * The nine canonical system mistake types named throughout CLAUDE.md and the
 * Phase 07 documents. The source documents define these nine types but do
 * not define evidence-backed relative severity or penalty weights — rather
 * than silently inventing differentiated weights with no evidentiary basis
 * (an earlier draft of this file did exactly that, and was corrected), Phase
 * 07 MVP seeds every one of the nine with a single neutral default:
 * `severity: 'moderate'`, `defaultWeight: '1.0000'`. This is a deliberate
 * decision, not an oversight — note that `defaultWeight` here does NOT come
 * from `MISTAKE_SEVERITY_WEIGHTS['moderate']` (`'0.35'`); the general
 * severity-weight framework is reserved for a later phase's differentiated,
 * evidence-backed weighting, introduced through an explicit product
 * decision. `trade_mistakes.severity_at_time`/`weight_at_time` snapshot
 * whatever was true at save time, so a future re-weighting never rewrites
 * historical discipline data recorded under this neutral default.
 *
 * Do not invent additional types in Phase 07B; workspace-defined custom
 * types are a later phase's job (`mistake_types.workspace_id` already
 * supports them structurally).
 */
export const CANONICAL_SYSTEM_MISTAKE_TYPES: readonly CanonicalMistakeType[] = [
  {
    key: 'moved_stop',
    label: 'Moved stop',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 0,
  },
  {
    key: 'early_exit',
    label: 'Early exit',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 1,
  },
  {
    key: 'oversized_position',
    label: 'Oversized position',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 2,
  },
  {
    key: 'no_setup',
    label: 'No setup',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 3,
  },
  {
    key: 'revenge_trade',
    label: 'Revenge trade',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 4,
  },
  {
    key: 'chased_entry',
    label: 'Chased entry',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 5,
  },
  {
    key: 'ignored_invalidation',
    label: 'Ignored invalidation',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 6,
  },
  {
    key: 'moved_target',
    label: 'Moved target',
    severity: 'moderate',
    defaultWeight: '1.0000',
    sortOrder: 7,
  },
  { key: 'no_stop', label: 'No stop', severity: 'moderate', defaultWeight: '1.0000', sortOrder: 8 },
];

export function isCanonicalMistakeKey(value: unknown): boolean {
  return (
    typeof value === 'string' && CANONICAL_SYSTEM_MISTAKE_TYPES.some((entry) => entry.key === value)
  );
}

export { MISTAKE_SEVERITIES };
