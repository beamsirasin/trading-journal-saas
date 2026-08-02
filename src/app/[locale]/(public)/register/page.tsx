import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TRIAL_DAYS } from '@/config/plans';
import { isGoogleSignInConfigured } from '@/lib/auth/server';
import { getOptionalSession } from '@/server/auth/dal';
import { AuthForm } from '@/components/auth/auth-form';
import { Container } from '@/components/shell/container';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { Link, redirect } from '@/i18n/navigation';
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
    title: t('registerTitle'),
    alternates: localizedAlternates(appLocale, '/register'),
    openGraph: {
      title: t('registerTitle'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/register'),
    },
    robots: { index: false, follow: false },
  };
}

export default async function RegisterPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');
  const trialPointCount = (t.raw('trialPoints') as readonly string[]).length;

  const session = await getOptionalSession();
  if (session !== null) {
    redirect({ href: '/app', locale: locale as AppLocale });
  }

  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto grid w-full max-w-4xl gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-page-title text-balance">{t('registerTitle')}</h1>
          </div>

          <ul className="flex flex-col gap-3">
            {Array.from({ length: trialPointCount }, (_, index) => (
              <li key={index} className="flex items-start gap-2.5 text-sm">
                <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="text-muted-foreground leading-relaxed">
                  {t(`trialPoints.${index}`, { trialDays: TRIAL_DAYS })}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground border-border border-l-2 pl-4 text-xs leading-relaxed">
            {t('paymentNote')}
          </p>
        </div>

        {/*
          `max-w-md mx-auto` below `lg`: the two columns stack there, and this
          div would otherwise take the full grid-track width — around 700px
          at a tablet viewport — stretching every input far wider than the
          same fields render on `/login`. `lg:max-w-none lg:mx-0` lifts the
          cap once the two-column layout is active, where the `max-w-4xl`
          grid already keeps the column near 416px.
        */}
        <div className="mx-auto flex w-full max-w-md flex-col lg:mx-0 lg:max-w-none">
          <AuthForm mode="register" googleEnabled={isGoogleSignInConfigured()} />

          <p className="text-muted-foreground mt-8 text-center text-sm">
            {t('haveAccount')}{' '}
            <Link
              href="/login"
              className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
            >
              {t('loginLink')}
            </Link>
          </p>
        </div>
      </div>
    </Container>
  );
}
