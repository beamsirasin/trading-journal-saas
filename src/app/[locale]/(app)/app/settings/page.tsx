import { ArrowRight, CircleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isOnboardingComplete } from '@/lib/trading-accounts/onboarding-guard';
import { getAccountSecurityView } from '@/server/auth/account-security-dal';
import {
  getActiveTradingAccount,
  getActiveWorkspaceContext,
  getCurrentUserPreferences,
} from '@/server/auth/dal';
import {
  getSelfProfile,
  getSettingsWorkspaceSummary,
  type SettingsWorkspaceSummary,
} from '@/server/auth/settings-dal';
import { getSubscriptionManagementPresentation } from '@/server/billing/subscription-management';
import { MetricLabel } from '@/components/product/metric';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { DataExportSection } from '@/components/settings/data-export-section';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecuritySection } from '@/components/settings/security-section';
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

type WorkspaceSettingsState =
  | {
      readonly status: 'available';
      readonly context: Awaited<ReturnType<typeof getActiveWorkspaceContext>>;
      readonly summary: SettingsWorkspaceSummary;
    }
  | { readonly status: 'unavailable' };

async function getWorkspaceSettingsState(): Promise<WorkspaceSettingsState> {
  try {
    const context = await getActiveWorkspaceContext();
    const summary = await getSettingsWorkspaceSummary();
    return { status: 'available', context, summary };
  } catch {
    // Tenant repair/read failures must not take down account-level Profile or
    // Security. Workspace-scoped cards retain their own authorization and
    // render a closed, truthful unavailable state.
    return { status: 'unavailable' };
  }
}

function WorkspaceUnavailable({ message }: { readonly message: string }) {
  return (
    <div className="bg-card border-border text-muted-foreground flex min-h-11 items-start gap-2 rounded-lg border p-5 text-sm sm:p-6">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

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
  const [profile, security, workspaceState] = await Promise.all([
    getSelfProfile(),
    getAccountSecurityView(),
    getWorkspaceSettingsState(),
  ]);
  // Read preferences only after the workspace repair attempt. A missing row
  // is a provisioning failure, but must not block account-level security.
  const preferences = await getCurrentUserPreferences().catch(() => null);
  const timezone = preferences?.timezone ?? 'UTC';
  const onboardingComplete =
    workspaceState.status === 'available' &&
    isOnboardingComplete(workspaceState.context.onboardingCompletedAt);
  const [activeAccount, subscription] = onboardingComplete
    ? await Promise.all([
        getActiveTradingAccount(),
        getSubscriptionManagementPresentation(appLocale, timezone),
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
            {preferences === null ? (
              <p className="text-muted-foreground flex min-h-11 items-center gap-2 text-sm">
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {t('preferences.timezoneUnavailable')}
              </p>
            ) : (
              <TimezoneForm initialTimezone={preferences.timezone} />
            )}
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

      <section aria-labelledby="security-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="security-heading"
          title={t('security.title')}
          description={t('security.description')}
        />
        <SecuritySection security={security} timezone={timezone} />
      </section>

      <section aria-labelledby="workspace-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="workspace-heading"
          title={t('workspace.title')}
          description={t('workspace.description')}
        />
        {workspaceState.status === 'available' ? (
          <WorkspaceForm workspace={workspaceState.summary} />
        ) : (
          <WorkspaceUnavailable message={t('workspace.unavailable')} />
        )}
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
              {workspaceState.status === 'unavailable'
                ? t('accounts.workspaceUnavailable')
                : onboardingComplete
                  ? t('accounts.ready')
                  : t('accounts.onboardingRequired')}
            </p>
            {activeAccount === null ? null : (
              <p className="text-foreground mt-2 text-sm font-semibold break-words">
                {t('accounts.active', { name: activeAccount.name })}
              </p>
            )}
          </div>
          {workspaceState.status === 'available' ? (
            <Button asChild variant="outline" className="min-h-11 shrink-0">
              <Link href={onboardingComplete ? '/app/accounts' : '/app/onboarding'}>
                {onboardingComplete ? t('accounts.manage') : t('completeOnboarding')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="subscription-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="subscription-heading"
          title={t('subscription.title')}
          description={t('subscription.description')}
        />
        <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 sm:p-6">
          {workspaceState.status === 'unavailable' ? (
            <p className="text-muted-foreground flex min-h-11 items-center gap-2 text-sm">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              {t('subscription.workspaceUnavailable')}
            </p>
          ) : onboardingComplete ? (
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
            {workspaceState.status === 'unavailable'
              ? t('billing.workspaceUnavailable')
              : onboardingComplete
                ? t('billing.ready')
                : t('billing.onboardingRequired')}
          </p>
          {workspaceState.status === 'available' ? (
            <Button asChild variant="outline" className="min-h-11 shrink-0">
              <Link href={onboardingComplete ? '/app/billing' : '/app/onboarding'}>
                {onboardingComplete ? t('billing.view') : t('completeOnboarding')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="data-export-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="data-export-heading"
          title={t('dataExport.title')}
          description={t('dataExport.description')}
        />
        {workspaceState.status === 'available' ? (
          <DataExportSection role={workspaceState.summary.role} />
        ) : (
          <WorkspaceUnavailable message={t('dataExport.workspaceUnavailable')} />
        )}
      </section>
    </Container>
  );
}
