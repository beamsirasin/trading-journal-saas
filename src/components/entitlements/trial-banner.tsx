import { CircleAlert, TriangleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { computeTrialRemaining } from '@/lib/entitlements/resolve';
import { systemClock } from '@/lib/time';
import type { EffectiveEntitlement } from '@/server/auth/dal';
import { Link } from '@/i18n/navigation';

/**
 * The app-shell trial/entitlement status surface (Phase 3C brief). Renders
 * one of four mutually exclusive states, priority order matching the
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
 *   3. trialing    — the full-feature, 1-account trial's informational line.
 *   4. active       — a real paying plan, not over its limit: nothing
 *                    actionable to say, so no banner renders at all rather
 *                    than nagging a paying customer with a permanent bar.
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
          className="text-primary ml-auto inline-flex min-h-11 items-center underline underline-offset-4"
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
          className="text-primary ml-auto inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {t('expiredNotice.viewPlans')}
        </Link>
      </div>
    );
  }

  if (entitlement.effectiveStatus !== 'trialing') {
    // A real, active paying plan, not over its limit — nothing actionable
    // to surface here (account usage lives on the accounts page itself).
    return null;
  }

  const usage =
    entitlement.accountLimit === null
      ? null
      : t('banner.accountUsage', {
          used: entitlement.activeAccountCount,
          limit: entitlement.accountLimit,
        });

  return (
    <div
      role="region"
      aria-label={t('banner.regionLabel')}
      className="border-border bg-muted/40 flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm"
    >
      <span className="text-foreground font-medium">{t('banner.trialActive')}</span>
      <span className="text-muted-foreground">{t('banner.trialSummary')}</span>
      {entitlement.trialEndsAt !== null ? (
        <TrialCountdown trialEndsAt={entitlement.trialEndsAt} />
      ) : null}
      {usage === null ? null : <span className="text-muted-foreground">{usage}</span>}
      <Link
        href="/app/plan"
        className="text-primary ml-auto inline-flex min-h-11 items-center underline underline-offset-4"
      >
        {t('banner.viewPlans')}
      </Link>
    </div>
  );
}

async function TrialCountdown({ trialEndsAt }: { trialEndsAt: Date }) {
  const t = await getTranslations('entitlements.banner');
  const remaining = computeTrialRemaining(trialEndsAt, systemClock.now());

  if (remaining.expired) {
    return null;
  }

  return (
    <span className="text-muted-foreground">
      {remaining.lessThanOneDay
        ? t('lessThanOneDay')
        : t('daysRemaining', { days: remaining.days })}
    </span>
  );
}
