/**
 * The two calculation-engine constants declared now so `trades.calc_version`
 * has a real, named default instead of a bare literal, even though the
 * engine that consumes them (`src/lib/calc/`) is Phase 07C's job, and the
 * break-even classification that reads `BREAK_EVEN_TOLERANCE_R` is Phase
 * 07C/08's job. Declaring them in Phase 07B avoids Phase 07C needing to
 * touch the schema again merely to introduce a constant the schema already
 * needed to reference.
 *
 * `BREAK_EVEN_TOLERANCE_R` is a **global Calculation Engine Version 1
 * constant** — identical for every Workspace and every Trading Account. It
 * is:
 *
 *   - NOT workspace-wide configuration (there is no per-workspace override,
 *     and none is planned for this engine version);
 *   - NOT a database column (`trading_accounts` carries no
 *     `break_even_tolerance_r` field — see `docs/data-dictionary.md`'s note
 *     on that table);
 *   - NOT user-configurable during the MVP.
 *
 * A future calculation-engine version could introduce per-workspace or
 * per-account tolerance as an explicit product decision; that would be a new
 * `CALC_VERSION` and a new constant, not a mutation of this one. Kept as a
 * string, never a JS `number`, so a `decimal.js` comparison never
 * round-trips through floating point. The four-decimal literal form
 * (`'0.0500'`) matches the `NUMERIC(12,4)` R-multiple storage convention
 * (CLAUDE.md §5) exactly, rather than the shorter but equivalent `'0.05'`.
 */
export const BREAK_EVEN_TOLERANCE_R = '0.0500';

/**
 * `trades.calc_version`'s default value, and the version `BREAK_EVEN_TOLERANCE_R`
 * above belongs to — both are Calculation Engine Version 1 constants, fixed
 * together. Bumped only by a deliberate, reviewed change to `src/lib/calc/`
 * paired with an explicit backfill migration for existing rows — never
 * edited casually (CLAUDE.md's "Persisted derived values drift" risk).
 */
export const CALC_VERSION = 1;
