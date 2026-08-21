'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
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
const VIEWS = ['overview', 'results', 'edge', 'behavior'] as const;
type View = (typeof VIEWS)[number];

const VIEW_DOM_ID: Record<View, string> = {
  overview: 'analytics-overview-top',
  results: 'analytics-performance-heading',
  edge: 'analytics-setup-quality-heading',
  behavior: 'analytics-psychology-heading',
};

export function AnalyticsExploreNav({ className }: { className?: string }) {
  const t = useTranslations('analytics.real.exploreNav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefersReducedMotion = usePrefersReducedMotion();
  const activeView = searchParams.get('view');
  const scrolledForRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeView === null || scrolledForRef.current === activeView) return;
    if (!(VIEWS as readonly string[]).includes(activeView)) return;

    const domId = VIEW_DOM_ID[activeView as View];
    const target = document.getElementById(domId);
    if (target === null) return;

    scrolledForRef.current = activeView;
    target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [activeView, prefersReducedMotion]);

  function hrefFor(view: View): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <nav aria-label={t('label')} className={cn('flex flex-wrap gap-2', className)}>
      {VIEWS.map((view) => {
        const isActive = activeView === view;
        return (
          <Link
            key={view}
            href={hrefFor(view)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'border-border inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t(view)}
          </Link>
        );
      })}
    </nav>
  );
}
