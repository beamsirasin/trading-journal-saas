import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { ResendVerificationButton } from '@/components/auth/resend-verification-button';
import { Container } from '@/components/shell/container';
import { localizedAlternates } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { email?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'auth' });

  return {
    title: t('verifyEmailPendingTitle'),
    alternates: localizedAlternates(appLocale, '/verify-email'),
    robots: { index: false, follow: false },
  };
}

export default async function VerifyEmailPendingPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');
  const { email } = await searchParams;

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <h1 className="text-page-title">{t('verifyEmailPendingTitle')}</h1>
        {/*
          Deliberately the SAME generic message regardless of whether the
          registered email exists — CLAUDE.md's account-enumeration rule.
          `whitespace-pre-line` renders the message's embedded newline
          without needing a second translation key per sentence.
        */}
        <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">
          {t('verifyEmailPendingBody')}
        </p>

        {email !== undefined ? <ResendVerificationButton email={email} /> : null}

        <div className="flex flex-col items-center gap-2">
          <Link
            href="/login"
            className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center text-sm underline underline-offset-4"
          >
            {t('backToLogin')}
          </Link>
          <Link
            href="/forgot-password"
            className="text-muted-foreground inline-flex min-h-11 min-w-11 items-center justify-center text-xs underline underline-offset-4"
          >
            {t('forgotPasswordLink')}
          </Link>
        </div>
      </div>
    </Container>
  );
}
