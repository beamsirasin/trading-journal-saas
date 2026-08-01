import { getTranslations } from 'next-intl/server';

import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * The 404 a real visitor actually reaches. `app/global-error.tsx` documents
 * why a second, English-only, self-contained boundary exists above this one.
 */
export default async function NotFound() {
  const t = await getTranslations('notFound');

  return (
    <main className="flex min-h-dvh items-center">
      <Container className="flex flex-col items-start gap-5 py-16">
        <p className="text-muted-foreground font-mono text-sm">404</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('title')}</h1>
        <p className="text-muted-foreground max-w-prose">{t('description')}</p>
        <Button asChild>
          <Link href="/">{t('backHome')}</Link>
        </Button>
      </Container>
    </main>
  );
}
