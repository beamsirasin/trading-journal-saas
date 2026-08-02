import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

/**
 * Better Auth's core schema, hand-authored rather than generated.
 *
 * Better Auth's Drizzle adapter treats every ID as an opaque string, so these
 * tables use `text` primary keys (never native `uuid`) populated by the same
 * `generateId()` — a UUIDv7 — that every application table uses via
 * `advanced.database.generateId` in `src/lib/auth/server.ts`. This is the
 * identifier boundary documented in ADR 0008 and `docs/data-dictionary.md`:
 * Better-Auth-owned tables are `text`, application-owned tables are `uuid`,
 * and both hold the same *shape* of value.
 *
 * Column names are snake_case (project convention); every Drizzle TS
 * property, however, is Better Auth's own canonical camelCase field name
 * (`emailVerified`, `expiresAt`, `providerId`, …), which is what the adapter
 * actually reads — it never sees the underlying SQL column name, Drizzle
 * resolves that. `src/lib/auth/server.ts` only needs a `modelName` mapping
 * per table (`user` -> `'users'`, etc.); no `fields` mapping is needed
 * anywhere, because no TS property name was renamed here, only its column.
 *
 * Confirmed against Better Auth 1.6.25's documented core schema (user /
 * session / account / verification) and its database-backed rate-limit
 * table shape (id / key / count / lastRequest) — not assumed from a
 * different version's docs.
 */

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_idx').on(table.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_idx').on(table.token),
    // Resolving "which workspace/session belongs to this user" is the whole
    // point of a session table; every request touches this.
    index('sessions_user_id_idx').on(table.userId),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    idToken: text('id_token'),
    /** Hashed credential-provider password. Never the plaintext — Better Auth hashes before this is written. */
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    uniqueIndex('accounts_provider_account_idx').on(table.providerId, table.accountId),
  ],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

/** Database-backed rate limiting (Decision 7 of the Phase 2 plan) — never in-memory, never Redis. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: text('id').primaryKey().$defaultFn(generateId),
    key: text('key').notNull(),
    count: integer('count').notNull().default(0),
    /**
     * Epoch milliseconds. `bigint` with `mode: 'number'` — Better Auth's own
     * documented column type is bigint (room to grow past 2038 as a plain SQL
     * integer would not have), but its runtime code hands this around as a
     * JS `number`, which is exact for epoch-ms values for millennia yet.
     */
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('rate_limits_key_idx').on(table.key)],
);
