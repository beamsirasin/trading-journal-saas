import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { trades } from './trades';
import { workspaces } from './workspaces';

/**
 * ONE ROW PER STAGE 6 SAVE (migration 0028) — the After-Trade Context Save
 * key and the fingerprint of what that Save said.
 *
 * Stage 6 is a patch that may be saved more than once over a Trade's life, so
 * its idempotency cannot live on the Trade row the way a create's does. Each
 * accepted Save records its own `mutation_key` (unique per workspace, and
 * never the Final Close's key, which lives on `trade_exits`) and the SHA-256
 * of its canonical request. A replay with the same key and fingerprint
 * returns the Trade's current After-Trade Context and writes nothing; the same
 * key with different content is a replay conflict. It holds no answers of its
 * own — those are the Trade's columns and `trade_emotions`.
 */
export const tradeAfterTradeContextSaves = pgTable(
  'trade_after_trade_context_saves',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradeId: uuid('trade_id').notNull(),
    mutationKey: uuid('mutation_key').notNull(),
    mutationFingerprint: text('mutation_fingerprint').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_after_trade_context_saves_workspace_key_idx').on(
      table.workspaceId,
      table.mutationKey,
    ),
    index('trade_after_trade_context_saves_trade_idx').on(table.workspaceId, table.tradeId),
    foreignKey({
      name: 'trade_after_trade_context_saves_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
  ],
);
