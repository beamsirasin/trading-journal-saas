import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { workspaces } from './workspaces';

/** Shared system taxonomy now; nullable tenancy supports future custom types. */
export const emotionTypes = pgTable(
  'emotion_types',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('emotion_types_workspace_archived_idx').on(table.workspaceId, table.isArchived),
    uniqueIndex('emotion_types_system_key_idx')
      .on(table.key)
      .where(sql`${table.isSystem}`),
    uniqueIndex('emotion_types_workspace_key_idx')
      .on(table.workspaceId, table.key)
      .where(sql`NOT ${table.isSystem}`),
    check('emotion_types_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('emotion_types_key_not_blank_check', sql`btrim(${table.key}) <> ''`),
    check('emotion_types_label_not_blank_check', sql`btrim(${table.label}) <> ''`),
    check(
      'emotion_types_tenancy_check',
      sql`(${table.isSystem} AND ${table.workspaceId} IS NULL) OR (NOT ${table.isSystem} AND ${table.workspaceId} IS NOT NULL)`,
    ),
  ],
);
