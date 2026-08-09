import 'server-only';

import { eq } from 'drizzle-orm';

import type { SyncObservedPreferencesData } from '@/lib/settings/schemas';
import { systemClock, type Clock } from '@/lib/time';
import { getDb } from '@/server/db/client';
import { userPreferences } from '@/server/db/schema';

import { insertAuditLog } from './audit-log';

export type PreferenceField = 'locale' | 'theme' | 'timezone';
export type PreferenceUpdate = Partial<Pick<typeof userPreferences.$inferSelect, PreferenceField>>;

export interface PreferenceUpdateResult {
  readonly changed: boolean;
  readonly changedFields: readonly PreferenceField[];
}

type AuditWriter = typeof insertAuditLog;

const auditActionByField = {
  locale: 'user_preferences.locale_changed',
  theme: 'user_preferences.theme_changed',
  timezone: 'user_preferences.timezone_changed',
} as const;

/** Account-level preference write plus audit, committed atomically in PostgreSQL. */
export async function updateUserPreferences(
  userId: string,
  requested: PreferenceUpdate,
  dependencies: { readonly clock?: Clock; readonly auditWriter?: AuditWriter } = {},
): Promise<PreferenceUpdateResult> {
  const clock = dependencies.clock ?? systemClock;
  const auditWriter = dependencies.auditWriter ?? insertAuditLog;

  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({
        locale: userPreferences.locale,
        theme: userPreferences.theme,
        timezone: userPreferences.timezone,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .for('update');
    const current = rows[0];
    if (current === undefined) {
      throw new Error('Authenticated user has no preferences row.');
    }

    const changedFields = (['locale', 'theme', 'timezone'] as const).filter(
      (field) => requested[field] !== undefined && requested[field] !== current[field],
    );
    if (changedFields.length === 0) {
      return { changed: false, changedFields: [] };
    }

    const changes: PreferenceUpdate = {
      ...(changedFields.includes('locale') ? { locale: requested.locale as string } : {}),
      ...(changedFields.includes('theme') ? { theme: requested.theme as string } : {}),
      ...(changedFields.includes('timezone') ? { timezone: requested.timezone as string } : {}),
    };
    await tx
      .update(userPreferences)
      .set({ ...changes, updatedAt: clock.now() })
      .where(eq(userPreferences.userId, userId));

    for (const field of changedFields) {
      await auditWriter(tx, {
        action: auditActionByField[field],
        actorUserId: userId,
        entityType: 'user_preferences',
        entityId: userId,
        metadata: { changedFields: [field] },
      });
    }

    return { changed: true, changedFields };
  });
}

export type ObservedPreferenceUpdate = SyncObservedPreferencesData;
