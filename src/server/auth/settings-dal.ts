import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { getDb } from '@/server/db/client';
import { accounts } from '@/server/db/schema';

import { requireSession } from './dal';

export type LinkedAuthProvider = 'email_password' | 'google' | 'other';

export interface SelfProfile {
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
  readonly providers: readonly LinkedAuthProvider[];
}

function toSafeProvider(providerId: string): LinkedAuthProvider {
  if (providerId === 'credential') return 'email_password';
  if (providerId === 'google') return 'google';
  return 'other';
}

/** Minimal account-level Settings DTO. OAuth account IDs and credentials never cross this boundary. */
export async function getSelfProfile(): Promise<SelfProfile> {
  const { user } = await requireSession();
  const rows = await getDb()
    .select({ providerId: accounts.providerId })
    .from(accounts)
    .where(eq(accounts.userId, user.id))
    .orderBy(asc(accounts.createdAt));

  return {
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image,
    providers: [...new Set(rows.map((row) => toSafeProvider(row.providerId)))],
  };
}
