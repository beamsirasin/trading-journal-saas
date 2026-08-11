/**
 * Pure, framework-independent admin search-query parsing — no I/O, no
 * Drizzle. Shared by the Users and Workspaces oversight lists (Phase 11D).
 *
 * Two concerns kept deliberately separate:
 *   1. Deciding WHAT KIND of search a `q` value means (exact ID vs. a
 *      case-insensitive prefix) — `parseAdminSearchQuery`.
 *   2. Making a prefix search SAFE to embed in a Postgres `ILIKE` pattern —
 *      `escapeLikePattern`. A customer literally named "100% Trader" must
 *      search for the literal percent character, not silently widen the
 *      match (Phase 11's own locked example).
 */

const MAX_QUERY_LENGTH = 200;

/** Loose UUID shape check (any RFC 4122 version) — `users.id`/`workspaces.id` are always UUIDv7, but the check itself does not assume a specific version. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export type AdminSearchQuery =
  | { readonly kind: 'none' }
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'prefix'; readonly text: string };

/**
 * Normalizes and classifies a raw `q` URL parameter. Never throws — an
 * oversized or empty value degrades to `{ kind: 'none' }` (no filter
 * applied), matching the "safely ignore unsupported input" convention
 * `AnalyticsFilterInputSchema` already establishes for admin/analytics
 * filter parsing, rather than surfacing a parse error to the visitor.
 */
export function parseAdminSearchQuery(raw: string | null | undefined): AdminSearchQuery {
  if (raw === null || raw === undefined) return { kind: 'none' };
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > MAX_QUERY_LENGTH) return { kind: 'none' };
  if (isUuidLike(trimmed)) return { kind: 'id', id: trimmed.toLowerCase() };
  return { kind: 'prefix', text: trimmed };
}

/**
 * Escapes `%`, `_`, and `\` so a user-supplied prefix is matched LITERALLY
 * inside a Postgres `ILIKE ... ESCAPE '\'` pattern, then appends the
 * trailing `%` that makes it a prefix match. The caller's SQL must always
 * pair this with `ESCAPE '\'` — the escape character is not implicit.
 */
export function escapeLikePrefix(text: string): string {
  const escaped = text.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `${escaped}%`;
}
