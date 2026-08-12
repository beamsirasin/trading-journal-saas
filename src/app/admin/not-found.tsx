import Link from 'next/link';

import { adminCopy } from '@/components/admin/admin-copy';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

/**
 * The privacy-limited denial for `/admin` — reached both by a genuinely
 * unmatched sub-path and by `(dashboard)/layout.tsx`'s `notFound()` call for
 * an authenticated non-admin (Phase 11's own locked choice: 404, not a 403
 * that would confirm the surface exists). Deliberately renders no "Admin"
 * branding, no nav, no mention of platform-admin authority — nothing here
 * distinguishes "you are not an admin" from "this route does not exist".
 * Plain HTML, not `AdminShell` — an unauthorized visitor never sees that
 * chrome. No `<html>`/`<body>` here: `admin/layout.tsx` (the root layout for
 * this segment) already supplies both, and this file renders as its
 * children — the same relationship `[locale]/not-found.tsx` has with
 * `[locale]/layout.tsx`.
 */
export default function AdminNotFound() {
  return (
    <main className="flex min-h-dvh items-center">
      <Container className="flex flex-col items-start gap-5 py-16">
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {adminCopy.notFound.title}
        </h1>
        <p className="text-muted-foreground max-w-prose">{adminCopy.notFound.description}</p>
        <Button asChild>
          {/* Plain `next/link`, deliberately not `@/i18n/navigation`'s locale-aware `Link` — this page sits outside `[locale]` and must never gain a prepended locale segment. */}
          <Link href="/en/login">{adminCopy.notFound.backHome}</Link>
        </Button>
      </Container>
    </main>
  );
}
