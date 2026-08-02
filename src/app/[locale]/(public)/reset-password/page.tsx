import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { Container } from '@/components/shell/container';
import { localizedAlternates } from '@/i18n/metadata';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { token?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'auth' });

  return {
    title: t('resetPasswordTitle'),
    alternates: localizedAlternates(appLocale, '/reset-password'),
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');
  const { token } = await searchParams;

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-page-title">{t('resetPasswordTitle')}</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('resetPasswordDescription')}
          </p>
        </div>

        <ResetPasswordForm token={token} />
      </div>
    </Container>
  );
}
