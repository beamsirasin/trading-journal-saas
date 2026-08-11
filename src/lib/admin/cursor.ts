/**
 * The `(createdAt, id)` opaque keyset cursor shared by the Users and
 * Workspaces oversight lists (Phase 11D) — both order "newest first,
 * deterministically tie-broken by id", the identical shape, so one shared
 * helper is justified here (unlike `src/server/dal/trades.ts`'s
 * `encodeCursor`/`decodeCursor`, which is deliberately Trade-specific
 * because its sort column, `coalesce(exited_at, entered_at, created_at)`,
 * is not reused anywhere else). Same idiom: base64url of
 * `${iso}|${id}`, `(createdAt, id) < (cursor.createdAt, cursor.id)` as the
 * next-page predicate — never `OFFSET`, which degrades under concurrent
 * inserts.
 *
 * Server-generated and validated, never arbitrary caller input: a malformed
 * cursor decodes to `null`, and every caller treats that as "start from the
 * first page" rather than surfacing a parse error — the same fail-safe
 * posture the rest of this module's search parsing takes.
 */

export interface DecodedCreatedAtCursor {
  readonly createdAt: string;
  readonly id: string;
}

export function encodeCreatedAtCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}

export function decodeCreatedAtCursor(cursor: string): DecodedCreatedAtCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const separatorIndex = decoded.indexOf('|');
    if (separatorIndex === -1) return null;
    const createdAt = decoded.slice(0, separatorIndex);
    const id = decoded.slice(separatorIndex + 1);
    if (createdAt === '' || id === '' || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Shared page-size clamp — Phase 11D's own locked default/maximum (25/100), distinct from the Trade list's 25/50. */
export function clampAdminPageSize(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_SIZE);
}
