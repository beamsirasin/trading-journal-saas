import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { DemoAuthForm } from '@/components/forms/demo-auth-form';
import { Container } from '@/components/shell/container';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });

  return {
    title: t('loginTitle'),
    description: t('loginPreviewNote'),
    alternates: { canonical: '/login' },
    // A sign-in page has no business in an index even once it works.
    robots: { index: false, follow: false },
  };
}

export default async function LoginPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-page-title">{t('loginTitle')}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">{t('loginPreviewNote')}</p>
        </div>

        <DemoAuthForm mode="login" />

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
