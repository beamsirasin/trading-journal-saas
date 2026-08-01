import type { Metadata } from 'next';

import { routing, type AppLocale } from './routing';

const OPEN_GRAPH_LOCALE: Record<AppLocale, string> = {
  en: 'en_US',
  th: 'th_TH',
};

/** Builds the public URL for one locale without relying on middleware redirects. */
export function localizedPathname(locale: AppLocale, pathname: `/${string}` | '/'): string {
  return pathname === '/' ? `/${locale}` : `/${locale}${pathname}`;
}

/**
 * Route-specific canonical and hreflang entries.
 *
 * These must be emitted by each page rather than inherited from the locale
 * layout: a layout cannot know whether it is rendering `/pricing`, `/demo`,
 * or an application route, and root-only alternates would incorrectly claim
 * every translated child page is equivalent to the home page.
 */
export function localizedAlternates(
  locale: AppLocale,
  pathname: `/${string}` | '/',
): NonNullable<Metadata['alternates']> {
  return {
    canonical: localizedPathname(locale, pathname),
    languages: Object.fromEntries(
      routing.locales.map((supportedLocale) => [
        supportedLocale,
        localizedPathname(supportedLocale, pathname),
      ]),
    ),
  };
}

/** Open Graph uses language_TERRITORY values rather than bare route locales. */
export function localizedOpenGraph(locale: AppLocale, pathname: `/${string}` | '/') {
  return {
    url: localizedPathname(locale, pathname),
    locale: OPEN_GRAPH_LOCALE[locale],
    alternateLocale: routing.locales
      .filter((supportedLocale) => supportedLocale !== locale)
      .map((supportedLocale) => OPEN_GRAPH_LOCALE[supportedLocale]),
  };
}
