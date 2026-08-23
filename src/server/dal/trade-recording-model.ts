import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { trades } from '@/server/db/schema';

/**
 * Canonical SQL eligibility predicate for analytics that claim genuine
 * live-entry context. It is the PostgreSQL equivalent of
 * `isRecordedRetrospectively`: timestamps are truncated to JavaScript Date's
 * observable millisecond precision before comparison, equality remains
 * eligible, and an Open Trade (`exited_at IS NULL`) is never classified as
 * retrospective by this completed-Trade rule.
 */
export function entryContextAnalyticsEligible(): SQL {
  return sql`(
    ${trades.exitedAt} is null
    or date_trunc('milliseconds', ${trades.createdAt})
      <= date_trunc('milliseconds', ${trades.exitedAt})
  )`;
}
