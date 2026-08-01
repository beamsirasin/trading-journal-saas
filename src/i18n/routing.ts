import { defineRouting } from 'next-intl/routing';

/**
 * The single source of truth for supported locales, the fallback, and the
 * URL strategy. `src/i18n/navigation.ts` and `src/middleware.ts` both derive
 * from this — see ADR 0007 for why `localePrefix: 'always'` was chosen over
 * hiding the default locale's prefix.
 */
export const routing = defineRouting({
  locales: ['en', 'th'],
  defaultLocale: 'en',
  localePrefix: 'always',
});

export type AppLocale = (typeof routing.locales)[number];
