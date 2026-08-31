'use client';

import { useLocale } from 'next-intl';
import { useCallback, type ComponentPropsWithoutRef, type MouseEvent } from 'react';

import { getPathname } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';

import { rememberDashboardScroll } from './dashboard-scroll-restoration';

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
export function DashboardStateLink({ href, onClick, ...props }: DashboardStateLinkProps) {
  const locale = useLocale() as AppLocale;
  return (
    <a
      href={dashboardDocumentHref(href, locale)}
      onClick={(event) => {
        onClick?.(event);
        // A modified click opens a new tab or window and leaves THIS document
        // exactly where it is, so signalling a transition would dim a page
        // that is not going anywhere. `defaultPrevented` covers a caller that
        // has already handled the click itself.
        if (event.defaultPrevented || isModifiedClick(event)) return;
        // Remembered HERE rather than on `beforeunload`, because this is the
        // only moment we know the navigation is a Dashboard state transition
        // rather than a link away from the page. See
        // `DashboardScrollRestoration` for why a document navigation needs
        // this at all.
        rememberDashboardScroll();
        signalDashboardTransition();
      }}
      {...props}
    />
  );
}

/** Document navigation for dismissals whose native semantics are buttons. */
export function useDashboardStateNavigation(): (href: string) => void {
  const locale = useLocale() as AppLocale;
  return useCallback(
    (href: string) => {
      rememberDashboardScroll();
      signalDashboardTransition();
      window.location.assign(dashboardDocumentHref(href, locale));
    },
    [locale],
  );
}

/**
 * Announces that a Dashboard state navigation has just been started.
 *
 * A plain window event rather than a context, because the two ends are on
 * opposite sides of the tree: every control that starts a transition lives
 * inside the sticky toolbar (or the Calendar), and the surface that reports
 * one covers the analytical content beside them. Threading a provider around
 * both would mean wrapping the server-rendered page body in a client
 * component purely to carry a boolean.
 *
 * It is fire-and-forget on purpose. There is no matching "finished" signal
 * and there cannot be one: the navigation this announces replaces the whole
 * document, so the listener is destroyed rather than notified. See
 * `DashboardTransitionOverlay` for what that means for the overlay's exits.
 */
export function signalDashboardTransition(): void {
  window.dispatchEvent(new Event(DASHBOARD_TRANSITION_EVENT));
}

/** The one event name both ends agree on. */
export const DASHBOARD_TRANSITION_EVENT = 'tradechemist:dashboard-transition';

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function dashboardDocumentHref(href: string, locale: AppLocale): string {
  return getPathname({ locale, href });
}
