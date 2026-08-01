'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Route-level error boundary. Must be a client component — React needs to
 * attach it as an error boundary, which server components cannot be.
 *
 * The raw error message is never rendered. It can contain connection strings,
 * query fragments, or internal paths, and in production Next.js replaces it
 * with a digest anyway. The digest IS shown, because it is the only thing
 * that lets a user's report be matched to a server log.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    // Error tracking (Sentry or equivalent) is wired in Phase 12.
    console.error('Application route error:', error);
  }, [error]);

  return (
    <Container className="py-16">
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error.digest === undefined ? null : (
            <p className="text-muted-foreground font-mono text-xs">
              {t('reference')} <span className="select-all">{error.digest}</span>
            </p>
          )}
          <div>
            <Button onClick={reset}>{t('tryAgain')}</Button>
          </div>
        </CardContent>
      </Card>
    </Container>
  );
}
