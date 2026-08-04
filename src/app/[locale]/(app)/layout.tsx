import type { ReactNode } from 'react';

import {
  getActiveTradingAccount,
  getActiveWorkspaceContext,
  getCurrentUserPreferences,
  getOptionalSession,
  getWorkspaceEntitlement,
  listSwitchableTradingAccounts,
} from '@/server/auth/dal';
import { AppShell } from '@/components/shell/app-shell';
import { redirect } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

/**
 * `never`-typed explicitly here because next-intl's own `redirect` return
 * type does not narrow reliably through this call shape (destructured from
 * `createNavigation`'s generic return value) — TypeScript trusts this
 * function's own annotation instead of re-deriving one from that type.
 */
function redirectToLogin(locale: AppLocale): never {
  redirect({ href: '/login', locale });
  throw new Error('unreachable: redirect() always throws');
}

/**
 * Authenticated application layout — the actual security boundary.
 *
 * `src/proxy.ts` already redirected an unauthenticated visitor before this
 * ever renders, but that check only confirms a session COOKIE is present,
 * never that it is valid (Better Auth's own documented trade-off for
 * middleware/proxy). This is where the database-verified check happens —
 * every route under `(app)` renders through this layout, so there is no
 * page that could forget it.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  const session = await getOptionalSession();

  if (session === null) {
    redirectToLogin(locale as AppLocale);
  }

  const user = session.user;
  const workspace = await getActiveWorkspaceContext();
  const preferences = await getCurrentUserPreferences();
  // `null` while onboarding is incomplete (no account exists yet) — AppShell
  // simply omits the switcher rather than rendering one for something that
  // does not exist. `switchableAccounts` is fetched unconditionally (a cheap
  // query even when unused) rather than made conditional on `activeAccount`
  // — the two are independent reads and cannot silently drift out of sync.
  //
  // `entitlement` is fetched only once onboarding is complete — no
  // `workspace_entitlements` row exists before then (the trial starts on
  // completion, `completeOnboarding`), so querying earlier would just
  // resolve `null` anyway; skipping the query entirely says so directly.
  const [activeAccount, switchableAccounts, entitlement] = await Promise.all([
    getActiveTradingAccount(),
    listSwitchableTradingAccounts(),
    workspace.onboardingCompletedAt === null ? null : getWorkspaceEntitlement(),
  ]);

  return (
    <AppShell
      user={user}
      workspaceName={workspace.workspaceName}
      dbTheme={preferences.theme}
      dbLocale={preferences.locale}
      activeAccount={activeAccount}
      switchableAccounts={switchableAccounts}
      entitlement={entitlement}
    >
      {children}
    </AppShell>
  );
}
