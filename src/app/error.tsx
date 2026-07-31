'use client';

import { useEffect } from 'react';

import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

/**
 * Root error boundary — catches anything the route-group boundaries do not.
 *
 * Like the app boundary, it shows the digest rather than the message: the
 * message may carry internals, the digest is what correlates with the log.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center">
      <Container className="flex flex-col items-start gap-5 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-muted-foreground max-w-prose">
          An unexpected error occurred. The problem has been logged.
        </p>
        {error.digest === undefined ? null : (
          <p className="text-muted-foreground font-mono text-xs">
            Reference: <span className="select-all">{error.digest}</span>
          </p>
        )}
        <Button onClick={reset}>Try again</Button>
      </Container>
    </main>
  );
}
