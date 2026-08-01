import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  Settings,
  Target,
  type LucideIcon,
} from 'lucide-react';

export type NavItemKey = 'overview' | 'trades' | 'strategies' | 'analytics' | 'settings';

export interface NavItem {
  readonly href: string;
  /** Key under the `appNav.items` / `appNav.descriptions` translation namespaces. */
  readonly key: NavItemKey;
  readonly Icon: LucideIcon;
}

/**
 * Application navigation.
 *
 * PHASE 1.1 CHANGE — `label`/`description` became a translation key. This
 * array is now read by components rendered in both locales, so it can no
 * longer hold literal English strings; the actual text lives under
 * `appNav.items.*` and `appNav.descriptions.*` in `messages/{locale}.json`.
 *
 * Only MVP sections appear here (docs/product-spec.md §4). A nav entry is a
 * commitment, so nothing speculative is listed.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/app', key: 'overview', Icon: LayoutDashboard },
  { href: '/app/trades', key: 'trades', Icon: BookOpen },
  { href: '/app/strategies', key: 'strategies', Icon: Target },
  { href: '/app/analytics', key: 'analytics', Icon: BarChart3 },
  { href: '/app/settings', key: 'settings', Icon: Settings },
];
