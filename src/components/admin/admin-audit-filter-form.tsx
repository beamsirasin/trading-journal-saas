'use client';

import { RotateCcw, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_REASON_CODES } from '@/config/admin-audit-actions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function FilterSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full min-w-0 rounded-md border px-3 text-base outline-none focus-visible:ring-[3px] disabled:opacity-60',
        props.className,
      )}
    />
  );
}

/**
 * The Phase 11E Admin Audit filter bar — `action`/`reason`/`date` are
 * immediate-navigate `<select>`s (mirroring `AdminWorkspaceFilterForm`'s
 * convention); the three exact-ID fields (`actor`/`subjectUser`/
 * `subjectWorkspace`) batch into the same explicit-submit form. No free-text
 * metadata search exists anywhere here (Phase 11E's own locked "no arbitrary
 * field/sort/free-text metadata search" rule).
 */
export function AdminAuditFilterForm({
  initialAction,
  initialReason,
  initialActor,
  initialSubjectUser,
  initialSubjectWorkspace,
  initialDate,
  copy,
}: {
  initialAction: string;
  initialReason: string;
  initialActor: string;
  initialSubjectUser: string;
  initialSubjectWorkspace: string;
  initialDate: string;
  copy: {
    readonly actionLabel: string;
    readonly reasonLabel: string;
    readonly actorLabel: string;
    readonly subjectUserLabel: string;
    readonly subjectWorkspaceLabel: string;
    readonly dateLabel: string;
    readonly allActions: string;
    readonly allReasons: string;
    readonly date30d: string;
    readonly dateAll: string;
    readonly resetFilters: string;
    readonly applyLabel: string;
    readonly actionLabels: Readonly<Record<string, string>>;
    readonly reasonLabels: Readonly<Record<string, string>>;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [actor, setActor] = useState(initialActor);
  const [subjectUser, setSubjectUser] = useState(initialSubjectUser);
  const [subjectWorkspace, setSubjectWorkspace] = useState(initialSubjectWorkspace);
  const [isPending, startTransition] = useTransition();

  function navigate(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    update(params);
    params.delete('cursor');
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate((params) => {
      const trimmedActor = actor.trim();
      const trimmedSubjectUser = subjectUser.trim();
      const trimmedSubjectWorkspace = subjectWorkspace.trim();
      if (trimmedActor === '') params.delete('actor');
      else params.set('actor', trimmedActor);
      if (trimmedSubjectUser === '') params.delete('subjectUser');
      else params.set('subjectUser', trimmedSubjectUser);
      if (trimmedSubjectWorkspace === '') params.delete('subjectWorkspace');
      else params.set('subjectWorkspace', trimmedSubjectWorkspace);
    });
  }

  const hasActiveFilter =
    initialAction !== '' ||
    initialReason !== '' ||
    initialActor !== '' ||
    initialSubjectUser !== '' ||
    initialSubjectWorkspace !== '' ||
    initialDate !== '';

  return (
    <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-audit-action">{copy.actionLabel}</Label>
          <FilterSelect
            id="admin-audit-action"
            value={initialAction}
            disabled={isPending}
            onChange={(event) =>
              navigate((params) => {
                if (event.target.value === '') params.delete('action');
                else params.set('action', event.target.value);
              })
            }
          >
            <option value="">{copy.allActions}</option>
            {ADMIN_AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {copy.actionLabels[action] ?? action}
              </option>
            ))}
          </FilterSelect>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-audit-reason">{copy.reasonLabel}</Label>
          <FilterSelect
            id="admin-audit-reason"
            value={initialReason}
            disabled={isPending}
            onChange={(event) =>
              navigate((params) => {
                if (event.target.value === '') params.delete('reason');
                else params.set('reason', event.target.value);
              })
            }
          >
            <option value="">{copy.allReasons}</option>
            {ADMIN_AUDIT_REASON_CODES.map((reason) => (
              <option key={reason} value={reason}>
                {copy.reasonLabels[reason] ?? reason}
              </option>
            ))}
          </FilterSelect>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-audit-date">{copy.dateLabel}</Label>
          <FilterSelect
            id="admin-audit-date"
            value={initialDate}
            disabled={isPending}
            onChange={(event) =>
              navigate((params) => {
                if (event.target.value === '') params.delete('date');
                else params.set('date', event.target.value);
              })
            }
          >
            <option value="">{copy.dateAll}</option>
            <option value="30d">{copy.date30d}</option>
          </FilterSelect>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-audit-actor">{copy.actorLabel}</Label>
          <Input
            id="admin-audit-actor"
            value={actor}
            disabled={isPending}
            onChange={(event) => setActor(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-audit-subject-user">{copy.subjectUserLabel}</Label>
          <Input
            id="admin-audit-subject-user"
            value={subjectUser}
            disabled={isPending}
            onChange={(event) => setSubjectUser(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-audit-subject-workspace">{copy.subjectWorkspaceLabel}</Label>
          <Input
            id="admin-audit-subject-workspace"
            value={subjectWorkspace}
            disabled={isPending}
            onChange={(event) => setSubjectWorkspace(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Button type="submit" variant="outline" disabled={isPending}>
            <Search aria-hidden="true" /> {copy.applyLabel}
          </Button>
        </div>
      </form>

      {hasActiveFilter ? (
        <div>
          <Link
            href={pathname}
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> {copy.resetFilters}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
