import Link from 'next/link';

import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';

import { Brand } from './brand';
import { Container } from './container';

/**
 * Public (unauthenticated) header.
 *
 * Kept separate from the app header rather than branched inside one
 * component: the two diverge quickly — marketing navigation versus product
 * navigation — and a shared header full of conditionals is harder to change
 * than two honest ones.
 */
export function PublicHeader() {
  return (
    <header className="border-border border-b">
      <Container className="flex h-14 items-center gap-4">
        <Brand href="/" />
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Button asChild size="sm" className="min-h-11">
            <Link href="/app">Open app</Link>
          </Button>
        </div>
      </Container>
    </header>
  );
}
