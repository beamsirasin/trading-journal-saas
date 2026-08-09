import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isOnboardingComplete } from '@/lib/trading-accounts/onboarding-guard';
import {
  getActiveTradingAccount,
  getActiveWorkspaceContext,
  getCurrentUserPreferences,
} from '@/server/auth/dal';
import { getSelfProfile, getSettingsWorkspaceSummary } from '@/server/auth/settings-dal';
import { getSubscriptionManagementPresentation } from '@/server/billing/subscription-management';
import { MetricLabel } from '@/components/product/metric';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { ProfileForm } from '@/components/settings/profile-form';
import { TimezoneForm } from '@/components/settings/timezone-form';
import { WorkspaceForm } from '@/components/settings/workspace-form';
import { Container } from '@/components/shell/container';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { ThemeSelector } from '@/components/theme/theme-selector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
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
  const t = await getTranslations({ locale: appLocale, namespace: 'settings' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/settings'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/settings'),
    },
  };
}

/** Authenticated account-level Settings. This route intentionally sits outside `(main)` so onboarding completion is not a prerequisite. */
export default async function SettingsPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const t = await getTranslations('settings');
  const tLanguage = await getTranslations('languageSwitcher');
  // Resolve/repair the account's personal workspace and preferences first.
  // A directly provisioned or recovered auth user can legitimately reach
  // this pre-onboarding route before those application rows exist; reading
  // preferences in parallel with the repair would race their creation.
  const workspace = await getActiveWorkspaceContext();
  const [profile, preferences, settingsWorkspace] = await Promise.all([
    getSelfProfile(),
    getCurrentUserPreferences(),
    getSettingsWorkspaceSummary(),
  ]);
  const onboardingComplete = isOnboardingComplete(workspace.onboardingCompletedAt);
  const [activeAccount, subscription] = onboardingComplete
    ? await Promise.all([
        getActiveTradingAccount(),
        getSubscriptionManagementPresentation(appLocale, preferences.timezone),
      ])
    : [null, null];

  return (
    <Container className="flex flex-col gap-10 py-8">
      <PageHeader title={t('title')} description={t('description')} />

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="profile-heading"
          title={t('profile.title')}
          description={t('profile.description')}
        />
        <ProfileForm profile={profile} />
      </section>

      <section aria-labelledby="preferences-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="preferences-heading"
          title={t('preferences.title')}
          description={t('preferences.description')}
        />
        <div className="bg-card border-border flex flex-col gap-8 rounded-lg border p-5 sm:p-6">
          <div className="flex flex-col gap-3">
            <h3 className="text-card-title">{t('preferences.timezone')}</h3>
            <TimezoneForm initialTimezone={preferences.timezone} />
          </div>
          <div className="border-t pt-6">
            <ThemeSelector />
          </div>
          <div className="border-t pt-6">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-foreground text-sm font-medium">{t('language.title')}</h3>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  {t('language.description')}
                </p>
              </div>
              <div className="flex min-h-11 shrink-0 items-center gap-2">
                <span className="text-foreground text-sm">{tLanguage(appLocale)}</span>
                <LanguageSwitcher />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="workspace-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="workspace-heading"
          title={t('workspace.title')}
          description={t('workspace.description')}
        />
        <WorkspaceForm workspace={settingsWorkspace} />
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="accounts-heading"
          title={t('accounts.title')}
          description={t('accounts.description')}
        />
        <div className="bg-card border-border flex flex-col items-start gap-4 rounded-lg border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm leading-relaxed">
              {onboardingComplete ? t('accounts.ready') : t('accounts.onboardingRequired')}
            </p>
            {activeAccount === null ? null : (
              <p className="text-foreground mt-2 text-sm font-semibold break-words">
                {t('accounts.active', { name: activeAccount.name })}
              </p>
            )}
          </div>
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link href={onboardingComplete ? '/app/accounts' : '/app/onboarding'}>
              {onboardingComplete ? t('accounts.manage') : t('completeOnboarding')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="subscription-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="subscription-heading"
          title={t('subscription.title')}
          description={t('subscription.description')}
        />
        <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 sm:p-6">
          {onboardingComplete ? (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-col gap-1">
                  <MetricLabel>{t('subscription.planShown')}</MetricLabel>
                  <span className="text-foreground text-sm font-semibold">
                    {subscription?.currentPlan?.name ?? t('subscription.trial')}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <MetricLabel>{t('subscription.tradingAccounts')}</MetricLabel>
                  <span className="numeric text-foreground text-sm font-semibold">
                    {subscription === null || subscription.accountLimit === null
                      ? '—'
                      : `${subscription.activeAccountCount} / ${subscription.accountLimit}`}
                  </span>
                </div>
                <Badge variant="warning" className="sm:ml-auto">
                  {subscription === null
                    ? t('subscription.unavailable')
                    : t(`subscription.status.${subscription.persistedStatus}`)}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/app/plan">{t('subscription.seePlans')}</Link>
                </Button>
              </div>
              {subscription?.pendingDowngrade ? (
                <p className="text-muted-foreground text-sm">
                  {t('subscription.pendingDowngrade', {
                    plan: subscription.pendingDowngrade.plan.name,
                    date: subscription.pendingDowngrade.effectiveAt,
                  })}
                </p>
              ) : null}
              {subscription?.cancellationScheduled ? (
                <p className="text-muted-foreground text-sm">
                  {t('subscription.cancellationScheduled', {
                    date: subscription.currentPeriodEndsAt ?? '—',
                  })}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t('subscription.onboardingRequired')}
              </p>
              <Button asChild variant="outline" className="min-h-11 shrink-0">
                <Link href="/app/onboarding">{t('completeOnboarding')}</Link>
              </Button>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="billing-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="billing-heading"
          title={t('billing.title')}
          description={t('billing.description')}
        />
        <div className="bg-card border-border flex flex-col items-start gap-4 rounded-lg border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {onboardingComplete ? t('billing.ready') : t('billing.onboardingRequired')}
          </p>
          <Button asChild variant="outline" className="min-h-11 shrink-0">
            <Link href={onboardingComplete ? '/app/billing' : '/app/onboarding'}>
              {onboardingComplete ? t('billing.view') : t('completeOnboarding')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </section>
    </Container>
  );
}
