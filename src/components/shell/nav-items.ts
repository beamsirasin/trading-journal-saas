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

/**
 * WHERE A DESTINATION SITS ON A PHONE, below `lg`, where the bottom bar
 * replaces the sidebar. Kept beside `NAV_ITEMS` rather than as a field on it,
 * because the desktop sidebar renders that array wholesale and has no use for
 * a phone's placement: the bar holds the core loop — understand, review,
 * understand more deeply — and the setup destinations sit one tap deeper,
 * behind More. Log a trade is an ACTION, not a destination, and is placed by
 * the bar itself (see `MobileTabBar`).
 */
export const MOBILE_BAR_KEYS: readonly NavItemKey[] = ['overview', 'trades', 'analytics'];
export const MOBILE_MORE_KEYS: readonly NavItemKey[] = ['accounts', 'strategies'];

export function navItem(key: NavItemKey): NavItem {
  const item = NAV_ITEMS.find((candidate) => candidate.key === key);
  if (item === undefined) throw new Error(`No navigation item "${key}"`);
  return item;
}

/**
 * Does `pathname` sit at or below `route`, by WHOLE SEGMENTS?
 *
 * `/app/accounts` matches `/app/accounts` and `/app/accounts/new`, never
 * `/app/accountsx`; a substring or plain `startsWith` test would take the
 * last one too. Paths arrive locale-free from `usePathname` in
 * `@/i18n/navigation`, and without a query string — so `/app/trades?trade=…`
 * is `/app/trades` here.
 */
export function isWithinRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/**
 * Is a destination the page being shown, for the MOBILE bar?
 *
 * The Dashboard is `/app`, the root every other route sits under, so it is
 * matched exactly — a segment match would light it on every page. Every
 * other destination owns its subtree: `/app/accounts/new` is still Accounts.
 *
 * The desktop sidebar keeps its exact match for now (`SidebarNav`); this rule
 * is the bar's.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.key === 'overview' ? pathname === item.href : isWithinRoute(pathname, item.href);
}

/**
 * FOCUSED WORKFLOWS — the bar steps aside on these, and on everything below
 * them. Each already has its own way out (the wizard's Change / Discard, the
 * back link to the Trade) and, for the recording flows, a sticky footer of
 * its own at the bottom edge. Leaving one is never destructive — drafts are
 * kept in this browser (UX Rules §5) — so this is about space and focus, not
 * about guarding work.
 *
 * `/app/trades/new` is inside `/app/trades` by segment, which is why this list
 * is checked BEFORE any destination is considered: a focused route shows no
 * bar at all, rather than a bar with Trades lit.
 */
export const MOBILE_BAR_HIDDEN_ROUTES: readonly string[] = [
  '/app/trades/new',
  '/app/trades/close',
  '/app/trades/after-trade',
  '/app/onboarding',
  '/app/checkout',
];

export function isMobileBarHidden(pathname: string): boolean {
  return MOBILE_BAR_HIDDEN_ROUTES.some((route) => isWithinRoute(pathname, route));
}
