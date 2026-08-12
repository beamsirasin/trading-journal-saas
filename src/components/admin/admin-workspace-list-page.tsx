import { Building2 } from 'lucide-react';
import Link from 'next/link';

import { formatUtcDateTime } from '@/lib/admin/format';
import type { EntitlementStatus } from '@/lib/entitlements/resolve';
import type { AdminWorkspaceListPage as AdminWorkspaceListPageDto } from '@/server/services/admin/workspace-oversight';
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
import { AdminWorkspaceFilterForm } from './admin-workspace-filter-form';

const STATUS_VARIANT: Record<EntitlementStatus, BadgeVariant> = {
  trialing: 'brand',
  active: 'positive',
  expired: 'negative',
  canceled: 'negative',
};

function buildHref(
  base: string,
  params: { q: string; plan: string; source: string; cursor: string | null },
): string {
  const search = new URLSearchParams();
  if (params.q !== '') search.set('q', params.q);
  if (params.plan !== '') search.set('plan', params.plan);
  if (params.source !== '') search.set('source', params.source);
  if (params.cursor !== null) search.set('cursor', params.cursor);
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * The Phase 11D Workspaces list — renders directly from
 * `AdminWorkspaceListPage`, the strict DTO `getAdminWorkspaceList()` returns.
 * No Strategy name, no Trade row, no billing-provider identifier ever
 * reaches this component (Phase 11D's locked privacy contract).
 */
export function AdminWorkspaceListPage({
  page,
  query,
  plan,
  source,
  hasCursor,
}: {
  page: AdminWorkspaceListPageDto;
  query: string;
  plan: string;
  source: string;
  hasCursor: boolean;
}) {
  const c = adminCopy.workspaces;
  const s = adminCopy.subscriptionLabels;

  const nextHref =
    page.nextCursor === null
      ? null
      : buildHref('/admin/workspaces', { q: query, plan, source, cursor: page.nextCursor });

  const hasActiveFilter = query !== '' || plan !== '' || source !== '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{c.title}</h1>
        <p className="text-muted-foreground text-sm">{c.description}</p>
      </div>

      <AdminWorkspaceFilterForm
        initialQuery={query}
        initialPlan={plan}
        initialSource={source}
        copy={{
          searchLabel: c.searchLabel,
          searchPlaceholder: c.searchPlaceholder,
          searchButton: c.searchButton,
          planFilterLabel: c.planFilterLabel,
          sourceFilterLabel: c.sourceFilterLabel,
          allPlans: c.allPlans,
          allSources: c.allSources,
          resetFilters: c.resetFilters,
          planLabels: s.plan,
          sourceLabels: s.source,
        }}
      />

      {page.items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={c.emptyTitle}
          description={c.emptyDescription}
          action={
            hasActiveFilter ? (
              <Link
                href="/admin/workspaces"
                className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
              >
                {c.resetFilters}
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <TableScroller label={c.title}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.columns.name}</TableHead>
                  <TableHead>{c.columns.owner}</TableHead>
                  <TableHead>{c.columns.status}</TableHead>
                  <TableHead>{c.columns.plan}</TableHead>
                  <TableHead>{c.columns.accounts}</TableHead>
                  <TableHead>{c.columns.created}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((workspace) => (
                  <TableRow key={workspace.workspaceId}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/admin/workspaces/${workspace.workspaceId}`}
                        className="hover:underline focus-visible:underline"
                      >
                        {workspace.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {workspace.owner.kind === 'single'
                        ? workspace.owner.email
                        : workspace.owner.kind === 'multiple'
                          ? `${workspace.owner.count} owners`
                          : c.ownerNone}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          workspace.effectiveStatus === null
                            ? 'neutral'
                            : STATUS_VARIANT[workspace.effectiveStatus]
                        }
                      >
                        {workspace.effectiveStatus === null
                          ? s.unknown
                          : s.status[workspace.effectiveStatus]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {workspace.effectivePlanKey === null
                        ? s.plan.none
                        : s.plan[workspace.effectivePlanKey]}
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {workspace.activeTradingAccounts}
                      {workspace.archivedTradingAccounts > 0
                        ? ` (+${workspace.archivedTradingAccounts})`
                        : ''}
                    </TableCell>
                    <TableCell className="numeric text-muted-foreground">
                      {formatUtcDateTime(workspace.createdAt)}
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

export function AdminWorkspaceListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-8 w-48 rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full rounded-md" />
      </div>
      <div className="bg-card border-border h-40 rounded-lg border" />
      <div className="bg-card border-border h-96 rounded-lg border" />
    </div>
  );
}
