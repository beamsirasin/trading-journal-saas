import { ScrollText } from 'lucide-react';
import Link from 'next/link';

import {
  ADMIN_AUDIT_STATE_FIELD_LABELS,
  type AdminAuditStateSnapshot,
} from '@/lib/admin/audit-snapshot';
import { formatUtcDateTime } from '@/lib/admin/format';
import type { AdminAuditListPage as AdminAuditListPageDto } from '@/server/services/admin/audit';
import { EmptyState } from '@/components/product/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroller,
} from '@/components/ui/table';

import { AdminAuditFilterForm } from './admin-audit-filter-form';
import { adminCopy } from './admin-copy';
import { AdminPaginationNav } from './admin-pagination-nav';

function buildHref(
  base: string,
  params: {
    action: string;
    reason: string;
    actor: string;
    subjectUser: string;
    subjectWorkspace: string;
    date: string;
    cursor: string | null;
  },
): string {
  const search = new URLSearchParams();
  if (params.action !== '') search.set('action', params.action);
  if (params.reason !== '') search.set('reason', params.reason);
  if (params.actor !== '') search.set('actor', params.actor);
  if (params.subjectUser !== '') search.set('subjectUser', params.subjectUser);
  if (params.subjectWorkspace !== '') search.set('subjectWorkspace', params.subjectWorkspace);
  if (params.date !== '') search.set('date', params.date);
  if (params.cursor !== null) search.set('cursor', params.cursor);
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

function StructuralFields({ snapshot }: { snapshot: AdminAuditStateSnapshot | null }) {
  if (snapshot === null) return <span className="text-muted-foreground">—</span>;
  const present = ADMIN_AUDIT_STATE_FIELD_LABELS.filter(({ key }) => key in snapshot);
  if (present.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <dl className="flex flex-col gap-1">
      {present.map(({ key, label }) => (
        <div key={key} className="flex gap-1.5 text-xs">
          <dt className="text-muted-foreground">{label}:</dt>
          <dd className="font-medium break-all">{String(snapshot[key] ?? '—')}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The Phase 11E Admin Audit list — renders directly from `AdminAuditListPage`,
 * the strict DTO `getAdminAuditList()` returns. `before`/`after` are already
 * allowlist-parsed (`src/lib/admin/audit-snapshot.ts`) before this component
 * ever sees them — never a raw JSON dump. Read-only: no mutation affordance
 * exists on this page.
 */
export function AdminAuditListPage({
  page,
  action,
  reason,
  actor,
  subjectUser,
  subjectWorkspace,
  date,
  hasCursor,
}: {
  page: AdminAuditListPageDto;
  action: string;
  reason: string;
  actor: string;
  subjectUser: string;
  subjectWorkspace: string;
  date: string;
  hasCursor: boolean;
}) {
  const c = adminCopy.audit;

  const nextHref =
    page.nextCursor === null
      ? null
      : buildHref('/admin/audit', {
          action,
          reason,
          actor,
          subjectUser,
          subjectWorkspace,
          date,
          cursor: page.nextCursor,
        });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{c.title}</h1>
        <p className="text-muted-foreground text-sm">{c.description}</p>
      </div>

      <AdminAuditFilterForm
        initialAction={action}
        initialReason={reason}
        initialActor={actor}
        initialSubjectUser={subjectUser}
        initialSubjectWorkspace={subjectWorkspace}
        initialDate={date}
        copy={{ ...c.filters, actionLabels: c.actionLabels, reasonLabels: c.reasonLabels }}
      />

      {page.items.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={c.emptyTitle}
          description={c.emptyDescription}
          action={null}
        />
      ) : (
        <>
          <TableScroller label={c.title}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{c.columns.timestamp}</TableHead>
                  <TableHead>{c.columns.action}</TableHead>
                  <TableHead>{c.columns.actor}</TableHead>
                  <TableHead>{c.columns.reason}</TableHead>
                  <TableHead>{c.columns.subject}</TableHead>
                  <TableHead>{c.beforeLabel}</TableHead>
                  <TableHead>{c.afterLabel}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.items.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="numeric text-muted-foreground whitespace-nowrap">
                      {formatUtcDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      <Badge variant="neutral">
                        {c.actionLabels[entry.action] ?? entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.actor.kind === 'system'
                        ? c.systemActor
                        : (entry.actor.name ?? entry.actor.email ?? entry.actor.adminGrantId)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.reasonLabels[entry.reasonCode] ?? entry.reasonCode}
                      {entry.reasonNote === null ? null : (
                        <p className="text-muted-foreground mt-1 max-w-xs text-xs break-words">
                          {entry.reasonNote}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {entry.subjectUserId === null && entry.subjectWorkspaceId === null ? (
                        c.noSubject
                      ) : (
                        <div className="flex flex-col gap-1">
                          {entry.subjectUserId === null ? null : (
                            <Link
                              href={`/admin/users/${entry.subjectUserId}`}
                              className="hover:underline focus-visible:underline"
                            >
                              {c.subjectUser}: {entry.subjectUserId}
                            </Link>
                          )}
                          {entry.subjectWorkspaceId === null ? null : (
                            <Link
                              href={`/admin/workspaces/${entry.subjectWorkspaceId}`}
                              className="hover:underline focus-visible:underline"
                            >
                              {c.subjectWorkspace}: {entry.subjectWorkspaceId}
                            </Link>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StructuralFields snapshot={entry.before} />
                    </TableCell>
                    <TableCell>
                      <StructuralFields snapshot={entry.after} />
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

export function AdminAuditListSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-2">
        <div className="bg-muted h-8 w-32 rounded-md" />
        <div className="bg-muted h-4 w-96 max-w-full rounded-md" />
      </div>
      <div className="bg-card border-border h-48 rounded-lg border" />
      <div className="bg-card border-border h-96 rounded-lg border" />
    </div>
  );
}
