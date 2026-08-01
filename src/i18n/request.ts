import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { routing } from './routing';

/**
 * Loads the message bundle for the resolved locale on every server render.
 *
 * `hasLocale` guards against an invalid segment reaching this far — the
 * middleware already redirects unknown locales, but a server component can
 * still be rendered directly in tests or during static generation, so the
 * fallback to `routing.defaultLocale` here is the second, independent layer
 * rather than the only one.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
