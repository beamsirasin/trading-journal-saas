import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  Settings,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export type NavItemKey =
  'overview' | 'accounts' | 'trades' | 'strategies' | 'analytics' | 'settings';

export interface NavItem {
  readonly href: string;
  /** Key under the `appNav.items` / `appNav.descriptions` translation namespaces. */
  readonly key: NavItemKey;
  readonly Icon: LucideIcon;
}

/**
 * Application navigation — PRODUCT DESTINATIONS ONLY.
 *
 * PHASE 1.1 CHANGE — `label`/`description` became a translation key. This
 * array is now read by components rendered in both locales, so it can no
 * longer hold literal English strings; the actual text lives under
 * `appNav.items.*` and `appNav.descriptions.*` in `messages/{locale}.json`.
 *
 * Only MVP sections appear here (docs/product-spec.md §4). A nav entry is a
 * commitment, so nothing speculative is listed.
 *
 * ONE array, not one per surface. The desktop sidebar, the collapsed rail and
 * the mobile drawer all read this same list through `SidebarNav`, so a route
 * cannot end up reachable on desktop and missing on mobile.
 *
 * SETTINGS IS NOT IN IT. It used to sit in a second "utility" band pinned to
 * the bottom of the same list, which meant the sidebar mixed two different
 * kinds of thing: places you go to do the work, and the place you configure
 * the product. It now lives in the account menu (`SETTINGS_NAV_ITEM` below),
 * beside Plan & billing, which is where a user goes looking for their own
 * settings anyway — and the account menu is in the header at every width, so
 * nothing became harder to reach on a phone. The `group`/`utility` split that
 * existed to separate the two bands went with it: with one kind of entry
 * left, there is nothing to separate.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/app', key: 'overview', Icon: LayoutDashboard },
  { href: '/app/accounts', key: 'accounts', Icon: Wallet },
  { href: '/app/trades', key: 'trades', Icon: BookOpen },
  { href: '/app/strategies', key: 'strategies', Icon: Target },
  { href: '/app/analytics', key: 'analytics', Icon: BarChart3 },
];

/**
 * Settings, as a destination rather than a navigation entry.
 *
 * Declared HERE rather than inline in `AccountMenu` so the route, the icon
 * and the translation key stay in the one file that owns application
 * destinations — moving where a link is RENDERED should not scatter where it
 * is DEFINED. It deliberately does not appear in `NAV_ITEMS`: the sidebar and
 * the drawer render that array wholesale, so membership is what decides
 * whether a route shows up in navigation.
 */
export const SETTINGS_NAV_ITEM: NavItem = {
  href: '/app/settings',
  key: 'settings',
  Icon: Settings,
};
