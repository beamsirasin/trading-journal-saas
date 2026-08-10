import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateWorkspaceNameSchema } from '@/lib/settings/schemas';
import { createFixedClock } from '@/lib/time';
import { closeDb } from '@/server/db/client';
import {
  auditLogs,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

const authState = vi.hoisted(() => ({
  session: null as null | {
    user: {
      id: string;
      name: string;
      email: string;
      emailVerified: boolean;
      image: null;
    };
    session: { id: string; expiresAt: Date };
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({ api: { getSession: async () => authState.session } }),
}));

const { updateWorkspaceNameAction } = await import('@/server/actions/workspace');
const { getSettingsWorkspaceSummary } = await import('@/server/auth/settings-dal');
const { renameWorkspace } = await import('./workspace-settings');

type Db = ReturnType<typeof getTestDb>;
const NOW = new Date('2026-08-09T00:00:00.000Z');
const CLOCK = createFixedClock(NOW);
const userIds: string[] = [];
const workspaceIds: string[] = [];

interface FixtureOptions {
  readonly role?: 'owner' | 'member';
  readonly status?: 'trialing' | 'active' | 'past_due' | 'expired' | 'canceled';
  readonly planKey?: 'starter' | 'trader' | 'professional' | null;
  readonly additionalAccounts?: number;
  readonly entitlement?: boolean;
  readonly initialUpdatedAt?: Date;
}

async function fixture(db: Db, label: string, options: FixtureOptions = {}) {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id, email: users.email, name: users.name });
  if (user === undefined) throw new Error('failed to seed Settings workspace user');
  userIds.push(user.id);
  const initialUpdatedAt = options.initialUpdatedAt ?? new Date('2026-01-01T00:00:00.000Z');
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: `${label} workspace`,
      slug: `${label}-${crypto.randomUUID()}`,
      personalOwnerUserId: options.role === 'member' ? null : user.id,
      onboardingCompletedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: initialUpdatedAt,
      updatedAt: initialUpdatedAt,
    })
    .returning({ id: workspaces.id, name: workspaces.name });
  if (workspace === undefined) throw new Error('failed to seed Settings workspace');
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: options.role ?? 'owner',
  });
  await db.insert(userPreferences).values({ userId: user.id, activeWorkspaceId: workspace.id });
  if (options.entitlement !== false) {
    const status = options.status ?? 'active';
    const planKey = options.planKey === undefined ? 'professional' : options.planKey;
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status,
      planKey,
      trialStartedAt: status === 'trialing' ? new Date('2026-08-01T00:00:00.000Z') : null,
      trialEndsAt: status === 'trialing' ? new Date('2026-08-16T00:00:00.000Z') : null,
      billingCurrency: status === 'active' ? 'USD' : null,
      billingInterval: status === 'active' ? 'monthly' : null,
      currentPeriodStartedAt: status === 'active' ? new Date('2026-08-01T00:00:00.000Z') : null,
      currentPeriodEndsAt: status === 'active' ? new Date('2026-09-01T00:00:00.000Z') : null,
    });
  }
  for (let index = 0; index < (options.additionalAccounts ?? 0); index += 1) {
    await db.insert(tradingAccounts).values({
      workspaceId: workspace.id,
      name: `${label} account ${index}`,
      accountMode: 'live',
      baseCurrency: 'USD',
      startingBalance: '10000',
      timezone: 'UTC',
    });
  }
  return { user, workspace, initialUpdatedAt };
}

function setSession(user: { id: string; name: string; email: string }) {
  authState.session = {
    user: { ...user, emailVerified: true, image: null },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

beforeEach(() => {
  authState.session = null;
});

afterEach(async () => {
  const db = getTestDb();
  if (workspaceIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds.splice(0)));
  }
  if (workspaceIds.length > 0) {
    await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds.splice(0)));
  }
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
});

