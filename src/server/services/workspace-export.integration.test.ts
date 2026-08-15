import { and, eq, inArray } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceExportCsvZip,
  createWorkspaceExportEnvelope,
  serializeWorkspaceExportJson,
} from '@/lib/export/workspace-export';
import { createFixedClock } from '@/lib/time';
import type { WorkspaceExportAccessError } from '@/server/dal/workspace-export';
import { closeDb } from '@/server/db/client';
import {
  accounts,
  auditLogs,
  billingTransactions,
  emotionTypes,
  mistakeTypes,
  sessions,
  setupConditions,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  userPreferences,
  users,
  verifications,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

const authState = vi.hoisted(() => ({
  context: null as null | {
    workspaceId: string;
    workspaceName: string;
    role: 'owner';
    userId: string;
    onboardingCompletedAt: Date | null;
  },
}));

vi.mock('@/server/auth/dal', () => ({
  getActiveWorkspaceContext: async () => {
    if (authState.context === null) throw new Error('test context missing');
    return authState.context;
  },
}));

const { readWorkspaceExportSource } = await import('@/server/dal/workspace-export');
const { prepareCurrentWorkspaceExport } = await import('./workspace-export');

type Db = ReturnType<typeof getTestDb>;
const NOW = new Date('2026-08-09T12:00:00.000Z');
const userIds: string[] = [];
const workspaceIds: string[] = [];

const SENTINELS = {
  password: 'PASSWORD_HASH_SENTINEL',
  accessToken: 'ACCESS_TOKEN_SENTINEL',
  refreshToken: 'REFRESH_TOKEN_SENTINEL',
  idToken: 'ID_TOKEN_SENTINEL',
  providerAccount: 'PROVIDER_ACCOUNT_SENTINEL',
  sessionToken: 'SESSION_TOKEN_SENTINEL',
  verification: 'VERIFICATION_VALUE_SENTINEL',
  providerCheckout: 'PROVIDER_CHECKOUT_SENTINEL',
  providerPayment: 'PROVIDER_PAYMENT_SENTINEL',
  audit: 'AUDIT_METADATA_SENTINEL',
  foreign: 'FOREIGN_WORKSPACE_SENTINEL',
} as const;

async function createUser(db: Db, label: string) {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id, name: users.name, email: users.email });
  if (user === undefined) throw new Error('failed to seed export user');
  userIds.push(user.id);
  return user;
}

async function createWorkspace(
  db: Db,
  userId: string,
  label: string,
  options: { readonly onboarding?: boolean; readonly role?: 'owner' | 'member' } = {},
) {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: label,
      slug: `export-${crypto.randomUUID()}`,
      personalOwnerUserId: options.role === 'member' ? null : userId,
      onboardingCompletedAt: options.onboarding === false ? null : NOW,
    })
    .returning({ id: workspaces.id, name: workspaces.name });
  if (workspace === undefined) throw new Error('failed to seed export workspace');
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId,
    role: options.role ?? 'owner',
  });
  await db.insert(userPreferences).values({ userId, activeWorkspaceId: workspace.id });
  return workspace;
}

