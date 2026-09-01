import type { TradeListItem } from '@/server/dal/trades';

/**
 * One row of the Trades workspace: the canonical list item plus the one thing
 * a client component cannot derive for itself.
 *
 * `occurredAtDisplay` is formatted on the SERVER, in the reader's persisted
 * IANA timezone, because CLAUDE.md §7 forbids bucketing or displaying a
 * journal date in the browser's zone or the server's local one. The raw
 * `occurredAt` instant travels alongside it unchanged for anything that needs
 * the real value.
 *
 * Deliberately a type alias over `TradeListItem` rather than a hand-copied
 * shape: adding a field to the DAL projection must not require editing a
 * parallel interface here that would silently drift from it.
 */
export type TradesWorkspaceRow = TradeListItem & {
  readonly occurredAtDisplay: string;
};
