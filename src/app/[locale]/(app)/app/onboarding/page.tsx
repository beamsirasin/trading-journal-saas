import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isOnboardingComplete } from '@/lib/trading-accounts/onboarding-guard';
import { getActiveWorkspaceContext, getCurrentUserPreferences } from '@/server/auth/dal';
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard';
import { Container } from '@/components/shell/container';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
import { redirect } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  const t = await getTranslations({ locale: appLocale, namespace: 'onboarding' });

  return {
    title: t('title'),
    alternates: localizedAlternates(appLocale, '/app/onboarding'),
    openGraph: {
      title: t('title'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/onboarding'),
    },
    robots: { index: false, follow: false },
  };
}

/**
 * `/app/onboarding` — sits OUTSIDE the `(main)` route group
 * (`(app)/app/(main)/layout.tsx`), which is what lets this page carry the
 * inverse of that layout's check without looping: `(main)` redirects here
 * while onboarding is incomplete, this redirects to `/app` once onboarding
 * IS complete. See `(main)/layout.tsx`'s comment for the full reasoning.
 */
export default async function OnboardingPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('onboarding');

  const workspace = await getActiveWorkspaceContext();
  if (isOnboardingComplete(workspace.onboardingCompletedAt)) {
    redirect({ href: '/app', locale: locale as AppLocale });
  }

  const preferences = await getCurrentUserPreferences();

  return (
    <Container width="prose" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-page-title">{t('title')}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          {t('description')}
        </p>
      </div>
      <OnboardingWizard defaultTimezone={preferences.timezone} />
    </Container>
  );
}
