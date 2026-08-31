'use client';

import { useEffect } from 'react';

/**
 * Carries the scroll position across a Dashboard state navigation.
 *
 * WHY THIS EXISTS RATHER THAN CLIENT-SIDE ROUTING. Every Dashboard state
 * control performs a native document navigation (`DashboardStateLink`), which
 * is a measured workaround for Next 16.2.12 failing to commit
 * search-param-only soft navigations on `/[locale]/app` — see
 * `docs/reviews/dashboard-d6b-transition-reliability.md`. A document
 * navigation starts the new page at the top, so switching the Calendar
 * between Actual/System/Gap threw the reader back to the KPI band every time,
 * roughly 900px above the control they had just used.
 *
 * The obvious fix — make those tabs shallow client routes — would reintroduce
 * the exact bug the transport works around, at a measured ~10% failure rate on
 * these very tabs. This restores the position instead, which is the part the
 * reader actually noticed, and leaves the transport alone.
 *
 * ONLY FOR A STATE TRANSITION, NEVER FOR AN ARRIVAL. The offset is written by
 * `DashboardStateLink` at the moment of the click and consumed exactly once
 * here. Opening the Dashboard fresh, from the sidebar, from a bookmark or from
 * another tab finds nothing stored and lands at the top, which is correct —
 * this must never resurrect a scroll position from a session an hour ago.
 *
 * `sessionStorage`, not `history.state`: the navigation is a fresh document
 * rather than a history traversal, so there is no entry to attach state to,
 * and the browser's own `scrollRestoration` only covers Back and Forward.
 */
const SCROLL_KEY = 'tradechemist:dashboard-scroll';

/** Written by the link that is about to navigate; read once by the page it lands on. */
export function rememberDashboardScroll(): void {
  try {
    window.sessionStorage.setItem(SCROLL_KEY, String(Math.round(window.scrollY)));
  } catch {
    // Private mode, blocked storage, a full quota — losing the position is a
    // smaller failure than not navigating, so this is deliberately silent.
  }
}

export function DashboardScrollRestoration() {
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(SCROLL_KEY);
      // Consumed immediately, before any restore is attempted. A key that
      // survives this effect would fire again on the next plain visit.
      window.sessionStorage.removeItem(SCROLL_KEY);
    } catch {
      return;
    }

    if (stored === null) return;
    const target = Number(stored);
    if (!Number.isFinite(target) || target <= 0) return;

    /*
      THE PAGE IS TALL ENOUGH ALMOST IMMEDIATELY, AND "ALMOST" IS THE PROBLEM.

      `DashboardSkeleton` reserves every section's measured height, so the
      document is close to its final length on first paint — but the Calendar,
      the insight pillars and Risk Performance each stream in on their own
      Suspense boundary, and a restore attempted one frame too early clamps to
      whatever the page is at that instant.

      So it retries across a bounded window rather than scrolling once and
      hoping. It stops the moment it lands, and otherwise after a fixed number
      of frames OR a wall-clock deadline, whichever comes first.

      BOTH BOUNDS, DELIBERATELY. A frame budget alone is meaningless in a
      test environment where `requestAnimationFrame` is synchronous, and a
      deadline alone is meaningless there too, because no time passes between
      recursive calls — the first draft had only the deadline and blew the
      call stack. Neither bound is a fallback for the other; each covers a
      case the other cannot see.

      There is deliberately no "the page is too short, give up" branch. A
      page that cannot reach the target yet may still be growing as its
      Suspense boundaries resolve, so "unreachable" is not a terminal fact —
      the two bounds above are what make this terminate.
    */
    let frame = 0;
    let attempts = 0;
    let cancelled = false;
    const maxAttempts = 60;
    const deadline = performance.now() + 1_000;

    // A user who scrolls during the restore has taken over, and fighting them
    // for control of the viewport is worse than losing the position.
    const abort = () => {
      cancelled = true;
    };
    window.addEventListener('wheel', abort, { passive: true, once: true });
    window.addEventListener('touchstart', abort, { passive: true, once: true });
    window.addEventListener('keydown', abort, { once: true });

    const attempt = () => {
      if (cancelled) return;
      // `auto`, never `smooth`: this is a restoration, not a journey. A
      // smooth scroll would animate 900px of content past a reader who never
      // asked to travel, and would need a `prefers-reduced-motion` branch to
      // do something this simply does not do.
      window.scrollTo({ top: target, behavior: 'auto' });
      attempts += 1;

      const reached = Math.abs(window.scrollY - target) <= 2;
      if (reached || attempts >= maxAttempts || performance.now() > deadline) return;
      frame = window.requestAnimationFrame(attempt);
    };

    frame = window.requestAnimationFrame(attempt);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('wheel', abort);
      window.removeEventListener('touchstart', abort);
      window.removeEventListener('keydown', abort);
    };
  }, []);

  return null;
}
