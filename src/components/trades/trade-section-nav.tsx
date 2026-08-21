'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import type { StatusKind } from '@/lib/status/status-kind';
import {
  TRADE_DETAIL_SECTIONS,
  TRADE_SECTION_DOM_ID,
  type TradeDetailSection,
} from '@/lib/trades/section';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/status/status-badge';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * The reusable Trade section navigation model — Phase 15B
 * (docs/phases/PHASE-15-ux-simplification.md §12-14/§30/§38). Proves the
 * shared deep-link contract against TODAY's flat Trade Detail layout (each
 * item scrolls to its existing `Section` by id) without restructuring that
 * layout — the full step-navigation redesign (hiding every section but the
 * active one) is Phase 15E's job, not this one.
 *
 * Renders once; CSS handles the desktop-compact-row vs.
 * mobile-stacked-list split (brief §13/§14), same responsive pattern already
 * used elsewhere in this codebase (e.g. `trade-list.tsx`'s table/card split)
 * rather than two components.
 */
export function TradeSectionNav({
  tradeId,
  statuses,
  className,
}: {
  tradeId: string;
  statuses: Record<TradeDetailSection, StatusKind>;
  className?: string;
}) {
  const t = useTranslations('trades.detail.nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefersReducedMotion = usePrefersReducedMotion();
  const activeSection = searchParams.get('section');
  const highlightedRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeSection === null || highlightedRef.current === activeSection) return;
    const isValid = (TRADE_DETAIL_SECTIONS as readonly string[]).includes(activeSection);
    // An invalid/unknown section degrades to a no-op — never a crash, and
    // never a scroll to nowhere (brief §9).
    if (!isValid) return;

    const domId = TRADE_SECTION_DOM_ID[activeSection as TradeDetailSection];
    const target = document.getElementById(domId);
    if (target === null) return;

    highlightedRef.current = activeSection;
    target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    // Moves assistive-tech focus too, not just the visual viewport — a
    // sighted-only scroll would leave a screen-reader user's focus behind.
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [activeSection, prefersReducedMotion]);

  function hrefFor(section: TradeDetailSection): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('trade', tradeId);
    params.set('section', section);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <nav
      aria-label={t('label')}
      className={cn('flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-2', className)}
    >
      {TRADE_DETAIL_SECTIONS.map((section) => {
        const isActive = activeSection === section;
        return (
          <Link
            key={section}
            href={hrefFor(section)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'border-border flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm sm:flex-col sm:items-start sm:gap-1.5 sm:py-2.5',
              'transition-colors',
              isActive ? 'border-primary bg-primary/5' : 'hover:bg-muted',
            )}
          >
            <span className="font-medium">{t(section)}</span>
            <StatusBadge kind={statuses[section]} />
          </Link>
        );
      })}
    </nav>
  );
}
