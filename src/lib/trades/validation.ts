/**
 * Pure normalization helpers for Trade text fields — no I/O, no database.
 * Mirrors `src/lib/strategies/validation.ts`'s exact shape rather than
 * importing it directly: that module belongs to the Strategy domain, and a
 * Trade service reaching into it would be an odd, undocumented cross-domain
 * dependency for two three-line pure functions. The database's own
 * `btrim(...) <> ''`-style discipline (via service-level rejection, since
 * `trades.symbol` has no such CHECK) is applied here, before any lock is
 * taken.
 */

export interface RequiredTextResult {
  readonly ok: boolean;
  readonly value: string;
}

/** Trims and rejects a required text field (currently: Trade `symbol`). */
export function normalizeRequiredText(value: string): RequiredTextResult {
  const trimmed = value.trim();
  return { ok: trimmed.length > 0, value: trimmed };
}

/** Trims an optional text field, converting a blank result to `null` rather than an empty string. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
