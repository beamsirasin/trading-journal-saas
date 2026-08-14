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
 * Founder-UAT Trade Plan UX slice (migration 0010) — a Trade may now record
 * a Price plan (`planned_entry`/`planned_stop`/`planned_target`) and a Money
 * plan (`planned_risk_minor`/`planned_reward_minor`) simultaneously, and
 * neither derives the other (this engine never infers instrument
 * economics/contract multipliers a user did not supply — CLAUDE.md §6). When
 * both independently produce a Planned R, they are two different user-entered
 * estimates of the SAME plan and are expected to roughly agree; a difference
 * beyond this tolerance is flagged to the user as a genuine discrepancy
 * rather than silently resolved by picking one (`composePlannedR` in
 * `src/lib/calc/trade.ts`) — analytics must never silently ingest a
 * contradictory Plan.
 *
 * Deliberately a DISTINCT constant from `BREAK_EVEN_TOLERANCE_R`, even though
 * the Founder-set value below currently happens to equal it numerically: that
 * tolerance classifies a single measured R against zero; this one compares
 * two independent ESTIMATES of the same R against each other. They are
 * allowed to diverge in the future (a different engine version could widen
 * or narrow either independently) — `0.0500` is a judgment call recorded
 * here for one place to revisit, never a derived or reused value, and never
 * an alias for `BREAK_EVEN_TOLERANCE_R`. Same Calculation Engine Version 1
 * status as `BREAK_EVEN_TOLERANCE_R` — global, not configurable per
 * Workspace/Account.
 */
export const PLANNED_R_AGREEMENT_TOLERANCE_R = '0.0500';

/**
 * `trades.calc_version`'s default value, and the version `BREAK_EVEN_TOLERANCE_R`
 * above belongs to — both are Calculation Engine Version 1 constants, fixed
 * together. Bumped only by a deliberate, reviewed change to `src/lib/calc/`
 * paired with an explicit backfill migration for existing rows — never
 * edited casually (CLAUDE.md's "Persisted derived values drift" risk).
 */
export const CALC_VERSION = 1;
