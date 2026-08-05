import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isPlanKey } from '@/config/plan-catalog';
import { isSupportedBillingCurrency } from '@/lib/billing';
import { getActiveWorkspaceContext, getWorkspaceEntitlement } from '@/server/auth/dal';
import {
  getBillingPresentation,
  getCheckoutQuotePresentation,
} from '@/server/billing/presentation';
import { CheckoutExperience } from '@/components/billing/checkout-experience';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };
type PageSearchParams = { plan?: string | string[]; currency?: string | string[] };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as AppLocale, namespace: 'checkout' });
  return {
    title: t('title'),
    description: t('description'),
    robots: { index: false, follow: false },
  };
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<PageSearchParams>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const t = await getTranslations('checkout');
  const query = await searchParams;
  const plan = query.plan;
  const currency = query.currency;

  // Resolve the trusted session/workspace even for malformed queries: this route never
  // becomes an unauthenticated quote oracle or accepts a customer workspace identifier.
  await getActiveWorkspaceContext();
  const entitlement = await getWorkspaceEntitlement();

  if (
    typeof plan !== 'string' ||
    !isPlanKey(plan) ||
    typeof currency !== 'string' ||
    !isSupportedBillingCurrency(currency)
  ) {
    return (
      <Container width="prose" className="flex flex-col gap-6 py-8">
        <PageHeader title={t('title')} description={t('description')} />
        <div role="alert" className="border-destructive/30 bg-destructive/10 rounded-lg border p-5">
          <p className="text-foreground text-sm">{t('invalidSelection')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/app/plan">{t('backToPlans')}</Link>
        </Button>
      </Container>
    );
  }

  const presentation = getBillingPresentation(appLocale);
  const quote = getCheckoutQuotePresentation(appLocale, plan, currency);
  const currentPlan =
    entitlement?.effectivePlanKey === null || entitlement?.effectivePlanKey === undefined
      ? null
      : (presentation.plans.find((candidate) => candidate.id === entitlement.effectivePlanKey)
          ?.name ?? null);
  const context = {
    status: entitlement?.persistedStatus ?? 'unavailable',
    currentPlanName: currentPlan,
  };

  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} />
      <CheckoutExperience
        quote={quote}
        sharedFeatureKeys={presentation.sharedFeatureKeys}
        context={context}
      />
    </Container>
  );
}
