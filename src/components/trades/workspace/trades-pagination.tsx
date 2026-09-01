'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * The workspace's keyset pager.
 *
 * The cursor mechanics are the ones this route already had — an opaque
 * `(occurredAt, tradeId)` cursor plus a breadcrumb `trail` of the cursors
 * walked so far, which is what makes "Previous" possible over a keyset scheme
 * that has no natural backward cursor. Unchanged here, deliberately: paging is
 * not what this pass is redesigning.
 *
 * WHAT IT DROPS ON EVERY MOVE is `trade` and `tab`. Page 2 with a Trade from
 * page 1 still open in the sheet is a sheet describing a Trade the reader can
 * no longer see behind it.
 */
export function TradesPagination({
  nextCursor,
  currentCursor,
  cursorTrail,
}: {
  nextCursor: string | null;
  currentCursor: string | null;
  cursorTrail: string;
}) {
  const t = useTranslations('trades.pagination');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Bounded at 99 so a hand-edited `trail` cannot grow the URL without limit.
  const previousCursors = cursorTrail.split(',').filter(Boolean).slice(-99);
  const pageNumber = currentCursor === null ? 1 : previousCursors.length + 2;

  function baseParams(): URLSearchParams {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('trade');
    params.delete('tab');
    return params;
  }

  function nextHref(cursor: string): string {
    const params = baseParams();
    params.set('cursor', cursor);
    const nextTrail =
      currentCursor === null ? previousCursors : [...previousCursors, currentCursor];
    if (nextTrail.length === 0) params.delete('trail');
    else params.set('trail', nextTrail.join(','));
    return `${pathname}?${params.toString()}`;
  }

  function previousHref(): string {
    const params = baseParams();
    const previousCursor = previousCursors.at(-1);
    if (previousCursor === undefined) params.delete('cursor');
    else params.set('cursor', previousCursor);
    const remainingTrail = previousCursors.slice(0, -1);
    if (remainingTrail.length === 0) params.delete('trail');
    else params.set('trail', remainingTrail.join(','));
    return `${pathname}?${params.toString()}`;
  }

  return (
    <nav aria-label={t('label')} className="flex items-center justify-between gap-3">
      {currentCursor === null ? (
        <Button variant="outline" disabled>
          <ArrowLeft aria-hidden="true" /> {t('previous')}
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href={previousHref()}>
            <ArrowLeft aria-hidden="true" /> {t('previous')}
          </Link>
        </Button>
      )}
      <span className="text-muted-foreground text-sm font-medium" aria-current="page">
        {t('page', { page: pageNumber })}
      </span>
      {nextCursor === null ? (
        <Button variant="outline" disabled>
          {t('next')} <ArrowRight aria-hidden="true" />
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href={nextHref(nextCursor)}>
            {t('next')} <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      )}
    </nav>
  );
}
