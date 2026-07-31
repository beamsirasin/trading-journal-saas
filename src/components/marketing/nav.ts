/**
 * Public site navigation.
 *
 * In-page destinations are written as absolute anchors (`/#features`) rather
 * than bare fragments (`#features`) so the same nav works from `/pricing` and
 * `/login`, where a bare fragment would resolve against the current route and
 * scroll nowhere.
 */
export interface MarketingNavItem {
  readonly href: string;
  readonly label: string;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo' },
];

/**
 * Footer groups.
 *
 * Legal entries are placeholders that link to routes which do not exist yet
 * and are marked as such. Inventing a company address, a registration number
 * or a support email would be fabricating facts about a business, which is
 * worse than an honest "not written yet".
 */
export interface FooterGroup {
  readonly title: string;
  readonly items: readonly { href: string; label: string; pending?: boolean }[];
}

export const FOOTER_GROUPS: readonly FooterGroup[] = [
  {
    title: 'Product',
    items: [
      { href: '/#features', label: 'Features' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#attribution', label: 'System vs trader' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/demo', label: 'Demo dashboard' },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/login', label: 'Log in' },
      { href: '/register', label: 'Create account' },
      { href: '/app', label: 'Open the app preview' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { href: '/terms', label: 'Terms of service', pending: true },
      { href: '/privacy', label: 'Privacy policy', pending: true },
      { href: '/risk', label: 'Risk disclosure', pending: true },
    ],
  },
];
