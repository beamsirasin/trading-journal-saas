import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware wrappers around next/navigation and next/link.
 *
 * Every internal link in the app must import `Link` from here, never from
 * `next/link` directly — this is what makes "preserve the current route
 * when switching language" and "no duplicate route implementations" both
 * true: a single `<Link href="/pricing">` automatically resolves to
 * `/en/pricing` or `/th/pricing` depending on the active locale, without a
 * component ever hardcoding a locale segment.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
