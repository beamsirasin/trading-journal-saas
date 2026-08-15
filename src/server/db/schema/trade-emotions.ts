import { foreignKey, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { emotionTypes } from './emotion-types';
import { trades } from './trades';
import { workspaces } from './workspaces';

/** One selected emotion per Trade/type. Workspace scope is also trigger-enforced. */
export const tradeEmotions = pgTable(
  'trade_emotions',
  {
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    emotionTypeId: uuid('emotion_type_id')
      .notNull()
      .references(() => emotionTypes.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tradeId, table.emotionTypeId] }),
    index('trade_emotions_workspace_idx').on(table.workspaceId),
    index('trade_emotions_emotion_type_idx').on(table.emotionTypeId),
    foreignKey({
      name: 'trade_emotions_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
  ],
);
