import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PLANS, TRIAL_DAYS } from '@/config/plans';
import { DEMO_ACCOUNTS } from '@/lib/demo';
import { DEMO_TIME_ZONE } from '@/components/dashboard/format';
import { DemoBadge } from '@/components/product/demo-badge';
import { MetricLabel } from '@/components/product/metric';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { ThemeSelector } from '@/components/theme/theme-selector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/**
 * Settings preview.
 *
 * Appearance and Language are REAL and fully working — both need no account,
 * no database and no server, so shipping either disabled would be pretending
 * something is hard that is not.
 *
 * Everything else is a disabled preview. Profile and account fields are
 * `readOnly` rather than `disabled`: a read-only input stays focusable and
 * readable by a screen reader, whereas a disabled one is skipped entirely,
 * which hides the layout being previewed from exactly the users most likely
 * to be reviewing it.
 */
export default async function SettingsPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('settings');
  const tLanguageSwitcher = await getTranslations('languageSwitcher');
  const tradingAccounts = DEMO_ACCOUNTS.filter((account) => account.id !== 'all');
  const currentPlan = PLANS.find((plan) => plan.featured) ?? PLANS[0];

  return (
    <Container className="flex flex-col gap-10 py-8">
      <PageHeader title={t('title')} description={t('description')} meta={<DemoBadge />} />

      <section aria-labelledby="appearance-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="appearance-heading"
          title={t('appearance.title')}
          description={t('appearance.description')}
        />
        <div className="bg-card border-border rounded-lg border p-5 sm:p-6">
          <ThemeSelector />
        </div>
      </section>

      <section aria-labelledby="language-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="language-heading"
          title={t('language.title')}
          description={t('language.description')}
        />
        <div className="bg-card border-border flex items-center justify-between gap-4 rounded-lg border p-5 sm:p-6">
          <p className="text-foreground text-sm font-medium">{tLanguageSwitcher('label')}</p>
          <LanguageSwitcher />
        </div>
      </section>

      <section aria-labelledby="profile-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="profile-heading"
          title={t('profile.title')}
          description={t('profile.description')}
        />
        <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 sm:p-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-name">{t('profile.name')}</Label>
              <Input id="settings-name" defaultValue="Demo trader" readOnly />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-email">{t('profile.email')}</Label>
              <Input id="settings-email" type="email" defaultValue="demo@example.com" readOnly />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-timezone">{t('profile.timezone')}</Label>
              <Input id="settings-timezone" defaultValue={DEMO_TIME_ZONE} readOnly />
              <p className="text-muted-foreground text-xs leading-relaxed">
                {t('profile.timezoneNote')}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-currency">{t('profile.currency')}</Label>
              <Input id="settings-currency" defaultValue="USD" readOnly />
            </div>
          </div>

          <div>
            <Button disabled aria-describedby="profile-note">
              {t('profile.save')}
            </Button>
            <p id="profile-note" className="text-muted-foreground mt-2 text-sm">
              {t('profile.saveNote')}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="accounts-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="accounts-heading"
          title={t('accounts.title')}
          description={t('accounts.description')}
          actions={
            <Button
              variant="outline"
              className="min-h-11"
              disabled
              aria-describedby="accounts-note"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t('accounts.add')}
            </Button>
          }
        />

        <ul className="flex flex-col gap-3">
          {tradingAccounts.map((account) => (
            <li
              key={account.id}
              className="bg-card border-border flex flex-wrap items-center gap-4 rounded-lg border p-4"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-foreground text-sm font-medium">{account.name}</span>
                <span className="text-muted-foreground text-xs">{account.broker}</span>
              </div>
              <span className="numeric text-muted-foreground ml-auto text-xs">
                {account.currency}
              </span>
            </li>
          ))}
        </ul>

        <p id="accounts-note" className="text-muted-foreground text-sm">
          {t('accounts.note')}
        </p>
      </section>

      <section aria-labelledby="subscription-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="subscription-heading"
          title={t('subscription.title')}
          description={t('subscription.description')}
        />
        <div className="bg-card border-border flex flex-col gap-5 rounded-lg border p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <MetricLabel>{t('subscription.planShown')}</MetricLabel>
              <span className="text-foreground text-sm font-semibold">{currentPlan?.name}</span>
            </div>
            <div className="flex flex-col gap-1">
              <MetricLabel>{t('subscription.tradingAccounts')}</MetricLabel>
              <span className="numeric text-foreground text-sm font-semibold">
                {currentPlan?.tradingAccounts}
              </span>
            </div>
            <Badge variant="warning" className="ml-auto">
              {t('subscription.trialNotStarted', { trialDays: TRIAL_DAYS })}
            </Badge>
          </div>

          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('subscription.note')}{' '}
            <Link
              href="/pricing"
              className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
            >
              {t('subscription.seePlans')}
            </Link>
          </p>
        </div>
      </section>
    </Container>
  );
}
