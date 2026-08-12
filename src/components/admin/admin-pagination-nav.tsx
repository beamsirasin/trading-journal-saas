'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

/**
 * Shared cursor-pagination control for the Admin Users/Workspaces lists —
 * mirrors `src/components/trades/trade-list.tsx`'s own Previous/Next
 * convention exactly (browser-history `back()` for Previous, a plain Link
 * carrying the next cursor for Next), using plain `next/navigation` rather
 * than `@/i18n/navigation` because `/admin` sits outside `[locale]`.
 */
export function AdminPaginationNav({
  ariaLabel,
  hasCursor,
  nextHref,
  previousLabel,
  nextLabel,
}: {
  ariaLabel: string;
  hasCursor: boolean;
  nextHref: string | null;
  previousLabel: string;
  nextLabel: string;
}) {
  const router = useRouter();

  if (!hasCursor && nextHref === null) {
    return null;
  }

  return (
    <nav aria-label={ariaLabel} className="flex items-center justify-between gap-3">
      <Button variant="outline" disabled={!hasCursor} onClick={() => router.back()}>
        <ArrowLeft aria-hidden="true" /> {previousLabel}
      </Button>
      {nextHref === null ? (
        <Button variant="outline" disabled>
          {nextLabel} <ArrowRight aria-hidden="true" />
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href={nextHref}>
            {nextLabel} <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      )}
    </nav>
  );
}
