import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getOptionalPlatformAdmin } from '@/server/auth/admin-dal';
import { getOptionalSession } from '@/server/auth/dal';
import { AdminShell } from '@/components/admin/admin-shell';
import { routing } from '@/i18n/routing';

/**
 * The actual `/admin` security boundary (Layer B — `src/proxy.ts`'s
 * cookie-presence check is Layer A, optimistic only). Every request under
 * `/admin` renders through this layout (a route group — `(dashboard)` never
 * appears in the URL, so this is still exactly `/admin`), so no admin page
 * can forget it — the same "one place, no page can skip it" posture
 * `(app)/layout.tsx` already established for the customer app.
 *
 * Deliberately does NOT call `getActiveWorkspaceContext`,
 * `getActiveTradingAccount`, or `getWorkspaceEntitlement` — platform
 * authority has no Workspace dependency, and an admin with no Workspace at
 * all must still be authorized here.
 *
 * Two distinct failure modes, both required by Phase 11C:
 *   - no session at all -> redirect to the canonical EN login (matches
 *     `src/proxy.ts`'s own optimistic redirect target, re-verified here
 *     against the database rather than trusted from cookie presence);
 *   - a real session but no active platform-admin grant -> `notFound()`
 *     (`../not-found.tsx`), a privacy-limited denial that reveals nothing
 *     about why (Phase 11's own "do not display 'you are not a platform
 *     admin because...'" rule) and never renders `AdminShell`'s chrome.
 */
export const dynamic = 'force-dynamic';

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const session = await getOptionalSession();
  if (session === null) {
    redirect(`/${routing.defaultLocale}/login?callbackUrl=/admin`);
  }

  const adminContext = await getOptionalPlatformAdmin();
  if (adminContext === null) {
    notFound();
  }

  return <AdminShell user={adminContext.user}>{children}</AdminShell>;
}
