import { uuidv7 } from 'uuidv7';

/**
 * The one identifier strategy for the whole system — see ADR 0008.
 *
 * UUIDv7 embeds a millisecond timestamp in its high bits, so IDs sort
 * chronologically (useful for indexes and `ORDER BY id`) while remaining
 * unguessable (128 bits of which ~74 are random) — unlike a sequential
 * integer, an ID here never doubles as a "how many rows exist" signal.
 *
 * Unguessability is defence in depth, never the authorization mechanism
 * (CLAUDE.md §4): every read and write is still scoped by session-derived
 * workspace membership, not by whether the caller happened to know an ID.
 *
 * Both Better-Auth-owned tables (`text` primary keys, populated via
 * `advanced.database.generateId`) and application-owned tables (native
 * Postgres `uuid` columns, populated via `.$defaultFn`) call this same
 * function, so a `users.id` and a `workspaces.id` are the same *shape* of
 * value even though one is stored as `text` and the other as `uuid` — see
 * the identifier boundary note in `docs/data-dictionary.md`.
 */
export function generateId(): string {
  return uuidv7();
}