async function seedHistoricalWorkspace(db: Db) {
  const owner = await createUser(db, 'Export owner');
  const workspace = await createWorkspace(db, owner.id, 'พื้นที่ทำงาน ส่งออก');
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
    currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
  });

  await db.insert(accounts).values({
    userId: owner.id,
    accountId: SENTINELS.providerAccount,
    providerId: 'credential-provider-sentinel',
    password: SENTINELS.password,
    accessToken: SENTINELS.accessToken,
    refreshToken: SENTINELS.refreshToken,
    idToken: SENTINELS.idToken,
  });
  await db.insert(sessions).values({
    userId: owner.id,
    token: SENTINELS.sessionToken,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
  });
  await db.insert(verifications).values({
    identifier: owner.email,
    value: SENTINELS.verification,
    expiresAt: new Date('2027-01-01T00:00:00Z'),
  });

  const [activeAccount, archivedAccount] = await db
    .insert(tradingAccounts)
    .values([
      {
        workspaceId: workspace.id,
        name: 'บัญชีหลัก',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '9999999999.1234567890',
        timezone: 'Asia/Bangkok',
      },
      {
        workspaceId: workspace.id,
        name: '=ARCHIVED_FORMULA',
        accountMode: 'demo',
        baseCurrency: 'THB',
        startingBalance: '5000.0000000000',
        timezone: 'Asia/Bangkok',
        isArchived: true,
      },
    ])
    .returning({ id: tradingAccounts.id, isArchived: tradingAccounts.isArchived });
  if (activeAccount === undefined || archivedAccount === undefined) {
    throw new Error('failed to seed export accounts');
  }
  await db
    .update(userPreferences)
    .set({ activeTradingAccountId: activeAccount.id })
    .where(eq(userPreferences.userId, owner.id));

  const [strategy] = await db
    .insert(strategies)
    .values({ workspaceId: workspace.id, isArchived: true })
    .returning({ id: strategies.id });
  if (strategy === undefined) throw new Error('failed to seed export strategy');
  const [versionOne, versionTwo] = await db
    .insert(strategyVersions)
    .values([
      {
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 1,
        name: 'กลยุทธ์ รุ่นหนึ่ง',
        notes: 'locked history',
      },
      {
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 2,
        name: 'Strategy v2',
        changeNote: 'new confirmation',
      },
    ])
    .returning({ id: strategyVersions.id, versionNumber: strategyVersions.versionNumber });
  if (versionOne === undefined || versionTwo === undefined) {
    throw new Error('failed to seed export versions');
  }
  await db
    .update(strategies)
    .set({ currentVersionId: versionTwo.id })
    .where(eq(strategies.id, strategy.id));

  const [setup] = await db
    .insert(setups)
    .values({ workspaceId: workspace.id, strategyId: strategy.id, isArchived: true })
    .returning({ id: setups.id });
  if (setup === undefined) throw new Error('failed to seed export setup');
  const [setupOne, setupTwo] = await db
    .insert(strategySetupVersions)
    .values([
      {
        workspaceId: workspace.id,
        strategyId: strategy.id,
        strategyVersionId: versionOne.id,
        setupId: setup.id,
        name: 'ตั้งค่า รุ่นหนึ่ง',
      },
      {
        workspaceId: workspace.id,
        strategyId: strategy.id,
        strategyVersionId: versionTwo.id,
        setupId: setup.id,
        name: 'Setup v2',
      },
    ])
    .returning({
      id: strategySetupVersions.id,
      strategyVersionId: strategySetupVersions.strategyVersionId,
    });
  if (setupOne === undefined || setupTwo === undefined) {
    throw new Error('failed to seed export setup versions');
  }

  const [rule] = await db
    .insert(strategyRules)
    .values({
      workspaceId: workspace.id,
      strategyVersionId: versionOne.id,
      setupVersionId: setupOne.id,
      category: 'entry',
      title: '+Confirm trend',
      isRequired: true,
      isPreTradeCheck: true,
    })
    .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
  if (rule === undefined) throw new Error('failed to seed export rule');

  const [condition] = await db
    .insert(setupConditions)
    .values({
      workspaceId: workspace.id,
      setupId: setup.id,
      setupVersionId: setupOne.id,
      label: 'Retest confirmation',
      sortOrder: 4,
    })
    .returning({
      id: setupConditions.id,
      conditionKey: setupConditions.conditionKey,
      label: setupConditions.label,
      sortOrder: setupConditions.sortOrder,
    });
  if (condition === undefined) throw new Error('failed to seed export Setup Condition');

  await db
    .update(strategyVersions)
    .set({ lockedAt: new Date('2026-06-01T00:00:00Z') })
    .where(eq(strategyVersions.id, versionOne.id));

  const [trade] = await db
    .insert(trades)
    .values({
      workspaceId: workspace.id,
      tradingAccountId: archivedAccount.id,
      strategyId: strategy.id,
      strategyVersionId: versionOne.id,
      setupId: setup.id,
      setupVersionId: setupOne.id,
      symbol: 'ทองคำ',
      direction: 'long',
      notes: '@formula-looking note',
      plannedEntry: '100.0000000000',
      plannedStop: '90.0000000000',
      plannedTarget: '110.0000000000',
      plannedR: '1.0000',
      deletedAt: new Date('2026-08-08T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
    })
    .returning({ id: trades.id });
  if (trade === undefined) throw new Error('failed to seed export Trade');

  await db.insert(tradeRuleChecks).values({
    workspaceId: workspace.id,
    tradeId: trade.id,
    strategyRuleId: rule.id,
    strategyVersionId: versionOne.id,
    ruleKey: rule.ruleKey,
    checkStatus: 'violated',
    title: '+Confirm trend',
    category: 'entry',
    isRequired: true,
    isPreTradeCheck: true,
  });
  await db.insert(tradeSetupConditionChecks).values({
    workspaceId: workspace.id,
    tradeId: trade.id,
    setupConditionId: condition.id,
    setupVersionId: setupOne.id,
    conditionKey: condition.conditionKey,
    label: condition.label,
    sortOrder: condition.sortOrder,
    checkStatus: 'met',
  });
  const [systemMistake] = await db
    .select({ id: mistakeTypes.id })
    .from(mistakeTypes)
    .where(eq(mistakeTypes.isSystem, true))
    .limit(1);
  if (systemMistake === undefined) throw new Error('system mistake seed missing');
  await db.insert(tradeMistakes).values({
    workspaceId: workspace.id,
    tradeId: trade.id,
    mistakeTypeId: systemMistake.id,
    note: 'พลาดตามแผน',
    severityAtTime: 'moderate',
    weightAtTime: '1.0000',
  });

  const idempotencyKey = crypto.randomUUID();
  await db.insert(billingTransactions).values({
    workspaceId: workspace.id,
    idempotencyKey,
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    subtotalMinor: 10000000000000001n,
    vatEnabled: true,
    appliedVatRateBasisPoints: 700,
    vatAmountMinor: 700000000000000n,
    totalMinor: 10700000000000001n,
    taxMode: 'exclusive',
    providerKind: 'mock',
    providerCheckoutId: SENTINELS.providerCheckout,
    providerPaymentId: SENTINELS.providerPayment,
    failureCode: 'INTERNAL_FAILURE_SENTINEL',
    status: 'failed',
    failedAt: new Date('2026-08-03T00:00:00Z'),
  });
  await db.insert(auditLogs).values({
    workspaceId: workspace.id,
    actorUserId: owner.id,
    action: 'test.sensitive',
    metadata: { secret: SENTINELS.audit },
  });

  return {
    owner,
    workspace,
    activeAccount,
    archivedAccount,
    strategy,
    versionOne,
    versionTwo,
    setup,
    setupOne,
    trade,
    rule,
    condition,
    systemMistake,
    idempotencyKey,
  };
}

