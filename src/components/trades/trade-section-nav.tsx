'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';

import type { StatusKind } from '@/lib/status/status-kind';
import {
  DEFAULT_TRADE_DETAIL_SECTION,
  parseTradeDetailSection,
  TRADE_DETAIL_SECTIONS,
  type TradeDetailSection,
} from '@/lib/trades/section';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/status/status-badge';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * Trade Detail section navigation AND switcher — Phase 15E. Supersedes
 * Phase 15B's scroll-to-anchor proof: rather than jumping to an anchor on an
 * always-fully-rendered page, this now shows exactly ONE of the five
 * pre-rendered section bodies at a time (`sections` — already-rendered
 * Server Component output passed down as `ReactNode`, so switching is a
 * pure client-side choice with no re-fetch). This is the "ONE THING AT A
 * TIME" contract (brief §5) — never a wizard: every item stays reachable,
 * none is ever disabled because another is incomplete.
 *
 * `?section=` is read client-side only (`useSearchParams`), never reaches
 * the server, and therefore carries zero authorization surface — the
 * `trade` param continues through its own unchanged, fully authorized DAL
 * path. An invalid/absent value degrades to
 * {@link DEFAULT_TRADE_DETAIL_SECTION}, never a crash (brief §9).
 */
export function TradeSectionNav({
  tradeId,
  statuses,
  sections,
  className,
}: {
  tradeId: string;
  statuses: Record<TradeDetailSection, StatusKind>;
  sections: Record<TradeDetailSection, ReactNode>;
  className?: string;
}) {
  const t = useTranslations('trades');
  const tNav = useTranslations('trades.detail.nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection: TradeDetailSection =
    parseTradeDetailSection(searchParams.get('section') ?? undefined) ??
    DEFAULT_TRADE_DETAIL_SECTION;
  const panelRef = useRef<HTMLDivElement>(null);

  // Moves assistive-tech focus to the newly-selected section on every
  // switch — a sighted-only content swap would otherwise leave a
  // screen-reader user's focus stranded on the (now-hidden) previous
  // section's controls.
  useEffect(() => {
    panelRef.current?.focus();
  }, [activeSection]);

  function hrefFor(section: TradeDetailSection): string {
    const params = new URLSearchParams(searchParams.toString());
    params.set('trade', tradeId);
    params.set('section', section);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      <nav
        aria-label={tNav('label')}
        className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-2"
      >
        {TRADE_DETAIL_SECTIONS.map((section) => {
          const isActive = activeSection === section;
          const label = sectionStatusLabel(section, statuses[section], t);
          return (
            <Link
              key={section}
              href={hrefFor(section)}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'border-border flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors sm:flex-col sm:items-start sm:gap-1.5 sm:py-2.5',
                isActive ? 'border-primary bg-primary/5' : 'hover:bg-muted',
              )}
            >
              <span className="font-medium">{tNav(section)}</span>
              {label === undefined ? (
                <StatusBadge kind={statuses[section]} />
              ) : (
                <StatusBadge kind={statuses[section]} label={label} />
              )}
            </Link>
          );
        })}
      </nav>
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-label={tNav(activeSection)}
        className="min-w-0 outline-none"
      >
        {sections[activeSection]}
      </div>
    </div>
  );
}

/**
 * Per-section wording for a shared `StatusKind` (brief §48-52: Strategy's
 * "complete" reads as "Recorded", never "Complete"; Review's reads as
 * "Review recorded"/"Not reviewed"; Actual/System reuse their own existing
 * lifecycle vocabulary). Returns `undefined` where the shared Phase 15B
 * vocabulary default already reads naturally (e.g. Entry/Review's
 * "Partially recorded") — `StatusBadge` falls back to it unchanged.
 */
function sectionStatusLabel(
  section: TradeDetailSection,
  kind: StatusKind,
  t: ReturnType<typeof useTranslations<'trades'>>,
): string | undefined {
  if (section === 'actual') {
    if (kind === 'complete') return t('status.execution.closed');
    if (kind === 'active') return t('status.execution.open');
    if (kind === 'needs_attention') return t('detail.nav.status.actualNeedsAttention');
    if (kind === 'not_recorded') return t('status.execution.canceled');
  }
  if (section === 'system') {
    if (kind === 'complete') return t('status.system.resolved');
    if (kind === 'needs_attention') return t('status.system.pending');
    if (kind === 'not_recorded') return t('status.system.no_trade');
  }
  if (section === 'strategy') {
    if (kind === 'complete') return t('detail.nav.status.strategyRecorded');
    if (kind === 'partial') return t('detail.nav.status.strategyPartial');
    if (kind === 'not_recorded') return t('common.notAssigned');
  }
  if (section === 'entry' && kind === 'complete') return t('detail.nav.status.entryRecorded');
  if (section === 'review') {
    if (kind === 'complete') return t('detail.nav.status.reviewRecorded');
    if (kind === 'not_recorded') return t('detail.nav.status.reviewNotReviewed');
  }
  return undefined;
}

/**
 * A cross-section deep link (brief §20 — "Strategy & Setup" links to "View
 * Entry Snapshot" for the full Setup Checklist, never duplicating it) that
 * preserves every existing query param — the same `?section=` contract
 * `TradeSectionNav` itself uses, just reachable from inside a section body
 * rather than the nav strip.
 */
export function TradeSectionLink({
  tradeId,
  section,
  children,
  className,
}: {
  tradeId: string;
  section: TradeDetailSection;
  children: ReactNode;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  params.set('trade', tradeId);
  params.set('section', section);
  return (
    <Link href={`${pathname}?${params.toString()}`} className={className}>
      {children}
    </Link>
  );
}
