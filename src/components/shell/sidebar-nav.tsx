'use client';

import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LAYOUT_SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';

import { NAV_ITEMS } from './nav-items';

interface SidebarNavProps {
  /** Called after navigation, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

/**
 * The one place Motion is used in this phase, and the justification:
 *
 * A shared `layoutId` makes the active indicator travel from the old item to
 * the new one. That movement communicates the relationship between the two
 * — you came from there, you are now here — which a hard cut cannot. It is
 * comprehension, not decoration.
 *
 * Reduced motion is honoured twice: the global CSS rule collapses durations,
 * and `useReducedMotion` swaps the animated indicator for a static one so no
 * layout animation is even scheduled.
 */
export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ href, label, Icon, enabled }) => {
        const isActive = pathname === href;

        if (!enabled) {
          return (
            <span
              key={href}
              aria-disabled="true"
              className="text-muted-foreground/60 flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm"
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
              <span className="border-border text-muted-foreground/70 ml-auto rounded border px-1.5 py-0.5 text-[10px] tracking-wide">
                Soon
              </span>
            </span>
          );
        }

        return (
          <Link
            key={href}
            href={href}
            // Spread rather than `onClick={onNavigate}` — exactOptionalPropertyTypes
            // distinguishes an absent prop from one explicitly set to undefined.
            {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {isActive ? (
              prefersReducedMotion ? (
                <span className="bg-accent absolute inset-0 rounded-md" aria-hidden="true" />
              ) : (
                <motion.span
                  layoutId="sidebar-active-indicator"
                  className="bg-accent absolute inset-0 rounded-md"
                  transition={LAYOUT_SPRING}
                  aria-hidden="true"
                />
              )
            ) : null}
            <Icon className="relative size-4 shrink-0" aria-hidden="true" />
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
