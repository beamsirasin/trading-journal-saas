import Link from 'next/link';
import type { ReactNode } from 'react';

import { Container } from '@/components/shell/container';

import { adminCopy } from './admin-copy';
import { AdminSignOutButton } from './admin-sign-out-button';

/**
 * The independent admin shell — deliberately NOT `AppShell`
 * (`src/components/shell/app-shell.tsx`), which requires an active
 * Workspace, active Trading Account, and entitlement snapshot as props.
 * Nothing here depends on tenant state. Nav entries are added only as their
 * own routes ship (Phase 11's own "do not add placeholder nav entries"
 * instruction): Overview (11C), Users/Workspaces (11D), Audit (11E) exist;
 * VAT does not yet. The nav `<ul>` wraps (`flex-wrap`) so a narrow viewport
 * drops entries onto additional lines rather than overflowing horizontally
 * — this mattered starting at exactly 4 entries (11E's Audit link).
 */
export function AdminShell({
  user,
  children,
}: {
  user: { readonly name: string; readonly email: string };
  children: ReactNode;
}) {
  return (
    <div className="bg-background min-h-dvh">
      <a
        href="#admin-main"
        className="bg-background text-foreground focus-visible:ring-ring sr-only rounded-md px-4 py-2 focus:not-sr-only focus-visible:fixed focus-visible:top-4 focus-visible:left-4 focus-visible:z-50 focus-visible:ring-2"
      >
        Skip to content
      </a>
      <header className="border-border bg-card border-b">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-foreground text-base font-semibold tracking-tight">
              {adminCopy.shell.brand}
            </span>
            <span className="bg-primary/10 text-primary rounded-full px-2.5 py-1 text-xs font-semibold">
              {adminCopy.shell.badge}
            </span>
            <nav aria-label={adminCopy.shell.badge}>
              <ul className="flex flex-wrap items-center gap-1">
                <li>
                  {/* Plain `next/link`, deliberately not `@/i18n/navigation`'s locale-aware `Link` — `/admin` sits outside `[locale]` and must never gain a prepended locale segment. */}
                  <Link
                    href="/admin"
                    className="text-foreground hover:bg-accent/50 flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
                  >
                    {adminCopy.shell.nav.overview}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/users"
                    className="text-foreground hover:bg-accent/50 flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
                  >
                    {adminCopy.shell.nav.users}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/workspaces"
                    className="text-foreground hover:bg-accent/50 flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
                  >
                    {adminCopy.shell.nav.workspaces}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/admin/audit"
                    className="text-foreground hover:bg-accent/50 flex min-h-11 items-center rounded-md px-3 text-sm font-medium"
                  >
                    {adminCopy.shell.nav.audit}
                  </Link>
                </li>
              </ul>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right">
              <p className="text-foreground text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground text-xs">{user.email}</p>
            </div>
            <Link
              href="/en/app"
              className="text-muted-foreground hover:text-foreground flex min-h-11 items-center rounded-md px-3 text-sm underline underline-offset-4"
            >
              {adminCopy.shell.backToApp}
            </Link>
            <AdminSignOutButton />
          </div>
        </Container>
      </header>

      <main id="admin-main" className="py-8">
        <Container width="wide">{children}</Container>
      </main>
    </div>
  );
}
