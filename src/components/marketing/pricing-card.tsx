import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { SharedBillingFeatureKey } from '@/config/plan-catalog';
import type { BillingCurrency } from '@/lib/billing';
import type { BillingPlanPresentation } from '@/lib/billing/presentation-types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * One subscription plan.
 *
 * The safe server presentation DTO supplies canonical bigint-derived prices,
 * account allowances, and one shared feature-key list. VAT visibility is
 * deliberately absent from the plan: only trusted server configuration may
 * add the separate notice around the cards.
 *
 * The protected checkout URL carries only plan and display currency. The
 * authenticated route derives workspace context and every commercial value
 * again on the server; unauthenticated visitors follow the existing safe
 * login callback path through the protected-route proxy.
 */
export function PricingCard({
  plan,
  currency,
  sharedFeatureKeys,
}: {
  plan: BillingPlanPresentation;
  currency: BillingCurrency;
  sharedFeatureKeys: readonly SharedBillingFeatureKey[];
}) {
  const t = useTranslations('pricing');
  const headingId = `plan-${plan.id}-name`;

  return (
    <div
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-6 rounded-xl border p-6',
        plan.featured ? 'border-primary/50 bg-card shadow-elevated' : 'border-border bg-card',
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="text-card-title">
            {plan.name}
          </h3>
          {plan.featured ? <Badge variant="brand">{t('mostPopular')}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t(`plans.${plan.id}.tagline`)}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-foreground text-xl font-semibold">
          {t('priceMonthly', { price: plan.prices[currency].formatted })}
        </p>
      </div>

      <div className="border-border flex flex-col gap-1 rounded-lg border border-dashed p-3">
        <span className="text-muted-foreground text-label uppercase">{t('tradingAccounts')}</span>
        <span className="numeric text-foreground text-lg font-semibold">
          {plan.activeTradingAccountLimit}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <span className="text-muted-foreground text-label uppercase">
          {t('sharedFeaturesHeading')}
        </span>
        <ul className="flex flex-col gap-2.5">
          {sharedFeatureKeys.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="text-muted-foreground leading-relaxed">
                {t(`sharedFeatures.${feature}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Button asChild variant={plan.featured ? 'default' : 'outline'} className="min-h-11 w-full">
        <Link href={`/app/checkout?plan=${plan.id}&currency=${currency}`}>{t('cta')}</Link>
      </Button>
    </div>
  );
}
