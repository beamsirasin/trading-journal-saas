import Link from 'next/link';

import { formatUtcDateTime } from '@/lib/admin/format';
import type { EntitlementStatus } from '@/lib/entitlements/resolve';
import type { AdminWorkspaceDetail } from '@/server/services/admin/workspace-oversight';
import { Badge, type BadgeVariant } from '@/components/ui/badge';

import { adminCopy } from './admin-copy';
import { AdminSubscriptionSupport } from './admin-subscription-support';

const STATUS_VARIANT: Record<EntitlementStatus, BadgeVariant> = {
  trialing: 'brand',
  active: 'positive',
  expired: 'negative',
  canceled: 'negative',
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="text-foreground mt-1 text-sm font-semibold break-words">{value}</dd>
    </div>
  );
}

/**
 * The Phase 11D Workspace detail — renders directly from
 * `AdminWorkspaceDetail`, the strict DTO `getAdminWorkspaceDetail()`
 * returns. No Strategy name, no Trade row or content, no payment-provider
 * identifier, no idempotency key, no raw billing-provider payload — only the
 * same sanitized billing-transaction shape Phase 10's Workspace export
 * already uses. No mutation affordance exists anywhere on this page.
 */
export function AdminWorkspaceDetailPage({ workspace }: { workspace: AdminWorkspaceDetail }) {
  const c = adminCopy.workspaces.detail;
  const s = adminCopy.subscriptionLabels;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/workspaces"
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          ← {c.backToList}
        </Link>
        <h1 className="text-page-title break-words">{workspace.name}</h1>
      </div>

      <section
        aria-labelledby="admin-workspace-identity-heading"
        className="border-border bg-card rounded-xl border p-5 sm:p-6"
      >
        <h2 id="admin-workspace-identity-heading" className="text-card-title mb-4">
          {c.identityTitle}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={c.nameLabel} value={workspace.name} />
          <Fact label={c.kindLabel} value={workspace.kind} />
          <Fact label={c.createdLabel} value={formatUtcDateTime(workspace.createdAt)} />
          <Fact
            label={c.ownerTitle}
            value={
              workspace.owner.kind === 'single'
                ? `${workspace.owner.name} (${workspace.owner.email})`
                : workspace.owner.kind === 'multiple'
                  ? `${workspace.owner.count} owners`
                  : adminCopy.workspaces.ownerNone
            }
          />
        </dl>
      </section>

      <section
        aria-labelledby="admin-workspace-usage-heading"
        className="border-border bg-card rounded-xl border p-5 sm:p-6"
      >
        <h2 id="admin-workspace-usage-heading" className="text-card-title mb-4">
          {c.usageTitle}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact
            label={c.accountsLabel}
            value={`${workspace.tradingAccounts.active} ${c.accountsActive} · ${workspace.tradingAccounts.archived} ${c.accountsArchived}`}
          />
          <Fact
            label={c.strategiesLabel}
            value={`${workspace.strategies.total} (${workspace.strategies.archived} ${c.strategiesArchived})`}
          />
          <Fact
            label={c.tradesLabel}
            value={`${workspace.trades.total} (${workspace.trades.softDeleted} ${c.tradesSoftDeleted})`}
          />
        </dl>
      </section>

      <section
        aria-labelledby="admin-workspace-subscription-heading"
        className="border-border bg-card rounded-xl border p-5 sm:p-6"
      >
        <h2
          id="admin-workspace-subscription-heading"
          className="text-card-title mb-4 flex items-center gap-3"
        >
          {c.subscriptionTitle}
          <Badge
            variant={
              workspace.subscription.effectiveStatus === null
                ? 'neutral'
                : STATUS_VARIANT[workspace.subscription.effectiveStatus]
            }
          >
            {workspace.subscription.effectiveStatus === null
              ? s.unknown
              : s.status[workspace.subscription.effectiveStatus]}
          </Badge>
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label={c.planLabel}
            value={
              workspace.subscription.effectivePlanKey === null
                ? s.plan.none
                : s.plan[workspace.subscription.effectivePlanKey]
            }
          />
          <Fact
            label={c.sourceLabel}
            value={
              workspace.subscription.source === null
                ? s.unknown
                : s.source[workspace.subscription.source]
            }
          />
          <Fact
            label={c.trialEndsLabel}
            value={
              workspace.subscription.trialEndsAt === null
                ? '—'
                : formatUtcDateTime(workspace.subscription.trialEndsAt)
            }
          />
          <Fact
            label={c.periodEndsLabel}
            value={
              workspace.subscription.currentPeriodEndsAt === null
                ? '—'
                : formatUtcDateTime(workspace.subscription.currentPeriodEndsAt)
            }
          />
        </dl>
      </section>

      <AdminSubscriptionSupport
        workspaceId={workspace.workspaceId}
        source={workspace.subscription.source}
        trialEndsAt={workspace.subscription.trialEndsAt}
      />

      <section
        aria-labelledby="admin-workspace-billing-heading"
        className="border-border bg-card rounded-xl border p-5 sm:p-6"
      >
        <h2 id="admin-workspace-billing-heading" className="text-card-title mb-4">
          {c.billingTitle}
        </h2>
        {workspace.billing.latestTransaction === null ? (
          <p className="text-muted-foreground text-sm">{c.billingNoTransactions}</p>
        ) : (
          <>
            <p className="text-muted-foreground mb-4 text-xs">
              {workspace.billing.transactionCount} {c.billingTransactionCountSuffix}
            </p>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact
                label={c.billingPlanLabel}
                value={
                  workspace.billing.latestTransaction.planKey in s.plan
                    ? s.plan[workspace.billing.latestTransaction.planKey as keyof typeof s.plan]
                    : workspace.billing.latestTransaction.planKey
                }
              />
              <Fact
                label={c.billingIntervalLabel}
                value={workspace.billing.latestTransaction.billingInterval}
              />
              <Fact
                label={c.billingSubtotalLabel}
                value={workspace.billing.latestTransaction.subtotal}
              />
              <Fact
                label={c.billingVatLabel}
                value={workspace.billing.latestTransaction.vatAmount}
              />
              <Fact label={c.billingTotalLabel} value={workspace.billing.latestTransaction.total} />
              <Fact
                label={c.billingStatusLabel}
                value={workspace.billing.latestTransaction.status}
              />
              <Fact
                label={c.billingCreatedLabel}
                value={formatUtcDateTime(workspace.billing.latestTransaction.createdAt)}
              />
            </dl>
          </>
        )}
      </section>
    </div>
  );
}

export function AdminWorkspaceDetailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-4 w-24 rounded-md" />
        <div className="bg-muted h-8 w-64 rounded-md" />
      </div>
      <div className="bg-card border-border h-40 rounded-xl border" />
      <div className="bg-card border-border h-32 rounded-xl border" />
      <div className="bg-card border-border h-40 rounded-xl border" />
      <div className="bg-card border-border h-40 rounded-xl border" />
    </div>
  );
}
