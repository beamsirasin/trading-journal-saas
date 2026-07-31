import type { ReactNode } from 'react';

import { MAIN_CONTENT_ID } from '@/components/shell/constants';
import { PublicFooter } from '@/components/shell/public-footer';
import { PublicHeader } from '@/components/shell/public-header';
import { SkipLink } from '@/components/shell/skip-link';

/**
 * Public layout boundary — everything reachable without a session.
 *
 * The route group `(public)` does not appear in URLs; it exists so that
 * public and authenticated routes can have genuinely different chrome
 * without either one branching on auth state.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <PublicHeader />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
