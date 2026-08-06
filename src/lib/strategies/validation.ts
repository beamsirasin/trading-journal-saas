/**
 * Pure normalization helpers for Strategy/Setup/Rule text fields — no I/O, no
 * database. The service layer calls these before ever touching a
 * transaction, so a blank name/title/change-note is rejected before any lock
 * is taken. The database's own `btrim(...) <> ''` CHECK constraints
 * (`drizzle/0007_strategies_and_setups.sql`) are the real, final boundary;
 * this is the same value applied earlier so a rejection never costs a wasted
 * transaction.
 */

export interface RequiredTextResult {
  readonly ok: boolean;
  readonly value: string;
}

/** Trims and rejects a required text field (Strategy/Setup name, Rule title). */
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

/** A change note is required only when copy-on-write actually fires (the current Version is locked) — see each service function. */
export function normalizeChangeNote(value: string | null | undefined): RequiredTextResult {
  const trimmed = (value ?? '').trim();
  return { ok: trimmed.length > 0, value: trimmed };
}
