import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { getDb } from '@/server/db/client';
import { userPreferences, workspaceMembers, workspaces } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';

/**
 * Every authenticated user has exactly one personal workspace (Phase 2
 * brief §12). This is the sole place that guarantee is implemented.
 *
 * Concurrency safety comes from the database, not from application logic:
 * `workspaces_personal_owner_idx` (a partial unique index on
 * `personal_owner_user_id WHERE kind = 'personal'`) and
 * `workspace_members_workspace_user_idx` (unique on `(workspace_id,
 * user_id)`) are the actual guarantees. Two concurrent calls for the same
 * user race to `INSERT ... ON CONFLICT DO NOTHING`; exactly one wins the
 * insert, and the loser's `.returning()` comes back empty, at which point it
 * reads the row the winner created. There is no read-check-then-insert
 * window for a second caller to land in.
 *
 * Retryable and idempotent by construction: calling this again for a user
 * who already has everything provisioned is a very fast no-op transaction.
 * `src/server/auth/dal.ts` relies on exactly that to repair a session whose
 * `databaseHooks.user.create.after` call failed independently (brief §12).
 */
export async function ensurePersonalWorkspace(userId: string): Promise<{ workspaceId: string }> {
  const db = getDb();
  const { locale } = await readPreLoginCookiePreferences();

  return db.transaction(async (tx) => {
    const insertedWorkspace = await tx
      .insert(workspaces)
      // Deterministic, always-unique slug derived from the user's own ID —
      // nothing in this product resolves a workspace by slug yet, so it only
      // needs to exist and never collide, not read well.
      .values({
        name: 'Personal workspace',
        slug: `personal-${userId}`,
        kind: 'personal',
        personalOwnerUserId: userId,
      })
      .onConflictDoNothing({
        target: workspaces.personalOwnerUserId,
        where: sql`${workspaces.kind} = 'personal'`,
      })
      .returning({ id: workspaces.id });

    let workspaceId: string;
    const created = insertedWorkspace[0];
    if (created !== undefined) {
      workspaceId = created.id;
      await insertAuditLog(tx, {
        action: 'workspace.personal_created',
        workspaceId,
        actorUserId: userId,
      });
    } else {
      const existing = await tx.query.workspaces.findFirst({
        where: and(eq(workspaces.personalOwnerUserId, userId), eq(workspaces.kind, 'personal')),
      });
      if (existing === undefined) {
        // The unique-index conflict proves a row exists; not finding it here
        // would mean the constraint and this query disagree about what
        // "personal" means, which is a bug worth failing loudly for.
        throw new Error(
          `ensurePersonalWorkspace: conflict reported but no row found for user ${userId}`,
        );
      }
      workspaceId = existing.id;
    }

    const insertedMember = await tx
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: 'owner' })
      .onConflictDoNothing({ target: [workspaceMembers.workspaceId, workspaceMembers.userId] })
      .returning({ id: workspaceMembers.id });

    if (insertedMember.length > 0) {
      await insertAuditLog(tx, {
        action: 'workspace_member.owner_created',
        workspaceId,
        actorUserId: userId,
      });
    }

    const insertedPreferences = await tx
      .insert(userPreferences)
      .values({ userId, activeWorkspaceId: workspaceId, locale })
      .onConflictDoNothing({ target: userPreferences.userId })
      .returning({ userId: userPreferences.userId });

    if (insertedPreferences.length > 0) {
      await insertAuditLog(tx, {
        action: 'user_preferences.active_workspace_initialized',
        workspaceId,
        actorUserId: userId,
      });
    } else {
      // Preferences already existed (a repair call, not first provisioning)
      // but may still be missing an active workspace — e.g. it was cleared
      // by a workspace deletion in some future phase. Repair without
      // clobbering a locale/theme/timezone the user already set.
      await tx
        .update(userPreferences)
        .set({ activeWorkspaceId: workspaceId })
        .where(
          and(
            eq(userPreferences.userId, userId),
            sql`${userPreferences.activeWorkspaceId} IS NULL`,
          ),
        );
    }

    return { workspaceId };
  });
}

/**
 * Locale precedence at first provisioning: the pre-login `NEXT_LOCALE`
 * cookie next-intl's middleware already manages (`src/proxy.ts`) is the
 * only signal read here — never the browser's `Accept-Language` again,
 * which would contradict a locale the visitor already explicitly switched
 * to or was served under. Falls back to the schema default (`'en'`) only
 * when the cookie is absent or holds a value outside the two supported
 * locales, so a corrupted or forged cookie can never violate the
 * `user_preferences_locale_check` constraint.
 *
 * Theme is deliberately NOT read here: `next-themes` persists to
 * `localStorage` (see `src/components/theme/theme-provider.tsx`), which the
 * server cannot see. The pre-login theme choice is instead synced once,
 * client-side, immediately after authentication succeeds — see
 * `src/components/auth/preferences-sync.tsx`. Reusing a cookie-based
 * mechanism for theme was rejected specifically to avoid touching the
 * hardened Phase 00b/01 no-flash theming behavior for this phase's sake.
 */
async function readPreLoginCookiePreferences(): Promise<{ locale: 'en' | 'th' }> {
  const cookieStore = await cookies();
  const raw = cookieStore.get('NEXT_LOCALE')?.value;
  const locale = raw === 'en' || raw === 'th' ? raw : 'en';
  return { locale };
}
