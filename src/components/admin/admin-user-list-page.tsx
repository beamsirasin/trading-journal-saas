import { UsersRound } from 'lucide-react';
import Link from 'next/link';

import { formatUtcDateTime } from '@/lib/admin/format';
import type { EntitlementStatus } from '@/lib/entitlements/resolve';
import type { AdminUserListPage as AdminUserListPageDto } from '@/server/services/admin/user-oversight';
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
import { AdminPaginationNav } from './admin-pagination-nav';
import { AdminUserSearchForm } from './admin-user-search-form';

const STATUS_VARIANT: Record<EntitlementStatus, BadgeVariant> = {
  trialing: 'brand',
  active: 'positive',
  expired: 'negative',
  canceled: 'negative',
};

/**
 * The Phase 11D Users list — renders directly from `AdminUserListPage`, the
 * strict DTO `getAdminUserList()` returns. No password hash, session, OAuth
 * token, IP, or Trade content ever reaches this component (Phase 11D's
 * locked privacy contract) — the DTO shape itself makes that impossible to
 * violate here.
 */
export function AdminUserListPage({
  page,
  query,
  hasCursor,
}: {
  page: AdminUserListPageDto;
  query: string;
  hasCursor: boolean;
}) {
  const c = adminCopy.users;
  const s = adminCopy.subscriptionLabels;

  const nextHref =
    page.nextCursor === null
      ? null
      : `/admin/users?cursor=${encodeURIComponent(page.nextCursor)}${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{c.title}</h1>
        <p className="text-muted-foreground text-sm">{c.description}</p>
      </div>

      <AdminUserSearchForm
        initialQuery={query}
        label={c.searchLabel}
        placeholder={c.searchPlaceholder}
        submitLabel={c.searchButton}
      />

      {page.items.length === 0 ? (
        <EmptyState
          icon={UsersRound}
          title={c.emptyTitle}
          description={c.emptyDescription}
          action={
            query === '' ? null : (
              <Link
                href="/admin/users"
                className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
              >
                {c.clearSearch}
              </Link>
            )
          }
        />
      ) : (
        <>
          <TableScroller label={c.title}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.columns.name}</TableHead>
                  <TableHead>{c.columns.email}</TableHead>
                  <TableHead>{c.columns.verified}</TableHead>
                  <TableHead>{c.columns.workspaces}</TableHead>
                  <TableHead>{c.columns.created}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((user) => (
                  <TableRow key={user.userId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/users/${user.userId}`}
                        className="hover:underline focus-visible:underline"
                      >
                        {user.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={user.emailVerified ? 'positive' : 'neutral'}>
                        {user.emailVerified ? c.verifiedYes : c.verifiedNo}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.workspaceSummary.kind === 'none' ? (
                        <span className="text-muted-foreground">{c.workspaceNone}</span>
                      ) : user.workspaceSummary.kind === 'multiple' ? (
                        <span className="text-muted-foreground">
                          {user.workspaceSummary.count} {c.columns.workspaces.toLowerCase()}
                        </span>
                      ) : (
                        <Badge
                          variant={
                            user.workspaceSummary.effectiveStatus === null
                              ? 'neutral'
                              : STATUS_VARIANT[user.workspaceSummary.effectiveStatus]
                          }
                        >
                          {user.workspaceSummary.effectiveStatus === null
                            ? s.unknown
                            : s.status[user.workspaceSummary.effectiveStatus]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {formatUtcDateTime(user.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroller>

          <AdminPaginationNav
            ariaLabel={c.pagination.label}
            hasCursor={hasCursor}
            nextHref={nextHref}
            previousLabel={c.pagination.previous}
            nextLabel={c.pagination.next}
          />
        </>
      )}
    </div>
  );
}

export function AdminUserListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-8 w-40 rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full rounded-md" />
      </div>
      <div className="bg-muted h-11 w-full rounded-md" />
      <div className="bg-card border-border h-96 rounded-lg border" />
    </div>
  );
}
