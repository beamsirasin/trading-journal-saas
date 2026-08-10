'use client';

import { useEffect } from 'react';

import { adminCopy } from '@/components/admin/admin-copy';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Route-level error boundary for the Admin dashboard — mirrors `(app)/
 * error.tsx`'s exact posture (sanitized message, digest only, retry action)
 * with EN-only copy instead of `next-intl`. The raw error message is never
 * rendered: it can carry connection strings, query fragments, or internal
 * paths, and Next.js already replaces it with a digest in production. Never
 * renders SQL, a stack trace, tenant Trade content, or auth/grant internals
 * — an unexpected metrics-query failure and an authorization failure are
 * handled separately (this boundary only ever sees the former; authorization
 * failures are `redirect()`/`notFound()` in the layout, never a thrown error
 * this boundary would catch).
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Error tracking (Sentry or equivalent) is wired in Phase 12.
    console.error('Admin route error:', error);
  }, [error]);

  return (
    <Container className="py-16">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>{adminCopy.errors.title}</CardTitle>
          <CardDescription>{adminCopy.errors.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error.digest === undefined ? null : (
            <p className="text-muted-foreground font-mono text-xs">
              {adminCopy.errors.reference} <span className="select-all">{error.digest}</span>
            </p>
          )}
          <div>
            <Button onClick={reset}>{adminCopy.errors.retry}</Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
