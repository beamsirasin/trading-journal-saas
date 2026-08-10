import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { cache } from 'react';

import { getDb } from '@/server/db/client';
import { platformAdmins } from '@/server/db/schema';

import { getOptionalSession, type SessionUser } from './dal';

/**
 * The platform-admin authorization boundary — deliberately a SIBLING file to
 * `dal.ts`, not a function added to it (Phase 11's locked contract:
 * "Platform Admin is NOT Workspace Admin"). `dal.ts` calls itself "the one
 * centralized... boundary" for TENANT-scoped access; platform authority is a
 * structurally different boundary with no workspace dependency at all, and
 * deserves its own file rather than being folded into that one.
 *
 * Reuses `dal.ts`'s canonical session authentication (`getOptionalSession`)
 * — never a second `auth.api.getSession` call site — but resolves NOTHING
 * about workspace membership, role, plan, or entitlement. An admin with no
 * active Workspace, or no Workspace at all, still authorizes here.
 */

/** Narrow context — never the raw `platform_admins` row (Phase 11's "do not return raw grant rows unnecessarily"). */
export interface PlatformAdminContext {
  readonly user: SessionUser;
  /** The acting admin's current active grant row id — what `admin_audit_log.actor_admin_id` and other tables' `granted_by_admin_id`/`created_by_admin_id` columns record. */
  readonly adminGrantId: string;
}

export class PlatformAdminRequiredError extends Error {
  constructor(message = 'Platform admin authority is required.') {
    super(message);
    this.name = 'PlatformAdminRequiredError';
  }
}

/**
 * The one authoritative active-grant predicate (Phase 11's "do not duplicate
 * authorization logic"). `requirePlatformAdmin()` below is a thin wrapper
 * around this — the same `getOptionalX` / `requireX` pairing `dal.ts` itself
 * uses for session resolution, so both the optional and throwing forms stay
 * backed by one query.
 *
 * Wrapped in React's `cache()` for the same reason `dal.ts`'s workspace
 * helpers are: a future `/admin` layout, a read service, and a mutation
 * service may all resolve this within one request, and this collapses that
 * to one database round trip. Cache scope is per-request only (React's own
 * guarantee), so a revoked grant is never served from a stale cross-request
 * cache — the next request re-queries `platform_admins` from scratch.
 */
export const getOptionalPlatformAdmin = cache(
  async function getOptionalPlatformAdmin(): Promise<PlatformAdminContext | null> {
    const session = await getOptionalSession();
    if (session === null) {
      return null;
    }

    const db = getDb();
    const [grant] = await db
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.userId, session.user.id), isNull(platformAdmins.revokedAt)))
      .limit(1);

    if (grant === undefined) {
      return null;
    }

    return { user: session.user, adminGrantId: grant.id };
  },
);

/**
 * Throws rather than returning null — for the future `/admin` route layout
 * (re-check, not the only check) and every admin mutation service, which
 * must independently re-verify this regardless of what the layout decided
 * (Phase 11's "do not design it as a UI-only check" / "middleware-only
 * guards fail" risk).
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const context = await getOptionalPlatformAdmin();
  if (context === null) {
    throw new PlatformAdminRequiredError();
  }
  return context;
}
