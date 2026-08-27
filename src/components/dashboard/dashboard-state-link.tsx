'use client';

import { useLocale } from 'next-intl';
import { useCallback, type ComponentPropsWithoutRef } from 'react';

import { getPathname } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

type DashboardStateLinkProps = Omit<ComponentPropsWithoutRef<'a'>, 'href'> & {
  readonly href: string;
};

/**
 * A same-pathname Dashboard URL-state transition that deliberately performs a
 * document navigation.
 *
 * Keep this primitive scoped to `/[locale]/app` state controls. Next 16.2.12
 * can fail to commit client-side search-param-only navigations on that route;
 * see `docs/reviews/dashboard-d6b-transition-reliability.md`. The canonical
 * Dashboard serializers still build `href`; this component only changes the
 * transport and restores the locale prefix normally supplied by Next Link.
 * Revisit and remove it after a Next upgrade proves the soft-navigation path
 * reliable again.
 */
export function DashboardStateLink({ href, ...props }: DashboardStateLinkProps) {
  const locale = useLocale() as AppLocale;
  return <a href={dashboardDocumentHref(href, locale)} {...props} />;
}

/** Document navigation for dismissals whose native semantics are buttons. */
export function useDashboardStateNavigation(): (href: string) => void {
  const locale = useLocale() as AppLocale;
  return useCallback(
    (href: string) => {
      window.location.assign(dashboardDocumentHref(href, locale));
    },
    [locale],
  );
}

function dashboardDocumentHref(href: string, locale: AppLocale): string {
  return getPathname({ locale, href });
}
