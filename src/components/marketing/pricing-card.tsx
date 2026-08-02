import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { TRIAL_DAYS, type Plan } from '@/config/plans';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * One subscription plan.
 *
 * The price slot renders "Pricing to be confirmed" rather than a number,
 * because no amount has been approved. A placeholder figure on a public page
 * is indistinguishable from a real one once it has been screenshotted, and
 * "we'll change it before launch" is not a control.
 *
 * The call to action goes to real registration (Phase 2). It does not claim
 * to start a trial, since billing and trial-entitlement tracking are still
 * unimplemented — only account creation is real today.
 *
 * PHASE 1.1 SIMPLIFICATION — feature lists trimmed to three bullets per
 * plan (translated, under `pricing.plans.{id}.features`), leading with the
 * account limit since that is the axis plans actually differ on. `name` is
 * intentionally not translated — see `config/plans.ts`.
 */
export function PricingCard({ plan }: { plan: Plan }) {
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
        <p className="text-foreground text-xl font-semibold">{t('priceUnset')}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t('priceUnsetNote', { trialDays: TRIAL_DAYS })}
        </p>
      </div>

      <div className="border-border flex flex-col gap-1 rounded-lg border border-dashed p-3">
        <span className="text-muted-foreground text-label uppercase">{t('tradingAccounts')}</span>
        <span className="numeric text-foreground text-lg font-semibold">
          {plan.tradingAccounts}
          {plan.limitProvisional ? (
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {t('provisional')}
            </span>
          ) : null}
        </span>
      </div>

      <ul className="flex flex-1 flex-col gap-2.5">
        {(t.raw(`plans.${plan.id}.features`) as readonly string[]).map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="text-muted-foreground leading-relaxed">{feature}</span>
          </li>
        ))}
      </ul>

      <Button asChild variant={plan.featured ? 'default' : 'outline'} className="min-h-11 w-full">
        <Link href="/register">{t('cta')}</Link>
      </Button>
    </div>
  );
}
