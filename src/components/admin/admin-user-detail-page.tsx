import { Users } from 'lucide-react';
import Link from 'next/link';

import { formatUtcDateTime } from '@/lib/admin/format';
import type { EntitlementStatus } from '@/lib/entitlements/resolve';
import type { AdminUserDetail } from '@/server/services/admin/user-oversight';
import { EmptyState } from '@/components/product/empty-state';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroller,
} from '@/components/ui/table';

import { adminCopy } from './admin-copy';

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
 * The Phase 11D User detail — renders directly from `AdminUserDetail`, the
 * strict DTO `getAdminUserDetail()` returns. No session, no verification
 * secret, no auth-provider account identifier, no Trade content, and no
 * mutation affordance (button, form, server action) exists anywhere on this
 * page — Phase 11D is read-only by contract.
 */
export function AdminUserDetailPage({ user }: { user: AdminUserDetail }) {
  const c = adminCopy.users.detail;
  const s = adminCopy.subscriptionLabels;
  const p = adminCopy.providerLabels;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/users"
          className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
        >
          ← {c.backToList}
        </Link>
        <h1 className="text-page-title break-words">{user.name}</h1>
      </div>

      <section
        aria-labelledby="admin-user-identity-heading"
        className="border-border bg-card rounded-xl border p-5 sm:p-6"
      >
        <h2 id="admin-user-identity-heading" className="text-card-title mb-4">
          {c.identityTitle}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={c.nameLabel} value={user.name} />
          <Fact label={c.emailLabel} value={user.email} />
          <Fact
            label={c.verifiedLabel}
            value={user.emailVerified ? adminCopy.users.verifiedYes : adminCopy.users.verifiedNo}
          />
          <Fact label={c.createdLabel} value={formatUtcDateTime(user.createdAt)} />
        </dl>
        <div className="mt-4">
          <dt className="text-muted-foreground text-xs uppercase">{c.signInMethodsLabel}</dt>
          <dd className="mt-2 flex flex-wrap gap-2">
            {user.providers.length === 0 ? (
              <span className="text-muted-foreground text-sm">{c.noSignInMethods}</span>
            ) : (
              user.providers.map((provider) => (
                <Badge key={provider} variant="neutral">
                  {p[provider]}
                </Badge>
              ))
            )}
          </dd>
        </div>
      </section>

      <section aria-labelledby="admin-user-workspaces-heading" className="flex flex-col gap-4">
        <h2 id="admin-user-workspaces-heading" className="text-card-title">
          {c.workspacesTitle}
        </h2>
        {user.workspaces.length === 0 ? (
          <EmptyState
            icon={Users}
            title={c.workspacesEmptyTitle}
            description={c.workspacesEmptyDescription}
            action={null}
          />
        ) : (
          <TableScroller label={c.workspacesTitle}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.columns.workspace}</TableHead>
                  <TableHead>{c.columns.role}</TableHead>
                  <TableHead>{c.columns.status}</TableHead>
                  <TableHead>{c.columns.plan}</TableHead>
                  <TableHead>{c.columns.source}</TableHead>
                  <TableHead>{c.columns.created}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {user.workspaces.map((membership) => (
                  <TableRow key={membership.workspaceId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/workspaces/${membership.workspaceId}`}
                        className="hover:underline focus-visible:underline"
                      >
                        {membership.workspaceName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {membership.role === 'owner' ? c.roleOwner : c.roleMember}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          membership.effectiveStatus === null
                            ? 'neutral'
                            : STATUS_VARIANT[membership.effectiveStatus]
                        }
                      >
                        {membership.effectiveStatus === null
                          ? s.unknown
                          : s.status[membership.effectiveStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {membership.effectivePlanKey === null
                        ? s.plan.none
                        : s.plan[membership.effectivePlanKey]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {membership.source === null ? s.unknown : s.source[membership.source]}
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {formatUtcDateTime(membership.workspaceCreatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroller>
        )}
      </section>
    </div>
  );
}

export function AdminUserDetailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-4 w-24 rounded-md" />
        <div className="bg-muted h-8 w-64 rounded-md" />
      </div>
      <div className="bg-card border-border h-48 rounded-xl border" />
      <div className="flex flex-col gap-4">
        <div className="bg-muted h-6 w-48 rounded-md" />
        <div className="bg-card border-border h-64 rounded-lg border" />
      </div>
    </div>
  );
}
