import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import type { SessionUser } from '@/server/auth/dal';
import { PreferencesSync } from '@/components/auth/preferences-sync';
import { DemoBadge } from '@/components/product/demo-badge';
import { ThemeToggle } from '@/components/theme/theme-toggle';

import { AccountMenu } from './account-menu';
import { Brand } from './brand';
import { MAIN_CONTENT_ID } from './constants';
import { LanguageSwitcher } from './language-switcher';
import { MobileNav } from './mobile-nav';
import { SidebarNav } from './sidebar-nav';
import { SkipLink } from './skip-link';

/**
 * Authenticated application shell.
 *
 * `user`/`workspaceName` are required props, not fetched here: the guard
 * that resolves them (`requireSession`/`getActiveWorkspaceContext`) lives in
 * `src/app/[locale]/(app)/layout.tsx`, the actual security boundary — this
 * component only renders what it is handed, so it cannot accidentally
 * become a second, un-enforced place a session check could be skipped.
 *
 * Landmarks are explicit — banner, navigation, main, contentinfo — so screen
 * reader users can jump between regions instead of traversing linearly.
 */
export async function AppShell({
  children,
  user,
  workspaceName,
  dbTheme,
  dbLocale,
}: {
  children: ReactNode;
  user: SessionUser;
  workspaceName: string;
  dbTheme: string;
  dbLocale: string;
}) {
  const t = await getTranslations('appNav');

  return (
    <div className="min-h-dvh">
      <PreferencesSync initialDbTheme={dbTheme} initialDbLocale={dbLocale} />
      <SkipLink />

      <header className="bg-background/85 border-border sticky top-0 z-40 border-b backdrop-blur-sm">
        <div
          className="flex items-center gap-3 px-4"
          style={{ height: 'var(--shell-header-height)' }}
        >
          <MobileNav />
          <Brand href="/app" className="lg:hidden" compact />
          <div className="ml-auto flex items-center gap-2">
            <DemoBadge className="hidden sm:inline-flex" />
            <LanguageSwitcher />
            <ThemeToggle />
            <AccountMenu user={user} workspaceName={workspaceName} />
          </div>
        </div>
      </header>

      <div className="flex">
        {/*
          Hidden below `lg` rather than duplicated: the same SidebarNav renders
          inside the mobile drawer, so nav items are defined once.
        */}
        <aside
          className="border-border sticky hidden shrink-0 border-r lg:block"
          style={{
            top: 'var(--shell-header-height)',
            height: 'calc(100dvh - var(--shell-header-height))',
            width: 'var(--shell-sidebar-width)',
          }}
        >
          <div className="flex h-full flex-col gap-4 p-3">
            <Brand href="/app" className="px-2 py-2" />
            <SidebarNav />
            <div className="border-border text-muted-foreground mt-auto flex flex-col gap-1 border-t px-2 pt-3 text-xs">
              <p className="text-warning font-medium">{t('demoNoteTitle')}</p>
              <p className="leading-relaxed">{t('demoNote')}</p>
            </div>
          </div>
        </aside>

        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
