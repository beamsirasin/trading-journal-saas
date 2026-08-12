import 'server-only';

import { asc, eq } from 'drizzle-orm';

import { authorizeWorkspaceMutation, type AccessMode } from '@/lib/entitlements/resolve';
import { getDb } from '@/server/db/client';
import { accounts, workspaces } from '@/server/db/schema';

import {
  getActiveWorkspaceContext,
  getWorkspaceEntitlement,
  requireSession,
  type WorkspaceRole,
} from './dal';

export type LinkedAuthProvider = 'email_password' | 'google' | 'other';

export interface SelfProfile {
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
  readonly providers: readonly LinkedAuthProvider[];
}

export type WorkspaceRenameAvailability =
  'available' | 'owner_required' | 'read_only_workspace' | 'over_limit_workspace';

export interface SettingsWorkspaceSummary {
  readonly name: string;
  readonly kind: 'personal';
  readonly role: WorkspaceRole;
  readonly accessMode: AccessMode;
  readonly renameAvailability: WorkspaceRenameAvailability;
}

/** Exported for reuse by `src/server/services/admin/user-oversight.ts` (Phase 11D) — the one canonical mapping, never a second copy with different behavior. */
export function toSafeProvider(providerId: string): LinkedAuthProvider {
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

/** Settings-only workspace DTO. Slug, provider data, and entitlement rows never cross this boundary. */
export async function getSettingsWorkspaceSummary(): Promise<SettingsWorkspaceSummary> {
  const context = await getActiveWorkspaceContext();
  const [workspace, entitlement] = await Promise.all([
    getDb()
      .select({ name: workspaces.name, kind: workspaces.kind })
      .from(workspaces)
      .where(eq(workspaces.id, context.workspaceId))
      .limit(1),
    getWorkspaceEntitlement(),
  ]);
  const row = workspace[0];
  if (row === undefined || row.kind !== 'personal') {
    throw new Error('Active Settings workspace is unavailable.');
  }

  const accessMode = entitlement?.accessMode ?? 'read_only';
  const authorization = authorizeWorkspaceMutation(entitlement, 'ordinary_write');
  const renameAvailability: WorkspaceRenameAvailability =
    context.role !== 'owner'
      ? 'owner_required'
      : authorization.allowed
        ? 'available'
        : authorization.code === 'over_limit_workspace'
          ? 'over_limit_workspace'
          : 'read_only_workspace';

  return {
    name: row.name,
    kind: 'personal',
    role: context.role,
    accessMode,
    renameAvailability,
  };
}
