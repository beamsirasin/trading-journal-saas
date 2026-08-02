import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Container } from '@/components/shell/container';
import { localizedAlternates } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
/** Better Auth appends `error` to the callback URL on an expired/invalid token; a plain redirect (no `error`) means success. */
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
    title: t('verifyEmailSuccessTitle'),
    alternates: localizedAlternates(appLocale, '/verify-email/complete'),
    robots: { index: false, follow: false },
  };
}

export default async function VerifyEmailCompletePage({
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
  const failed = error !== undefined;

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <h1 className="text-page-title">
          {failed ? t('verifyEmailInvalidTitle') : t('verifyEmailSuccessTitle')}
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {failed ? t('verifyEmailInvalidBody') : t('verifyEmailSuccessBody')}
        </p>
        <Link
          href="/login"
          className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center text-sm underline underline-offset-4"
        >
          {t('verifyEmailSuccessCta')}
        </Link>
      </div>
    </Container>
  );
}