beforeEach(() => {
  authState.context = null;
});

afterEach(async () => {
  const db = getTestDb();
  if (workspaceIds.length > 0) {
    await db
      .delete(billingTransactions)
      .where(inArray(billingTransactions.workspaceId, workspaceIds));
    await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
  }
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds.splice(0)));
  workspaceIds.splice(0);
  await db.delete(verifications).where(eq(verifications.value, SENTINELS.verification));
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
});

describe('workspace export completeness and security (real PostgreSQL)', () => {
  it('exports complete historical relational data for only the active tenant', async () => {
    const db = getTestDb();
    const seeded = await seedHistoricalWorkspace(db);
    const foreignUser = await createUser(db, 'Foreign export user');
    const foreign = await createWorkspace(db, foreignUser.id, SENTINELS.foreign);
    await db.insert(tradingAccounts).values({
      workspaceId: foreign.id,
      name: SENTINELS.foreign,
      accountMode: 'live',
      baseCurrency: 'USD',
      startingBalance: '1',
      timezone: 'UTC',
    });

    const source = await readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id);
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: NOW,
      productVersion: '0.1.0',
      workspaceId: seeded.workspace.id,
      source,
    });
    expect(envelope.data.workspace).toHaveLength(1);
    expect(envelope.data.trading_accounts).toHaveLength(2);
    expect(envelope.data.trading_accounts.some((row) => row.isArchived === true)).toBe(true);
    expect(envelope.data.strategies[0]?.isArchived).toBe(true);
    expect(envelope.data.strategy_versions).toHaveLength(2);
    expect(envelope.data.strategy_versions[0]?.lockedAt).not.toBeNull();
    expect(envelope.data.setups[0]?.isArchived).toBe(true);
    expect(envelope.data.strategy_setup_versions).toHaveLength(2);
    expect(envelope.data.strategy_rules).toHaveLength(1);
    expect(envelope.data.setup_conditions).toHaveLength(1);
    expect(envelope.data.setup_conditions[0]).toMatchObject({
      conditionKey: seeded.condition.conditionKey,
      label: 'Retest confirmation',
      sortOrder: 4,
    });
    expect(envelope.data.trades[0]?.deletedAt).toBe('2026-08-08T00:00:00.000Z');
    expect(envelope.data.trade_rule_checks).toHaveLength(1);
    expect(envelope.data.trade_setup_condition_checks).toHaveLength(1);
    expect(envelope.data.trade_setup_condition_checks[0]).toMatchObject({
      setupConditionId: seeded.condition.id,
      conditionKey: seeded.condition.conditionKey,
      label: 'Retest confirmation',
      sortOrder: 4,
      checkStatus: 'met',
    });
    expect(envelope.data.trade_mistakes).toHaveLength(1);
    expect(envelope.data.mistake_types.some((row) => row.id === seeded.systemMistake.id)).toBe(
      true,
    );

    const strategyIds = new Set(envelope.data.strategies.map((row) => row.id));
    const versionIds = new Set(envelope.data.strategy_versions.map((row) => row.id));
    const setupIds = new Set(envelope.data.setups.map((row) => row.id));
    const ruleIds = new Set(envelope.data.strategy_rules.map((row) => row.id));
    const conditionIds = new Set(envelope.data.setup_conditions.map((row) => row.id));
    const mistakeIds = new Set(envelope.data.mistake_types.map((row) => row.id));
    for (const trade of envelope.data.trades) {
      expect(strategyIds.has(trade.strategyId)).toBe(true);
      expect(versionIds.has(trade.strategyVersionId)).toBe(true);
      expect(setupIds.has(trade.setupId)).toBe(true);
    }
    expect(ruleIds.has(envelope.data.trade_rule_checks[0]?.strategyRuleId)).toBe(true);
    expect(conditionIds.has(envelope.data.trade_setup_condition_checks[0]?.setupConditionId)).toBe(
      true,
    );
    expect(mistakeIds.has(envelope.data.trade_mistakes[0]?.mistakeTypeId)).toBe(true);
    expect(serializeWorkspaceExportJson(envelope)).not.toContain(SENTINELS.foreign);
  });

  it('exports Money-plan/Confidence/Chart-attachment fields truthfully, and NEVER the internal private storage key (migration 0010, Founder review: private storage, no URL column)', async () => {
    const db = getTestDb();
    const seeded = await seedHistoricalWorkspace(db);
    const storageKey = `trade-charts/${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
    await db
      .update(trades)
      .set({
        plannedRiskMinor: 5000n,
        plannedRewardMinor: 15000n,
        confidence: 75,
        chartAttachmentStorageKey: storageKey,
        chartAttachmentUploadedAt: new Date('2026-08-05T00:00:00Z'),
      })
      .where(eq(trades.id, seeded.trade.id));

    const source = await readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id);
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: NOW,
      productVersion: '0.1.0',
      workspaceId: seeded.workspace.id,
      source,
    });
    const exportedTrade = envelope.data.trades.find((row) => row.id === seeded.trade.id);
    expect(exportedTrade).toMatchObject({
      plannedRiskMinor: '5000',
      plannedRewardMinor: '15000',
      confidence: 75,
      hasChartAttachment: true,
      chartAttachmentUploadedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(Object.keys(exportedTrade ?? {})).not.toContain('chartAttachmentStorageKey');
    expect(Object.keys(exportedTrade ?? {})).not.toContain('chartAttachmentUrl');
    expect(serializeWorkspaceExportJson(envelope)).not.toContain(storageKey);
  });

  it('exports Emotion taxonomy, Trade links, capture marker, and Review notes in schema v3', async () => {
    const db = getTestDb();
    const seeded = await seedHistoricalWorkspace(db);
    const [calm] = await db
      .select({ id: emotionTypes.id })
      .from(emotionTypes)
      .where(eq(emotionTypes.key, 'calm'));
    if (calm === undefined) throw new Error('canonical calm Emotion missing');
    await db.insert(tradeEmotions).values({
      tradeId: seeded.trade.id,
      emotionTypeId: calm.id,
      workspaceId: seeded.workspace.id,
    });
    await db
      .update(trades)
      .set({
        emotionsRecordedAt: new Date('2026-08-05T01:00:00Z'),
        reviewNotes: 'A post-trade lesson, distinct from Entry Reason.',
      })
      .where(eq(trades.id, seeded.trade.id));

    const source = await readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id);
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: NOW,
      productVersion: '0.1.0',
      workspaceId: seeded.workspace.id,
      source,
    });
    expect(envelope.schemaVersion).toBe(3);
    expect(envelope.data.emotion_types.find((row) => row.id === calm.id)).toMatchObject({
      key: 'calm',
      isSystem: true,
    });
    expect(envelope.data.trade_emotions).toContainEqual(
      expect.objectContaining({ tradeId: seeded.trade.id, emotionTypeId: calm.id }),
    );
    expect(envelope.data.trades.find((row) => row.id === seeded.trade.id)).toMatchObject({
      reviewNotes: 'A post-trade lesson, distinct from Entry Reason.',
      emotionsRecordedAt: '2026-08-05T01:00:00.000Z',
    });
  });

  it('excludes exact auth, provider, billing-internal and audit sentinels from JSON and ZIP', async () => {
    const seeded = await seedHistoricalWorkspace(getTestDb());
    const source = await readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id);
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: NOW,
      productVersion: '0.1.0',
      workspaceId: seeded.workspace.id,
      source,
    });
    const json = serializeWorkspaceExportJson(envelope);
    const archiveText = Object.values(unzipSync(createWorkspaceExportCsvZip(envelope)))
      .map((bytes) => strFromU8(bytes))
      .join('\n');
    for (const sentinel of Object.values(SENTINELS).filter(
      (value) => value !== SENTINELS.foreign,
    )) {
      expect(json).not.toContain(sentinel);
      expect(archiveText).not.toContain(sentinel);
    }
    expect(json).not.toContain(seeded.idempotencyKey);
    expect(archiveText).not.toContain(seeded.idempotencyKey);
  });

  it('exports only sanitized exact Billing snapshots', async () => {
    const seeded = await seedHistoricalWorkspace(getTestDb());
    const source = await readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id);
    const envelope = createWorkspaceExportEnvelope({
      exportedAt: NOW,
      productVersion: '0.1.0',
      workspaceId: seeded.workspace.id,
      source,
    });
    expect(envelope.data.billing_transactions).toEqual([
      expect.objectContaining({
        workspaceId: seeded.workspace.id,
        planKey: 'professional',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        subtotalMinor: '10000000000000001',
        vatEnabled: true,
        appliedVatRateBasisPoints: 700,
        vatAmountMinor: '700000000000000',
        totalMinor: '10700000000000001',
        status: 'failed',
      }),
    ]);
    expect(Object.keys(envelope.data.billing_transactions[0] ?? {})).not.toEqual(
      expect.arrayContaining([
        'id',
        'idempotencyKey',
        'providerKind',
        'providerCheckoutId',
        'providerPaymentId',
        'failureCode',
      ]),
    );
  });
});

describe('workspace export authorization and auditing (real PostgreSQL)', () => {
  it('allows owners without consulting writable entitlement, including read-only, over-limit and pre-onboarding', async () => {
    const db = getTestDb();
    const seeded = await seedHistoricalWorkspace(db);
    await db
      .update(workspaceEntitlements)
      .set({
        status: 'expired',
        planKey: null,
        billingCurrency: null,
        billingInterval: null,
        currentPeriodStartedAt: null,
        currentPeriodEndsAt: null,
      })
      .where(eq(workspaceEntitlements.workspaceId, seeded.workspace.id));
    await expect(
      readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id),
    ).resolves.toBeDefined();

    await db
      .update(workspaceEntitlements)
      .set({
        status: 'active',
        planKey: 'starter',
        billingCurrency: 'USD',
        billingInterval: 'monthly',
        currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
        currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
      })
      .where(eq(workspaceEntitlements.workspaceId, seeded.workspace.id));
    await expect(
      readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id),
    ).resolves.toBeDefined();

    await db
      .update(workspaces)
      .set({ onboardingCompletedAt: null })
      .where(eq(workspaces.id, seeded.workspace.id));
    await expect(
      readWorkspaceExportSource(seeded.workspace.id, seeded.owner.id),
    ).resolves.toBeDefined();
  });

  it('denies member, removed membership, and foreign workspace targeting', async () => {
    const db = getTestDb();
    const seeded = await seedHistoricalWorkspace(db);
    const member = await createUser(db, 'Export member');
    await db.insert(workspaceMembers).values({
      workspaceId: seeded.workspace.id,
      userId: member.id,
      role: 'member',
    });
    await expect(readWorkspaceExportSource(seeded.workspace.id, member.id)).rejects.toMatchObject({
      code: 'owner_required',
    } satisfies Partial<WorkspaceExportAccessError>);
    await db.delete(workspaceMembers).where(
      inArray(
        workspaceMembers.id,
        (
          await db
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.userId, member.id))
        ).map((row) => row.id),
      ),
    );
    await expect(readWorkspaceExportSource(seeded.workspace.id, member.id)).rejects.toMatchObject({
      code: 'workspace_not_found',
    });

    const foreignUser = await createUser(db, 'Foreign target owner');
    const foreign = await createWorkspace(db, foreignUser.id, 'Foreign target');
    await expect(readWorkspaceExportSource(foreign.id, seeded.owner.id)).rejects.toMatchObject({
      code: 'workspace_not_found',
    });
  });

  it('generates deterministic artifacts and records structural-only export audit events', async () => {
    const db = getTestDb();
    const seeded = await seedHistoricalWorkspace(db);
    authState.context = {
      workspaceId: seeded.workspace.id,
      workspaceName: seeded.workspace.name,
      role: 'owner',
      userId: seeded.owner.id,
      onboardingCompletedAt: NOW,
    };
    const clock = createFixedClock(NOW);
    const json = await prepareCurrentWorkspaceExport('json', { clock });
    const csv = await prepareCurrentWorkspaceExport('csv', { clock });
    expect(JSON.parse(json.body as string).schemaVersion).toBe(3);
    expect(csv.body).toBeInstanceOf(Uint8Array);
    expect(json.filename).toBe('trading-journal-workspace-2026-08-09.json');
    expect(csv.filename).toBe('trading-journal-workspace-2026-08-09.zip');

    const events = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.workspaceId, seeded.workspace.id), eq(auditLogs.action, 'data.exported')),
      );
    expect(events).toEqual([
      {
        action: 'data.exported',
        metadata: { format: 'json', scope: 'workspace', schemaVersion: 3 },
      },
      {
        action: 'data.exported',
        metadata: { format: 'csv', scope: 'workspace', schemaVersion: 3 },
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/พื้นที่ทำงาน|ทองคำ|@example/);
  });

  it('does not return an artifact when required audit persistence fails', async () => {
    const seeded = await seedHistoricalWorkspace(getTestDb());
    authState.context = {
      workspaceId: seeded.workspace.id,
      workspaceName: seeded.workspace.name,
      role: 'owner',
      userId: seeded.owner.id,
      onboardingCompletedAt: NOW,
    };
    await expect(
      prepareCurrentWorkspaceExport('json', {
        clock: createFixedClock(NOW),
        auditWriter: async () => {
          throw new Error('intentional export audit failure');
        },
      }),
    ).rejects.toThrow('intentional export audit failure');
  });
});