describe('workspace Settings rename (real PostgreSQL)', () => {
  it.each(['Execution Workspace', 'พื้นที่ทำงานของกานต์'])(
    'renames a writable owner workspace to %s and audits only the field name',
    async (name) => {
      const db = getTestDb();
      const seeded = await fixture(db, 'owner-change');
      const result = await renameWorkspace(
        seeded.workspace.id,
        seeded.user.id,
        UpdateWorkspaceNameSchema.parse({ name: `  ${name}  ` }),
        { clock: CLOCK },
      );
      expect(result).toEqual({ ok: true, changed: true, name });
      const [stored] = await db
        .select({ name: workspaces.name, updatedAt: workspaces.updatedAt })
        .from(workspaces)
        .where(eq(workspaces.id, seeded.workspace.id));
      expect(stored).toEqual({ name, updatedAt: NOW });
      const events = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.workspaceId, seeded.workspace.id));
      expect(events).toEqual([
        { action: 'workspace.updated', metadata: { changedFields: ['name'] } },
      ]);
      expect(JSON.stringify(events)).not.toContain(name);
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    },
  );

  it('makes an identical normalized name a no-op without touching updatedAt or audit', async () => {
    const db = getTestDb();
    const seeded = await fixture(db, 'same-name');
    const result = await renameWorkspace(
      seeded.workspace.id,
      seeded.user.id,
      UpdateWorkspaceNameSchema.parse({ name: `  ${seeded.workspace.name}  ` }),
      { clock: CLOCK },
    );
    expect(result).toEqual({ ok: true, changed: false, name: seeded.workspace.name });
    const [stored] = await db
      .select({ updatedAt: workspaces.updatedAt })
      .from(workspaces)
      .where(eq(workspaces.id, seeded.workspace.id));
    expect(stored?.updatedAt).toEqual(seeded.initialUpdatedAt);
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.workspaceId, seeded.workspace.id)),
    ).toHaveLength(0);
  });

  it('denies member, removed membership, read-only owner, and over-limit owner', async () => {
    const db = getTestDb();
    const member = await fixture(db, 'member', { role: 'member' });
    const removed = await fixture(db, 'removed');
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, removed.workspace.id));
    const readOnly = await fixture(db, 'read-only', { status: 'expired', planKey: null });
    const overLimit = await fixture(db, 'over-limit', {
      planKey: 'starter',
      additionalAccounts: 2,
    });

    await expect(
      renameWorkspace(member.workspace.id, member.user.id, { name: 'No' }, { clock: CLOCK }),
    ).resolves.toEqual({ ok: false, code: 'owner_required' });
    await expect(
      renameWorkspace(removed.workspace.id, removed.user.id, { name: 'No' }, { clock: CLOCK }),
    ).resolves.toEqual({ ok: false, code: 'workspace_not_found' });
    await expect(
      renameWorkspace(readOnly.workspace.id, readOnly.user.id, { name: 'No' }, { clock: CLOCK }),
    ).resolves.toEqual({ ok: false, code: 'read_only_workspace' });
    await expect(
      renameWorkspace(overLimit.workspace.id, overLimit.user.id, { name: 'No' }, { clock: CLOCK }),
    ).resolves.toEqual({ ok: false, code: 'over_limit_workspace' });
  });

  it('cannot update a foreign workspace and rolls back the update when audit writing fails', async () => {
    const db = getTestDb();
    const actor = await fixture(db, 'actor');
    const foreign = await fixture(db, 'foreign');
    await expect(
      renameWorkspace(foreign.workspace.id, actor.user.id, { name: 'Targeted' }, { clock: CLOCK }),
    ).resolves.toEqual({ ok: false, code: 'workspace_not_found' });

    await expect(
      renameWorkspace(
        actor.workspace.id,
        actor.user.id,
        { name: 'Must roll back' },
        {
          clock: CLOCK,
          auditWriter: async () => {
            throw new Error('intentional audit failure');
          },
        },
      ),
    ).rejects.toThrow('intentional audit failure');
    const rows = await db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(inArray(workspaces.id, [actor.workspace.id, foreign.workspace.id]));
    expect(rows.find((row) => row.id === actor.workspace.id)?.name).toBe(actor.workspace.name);
    expect(rows.find((row) => row.id === foreign.workspace.id)?.name).toBe(foreign.workspace.name);
  });
});

describe('workspace Settings public composition/action (real PostgreSQL)', () => {
  it.each([
    ['active', 'professional', 1, 'writable', 'available'],
    ['active', 'starter', 2, 'over_limit', 'over_limit_workspace'],
    ['expired', null, 1, 'read_only', 'read_only_workspace'],
  ] as const)(
    'returns a sanitized %s workspace summary under %s access',
    async (status, planKey, additionalAccounts, accessMode, renameAvailability) => {
      const seeded = await fixture(getTestDb(), `summary-${accessMode}`, {
        status,
        planKey,
        additionalAccounts,
      });
      setSession(seeded.user);
      const summary = await getSettingsWorkspaceSummary();
      expect(summary).toEqual({
        name: seeded.workspace.name,
        kind: 'personal',
        role: 'owner',
        accessMode,
        renameAvailability,
      });
      expect(JSON.stringify(summary)).not.toMatch(/slug|workspaceId|planKey|provider/);
    },
  );

  it('uses only the authenticated active workspace and returns closed JSON-safe action failures', async () => {
    const db = getTestDb();
    const actor = await fixture(db, 'action-actor');
    const foreign = await fixture(db, 'action-foreign');
    setSession(actor.user);
    const injection = await updateWorkspaceNameAction({
      name: 'Forged',
      workspaceId: foreign.workspace.id,
      slug: 'forged',
    });
    expect(injection).toEqual({ ok: false, error: { code: 'validation_error', fieldErrors: {} } });
    const changed = await updateWorkspaceNameAction({ name: 'Canonical Active Workspace' });
    expect(changed).toEqual({
      ok: true,
      data: { changed: true, name: 'Canonical Active Workspace' },
    });
    const [foreignStored] = await db
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, foreign.workspace.id));
    expect(foreignStored?.name).toBe(foreign.workspace.name);
    expect(JSON.parse(JSON.stringify([injection, changed]))).toEqual([injection, changed]);

    authState.session = null;
    const unauthenticated = await updateWorkspaceNameAction({ name: 'No session' });
    expect(unauthenticated).toEqual({ ok: false, error: { code: 'unauthenticated' } });
  });
});
