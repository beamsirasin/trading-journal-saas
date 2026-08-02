'use server';

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { z } from 'zod';

import { isValidTimeZone } from '@/lib/time/timezone';
import { getOptionalSession } from '@/server/auth/dal';
import { getDb } from '@/server/db/client';
import { userPreferences } from '@/server/db/schema';
import { routing } from '@/i18n/routing';

import { insertAuditLog } from '../services/audit-log';

/**
 * Syncs a locale/theme/timezone change into `user_preferences` for the
 * current session, and — for locale specifically — the `NEXT_LOCALE` cookie
 * next-intl's middleware reads (Phase 2 brief §13: "update both the
 * database and cookie when the user changes locale").
 *
 * Silently a no-op for an unauthenticated caller: locale and theme already
 * work correctly pre-login via the existing cookie/localStorage mechanisms
 * (Phase 1.1) — this action only extends that to also persist once a real
 * account exists, never gates the pre-login behavior on having one.
 *
 * Never trusts the client for anything beyond the literal values being set;
 * the target row is always the CALLER's own (`session.user.id`), never a
 * client-supplied user ID.
 */
const inputSchema = z.object({
  locale: z.enum(routing.locales).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  timezone: z.string().optional(),
});

export async function syncPreferences(input: z.infer<typeof inputSchema>): Promise<void> {
  const parsed = inputSchema.parse(input);
  if (parsed.timezone !== undefined && !isValidTimeZone(parsed.timezone)) {
    throw new Error(`Invalid IANA timezone: ${parsed.timezone}`);
  }

  const session = await getOptionalSession();
  if (session === null) {
    return;
  }

  const changes: Partial<typeof userPreferences.$inferInsert> = {};
  const auditActions: Array<
    | 'user_preferences.locale_changed'
    | 'user_preferences.theme_changed'
    | 'user_preferences.timezone_changed'
  > = [];

  if (parsed.locale !== undefined) {
    changes.locale = parsed.locale;
    auditActions.push('user_preferences.locale_changed');
  }
  if (parsed.theme !== undefined) {
    changes.theme = parsed.theme;
    auditActions.push('user_preferences.theme_changed');
  }
  if (parsed.timezone !== undefined) {
    changes.timezone = parsed.timezone;
    auditActions.push('user_preferences.timezone_changed');
  }

  if (Object.keys(changes).length === 0) {
    return;
  }

  const db = getDb();
  await db.update(userPreferences).set(changes).where(eq(userPreferences.userId, session.user.id));

  for (const action of auditActions) {
    await insertAuditLog(db, { action, actorUserId: session.user.id });
  }

  if (parsed.locale !== undefined) {
    const cookieStore = await cookies();
    cookieStore.set('NEXT_LOCALE', parsed.locale, {
      path: '/',
      sameSite: 'lax',
    });
  }
}
