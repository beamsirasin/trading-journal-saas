import Link from 'next/link';

import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

/**
 * Root 404. Renders its own landmarks because it replaces the whole layout
 * tree when a route matches nothing — no route-group layout wraps it.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center">
      <Container className="flex flex-col items-start gap-5 py-16">
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Page not found</h1>
        <p className="text-muted-foreground max-w-prose">
          That page does not exist. Several sections of the product have not been built yet — the
          roadmap in the repository documents what is coming and when.
        </p>
        <Button asChild>
          <Link href="/">Back to home</Link>
        </Button>
      </Container>
    </main>
  );
}
