import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PLANS, TRIAL_DAYS, type Plan } from '@/config/plans';
import { computeTrialRemaining } from '@/lib/entitlements/resolve';
import { formatInstant, systemClock } from '@/lib/time';
import {
  getCurrentUserPreferences,
  getWorkspaceEntitlement,
  type EffectiveEntitlement,
} from '@/server/auth/dal';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { localizedAlternates, localizedOpenGraph } from '@/i18n/metadata';
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

const STATUS_BADGE_VARIANT: Record<EffectiveEntitlement['effectiveStatus'], BadgeVariant> = {
  trialing: 'brand',
  active: 'positive',
  expired: 'negative',
  canceled: 'negative',
};

const STATUS_LABEL_KEY: Record<
  EffectiveEntitlement['effectiveStatus'],
  'statusTrialing' | 'statusActive' | 'statusExpired' | 'statusCanceled'
> = {
  trialing: 'statusTrialing',
  active: 'statusActive',
  expired: 'statusExpired',
  canceled: 'statusCanceled',
};

/**
 * Phase 3C's "Plan & billing" page — the one place a signed-in user sees
 * their workspace's real, server-resolved entitlement snapshot alongside
 * the same three plan definitions the public `/pricing` page renders
 * (`src/config/plans.ts`, never a second, duplicated registry). No button
 * here can activate a plan or charge anything — CLAUDE.md §9's "payments are
 * a mock flow" extends to "no flow at all yet" for this phase; the CTA is
 * an honest "coming soon," not a fake success screen.
 */
export default async function PlanPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('entitlements.plan');
  const tBanner = await getTranslations('entitlements.banner');
  const tPricing = await getTranslations('pricing');

  const [entitlement, preferences] = await Promise.all([
    getWorkspaceEntitlement(),
    getCurrentUserPreferences(),
  ]);

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />

      {entitlement === null ? null : (
        <section
          aria-labelledby="plan-status-heading"
          className="border-border bg-card flex flex-col gap-5 rounded-xl border p-6"
        >
          <h2 id="plan-status-heading" className="sr-only">
            {t('currentPlanLabel')}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={STATUS_BADGE_VARIANT[entitlement.effectiveStatus]}>
              {t(STATUS_LABEL_KEY[entitlement.effectiveStatus])}
            </Badge>
            {entitlement.effectiveStatus === 'trialing' && entitlement.trialEndsAt !== null ? (
              <TrialEndsLabel
                trialEndsAt={entitlement.trialEndsAt}
                timezone={preferences.timezone}
              />
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-label uppercase">
                {t('currentPlanLabel')}
              </span>
              <span className="text-foreground text-lg font-semibold">
                {entitlement.planKey === null
                  ? tBanner('trialActive')
                  : (PLANS.find((plan) => plan.id === entitlement.planKey)?.name ??
                    entitlement.planKey)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-label uppercase">{t('usageLabel')}</span>
              <span className="numeric text-foreground text-lg font-semibold">
                {entitlement.accountLimit === null
                  ? '—'
                  : `${entitlement.activeAccountCount} / ${entitlement.accountLimit}`}
              </span>
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="available-plans-heading" className="flex flex-col gap-4">
        <h2 id="available-plans-heading" className="text-card-title">
          {t('plansHeading')}
        </h2>
        <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <li key={plan.id} className="flex">
              <PlanCard
                plan={plan}
                isCurrent={entitlement !== null && entitlement.planKey === plan.id}
              />
            </li>
          ))}
        </ul>
      </section>

      <div className="border-border bg-card mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-lg border p-5 sm:flex-row">
        <Info className="text-info size-5 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-2 text-sm leading-relaxed">
          <p className="text-foreground font-medium">{t('paymentNotConnected')}</p>
          <p className="text-muted-foreground">
            {tPricing('paymentNoticeBody', { trialDays: TRIAL_DAYS })}
          </p>
        </div>
      </div>
    </Container>
  );
}

async function TrialEndsLabel({ trialEndsAt, timezone }: { trialEndsAt: Date; timezone: string }) {
  const t = await getTranslations('entitlements.plan');
  const tBanner = await getTranslations('entitlements.banner');
  const remaining = computeTrialRemaining(trialEndsAt, systemClock.now());
  const formatted = formatInstant(trialEndsAt, timezone, { style: 'date' });
  const dateLabel = formatted.ok ? formatted.value : trialEndsAt.toISOString();

  return (
    <span className="text-muted-foreground text-sm">
      {t('trialEndsLabel')}: {dateLabel}
      {remaining.expired
        ? null
        : ` · ${remaining.lessThanOneDay ? tBanner('lessThanOneDay') : tBanner('daysRemaining', { days: remaining.days })}`}
    </span>
  );
}

async function PlanCard({ plan, isCurrent }: { plan: Plan; isCurrent: boolean }) {
  const t = await getTranslations('pricing');
  const tEntitlements = await getTranslations('entitlements.plan');
  const headingId = `plan-${plan.id}-name`;

  return (
    <div
      aria-labelledby={headingId}
      className={
        isCurrent
          ? 'border-primary/50 bg-card shadow-elevated flex flex-1 flex-col gap-5 rounded-xl border p-6'
          : 'border-border bg-card flex flex-1 flex-col gap-5 rounded-xl border p-6'
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="text-card-title">
            {plan.name}
          </h3>
          {isCurrent ? <Badge variant="brand">{tEntitlements('currentPlanBadge')}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(`plans.${plan.id}.tagline`)}
        </p>
      </div>

      <div className="border-border flex flex-col gap-1 rounded-lg border border-dashed p-3">
        <span className="text-muted-foreground text-label uppercase">
          {tEntitlements('accountAllowance', { count: plan.tradingAccounts })}
        </span>
        {plan.limitProvisional ? (
          <span className="text-muted-foreground text-xs">{tEntitlements('provisionalNote')}</span>
        ) : null}
      </div>

      <Button
        disabled
        variant={isCurrent ? 'default' : 'outline'}
        className="mt-auto min-h-11 w-full"
      >
        {tEntitlements('comingSoon')}
      </Button>
    </div>
  );
}
