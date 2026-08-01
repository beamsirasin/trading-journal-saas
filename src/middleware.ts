import createMiddleware from 'next-intl/middleware';

import { routing } from './i18n/routing';

/**
 * Resolves `/` to the correct locale-prefixed route, applies the precedence
 * documented in ADR 0007 (explicit choice → cookie → `Accept-Language` →
 * `en` fallback) and sets `NEXT_LOCALE` so the choice survives a reload.
 */
export default createMiddleware(routing);

export const config = {
  // Runs on every path except static assets, the health endpoint (liveness
  // must stay locale-independent — an orchestrator does not send
  // Accept-Language), robots.txt and the file-based icon.
  matcher: ['/((?!api|_next|_vercel|robots.txt|icon.svg|.*\\..*).*)'],
};
