import { CircleAlert, TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import type { EffectiveEntitlement } from '@/server/auth/dal';
import { Link } from '@/i18n/navigation';

/**
 * The app-shell trial/entitlement status surface (Phase 3C brief). Renders
 * one of two mutually exclusive notices, or nothing, priority order matching the
 * brief's own downgrade/expiry precedence:
 *
 *   1. over limit  — a real, currently-active plan (or trial) that has more
 *                    non-archived accounts than it allows (e.g. a
 *                    downgrade). Takes priority because it is the most
 *                    actionable state: data is fine, but the workspace
 *                    needs to archive something.
 *   2. no access   — trial ran out, or the subscription was canceled; both
 *                    read as "no active access" (there is no live path to
 *                    `canceled` this phase, only trusted test helpers).
 *   3. otherwise   — trialing, or a real paying plan not over its limit:
 *                    nothing actionable to say, so no banner renders at all
 *                    rather than a permanent bar above every page. The
 *                    trial's informational line was removed from the shell;
 *                    the trial's state is shown on Plan & Billing.
 *
 * Server component: no interactivity is required (no dismiss, no client
 * state), and the entitlement snapshot is already resolved server-side —
 * rendering it client-side would only add a hydration round trip for
 * nothing.
 */
export async function TrialBanner({ entitlement }: { entitlement: EffectiveEntitlement }) {
  const t = await getTranslations('entitlements');

  if (entitlement.overLimit) {
    return (
      <div
        role="region"
        aria-label={t('banner.regionLabel')}
        className="border-warning/30 bg-warning/10 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm"
      >
        <TriangleAlert className="text-warning size-4 shrink-0" aria-hidden="true" />
        <p className="text-foreground font-medium">{t('overLimitNotice.title')}</p>
        <p className="text-muted-foreground">{t('overLimitNotice.body')}</p>
        <Link
          href="/app/plan"
          className="text-primary-text ml-auto inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {t('banner.viewPlans')}
        </Link>
      </div>
    );
  }

  if (entitlement.trialExpired || entitlement.effectiveStatus === 'canceled') {
    return (
      <div
        role="region"
        aria-label={t('banner.regionLabel')}
        className="border-destructive/30 bg-destructive/10 flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-sm"
      >
        <CircleAlert className="text-destructive size-4 shrink-0" aria-hidden="true" />
        <p className="text-foreground font-medium">{t('expiredNotice.title')}</p>
        <p className="text-muted-foreground">{t('expiredNotice.body')}</p>
        <Link
          href="/app/plan"
          className="text-primary-text ml-auto inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {t('expiredNotice.viewPlans')}
        </Link>
      </div>
    );
  }

  // Trialing, or a real paying plan not over its limit — nothing actionable
  // to surface in the shell. The plan's state lives on Plan & Billing.
  return null;
}
