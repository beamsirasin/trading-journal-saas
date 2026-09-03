import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFixedClock } from '@/lib/time';
import { closeDb } from '@/server/db/client';
import {
  accounts,
  auditLogs,
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  trades,
  tradingAccounts,
  userPreferences,
  users,
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
      image: string | null;
    };
    session: { id: string; expiresAt: Date };
  },
  updateUser: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: authState.cookieSet }),
}));
vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => authState.session,
      updateUser: (...args: unknown[]) => authState.updateUser(...args),
    },
  }),
}));

const { getSelfProfile } = await import('@/server/auth/settings-dal');
const { syncPreferences, updateTimezonePreferenceAction } =
  await import('@/server/actions/preferences');
const { updateDisplayNameAction } = await import('@/server/actions/profile');
const { updateUserPreferences } = await import('./user-preferences');

type Db = ReturnType<typeof getTestDb>;
const userIds: string[] = [];

async function createUserWithPreferences(db: Db, name: string) {
  const [user] = await db
    .insert(users)
    .values({
      name,
      email: `${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id, email: users.email });
  if (user === undefined) throw new Error('failed to create Settings test user');
  userIds.push(user.id);
  const initialUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
  await db.insert(userPreferences).values({
    userId: user.id,
    locale: 'en',
    theme: 'system',
    timezone: 'UTC',
    createdAt: initialUpdatedAt,
    updatedAt: initialUpdatedAt,
  });
  return { ...user, name, initialUpdatedAt };
}

function setSession(user: { id: string; name: string; email: string }) {
  authState.session = {
    user: { ...user, emailVerified: true, image: null },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

beforeEach(() => {
  authState.session = null;
  authState.updateUser.mockReset();
  authState.cookieSet.mockReset();
});

afterEach(async () => {
  const db = getTestDb();
  if (userIds.length > 0) {
    await db.delete(auditLogs).where(inArray(auditLogs.actorUserId, userIds));
    await db.delete(users).where(inArray(users.id, userIds.splice(0)));
  }
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
});

describe('account-level profile Settings (real PostgreSQL)', () => {
  it('returns only a safe, deduplicated linked-provider DTO without workspace membership', async () => {
    const db = getTestDb();
    const user = await createUserWithPreferences(db, 'Provider Tester');
    await db.insert(accounts).values([
      { userId: user.id, accountId: user.email, providerId: 'credential', password: 'hash' },
      {
        userId: user.id,
        accountId: 'google-account-id',
        providerId: 'google',
        accessToken: 'secret',
      },
      { userId: user.id, accountId: 'second-google', providerId: 'google', refreshToken: 'secret' },
      { userId: user.id, accountId: 'future-provider-id', providerId: 'future-oauth' },
    ]);
    setSession(user);

    const profile = await getSelfProfile();
    expect(profile).toEqual({
      name: 'Provider Tester',
      email: user.email,
      emailVerified: true,
      image: null,
      providers: ['email_password', 'google', 'other'],
    });
    expect(JSON.stringify(profile)).not.toMatch(
      /credential|future-oauth|google-account-id|accessToken|refreshToken|secret/,
    );
  });

  it('uses the canonical auth mutation, audits field name only, and makes normalized retry a no-op', async () => {
    const db = getTestDb();
    const user = await createUserWithPreferences(db, 'Original Name');
    setSession(user);
    authState.updateUser.mockImplementation(async ({ body }: { body: { name: string } }) => {
      await db.update(users).set({ name: body.name }).where(eq(users.id, user.id));
      if (authState.session !== null) authState.session.user.name = body.name;
      return { status: true };
    });

    const changed = await updateDisplayNameAction({ name: '  กานต์ เทรดเดอร์  ' });
    expect(changed).toEqual({
      ok: true,
      data: { changed: true, name: 'กานต์ เทรดเดอร์' },
    });
    expect(authState.updateUser).toHaveBeenCalledOnce();
    const stored = await db.select({ name: users.name }).from(users).where(eq(users.id, user.id));
    expect(stored[0]?.name).toBe('กานต์ เทรดเดอร์');

    const events = await db
      .select({
        action: auditLogs.action,
        metadata: auditLogs.metadata,
        workspaceId: auditLogs.workspaceId,
      })
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, user.id));
    expect(events).toEqual([
      { action: 'user.profile_updated', metadata: { changedFields: ['name'] }, workspaceId: null },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/Original Name|กานต์|@example/);

    const retry = await updateDisplayNameAction({ name: 'กานต์ เทรดเดอร์' });
    expect(retry).toEqual({
      ok: true,
      data: { changed: false, name: 'กานต์ เทรดเดอร์' },
    });
    expect(authState.updateUser).toHaveBeenCalledOnce();
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, user.id)),
    ).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(changed))).toEqual(changed);
  });

  it('returns closed unauthenticated and strict validation failures', async () => {
    expect(await updateDisplayNameAction({ name: 'Someone' })).toEqual({
      ok: false,
      error: { code: 'unauthenticated' },
    });
    expect(
      await updateDisplayNameAction({ name: 'Someone', email: 'forged@example.test' }),
    ).toEqual({
      ok: false,
      error: { code: 'validation_error', fieldErrors: {} },
    });
  });
});

describe('account-level preference Settings (real PostgreSQL)', () => {
  it('changes timezone with updatedAt and a field-name-only audit, then no-ops exactly', async () => {
    const db = getTestDb();
    const user = await createUserWithPreferences(db, 'Timezone Tester');
    const clock = createFixedClock(new Date('2026-02-01T00:00:00.000Z'));

    const changed = await updateUserPreferences(user.id, { timezone: 'Asia/Bangkok' }, { clock });
    expect(changed).toEqual({ changed: true, changedFields: ['timezone'] });
    const first = await db
      .select({ timezone: userPreferences.timezone, updatedAt: userPreferences.updatedAt })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id));
    expect(first[0]).toEqual({
      timezone: 'Asia/Bangkok',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(
      await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.actorUserId, user.id)),
    ).toEqual([
      {
        action: 'user_preferences.timezone_changed',
        metadata: { changedFields: ['timezone'] },
      },
    ]);

    clock.set(new Date('2026-03-01T00:00:00.000Z'));
    expect(await updateUserPreferences(user.id, { timezone: 'Asia/Bangkok' }, { clock })).toEqual({
      changed: false,
      changedFields: [],
    });
    const second = await db
      .select({ updatedAt: userPreferences.updatedAt })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id));
    expect(second[0]?.updatedAt).toEqual(new Date('2026-02-01T00:00:00.000Z'));
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.actorUserId, user.id)),
    ).toHaveLength(1);
  });

  it('persists only changed locale/theme fields and never another user row', async () => {
    const db = getTestDb();
    const actor = await createUserWithPreferences(db, 'Actor');
    const other = await createUserWithPreferences(db, 'Other');
    setSession(actor);

    expect(await syncPreferences({ locale: 'th', theme: 'dark' })).toEqual({
      ok: true,
      data: { changed: true, changedFields: ['locale', 'theme'] },
    });
    expect(authState.cookieSet).toHaveBeenCalledWith('NEXT_LOCALE', 'th', {
      path: '/',
      sameSite: 'lax',
    });
    const rows = await db
      .select({
        userId: userPreferences.userId,
        locale: userPreferences.locale,
        theme: userPreferences.theme,
      })
      .from(userPreferences)
      .where(inArray(userPreferences.userId, [actor.id, other.id]));
    expect(rows.find((row) => row.userId === actor.id)).toMatchObject({
      locale: 'th',
      theme: 'dark',
    });
    expect(rows.find((row) => row.userId === other.id)).toMatchObject({
      locale: 'en',
      theme: 'system',
    });
    /*
      ORDER BY, BECAUSE THIS ASSERTION IS ABOUT ORDER.

      This read had no ordering at all and was asserted with an
      order-sensitive `toEqual`, so for twenty-five days it was checking
      what PostgreSQL felt like returning. `audit_logs` carries exactly one
      index — `(workspace_id, created_at)` — and nothing on
      `actor_user_id`, so this is a sequential scan whose row order no
      contract covers. On 2026-09-03 it stopped agreeing: CI returned
      theme-then-locale on two consecutive runs of an unchanged commit
      while this same test returned locale-then-theme locally.

      `created_at` cannot break the tie. Both rows are written in one
      transaction (`user-preferences.ts`, a loop over `changedFields`) and
      `defaultNow()` is transaction start time, so they share a timestamp
      exactly. `id` is the only monotonic column: UUIDv7, generated per
      insert, so ordering by it IS ordering by the sequence the writes
      happened in — which is the thing this test means to assert.
    */
    const events = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.actorUserId, actor.id))
      .orderBy(auditLogs.id);
    expect(events).toEqual([
      { action: 'user_preferences.locale_changed', metadata: { changedFields: ['locale'] } },
      { action: 'user_preferences.theme_changed', metadata: { changedFields: ['theme'] } },
    ]);
  });

  it('rejects invalid timezone and active context injection with closed JSON-safe results', async () => {
    const db = getTestDb();
    const user = await createUserWithPreferences(db, 'Validation Tester');
    setSession(user);
    const invalid = await updateTimezonePreferenceAction({ timezone: 'Mars/Olympus' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid_timezone' } });
    const forged = await syncPreferences({
      theme: 'dark',
      activeWorkspaceId: crypto.randomUUID(),
      activeTradingAccountId: crypto.randomUUID(),
    });
    expect(forged).toEqual({
      ok: false,
      error: { code: 'validation_error', fieldErrors: {} },
    });
    expect(JSON.parse(JSON.stringify([invalid, forged]))).toEqual([invalid, forged]);
  });

  it('denies an unauthenticated timezone write without requiring workspace context', async () => {
    expect(await updateTimezonePreferenceAction({ timezone: 'Asia/Bangkok' })).toEqual({
      ok: false,
      error: { code: 'unauthenticated' },
    });
  });

  it('rolls back preference persistence when audit writing fails', async () => {
    const db = getTestDb();
    const user = await createUserWithPreferences(db, 'Rollback Tester');
    await expect(
      updateUserPreferences(
        user.id,
        { timezone: 'Europe/London' },
        {
          clock: createFixedClock(new Date('2026-04-01T00:00:00.000Z')),
          auditWriter: async () => {
            throw new Error('intentional audit failure');
          },
        },
      ),
    ).rejects.toThrow('intentional audit failure');

    const rows = await db
      .select({ timezone: userPreferences.timezone, updatedAt: userPreferences.updatedAt })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id));
    expect(rows[0]).toEqual({ timezone: 'UTC', updatedAt: user.initialUpdatedAt });
  });

  it('does not rewrite stored Trade timestamps when timezone changes', async () => {
    const db = getTestDb();
    const user = await createUserWithPreferences(db, 'Timestamp Tester');
    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: 'Timestamp workspace',
        slug: `settings-time-${crypto.randomUUID()}`,
        kind: 'personal',
        personalOwnerUserId: user.id,
        onboardingCompletedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      .returning({ id: workspaces.id });
    if (workspace === undefined) throw new Error('failed to seed timestamp workspace');
    const [account] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId: workspace.id,
        name: 'Timestamp account',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000',
        timezone: 'UTC',
      })
      .returning({ id: tradingAccounts.id });
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: workspace.id })
      .returning({ id: strategies.id });
    if (account === undefined || strategy === undefined)
      throw new Error('failed to seed framework');
    const [version] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 1,
        name: 'Timestamp strategy',
      })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('failed to seed strategy version');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: workspace.id, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('failed to seed setup');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        name: 'Timestamp setup',
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('failed to seed setup version');
    const originalCreatedAt = new Date('2025-12-31T23:30:00.000Z');
    const originalUpdatedAt = new Date('2026-01-01T00:15:00.000Z');
    const [trade] = await db
      .insert(trades)
      .values({
        workspaceId: workspace.id,
        tradingAccountId: account.id,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        symbol: 'TEST',
        direction: 'long',
        plannedEntry: '100',
        plannedStop: '90',
        createdAt: originalCreatedAt,
        updatedAt: originalUpdatedAt,
      })
      .returning({ id: trades.id });
    if (trade === undefined) throw new Error('failed to seed Trade');

    await updateUserPreferences(user.id, { timezone: 'Asia/Bangkok' });

    const stored = await db
      .select({ createdAt: trades.createdAt, updatedAt: trades.updatedAt })
      .from(trades)
      .where(eq(trades.id, trade.id));
    expect(stored[0]).toEqual({ createdAt: originalCreatedAt, updatedAt: originalUpdatedAt });
  });
});
