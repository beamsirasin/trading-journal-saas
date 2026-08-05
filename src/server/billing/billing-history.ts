import 'server-only';

import { count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getPlanDefinition, isPlanKey } from '@/config/plan-catalog';
import type {
  BillingHistoryItem,
  BillingHistoryPresentation,
  BillingHistoryStatus,
} from '@/lib/billing/subscription-management-types';
import type { BillingCurrency, BillingInterval } from '@/lib/billing/types';
import { formatMoney } from '@/lib/money';
import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { getDb, type Database } from '@/server/db/client';
import { billingTransactions } from '@/server/db/schema';

export const BILLING_HISTORY_PAGE_SIZE = 20;

const pageSchema = z.coerce.number().int().min(1).max(10_000);

export function parseBillingHistoryPage(value: unknown): number {
  const parsed = pageSchema.safeParse(value ?? 1);
  return parsed.success ? parsed.data : 1;
}

function ratePercent(rateBasisPoints: number): string {
  const whole = Math.trunc(rateBasisPoints / 100);
  const fraction = rateBasisPoints % 100;
  return fraction === 0 ? whole.toString() : `${whole}.${fraction.toString().padStart(2, '0')}`;
}

function money(amountMinor: bigint, currency: BillingCurrency) {
  return Object.freeze({
    amountMinor: amountMinor.toString(),
    formatted: formatMoney({ amountMinor, currency }, { style: 'symbol' }),
  });
}

type BillingHistoryExecutor = Pick<Database, 'select'>;

export async function readWorkspaceBillingHistory(
  db: BillingHistoryExecutor,
  workspaceId: string,
  page: number,
): Promise<BillingHistoryPresentation> {
  const safePage = parseBillingHistoryPage(page);
  const [totalRow] = await db
    .select({ value: count() })
    .from(billingTransactions)
    .where(eq(billingTransactions.workspaceId, workspaceId));
  const totalItems = totalRow?.value ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / BILLING_HISTORY_PAGE_SIZE));
  const rows = await db
    .select({
      id: billingTransactions.id,
      planKey: billingTransactions.planKey,
      billingCurrency: billingTransactions.billingCurrency,
      billingInterval: billingTransactions.billingInterval,
      subtotalMinor: billingTransactions.subtotalMinor,
      vatEnabled: billingTransactions.vatEnabled,
      appliedVatRateBasisPoints: billingTransactions.appliedVatRateBasisPoints,
      vatAmountMinor: billingTransactions.vatAmountMinor,
      totalMinor: billingTransactions.totalMinor,
      providerKind: billingTransactions.providerKind,
      status: billingTransactions.status,
      createdAt: billingTransactions.createdAt,
      completedAt: billingTransactions.completedAt,
      failedAt: billingTransactions.failedAt,
    })
    .from(billingTransactions)
    .where(eq(billingTransactions.workspaceId, workspaceId))
    .orderBy(desc(billingTransactions.createdAt), desc(billingTransactions.id))
    .limit(BILLING_HISTORY_PAGE_SIZE)
    .offset((safePage - 1) * BILLING_HISTORY_PAGE_SIZE);

  const items = rows.map((row): BillingHistoryItem => {
    if (!isPlanKey(row.planKey)) throw new Error('Billing history contains an unsupported plan');
    if (row.billingCurrency !== 'THB' && row.billingCurrency !== 'USD') {
      throw new Error('Billing history contains an unsupported currency');
    }
    if (row.billingInterval !== 'monthly') {
      throw new Error('Billing history contains an unsupported interval');
    }
    const status = row.status as BillingHistoryStatus;
    const currency = row.billingCurrency as BillingCurrency;
    return Object.freeze({
      transactionId: row.id,
      createdAt: row.createdAt.toISOString(),
      completedOrFailedAt: (row.completedAt ?? row.failedAt)?.toISOString() ?? null,
      planKey: row.planKey,
      planName: getPlanDefinition(row.planKey).name,
      currency,
      billingInterval: row.billingInterval as BillingInterval,
      subtotal: money(row.subtotalMinor, currency),
      vat: row.vatEnabled
        ? Object.freeze({
            ratePercent: ratePercent(row.appliedVatRateBasisPoints),
            amount: money(row.vatAmountMinor, currency),
          })
        : null,
      total: money(row.totalMinor, currency),
      status,
      failureMessageKey: status === 'failed' ? 'payment_failed' : null,
      canResumeProcessing:
        row.providerKind === 'mock' && ['created', 'pending', 'processing'].includes(status),
    });
  });

  return Object.freeze({
    items: Object.freeze(items),
    page: safePage,
    pageSize: BILLING_HISTORY_PAGE_SIZE,
    totalItems,
    totalPages,
    hasPreviousPage: safePage > 1,
    hasNextPage: safePage < totalPages,
  });
}

export async function getBillingHistoryPresentation(
  requestedPage: unknown,
): Promise<BillingHistoryPresentation> {
  const { workspaceId } = await getActiveWorkspaceContext();
  return readWorkspaceBillingHistory(getDb(), workspaceId, parseBillingHistoryPage(requestedPage));
}
