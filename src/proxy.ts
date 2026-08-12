import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

import { routing, type AppLocale } from '@/i18n/routing';

/**
 * Renamed from `middleware.ts` per Next.js 16's proxy convention (Better
 * Auth's own Next.js integration docs recommend the same rename). The
 * default export's shape is unchanged — Next.js resolves either filename to
 * the same middleware manifest entry, so this is a file-name migration, not
 * an API one.
 *
 * Two responsibilities layered in order:
 *
 * 1. next-intl's locale middleware (unchanged from Phase 1.1) — resolves
 *    `/` to a locale-prefixed route, sets `NEXT_LOCALE`, and passes through
 *    unchanged for anything already correctly prefixed.
 * 2. An OPTIMISTIC session-cookie check for `/{locale}/app/*`, added this
 *    phase. `getSessionCookie` only checks whether a session cookie is
 *    *present* — it does not validate it, per Better Auth's own
 *    documentation, which explicitly recommends exactly this trade-off for
 *    middleware/proxy: fast, no database round trip, redirect-only. The real
 *    authorization check is `src/server/auth/dal.ts`, run again inside every
 *    protected layout/page/action against the database. A forged or expired
 *    cookie passes this check and is rejected there — this file only saves
 *    an unauthenticated visitor the round trip of reaching a page that would
 *    reject them anyway.
 *
 * Deliberately NOT here: an optimistic "cookie present at /login or
 * /register -> redirect to /app" check. An earlier version had one, and a
 * forged or stale-but-present cookie sent it into an infinite redirect loop
 * against this same layer's unauthenticated-visitor check on `/app` (proxy
 * bounces /app -> /login on cookie presence alone; the database-verified
 * layout then bounces the still-invalid-cookie visitor straight back to
 * /login; proxy sees the cookie is still present and bounces to /app again).
 * `login/page.tsx` and `register/page.tsx` already perform this exact
 * redirect themselves, using `getOptionalSession()` — a real, database-
 * verified check that correctly falls through to rendering the form instead
 * of looping when the cookie is invalid. That is the only place this
 * redirect needs to happen.
 *
 * 3. Phase 11C's `/admin` optimistic branch, checked BEFORE `intlMiddleware`
 *    ever runs. `/admin` is deliberately outside `[locale]` (Phase 11's
 *    locked contract: EN-only, no `/en/admin`/`/th/admin`) — but next-intl's
 *    `localePrefix: 'always'` means `intlMiddleware` would otherwise treat
 *    any non-locale-prefixed path, `/admin` included, as needing a locale
 *    redirect. Returning early here is what prevents that; this branch never
 *    reaches next-intl at all. Same cookie-presence-only optimism as the
 *    `/app` branch above, and the same reason: `src/server/auth/admin-dal.ts`'s
 *    `requirePlatformAdmin()` is the actual, database-verified boundary,
 *    re-checked inside the `/admin` layout and again inside every admin
 *    service — this is only a fast, unauthoritative UX shortcut.
 */

const intlMiddleware = createMiddleware(routing);

const LOCALE_PATTERN = routing.locales.join('|');
const APP_PATH_PATTERN = new RegExp(`^/(${LOCALE_PATTERN})/app(/|$)`);
const ADMIN_PATH_PATTERN = /^\/admin(\/|$)/;
/** The one canonical, EN-only login destination `/admin` redirects an unauthenticated visitor to — never a second login page. */
const ADMIN_LOGIN_PATH = `/${routing.defaultLocale}/login`;

function localeFromPathname(pathname: string): AppLocale {
  const first = pathname.split('/')[1];
  return routing.locales.includes(first as AppLocale)
    ? (first as AppLocale)
    : routing.defaultLocale;
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname: adminCheckPathname } = request.nextUrl;
  if (ADMIN_PATH_PATTERN.test(adminCheckPathname)) {
    if (getSessionCookie(request) === null) {
      const loginUrl = new URL(ADMIN_LOGIN_PATH, request.url);
      // Same "built from the current request's own already-resolved path,
      // validated again by the destination" posture as the `/app` branch —
      // `safeCallbackPath` (`src/lib/auth/callback-url.ts`) accepts any
      // same-origin absolute path, `/admin` included.
      loginUrl.searchParams.set('callbackUrl', adminCheckPathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const response = intlMiddleware(request);

  // A redirect/rewrite from next-intl itself (e.g. `/` -> `/en`) — let it
  // resolve the locale first. The auth check re-runs on the request that
  // follows, once the pathname is actually locale-prefixed.
  if (response.headers.get('location') !== null) {
    return response;
  }

  const { pathname } = request.nextUrl;
  const hasSessionCookie = getSessionCookie(request) !== null;

  if (APP_PATH_PATTERN.test(pathname) && !hasSessionCookie) {
    const locale = localeFromPathname(pathname);
    const loginUrl = new URL(`/${locale}/login`, request.url);
    // Built from the current request's own already-resolved path — never
    // from client-suppliable input — so it is safe to attach without a
    // separate same-origin check here. The login page still validates it
    // again before using it (defence in depth, since query strings are
    // themselves attacker-writable once the URL exists).
    loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Runs on every path except static assets, the health endpoint (liveness
  // must stay locale-independent — an orchestrator does not send
  // Accept-Language), the Better Auth API routes (they set their own
  // cookies and must never be redirected), robots.txt and the file-based
  // icon.
  matcher: ['/((?!api|_next|_vercel|robots.txt|icon.svg|.*\\..*).*)'],
};
