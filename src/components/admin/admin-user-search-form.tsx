'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Plain controlled-submit search — mirrors `analytics-filters.tsx`'s
 * `useTransition` + `router.replace` convention, but explicit-submit rather
 * than per-keystroke: no debounce hook exists anywhere in this codebase
 * (Phase 11D research), and per-keystroke navigation for a free-text search
 * box would be new, untested behavior this phase does not need to introduce.
 * Submitting always resets `cursor` — a changed search always starts a new
 * result set at page one.
 */
export function AdminUserSearchForm({
  initialQuery,
  label,
  placeholder,
  submitLabel,
}: {
  initialQuery: string;
  label: string;
  placeholder: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams(searchParams);
    const trimmed = value.trim();
    if (trimmed === '') {
      params.delete('q');
    } else {
      params.set('q', trimmed);
    }
    params.delete('cursor');
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="admin-user-search">{label}</Label>
        <Input
          id="admin-user-search"
          type="search"
          value={value}
          placeholder={placeholder}
          disabled={isPending}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" disabled={isPending}>
        <Search aria-hidden="true" /> {submitLabel}
      </Button>
    </form>
  );
}
