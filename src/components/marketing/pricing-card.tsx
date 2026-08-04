import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Plan } from '@/config/plans';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * One subscription plan.
 *
 * Prices are real and tax-exclusive (`plan.priceThb`/`plan.priceUsd`,
 * `plan.taxExclusive`) — the locked product decision replacing the earlier
 * "Pricing to be confirmed" placeholder. The account-limit figure is the
 * ONLY entitlement difference between plans; the feature list below it is
 * the SAME `pricing.sharedFeatures` array for every card, never a per-plan
 * list — every paid plan includes identical features and analytics
 * (`src/config/plans.ts`'s file header).
 *
 * The call to action goes to real registration (Phase 2). It does not claim
 * to start a trial, since billing and trial-entitlement tracking are still
 * unimplemented — only account creation is real today.
 */
export function PricingCard({ plan }: { plan: Plan }) {
  const t = useTranslations('pricing');
  const headingId = `plan-${plan.id}-name`;
  const sharedFeatures = t.raw('sharedFeatures') as readonly string[];

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
          {t('priceMonthly', { thb: plan.priceThb, usd: plan.priceUsd })}
        </p>
        {plan.taxExclusive ? (
          <p className="text-muted-foreground text-xs leading-relaxed">{t('taxExclusiveNote')}</p>
        ) : null}
      </div>

      <div className="border-border flex flex-col gap-1 rounded-lg border border-dashed p-3">
        <span className="text-muted-foreground text-label uppercase">{t('tradingAccounts')}</span>
        <span className="numeric text-foreground text-lg font-semibold">
          {plan.tradingAccounts}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <span className="text-muted-foreground text-label uppercase">
          {t('sharedFeaturesHeading')}
        </span>
        <ul className="flex flex-col gap-2.5">
          {sharedFeatures.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm">
              <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="text-muted-foreground leading-relaxed">{feature}</span>
            </li>
          ))}
        </ul>
      </div>

      <Button asChild variant={plan.featured ? 'default' : 'outline'} className="min-h-11 w-full">
        <Link href="/register">{t('cta')}</Link>
      </Button>
    </div>
  );
}
