import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { Container } from '@/components/shell/container';
import { localizedAlternates } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'auth' });

  return {
    title: t('forgotPasswordTitle'),
    alternates: localizedAlternates(appLocale, '/forgot-password'),
    robots: { index: false, follow: false },
  };
}

export default async function ForgotPasswordPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-page-title">{t('forgotPasswordTitle')}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('forgotPasswordDescription')}
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="text-muted-foreground mt-8 text-center text-sm">
          <Link
            href="/login"
            className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
          >
            {t('backToLogin')}
          </Link>
        </p>
      </div>
    </Container>
  );
}
