import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { safeCallbackPath } from '@/lib/auth/callback-url';
import { isGoogleSignInConfigured } from '@/lib/auth/server';
import { getOptionalSession } from '@/server/auth/dal';
import { AuthForm } from '@/components/auth/auth-form';
import { Container } from '@/components/shell/container';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link, redirect } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { callbackUrl?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'auth' });

  return {
    title: t('loginTitle'),
    alternates: localizedAlternates(appLocale, '/login'),
    openGraph: {
      title: t('loginTitle'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/login'),
    },
    // A sign-in page has no business in an index even once it works.
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');

  // Defence in depth alongside `src/proxy.ts`'s optimistic redirect: a
  // genuinely authenticated visitor never sees the login form at all.
  const session = await getOptionalSession();
  const { callbackUrl } = await searchParams;
  const destination = safeCallbackPath(callbackUrl) ?? '/app';
  if (session !== null) {
    redirect({ href: destination, locale: locale as AppLocale });
  }

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-page-title">{t('loginTitle')}</h1>
        </div>

        <AuthForm
          mode="login"
          googleEnabled={isGoogleSignInConfigured()}
          callbackUrl={callbackUrl}
        />

        <p className="text-muted-foreground mt-8 text-center text-sm">
          {t('noAccount')}{' '}
          <Link
            href="/register"
            className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
          >
            {t('createOne')}
          </Link>
        </p>
      </div>
    </Container>
  );
}
