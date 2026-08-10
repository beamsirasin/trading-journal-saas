'use client';

import { useTransition } from 'react';

import { signOut } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

import { adminCopy } from './admin-copy';

/**
 * Deliberately not `AccountMenu` (`src/components/shell/account-menu.tsx`)
 * — that component is `next-intl`-coupled (`useTranslations`, the
 * locale-aware router) and workspace-name-aware, neither of which belongs
 * in the EN-only, tenant-independent admin shell. `signOut()` itself
 * (`@/lib/auth/client`) is a plain Better Auth client call with no such
 * coupling, so it is safe to reuse directly.
 */
export function AdminSignOutButton() {
  const [isPending, startTransition] = useTransition();

  function handleSignOut() {
    startTransition(async () => {
      await signOut();
      // Plain browser navigation, not `next/navigation`'s router: signing
      // out of the admin shell should land on the canonical, locale-prefixed
      // login page, the same destination `src/proxy.ts`'s unauthenticated
      // `/admin` redirect uses.
      window.location.assign('/en/login');
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11"
      onClick={handleSignOut}
      disabled={isPending}
    >
      {adminCopy.shell.signOut}
    </Button>
  );
}
