import type { ReactNode } from 'react';

import { isOnboardingComplete } from '@/lib/trading-accounts/onboarding-guard';
import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { redirect } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

/**
 * `never`-typed explicitly for the same reason as `(app)/layout.tsx`'s own
 * `redirectToLogin`: next-intl's `redirect()` return type does not narrow
 * reliably through this call shape.
 */
function redirectToOnboarding(locale: AppLocale): never {
  redirect({ href: '/app/onboarding', locale });
  throw new Error('unreachable: redirect() always throws');
}

/**
 * Guards every "main" application page (dashboard, analytics, trades,
 * strategies, settings) behind completed workspace onboarding — the one
 * place this check happens, matching `(app)/layout.tsx`'s own "every route
 * renders through this layout, so no page can forget it" reasoning for the
 * session/workspace boundary one level up.
 *
 * Deliberately a route group SEPARATE from `/app/onboarding`
 * (`(app)/app/onboarding/page.tsx`, which sits outside `(main)` and carries
 * the inverse check: redirect to `/app` once onboarding IS complete).
 * Folding both checks into one shared layout that also wrapped onboarding
 * would redirect the onboarding page to itself whenever onboarding is
 * incomplete — an infinite loop, the same failure mode `src/proxy.ts`'s own
 * comments document for the login/app boundary (an unconditional check
 * applied to a route that needs the opposite condition). Route groups are
 * what let both checks exist side by side without affecting either page's
 * URL: `(main)` never appears in `/app`, `/app/analytics`, etc.
 */
export default async function MainAppLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  const workspace = await getActiveWorkspaceContext();

  if (!isOnboardingComplete(workspace.onboardingCompletedAt)) {
    redirectToOnboarding(locale as AppLocale);
  }

  return <>{children}</>;
}
