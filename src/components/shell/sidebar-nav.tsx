'use client';

import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { LAYOUT_SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { Link, usePathname } from '@/i18n/navigation';

import { NAV_ITEMS } from './nav-items';

interface SidebarNavProps {
  /** Called after navigation, so the mobile drawer can close itself. */
  onNavigate?: () => void;
  /** Shows the per-item description. Used in the drawer, where there is room. */
  showDescriptions?: boolean;
}

/**
 * The one place Motion is used for navigation, and the justification:
 *
 * A shared `layoutId` makes the active indicator travel from the old item to
 * the new one. That movement communicates the relationship between the two
 * — you came from there, you are now here — which a hard cut cannot. It is
 * comprehension, not decoration.
 *
 * Reduced motion is honoured twice: the global CSS rule collapses durations,
 * and the SSR-safe preference hook swaps the animated indicator for a static
 * one so no layout animation is even scheduled.
 *
 * Active matching is EXACT, not `startsWith`. With a prefix match `/app`
 * would light up on `/app/trades` and two items would claim to be the current
 * page, which `aria-current="page"` must never do.
 *
 * `usePathname` is the locale-aware wrapper from `@/i18n/navigation`, which
 * strips the `/en` or `/th` prefix before comparing — without that, this
 * match would silently fail in every non-default locale.
 */
export function SidebarNav({ onNavigate, showDescriptions = false }: SidebarNavProps) {
  const t = useTranslations('appNav');
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <nav aria-label={tNav('mainNav')} className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, key, Icon }) => {
        const isActive = pathname === href;

        return (
          <Link
            key={href}
            href={href}
            // Spread rather than `onClick={onNavigate}` — exactOptionalPropertyTypes
            // distinguishes an absent prop from one explicitly set to undefined.
            {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {isActive ? (
              prefersReducedMotion ? (
                <span
                  data-active-indicator="static"
                  className="bg-accent absolute inset-0 rounded-md"
                  aria-hidden="true"
                />
              ) : (
                <motion.span
                  data-active-indicator="animated"
                  layoutId="sidebar-active-indicator"
                  className="bg-accent absolute inset-0 rounded-md"
                  transition={LAYOUT_SPRING}
                  aria-hidden="true"
                />
              )
            ) : null}

            <Icon className="relative size-4 shrink-0" aria-hidden="true" />

            <span className="relative flex min-w-0 flex-col">
              <span className="font-medium">{t(`items.${key}`)}</span>
              {showDescriptions ? (
                <span className="text-muted-foreground text-xs">{t(`descriptions.${key}`)}</span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
