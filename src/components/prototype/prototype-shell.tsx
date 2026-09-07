'use client';

import { BarChart3, BookOpen, LayoutDashboard, Menu, Target, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * AN INERT REPLICA OF THE APPLICATION SHELL.
 *
 * The real `ShellFrame` would have been the more faithful choice and was the
 * first thing tried — it takes plain props and fetches nothing. It is not used
 * here for one reason: the account switcher it renders imports
 * `setActiveTradingAccountAction`, a production server action, and the account
 * menu imports `signOut`. Mounting it would put two real mutations one stray
 * click away inside a prototype whose entire remit is "wired to nothing".
 *
 * So this reproduces the frame's GEOMETRY exactly — the same
 * `--shell-header-height` tokens, the same `--shell-rail-width`, the same
 * `data-shell-chrome` scope that inverts the header's palette in light mode,
 * the same nav icons in the same order — while every control in it is a
 * non-interactive presentational element. What that geometry buys is the thing
 * the responsive review actually depends on: the journal's content width at a
 * given viewport is the real one (viewport − rail − gutters), not a guess.
 *
 * NOT A DESIGN CONTRIBUTION. Nothing about the shell is under review in this
 * pass; it is here so the surfaces that ARE under review are seen in their real
 * frame rather than floating on a blank page.
 */

/** The skip link's target, named once so the two can never drift apart. */
const PROTOTYPE_MAIN_ID = 'prototype-main';

const NAV = [
  { key: 'overview', label: 'Dashboard', Icon: LayoutDashboard },
  { key: 'accounts', label: 'Accounts', Icon: Wallet },
  { key: 'trades', label: 'Trades', Icon: BookOpen },
  { key: 'strategies', label: 'Strategies', Icon: Target },
  { key: 'analytics', label: 'Analytics', Icon: BarChart3 },
] as const;

export function PrototypeShell({
  children,
  active = 'trades',
  /**
   * `desktop-only` is the focused recording flow: the global header and rail
   * stay on a desktop, where they cost nothing and keep the reader oriented,
   * and are suppressed below `lg`, where 60px of brand and account bar is 60px
   * the form does not get (spec §I).
   */
  chrome = 'full',
}: {
  children: ReactNode;
  active?: (typeof NAV)[number]['key'];
  chrome?: 'full' | 'desktop-only' | 'none';
}) {
  if (chrome === 'none') {
    return (
      <div className="bg-background min-h-dvh">
        <main id={PROTOTYPE_MAIN_ID} tabIndex={-1}>
          {children}
        </main>
      </div>
    );
  }

  const headerHidden = chrome === 'desktop-only' ? 'hidden lg:block' : '';

  return (
    <div
      className="bg-background min-h-dvh"
      style={{ ['--shell-workspace-offset' as string]: 'var(--shell-rail-width)' }}
    >
      {/*
        A REAL SKIP LINK, not a decorative one. The prototype puts a header and
        a five-item rail ahead of the journal on every screen; without this a
        keyboard user tabs through both before reaching the first trade. The
        target is `tabindex="-1"` so focus actually lands there.
      */}
      <a
        href={`#${PROTOTYPE_MAIN_ID}`}
        className={cn(
          'sr-only focus-visible:not-sr-only',
          'focus-visible:bg-card focus-visible:text-foreground focus-visible:ring-ring',
          'focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50',
          'focus-visible:inline-flex focus-visible:min-h-11 focus-visible:items-center',
          'focus-visible:rounded-md focus-visible:px-4 focus-visible:text-sm focus-visible:ring-2',
        )}
      >
        Skip to trades
      </a>

      <header
        data-shell-chrome
        className={cn('border-shell-chrome-border sticky top-0 z-40 w-full border-b', headerHidden)}
      >
        <div className="flex h-[var(--shell-header-height-mobile)] items-center gap-1.5 pr-3 pl-2 sm:pr-4 sm:pl-3 lg:h-[var(--shell-header-height)] lg:gap-0 lg:pl-0">
          <span
            aria-hidden="true"
            className="text-shell-chrome-foreground flex size-11 items-center justify-center rounded-md lg:hidden"
          >
            <Menu className="size-[1.125rem]" />
          </span>
          <span
            aria-hidden="true"
            className="text-shell-chrome-foreground hidden shrink-0 items-center justify-center lg:flex lg:w-[var(--shell-rail-width)]"
          >
            <Menu className="size-[1.125rem]" />
          </span>

          {/*
            THE WORDMARK YIELDS BEFORE THE ROW DOES.

            It was `shrink-0` with a `whitespace-nowrap` label, which at 200%
            text zoom on a 390px screen pushed the account cluster 70px past the
            right edge — the page scrolled sideways, which this design system
            forbids at any width. The mark and the utilities keep their size;
            the LABEL is the one thing here that can afford to be clipped, so it
            is the one thing allowed to be.
          */}
          <span className="flex min-w-0 shrink items-center gap-2">
            <span className="bg-brand text-shell-chrome-foreground flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold">
              T
            </span>
            <span className="text-shell-chrome-foreground hidden min-w-0 truncate text-lg font-semibold tracking-tight min-[360px]:inline">
              TradeChemist
            </span>
          </span>

          <span className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
            <span className="border-shell-chrome-border text-shell-chrome-foreground hidden h-9 items-center gap-2 rounded-md border px-3 text-sm sm:inline-flex">
              Live · FTMO 100K
            </span>
            <span className="bg-shell-chrome-accent text-shell-chrome-foreground flex size-9 items-center justify-center rounded-full text-xs font-semibold">
              KP
            </span>
          </span>
        </div>
      </header>

      {/* The rail. Icon column only — the resting desktop state, and the width
          the journal's available content is measured against. */}
      <aside
        aria-hidden="true"
        className="bg-sidebar border-sidebar-border fixed top-[var(--shell-header-height)] bottom-0 left-0 z-30 hidden w-[var(--shell-rail-width)] border-r lg:block"
      >
        <ul className="flex flex-col items-center gap-1 py-3">
          {NAV.map(({ key, label, Icon }) => (
            <li key={key}>
              <span
                title={label}
                className={cn(
                  'flex size-11 items-center justify-center rounded-lg',
                  key === active
                    ? 'bg-[var(--shell-nav-active-surface)] text-[var(--shell-nav-active-icon)]'
                    : 'text-[var(--shell-nav-rest-foreground)]',
                )}
              >
                <Icon className="size-[1.125rem]" />
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/*
        THE ONE `main` LANDMARK. Every prototype screen was previously a bare
        `div` between a header and an aside, so a screen-reader user had no
        region to jump to and the skip link above had nothing to target.
      */}
      <main id={PROTOTYPE_MAIN_ID} tabIndex={-1} className="lg:pl-[var(--shell-workspace-offset)]">
        {children}
      </main>
    </div>
  );
}
