import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { generateId } from '@/lib/identifiers';
import { billingTransactions, users, workspaces } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';
import { BILLING_HISTORY_PAGE_SIZE, readWorkspaceBillingHistory } from './billing-history';

const userIds: string[] = [];
const workspaceIds: string[] = [];

async function createWorkspace() {
  const db = getTestDb();
  const [user] = await db
    .insert(users)
    .values({
      name: 'Billing history',
      email: `billing-history-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user fixture failed');
  userIds.push(user.id);
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Billing history workspace',
      slug: `billing-history-${crypto.randomUUID()}`,
      personalOwnerUserId: user.id,
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace fixture failed');
  workspaceIds.push(workspace.id);
  return workspace.id;
}

function snapshot(
  workspaceId: string,
  overrides: Partial<typeof billingTransactions.$inferInsert> = {},
): typeof billingTransactions.$inferInsert {
  return {
    id: generateId(),
    workspaceId,
    idempotencyKey: crypto.randomUUID(),
    planKey: 'starter',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    subtotalMinor: 500n,
    vatEnabled: false,
    appliedVatRateBasisPoints: 0,
    vatAmountMinor: 0n,
    totalMinor: 500n,
    taxMode: 'disabled',
    providerKind: 'mock',
    status: 'succeeded',
    ...overrides,
  };
}

afterEach(async () => {
  const db = getTestDb();
  for (const workspaceId of workspaceIds.splice(0)) {
    await db.delete(billingTransactions).where(eq(billingTransactions.workspaceId, workspaceId));
  }
  for (const userId of userIds.splice(0)) await db.delete(users).where(eq(users.id, userId));
});

afterAll(async () => {
  await closeDb();
  await closeTestDb();
});

describe('billing history query (real PostgreSQL)', () => {
  it('returns only immutable workspace snapshots and omits provider/internal fields', async () => {
    const ownWorkspace = await createWorkspace();
    const otherWorkspace = await createWorkspace();
    const exactLargeAmount = 9_007_199_254_740_993n;
    await getTestDb()
      .insert(billingTransactions)
      .values([
        snapshot(ownWorkspace, {
          planKey: 'professional',
          subtotalMinor: exactLargeAmount,
          vatEnabled: true,
          appliedVatRateBasisPoints: 700,
          vatAmountMinor: 630_503_947_831_869n,
          totalMinor: 9_637_703_202_572_862n,
          taxMode: 'exclusive',
          providerCheckoutId: `secret-checkout-${crypto.randomUUID()}`,
          providerPaymentId: `secret-payment-${crypto.randomUUID()}`,
          status: 'failed',
          failureCode: 'raw-secret-provider-decline',
          failedAt: new Date(),
        }),
        snapshot(ownWorkspace, { status: 'processing' }),
        snapshot(ownWorkspace, { status: 'canceled', completedAt: new Date() }),
        snapshot(otherWorkspace, { status: 'succeeded' }),
      ]);

    const history = await readWorkspaceBillingHistory(getTestDb(), ownWorkspace, 1);
    expect(history.items).toHaveLength(3);
    expect(history.items.map((item) => item.status).sort()).toEqual([
      'canceled',
      'failed',
      'processing',
    ]);
    const vatRow = history.items.find((item) => item.status === 'failed');
    expect(vatRow).toMatchObject({
      planName: 'Professional',
      subtotal: { amountMinor: exactLargeAmount.toString() },
      vat: { ratePercent: '7', amount: { amountMinor: '630503947831869' } },
      total: { amountMinor: '9637703202572862' },
      failureMessageKey: 'payment_failed',
    });
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain('raw-secret-provider-decline');
    expect(serialized).not.toContain('secret-checkout');
    expect(serialized).not.toContain('secret-payment');
    expect(serialized).not.toContain('idempotency');
  });

  it('paginates at 20 with deterministic newest-first ordering and bounded input', async () => {
    const workspaceId = await createWorkspace();
    const createdAt = new Date('2026-08-05T00:00:00Z');
    const rows = Array.from({ length: BILLING_HISTORY_PAGE_SIZE + 3 }, (_, index) =>
      snapshot(workspaceId, {
        id: generateId(),
        createdAt: new Date(createdAt.getTime() + Math.floor(index / 2) * 1000),
        status: index % 2 === 0 ? 'succeeded' : 'failed',
        failedAt: index % 2 === 0 ? null : createdAt,
      }),
    );
    await getTestDb().insert(billingTransactions).values(rows);

    const first = await readWorkspaceBillingHistory(getTestDb(), workspaceId, 1);
    const second = await readWorkspaceBillingHistory(getTestDb(), workspaceId, 2);
    expect(first).toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 23,
      totalPages: 2,
      hasNextPage: true,
    });
    expect(second.items).toHaveLength(3);
    expect(new Set([...first.items, ...second.items].map((item) => item.transactionId)).size).toBe(
      23,
    );
    const ordered = [...rows].sort(
      (left, right) =>
        right.createdAt!.getTime() - left.createdAt!.getTime() ||
        String(right.id).localeCompare(String(left.id)),
    );
    expect([...first.items, ...second.items].map((item) => item.transactionId)).toEqual(
      ordered.map((row) => row.id),
    );
    expect((await readWorkspaceBillingHistory(getTestDb(), workspaceId, -5)).page).toBe(1);
    expect((await readWorkspaceBillingHistory(getTestDb(), workspaceId, 50_000)).page).toBe(1);
  });
});
