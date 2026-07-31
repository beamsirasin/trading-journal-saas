import { Check } from 'lucide-react';
import Link from 'next/link';

import { TRIAL_DAYS, type Plan } from '@/config/plans';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * One subscription plan.
 *
 * The price slot renders "Pricing to be confirmed" rather than a number,
 * because no amount has been approved. A placeholder figure on a public page
 * is indistinguishable from a real one once it has been screenshotted, and
 * "we'll change it before launch" is not a control.
 *
 * The call to action goes to `/register`, which starts a trial and takes no
 * payment details. Nothing on this card implies that a payment provider is
 * connected — because none is.
 */
export function PricingCard({ plan }: { plan: Plan }) {
  const headingId = `plan-${plan.id}-name`;

  return (
    <div
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-6 rounded-xl border p-6',
        plan.featured
          ? 'border-primary/50 bg-card shadow-[0_2px_4px_rgba(0,0,0,0.04),0_20px_44px_-24px_rgba(0,0,0,0.45)]'
          : 'border-border bg-card',
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 id={headingId} className="text-card-title">
            {plan.name}
          </h3>
          {plan.featured ? <Badge variant="brand">Most popular</Badge> : null}
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">{plan.tagline}</p>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-foreground text-xl font-semibold">Pricing to be confirmed</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Amounts have not been set. The {TRIAL_DAYS}-day trial is free and needs no card.
        </p>
      </div>

      <div className="border-border flex flex-col gap-1 rounded-lg border border-dashed p-3">
        <span className="text-muted-foreground text-label uppercase">Trading accounts</span>
        <span className="numeric text-foreground text-lg font-semibold">
          {plan.tradingAccounts}
          {plan.limitProvisional ? (
            <span className="text-muted-foreground ml-2 text-xs font-normal">provisional</span>
          ) : null}
        </span>
      </div>

      <ul className="flex flex-1 flex-col gap-2.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="text-muted-foreground leading-relaxed">{feature}</span>
          </li>
        ))}
      </ul>

      <Button asChild variant={plan.featured ? 'default' : 'outline'} className="min-h-11 w-full">
        <Link href="/register">Start {TRIAL_DAYS}-day free trial</Link>
      </Button>
    </div>
  );
}
