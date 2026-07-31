import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';

/**
 * Authenticated application layout.
 *
 * PLACEHOLDER: no session check happens here. Phase 02 adds the guard — it
 * will resolve the session, redirect anonymous visitors to `/login`, and
 * derive the workspace context. Until then these routes are open, which is
 * acceptable only because they hold no data.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
