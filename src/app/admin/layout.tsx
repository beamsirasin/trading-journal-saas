import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ThemeBootstrap } from '@/components/theme/theme-bootstrap';
import { ThemeProvider } from '@/components/theme/theme-provider';

import '../globals.css';

export const metadata: Metadata = {
  title: 'Admin · Trading OS',
  robots: { index: false, follow: false },
};

/**
 * The root HTML document for the entire `/admin` tree — deliberately.
 * `[locale]/layout.tsx`'s own comment calls itself "the sole root layout...
 * every page route is reached through `[locale]`", which stopped being true
 * the moment `/admin` existed as a sibling top-level segment with no shared
 * ancestor: `/admin` needs its own `<html>`/`<body>`/`globals.css` import
 * for exactly the same reason a second, independent Next.js app would.
 * Deliberately EN-only (no `NextIntlClientProvider`, no locale font
 * subsetting) — Phase 11's own contract.
 *
 * Deliberately carries NO authorization logic and never throws
 * `notFound()`/`redirect()` itself — that lives one level down, in
 * `(dashboard)/layout.tsx`. A root layout that throws `notFound()` has
 * nothing above it to supply `<html>`/`<body>` for the resulting
 * `not-found.tsx` render; keeping this layer a plain, always-succeeding
 * document wrapper is what lets `admin/not-found.tsx` render correctly
 * inside it regardless of which child layout below rejected the request.
 */
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh overflow-x-hidden antialiased">
        {/* /admin is its own document root, so it needs its own copy of the
            pre-paint theme bootstrap — see ThemeBootstrap. */}
        <ThemeBootstrap />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
