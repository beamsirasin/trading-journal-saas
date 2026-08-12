import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import type { PersistedEntitlementStatus } from '@/lib/entitlements/resolve';
import { getCurrentUserPreferences } from '@/server/auth/dal';
import { getBillingPresentation } from '@/server/billing/presentation';
import { getSubscriptionManagementPresentation } from '@/server/billing/subscription-management';
import { getEffectivePlatformVatConfiguration } from '@/server/services/platform-vat-configuration';
import { SubscriptionManagementControls } from '@/components/billing/subscription-management-controls';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
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
  const t = await getTranslations({ locale: appLocale, namespace: 'entitlements.plan' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: localizedAlternates(appLocale, '/app/plan'),
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      ...localizedOpenGraph(appLocale, '/app/plan'),
    },
  };
}

const STATUS_VARIANT: Record<PersistedEntitlementStatus, BadgeVariant> = {
  trialing: 'brand',
  active: 'positive',
  past_due: 'warning',
  expired: 'negative',
  canceled: 'negative',
};

const STATUS_KEY = {
  trialing: 'statusTrialing',
  active: 'statusActive',
  past_due: 'statusPastDue',
  expired: 'statusExpired',
  canceled: 'statusCanceled',
} as const;

export default async function PlanPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const t = await getTranslations('entitlements.plan');
  const tPricing = await getTranslations('pricing');
  const preferences = await getCurrentUserPreferences();
  const [subscription, vatConfiguration] = await Promise.all([
    getSubscriptionManagementPresentation(appLocale, preferences.timezone),
    getEffectivePlatformVatConfiguration(),
  ]);
  const presentation = getBillingPresentation(appLocale, vatConfiguration);

  if (subscription === null) {
    return (
      <Container width="wide" className="flex flex-col gap-8 py-8">
        <PageHeader title={t('title')} description={t('description')} />
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 rounded-lg border p-5 text-sm"
        >
          {t('unavailable')}
        </div>
      </Container>
    );
  }

  const currency = subscription.billingCurrency ?? presentation.defaultCurrency;

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />

      <section
        aria-labelledby="plan-status-heading"
        className="border-border bg-card flex flex-col gap-5 rounded-xl border p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="plan-status-heading" className="text-card-title">
            {t('currentHeading')}
          </h2>
          <Badge variant={STATUS_VARIANT[subscription.persistedStatus]}>
            {t(STATUS_KEY[subscription.persistedStatus])}
          </Badge>
          {subscription.overLimit ? <Badge variant="warning">{t('overLimitBadge')}</Badge> : null}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label={t('currentPlanLabel')}
            value={subscription.currentPlan?.name ?? t('trialLabel')}
          />
          <Fact
            label={t('usageLabel')}
            value={
              subscription.accountLimit === null
                ? '—'
                : `${subscription.activeAccountCount} / ${subscription.accountLimit}`
            }
          />
          <Fact label={t('accessModeLabel')} value={t(`accessMode.${subscription.accessMode}`)} />
          <Fact label={t('billingCurrencyLabel')} value={subscription.billingCurrency ?? '—'} />
          <Fact
            label={t('billingIntervalLabel')}
            value={subscription.billingInterval === 'monthly' ? t('monthly') : '—'}
          />
          <Fact label={t('trialEndsLabel')} value={subscription.trialEndsAt ?? '—'} />
          <Fact label={t('periodEndsLabel')} value={subscription.currentPeriodEndsAt ?? '—'} />
          <Fact
            label={t('cancellationLabel')}
            value={
              subscription.cancellationScheduled ? t('cancellationScheduled') : t('notScheduled')
            }
          />
        </dl>
        {subscription.persistedStatus === 'past_due' ? (
          <p className="text-muted-foreground text-sm">{t('pastDueCheckoutBlocked')}</p>
        ) : null}
      </section>

      <SubscriptionManagementControls model={subscription} />

      <div>
        <Button asChild variant="outline">
          <Link href="/app/billing">{t('billingHistory')}</Link>
        </Button>
      </div>

      <section aria-labelledby="available-plans-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="available-plans-heading" className="text-card-title">
            {t('plansHeading')}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('identicalFeaturesNote')}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t('displayCurrency', { currency })}</p>
        </div>
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {presentation.plans.map((plan) => {
            const isCurrent = subscription.currentPlan?.id === plan.id;
            const enabled = subscription.upgradeOptions.some((option) => option.id === plan.id);
            return (
              <li key={plan.id} className="flex">
                <div
                  className={
                    isCurrent
                      ? 'border-primary/50 bg-card shadow-elevated flex flex-1 flex-col gap-5 rounded-xl border p-6'
                      : 'border-border bg-card flex flex-1 flex-col gap-5 rounded-xl border p-6'
                  }
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-card-title">{plan.name}</h3>
                      {isCurrent ? <Badge variant="brand">{t('currentPlanBadge')}</Badge> : null}
                      {plan.featured ? (
                        <Badge variant="neutral">{tPricing('mostPopular')}</Badge>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground mt-2 text-sm">
                      {tPricing(`plans.${plan.id}.tagline`)}
                    </p>
                  </div>
                  <p className="text-foreground text-lg font-semibold">
                    {tPricing('priceMonthly', { price: plan.prices[currency].formatted })}
                  </p>
                  <p className="border-border rounded-lg border border-dashed p-3 text-sm">
                    {t('accountAllowance', { count: plan.activeTradingAccountLimit })}
                  </p>
                  <ul className="flex flex-1 flex-col gap-2">
                    {presentation.sharedFeatureKeys.map((feature) => (
                      <li
                        key={feature}
                        className="text-muted-foreground flex items-start gap-2 text-sm"
                      >
                        <Check
                          className="text-positive mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        {tPricing(`sharedFeatures.${feature}`)}
                      </li>
                    ))}
                  </ul>
                  {enabled ? (
                    <Button asChild variant={plan.featured ? 'default' : 'outline'}>
                      <Link href={`/app/checkout?plan=${plan.id}&currency=${currency}`}>
                        {subscription.persistedStatus === 'active' ? t('upgrade') : t('choosePlan')}
                      </Link>
                    </Button>
                  ) : (
                    <Button disabled variant="outline">
                      {isCurrent
                        ? t('currentPlanBadge')
                        : subscription.persistedStatus === 'past_due'
                          ? t('checkoutUnavailable')
                          : t('notAnUpgrade')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {presentation.vat.enabled ? (
        <p className="text-muted-foreground text-center text-sm">
          {tPricing('vatExclusiveNotice', { rate: presentation.vat.ratePercent })}
        </p>
      ) : null}
    </Container>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="text-foreground mt-1 text-sm font-semibold break-words">{value}</dd>
    </div>
  );
}
