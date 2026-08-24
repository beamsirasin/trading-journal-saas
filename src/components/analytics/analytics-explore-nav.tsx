'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { ANALYTICS_VIEWS, type AnalyticsView } from '@/lib/analytics/url-filters';
import { cn } from '@/lib/utils';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * Analytics Explore navigation — Phase 15D (brief §2/§3). Four states:
 * `overview` (scrolls back to the top of the Overview zones) plus one per
 * zone's Explore section. Same mechanism as Phase 15B's `TradeSectionNav`:
 * `?view=` is read client-side only (never reaches the server, never an
 * authorization surface), degrades to a no-op for an invalid/absent value,
 * and is reload-/back-forward-safe because it is plain URL state layered
 * onto a single fully-rendered page — nothing is conditionally hidden.
 */
export function AnalyticsExploreNav({
  view,
  className,
}: {
  view: AnalyticsView;
  className?: string;
}) {
  const t = useTranslations('analytics.real.exploreNav');
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function hrefFor(nextView: AnalyticsView): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <nav
      aria-label={t('label')}
      className={cn('border-border flex max-w-full gap-1 overflow-x-auto border-b pb-2', className)}
    >
      {ANALYTICS_VIEWS.map((item) => {
        const isActive = view === item;
        return (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative inline-flex min-h-11 shrink-0 items-center rounded-md px-4 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary after:bg-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:content-[\"\"]'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t(item)}
          </Link>
        );
      })}
    </nav>
  );
}
