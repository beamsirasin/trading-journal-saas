'use client';

import { useSyncExternalStore } from 'react';

/**
 * Tailwind's `md`. Above it a floating popover has room for two calendars
 * side by side and a preset column; below it, the frozen presentation
 * contract calls for a near-full-height sheet instead of a compressed copy of
 * the desktop panel.
 */
const QUERY = '(min-width: 48rem)';

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/**
 * Desktop-first on the server, per CLAUDE.md §8's analytics posture.
 *
 * Nothing this decides is visible before hydration: the closed control
 * renders one identical trigger either way, and the surface it chooses only
 * exists once a reader has opened it. So the server value cannot produce a
 * flash or a hydration mismatch — it only decides which surface a very early
 * click would open.
 */
const getServerSnapshot = () => true;

/** Reactive, SSR-safe "is there room for the desktop composition?". */
export function useIsDesktopViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
