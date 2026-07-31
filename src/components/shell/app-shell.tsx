import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/theme/theme-toggle';

import { Brand } from './brand';
import { MAIN_CONTENT_ID } from './constants';
import { MobileNav } from './mobile-nav';
import { SidebarNav } from './sidebar-nav';
import { SkipLink } from './skip-link';

/**
 * Authenticated application shell — structure only.
 *
 * NO AUTHENTICATION IS ENFORCED HERE. Phase 02 adds the session guard; until
 * then these routes are publicly reachable, which is safe only because they
 * contain no data. The layout is deliberately not shaped around a user
 * object, so adding the guard later does not restructure it.
 *
 * Landmarks are explicit — banner, navigation, main, contentinfo — so screen
 * reader users can jump between regions instead of traversing linearly.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <SkipLink />

      <header className="bg-background/80 border-border sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="flex h-14 items-center gap-3 px-4">
          <MobileNav />
          <Brand href="/app" className="lg:hidden" />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex">
        {/*
          Hidden below `lg` rather than duplicated: the same SidebarNav renders
          inside the mobile drawer, so nav items are defined once.
        */}
        <aside className="border-border sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 border-r lg:block">
          <div className="flex h-full flex-col gap-4 p-3">
            <Brand href="/app" className="px-2 py-2" />
            <SidebarNav />
            <p className="text-muted-foreground mt-auto px-2 text-xs">Phase 00b · foundations</p>
          </div>
        </aside>

        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
