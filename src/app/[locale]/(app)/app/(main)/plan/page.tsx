import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { computeTrialRemaining, type EffectiveEntitlement } from '@/lib/entitlements/resolve';
import { formatInstant, systemClock } from '@/lib/time';
import { getCurrentUserPreferences, getWorkspaceEntitlement } from '@/server/auth/dal';
import { getBillingPresentation } from '@/server/billing/presentation';
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

const STATUS_VARIANT: Record<EffectiveEntitlement['persistedStatus'], BadgeVariant> = {
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
  const tBanner = await getTranslations('entitlements.banner');
  const [entitlement, preferences] = await Promise.all([
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
  ]);
  const presentation = getBillingPresentation(appLocale);

  if (entitlement === null) {
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

  const currency =
    entitlement.persistedStatus === 'active' && entitlement.billingCurrency !== null
      ? entitlement.billingCurrency
      : presentation.defaultCurrency;
  const currentPlan =
    entitlement.effectivePlanKey === null
      ? null
      : (presentation.plans.find((plan) => plan.id === entitlement.effectivePlanKey) ?? null);
  const currentLimit = currentPlan?.activeTradingAccountLimit ?? 0;
  const canCheckout = entitlement.persistedStatus !== 'past_due';
  const trialRemaining =
    entitlement.effectiveStatus === 'trialing' && entitlement.trialEndsAt !== null
      ? computeTrialRemaining(entitlement.trialEndsAt, systemClock.now())
      : null;

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
          <Badge variant={STATUS_VARIANT[entitlement.persistedStatus]}>
            {t(STATUS_KEY[entitlement.persistedStatus])}
          </Badge>
          {entitlement.overLimit ? <Badge variant="warning">{t('overLimitBadge')}</Badge> : null}
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label={t('currentPlanLabel')} value={currentPlan?.name ?? t('trialLabel')} />
          <Fact
            label={t('usageLabel')}
            value={
              entitlement.accountLimit === null
                ? '—'
                : `${entitlement.activeAccountCount} / ${entitlement.accountLimit}`
            }
          />
          <Fact label={t('accessModeLabel')} value={t(`accessMode.${entitlement.accessMode}`)} />
          <Fact label={t('billingCurrencyLabel')} value={entitlement.billingCurrency ?? '—'} />
          <Fact
            label={t('billingIntervalLabel')}
            value={entitlement.billingInterval === 'monthly' ? t('monthly') : '—'}
          />
          <Fact
            label={t('trialEndsLabel')}
            value={dateValue(entitlement.trialEndsAt, preferences.timezone)}
          />
          <Fact
            label={t('periodEndsLabel')}
            value={dateValue(entitlement.currentPeriodEndsAt, preferences.timezone)}
          />
          <Fact
            label={t('cancellationLabel')}
            value={entitlement.cancelAtPeriodEnd ? t('cancellationScheduled') : t('notScheduled')}
          />
        </dl>
        {trialRemaining !== null && !trialRemaining.expired ? (
          <p className="text-muted-foreground text-sm">
            {trialRemaining.lessThanOneDay
              ? tBanner('lessThanOneDay')
              : tBanner('daysRemaining', { days: trialRemaining.days })}
          </p>
        ) : null}
        {entitlement.pendingPlanKey !== null ? (
          <p className="border-border bg-muted/40 rounded-lg border p-4 text-sm">
            {t('pendingDowngrade', {
              plan:
                presentation.plans.find((plan) => plan.id === entitlement.pendingPlanKey)?.name ??
                entitlement.pendingPlanKey,
              date: dateValue(entitlement.pendingPlanEffectiveAt, preferences.timezone),
            })}
          </p>
        ) : null}
        {entitlement.persistedStatus === 'past_due' ? (
          <p className="text-muted-foreground text-sm">{t('pastDueCheckoutBlocked')}</p>
        ) : null}
      </section>

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
            const isCurrent = entitlement.effectivePlanKey === plan.id;
            const isUpgrade =
              entitlement.persistedStatus !== 'active' ||
              plan.activeTradingAccountLimit > currentLimit;
            const enabled = canCheckout && !isCurrent && isUpgrade;
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
                        {entitlement.persistedStatus === 'active' ? t('upgrade') : t('choosePlan')}
                      </Link>
                    </Button>
                  ) : (
                    <Button disabled variant="outline">
                      {isCurrent
                        ? t('currentPlanBadge')
                        : entitlement.persistedStatus === 'past_due'
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

function dateValue(date: Date | null, timezone: string): string {
  if (date === null) return '—';
  const formatted = formatInstant(date, timezone, { style: 'date' });
  return formatted.ok ? formatted.value : date.toISOString();
}
