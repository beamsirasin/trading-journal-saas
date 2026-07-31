import {
  BarChart3,
  BookOpen,
  LayoutDashboard,
  Settings,
  Target,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  /** Longer wording for the mobile drawer, where there is room for it. */
  readonly description: string;
}

/**
 * Application navigation.
 *
 * PHASE 01 CHANGE — every item is now a real route. In Phase 00b these
 * carried an `enabled` flag and all but the dashboard rendered as disabled
 * placeholders, because linking to a 404 is worse than showing what is
 * coming. That flag is gone: all five routes exist and render, so the reason
 * for it does not. The corresponding e2e assertion moved from "unbuilt
 * sections are marked unavailable" to "every nav item resolves".
 *
 * The pages behind Trades, Strategies and Analytics are previews built from
 * demo fixtures — each says so on the page itself rather than in the nav,
 * where a badge on four of five items would be noise.
 *
 * Only MVP sections appear here (docs/product-spec.md §4). A nav entry is a
 * commitment, so nothing speculative is listed.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/app',
    label: 'Overview',
    Icon: LayoutDashboard,
    description: 'Attribution at a glance',
  },
  {
    href: '/app/trades',
    label: 'Trades',
    Icon: BookOpen,
    description: 'The journal',
  },
  {
    href: '/app/strategies',
    label: 'Strategies',
    Icon: Target,
    description: 'Playbooks and versions',
  },
  {
    href: '/app/analytics',
    label: 'Analytics',
    Icon: BarChart3,
    description: 'System versus trader',
  },
  {
    href: '/app/settings',
    label: 'Settings',
    Icon: Settings,
    description: 'Profile and preferences',
  },
];
