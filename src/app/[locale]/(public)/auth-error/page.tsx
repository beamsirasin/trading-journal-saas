import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Container } from '@/components/shell/container';
import { localizedAlternates } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { error?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'auth' });

  return {
    title: t('authErrorTitle'),
    alternates: localizedAlternates(appLocale, '/auth-error'),
    robots: { index: false, follow: false },
  };
}

/**
 * Better Auth's `onAPIError.errorURL` (src/lib/auth/server.ts) sends every
 * API-level failure here with the raw error code as a query parameter —
 * most relevantly a cancelled or denied Google sign-in. The raw code is
 * never shown to the user (CLAUDE.md: no raw backend error codes reach the
 * UI); it is only used to pick which of three safe, localized sentences to
 * show, with a generic fallback for anything unrecognized.
 */
export default async function AuthErrorPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');
  const { error } = await searchParams;
  const code = (error ?? '').toLowerCase();

  const description = code.includes('cancel')
    ? t('googleCancelled')
    : code.includes('denied') || code.includes('access_denied')
      ? t('googleAccessDenied')
      : t('authErrorDescription');

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <h1 className="text-page-title">{t('authErrorTitle')}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
        <Link
          href="/login"
          className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center text-sm underline underline-offset-4"
        >
          {t('authErrorBackToLogin')}
        </Link>
      </div>
    </Container>
  );
}
