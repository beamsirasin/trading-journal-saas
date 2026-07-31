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
  /** Routes that do not exist yet render as disabled rather than 404ing. */
  readonly enabled: boolean;
}

/**
 * Placeholder navigation.
 *
 * Labels reflect the planned information architecture so the shell can be
 * laid out and tested, but only `/app` exists. Everything else is explicitly
 * disabled: a nav that links to 404s is worse than one that shows what is
 * coming, and it would make the shell's own e2e tests unreliable.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/app', label: 'Dashboard', Icon: LayoutDashboard, enabled: true },
  { href: '/app/trades', label: 'Trades', Icon: BookOpen, enabled: false },
  { href: '/app/strategies', label: 'Strategies', Icon: Target, enabled: false },
  { href: '/app/analytics', label: 'Analytics', Icon: BarChart3, enabled: false },
  { href: '/app/settings', label: 'Settings', Icon: Settings, enabled: false },
];
