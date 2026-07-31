'use client';

import { useSyncExternalStore } from 'react';

/** Never fires — the value is constant per environment, so nothing to subscribe to. */
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Whether the component has hydrated on the client.
 *
 * The usual `useState(false)` + `useEffect(() => setMounted(true))` does the
 * same job, but triggers a cascading render and is flagged by the React
 * Compiler's `set-state-in-effect` rule. `useSyncExternalStore` expresses the
 * same thing directly: React already distinguishes the server snapshot from
 * the client one, so returning different constants is all that is needed —
 * no state, no effect, no extra render.
 *
 * Use this only for values genuinely unknowable during SSR, such as a theme
 * resolved from `localStorage` or an OS preference.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
