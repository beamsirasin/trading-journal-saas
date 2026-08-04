import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  ResendVerificationButton,
  type VerificationDispatchNotice,
} from '@/components/auth/resend-verification-button';
import { Container } from '@/components/shell/container';
import { localizedAlternates } from '@/i18n/metadata';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { email?: string; notice?: string };

/**
 * Narrows the raw `notice` query param `AuthForm` attaches
 * (`src/components/auth/auth-form.tsx`) after its own post-registration
 * dispatch attempt. Anything else (missing, mistyped, tampered-with) is
 * treated as "no notice" rather than trusted — this only ever seeds a UI
 * hint, never an authorization decision.
 */
function parseDispatchNotice(value: string | undefined): VerificationDispatchNotice | undefined {
  return value === 'rate-limited' || value === 'delivery-failed' ? value : undefined;
}

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
  const { email, notice } = await searchParams;
  const dispatchNotice = parseDispatchNotice(notice);

  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        <h1 className="text-page-title">{t('verifyEmailPendingTitle')}</h1>
        {/*
          Named region so E2E/assistive-tech can scope anti-enumeration
          assertions to exactly this content rather than the whole page —
          CLAUDE.md's account-enumeration rule requires the message to never
          reveal whether the submitted email exists, is verified, or is
          unverified, and a whole-page text scan is too broad to assert that
          safely (unrelated copy elsewhere on the page could coincidentally
          match a generic word like "account").
        */}
        <div
          role="region"
          aria-label={t('verifyEmailStatusRegionLabel')}
          className="flex flex-col items-center gap-5"
        >
          {/*
            Deliberately the SAME generic message regardless of whether the
            registered email exists — CLAUDE.md's account-enumeration rule.
            `whitespace-pre-line` renders the message's embedded newline
            without needing a second translation key per sentence.
          */}
          <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">
            {t('verifyEmailPendingBody')}
          </p>

          {email !== undefined ? (
            <ResendVerificationButton email={email} initialNotice={dispatchNotice} />
          ) : null}

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
      </div>
    </Container>
  );
}
