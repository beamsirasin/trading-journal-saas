/**
 * Public site navigation.
 *
 * In-page destinations are written as absolute anchors (`/#features`) rather
 * than bare fragments (`#features`) so the same nav works from `/pricing` and
 * `/login`, where a bare fragment would resolve against the current route and
 * scroll nowhere.
 *
 * PHASE 1.1 CHANGE — `label`/`title` became `labelKey`/`titleKey`. This data
 * is now consumed by components rendered in both locales, so the display
 * text lives in `messages/{locale}.json` (`nav.*` and `footer.*`) instead of
 * being a literal string here.
 */
export interface MarketingNavItem {
  readonly href: string;
  /** Key under the `nav` translation namespace. */
  readonly labelKey: 'features' | 'howItWorks' | 'pricing' | 'demo';
  /** Heavy interactive destinations are loaded only after explicit intent. */
  readonly prefetch?: false;
}

export const MARKETING_NAV: readonly MarketingNavItem[] = [
  { href: '/#features', labelKey: 'features' },
  { href: '/#how-it-works', labelKey: 'howItWorks' },
  { href: '/pricing', labelKey: 'pricing' },
  { href: '/demo', labelKey: 'demo', prefetch: false },
];

/**
 * Footer groups.
 *
 * Legal entries are placeholders that link to routes which do not exist yet
 * and are marked as such. Inventing a company address, a registration number
 * or a support email would be fabricating facts about a business, which is
 * worse than an honest "not written yet".
 */
export type FooterLinkKey =
  | 'features'
  | 'howItWorks'
  | 'systemVsTrader'
  | 'pricing'
  | 'demo'
  | 'login'
  | 'register'
  | 'openApp'
  | 'terms'
  | 'privacy'
  | 'risk';

export interface FooterGroup {
  /** Key under `footer.groups`. */
  readonly titleKey: 'product' | 'account' | 'legal';
  readonly items: readonly {
    href: string;
    /** Key under `footer.links`. */
    labelKey: FooterLinkKey;
    pending?: boolean;
    prefetch?: false;
  }[];
}

export const FOOTER_GROUPS: readonly FooterGroup[] = [
  {
    titleKey: 'product',
    items: [
      { href: '/#features', labelKey: 'features' },
      { href: '/#how-it-works', labelKey: 'howItWorks' },
      { href: '/#attribution', labelKey: 'systemVsTrader' },
      { href: '/pricing', labelKey: 'pricing' },
      { href: '/demo', labelKey: 'demo', prefetch: false },
    ],
  },
  {
    titleKey: 'account',
    items: [
      { href: '/login', labelKey: 'login' },
      { href: '/register', labelKey: 'register' },
      { href: '/app', labelKey: 'openApp', prefetch: false },
    ],
  },
  {
    titleKey: 'legal',
    items: [
      { href: '/terms', labelKey: 'terms', pending: true },
      { href: '/privacy', labelKey: 'privacy', pending: true },
      { href: '/risk', labelKey: 'risk', pending: true },
    ],
  },
];
