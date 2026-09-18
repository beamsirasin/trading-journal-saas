import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { emotionTypes } from './emotion-types';
import { trades } from './trades';
import { workspaces } from './workspaces';

/**
 * One selected emotion per Trade, type and phase. Workspace scope is also
 * trigger-enforced.
 *
 * `phase` (migration 0023, contract §9): Entry Emotion and Post-Trade Emotion
 * are separate observations, so the same emotion type may appear once in each
 * and a Post-Trade answer never overwrites an Entry one. Every pre-0023 row is
 * an Entry Emotion.
 */
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
    phase: text('phase').notNull().default('entry'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tradeId, table.emotionTypeId, table.phase] }),
    index('trade_emotions_workspace_idx').on(table.workspaceId),
    index('trade_emotions_emotion_type_idx').on(table.emotionTypeId),
    foreignKey({
      name: 'trade_emotions_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
    check('trade_emotions_phase_check', sql`${table.phase} IN ('entry', 'post_trade')`),
  ],
);
