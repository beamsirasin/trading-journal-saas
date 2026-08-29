'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import {
  DashboardLoadingIndicator,
  DashboardLoadingStatus,
} from '@/components/dashboard/dashboard-loading-indicator';

import { DASHBOARD_TRANSITION_EVENT } from './dashboard-state-link';

/**
 * WHAT THIS IS, AND WHAT IT HONESTLY CANNOT BE.
 *
 * Every Dashboard state change — Date Range, Filters, Account, and the
 * Calendar's own month/day links — performs a NATIVE DOCUMENT NAVIGATION
 * (`DashboardStateLink`; Next 16.2.12 cannot be trusted to commit
 * search-param-only soft navigations on this route). That is a fixed
 * constraint of this pass: the transport is not being changed here.
 *
 * A document navigation means the destination cannot keep anything mounted.
 * The header, the sidebar and the sticky toolbar are rebuilt from the
 * server's HTML like everything else, so a "persistent shell with only the
 * content swapping" is not available and this component does not pretend
 * otherwise. What IS true, and what this shows, is narrower and real:
 *
 *   between the click and the moment the browser commits the new document,
 *   THIS document is still alive, still painted and still the real DOM.
 *
 * So the overlay reports one fact — a request is in flight — over content
 * that is now stale. It is the departure half; the arrival half is the
 * destination's own server-rendered skeleton (`DashboardSkeleton`), which
 * carries the same mark and the same geometry, so the two moments read as
 * one continuous state across the document swap. Neither half fabricates
 * progress, and neither delays anything: there is no timer, no minimum
 * display time, and no artificial step.
 *
 * IT NEVER BLOCKS AND IT NEVER TRAPS. `pointer-events-none` throughout.
 * A native navigation has no "cancelled" event, so a user who presses Escape
 * during a slow load would otherwise be left under a modal veil this
 * component could never learn to lift. Escape clears it explicitly, and the
 * bfcache `pageshow` clears it on a Back that restores this very document —
 * the two ways this page can outlive the navigation it announced.
 *
 * IT HIDES NOTHING. The veil is translucent and un-blurred at the content's
 * own edges; an error is rendered by the SERVER on arrival
 * (`DashboardDataError`), which this cannot suppress because by then this
 * document no longer exists.
 */
export function DashboardTransitionOverlay() {
  const t = useTranslations('dashboard.loading');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function start() {
      setPending(true);
    }
    function clear() {
      setPending(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') clear();
    }

    window.addEventListener(DASHBOARD_TRANSITION_EVENT, start);
    // Back/forward into the bfcache restores this document with the overlay
    // still in state; `persisted` distinguishes that from a normal first load.
    window.addEventListener('pageshow', clear);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(DASHBOARD_TRANSITION_EVENT, start);
      window.removeEventListener('pageshow', clear);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!pending) return null;

  return (
    <>
      <DashboardLoadingStatus message={t('updating')} />
      {/*
        The veil covers the ANALYTICAL AREA only: it is absolutely positioned
        inside the page container, so the global header and the sticky toolbar
        above it — the two surfaces the reader is most likely still looking at,
        and the ones holding the control they just used — stay at full
        contrast and full clarity. That is also why the mark below sits at
        `z-20`, under the toolbar's own `z-30`.
      */}
      <div
        data-dashboard-transition="veil"
        aria-hidden="true"
        className="bg-background/65 pointer-events-none absolute inset-0 z-10 rounded-lg"
      />
      {/*
        The mark is FIXED and centred in the viewport, not in the content box.
        The Dashboard is several viewports tall, so a mark centred on the
        content would be somewhere off-screen for any reader who had scrolled.
        `--shell-workspace-offset` is the variable the shell already sets for
        the workspace column, inherited here, so the mark centres on the
        content rather than on the content plus the sidebar.
      */}
      <div
        data-dashboard-transition="mark"
        className="pointer-events-none fixed inset-0 z-20 grid place-items-center px-4 lg:pl-[var(--shell-workspace-offset)]"
      >
        <DashboardLoadingIndicator tone="overlay" message={t('updating')} detail={t('detail')} />
      </div>
    </>
  );
}
