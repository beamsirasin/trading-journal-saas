'use client';

import { useEffect } from 'react';

import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

import './globals.css';

/**
 * The root error boundary, in the special sense Next.js gives this exact
 * filename: it only activates when `app/[locale]/layout.tsx` itself throws,
 * meaning that layout's `<html>`/`<body>` never rendered. There is no other
 * root layout above it any more (every real route is reached through
 * `[locale]`), so this file supplies its own — the one case in the app where
 * that is correct rather than a duplicate.
 *
 * Deliberately not translated. If the locale layout failed, the locale may
 * not have resolved either, and a broken translation lookup inside an error
 * boundary would replace one failure with a more confusing one. English,
 * the documented fallback locale, is the safe constant here.
 */
export default function GlobalError({
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
    <html lang="en">
      <body className="min-h-dvh overflow-x-hidden antialiased">
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
      </body>
    </html>
  );
}
