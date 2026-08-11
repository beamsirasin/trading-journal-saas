'use client';

import { RotateCcw, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const PLAN_OPTIONS = ['starter', 'trader', 'professional', 'none'] as const;
const SOURCE_OPTIONS = ['trial', 'paid', 'complimentary'] as const;

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
 * Search-by-text (explicit submit, mirrors `AdminUserSearchForm`) plus
 * plan/source filters (immediate-navigate `<select>`, mirrors
 * `analytics-filters.tsx`'s own `navigate` convention). `plan`/`source` are
 * the only Workspace filters (Phase 11D's locked "not effective-status"
 * rule) — filtering happens on `workspace_entitlements`' own closed-set
 * columns, never a re-implementation of `resolveEffectiveEntitlement`.
 */
export function AdminWorkspaceFilterForm({
  initialQuery,
  initialPlan,
  initialSource,
  copy,
}: {
  initialQuery: string;
  initialPlan: string;
  initialSource: string;
  copy: {
    readonly searchLabel: string;
    readonly searchPlaceholder: string;
    readonly searchButton: string;
    readonly planFilterLabel: string;
    readonly sourceFilterLabel: string;
    readonly allPlans: string;
    readonly allSources: string;
    readonly resetFilters: string;
    readonly planLabels: Readonly<Record<(typeof PLAN_OPTIONS)[number], string>>;
    readonly sourceLabels: Readonly<Record<(typeof SOURCE_OPTIONS)[number], string>>;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
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
      const trimmed = value.trim();
      if (trimmed === '') params.delete('q');
      else params.set('q', trimmed);
    });
  }

  return (
    <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-4 sm:p-5">
      <form
        role="search"
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="admin-workspace-search">{copy.searchLabel}</Label>
          <Input
            id="admin-workspace-search"
            type="search"
            value={value}
            placeholder={copy.searchPlaceholder}
            disabled={isPending}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline" disabled={isPending}>
          <Search aria-hidden="true" /> {copy.searchButton}
        </Button>
      </form>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-workspace-plan">{copy.planFilterLabel}</Label>
          <FilterSelect
            id="admin-workspace-plan"
            value={initialPlan}
            disabled={isPending}
            onChange={(event) =>
              navigate((params) => {
                if (event.target.value === '') params.delete('plan');
                else params.set('plan', event.target.value);
              })
            }
          >
            <option value="">{copy.allPlans}</option>
            {PLAN_OPTIONS.map((plan) => (
              <option key={plan} value={plan}>
                {copy.planLabels[plan]}
              </option>
            ))}
          </FilterSelect>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="admin-workspace-source">{copy.sourceFilterLabel}</Label>
          <FilterSelect
            id="admin-workspace-source"
            value={initialSource}
            disabled={isPending}
            onChange={(event) =>
              navigate((params) => {
                if (event.target.value === '') params.delete('source');
                else params.set('source', event.target.value);
              })
            }
          >
            <option value="">{copy.allSources}</option>
            {SOURCE_OPTIONS.map((source) => (
              <option key={source} value={source}>
                {copy.sourceLabels[source]}
              </option>
            ))}
          </FilterSelect>
        </div>
      </div>

      {initialQuery === '' && initialPlan === '' && initialSource === '' ? null : (
        <div>
          <Link
            href={pathname}
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> {copy.resetFilters}
          </Link>
        </div>
      )}
    </div>
  );
}
