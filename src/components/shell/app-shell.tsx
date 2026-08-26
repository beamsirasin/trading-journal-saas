import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import type {
  ActiveTradingAccountSummary,
  EffectiveEntitlement,
  SessionUser,
} from '@/server/auth/dal';
import { PreferencesSync } from '@/components/auth/preferences-sync';
import { TrialBanner } from '@/components/entitlements/trial-banner';

import { SIDEBAR_COOKIE_NAME } from './constants';
import { ShellFrame } from './shell-frame';
import { SkipLink } from './skip-link';

/**
 * Authenticated application shell.
 *
 * `user` is a required prop, not fetched here: the guard
 * that resolves them (`requireSession`/`getActiveWorkspaceContext`) lives in
 * `src/app/[locale]/(app)/layout.tsx`, the actual security boundary — this
 * component only renders what it is handed, so it cannot accidentally
 * become a second, un-enforced place a session check could be skipped.
 *
 * Landmarks are explicit — banner, navigation, main — so screen reader users
 * can jump between regions instead of traversing linearly. The navigation
 * landmark lives in exactly one place at any width: the desktop sidebar
 * above `lg`, the drawer below it.
 *
 * This stays a server component and delegates the interactive frame to
 * `ShellFrame`. The only thing it reads for itself is the sidebar-collapse
 * cookie, and it reads it HERE rather than in the client so the first paint
 * already has the correct sidebar width — see `ShellFrame`'s own note. The
 * cookie is presentation state and is never used for authorization.
 */
export async function AppShell({
  children,
  user,
  dbTheme,
  dbLocale,
  activeAccount,
  switchableAccounts,
  entitlement,
}: {
  children: ReactNode;
  user: SessionUser;
  dbTheme: string;
  dbLocale: string;
  /** `null` while onboarding is incomplete — no trading account exists yet. */
  activeAccount: ActiveTradingAccountSummary | null;
  /** Every non-archived account in the active workspace — the switcher's menu. Empty/unused while `activeAccount` is `null`. */
  switchableAccounts: readonly ActiveTradingAccountSummary[];
  /** `null` while onboarding is incomplete — no entitlement row exists yet (the trial starts on completion). */
  entitlement: EffectiveEntitlement | null;
}) {
  const cookieStore = await cookies();
  // Absent cookie means the RAIL ALONE: the compact spine is the resting
  // desktop state, so a first-time visitor meets the shell's own default
  // rather than a state they would have had to choose. Only an explicit '0',
  // written when the user opens the secondary panel, opts out of it.
  const expanded = cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === '0';

  return (
    <>
      <PreferencesSync initialDbTheme={dbTheme} initialDbLocale={dbLocale} />
      <SkipLink />

      <ShellFrame
        user={user}
        defaultExpanded={expanded}
        activeAccount={activeAccount}
        switchableAccounts={switchableAccounts}
        canCreateAccount={entitlement?.canCreateAccount ?? false}
        banner={entitlement === null ? null : <TrialBanner entitlement={entitlement} />}
      >
        {children}
      </ShellFrame>
    </>
  );
}
