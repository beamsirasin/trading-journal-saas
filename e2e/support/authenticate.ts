import { expect, type Page } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../../scripts/test-database-safety.mjs';
import { generateId } from '../../src/lib/identifiers';
import { sessions } from '../../src/server/db/schema';
import { resolveE2eBetterAuthSecret } from './better-auth-secret';

/**
 * Visible dashboard landmark per locale (`dashboard.title` in
 * `messages/{en,th}.json`) — the "protected route actually rendered, not
 * just redirected to it" proof every `loginAs` call ends on.
 */
const DASHBOARD_HEADING: Record<'en' | 'th', string> = {
  en: 'Overview',
  th: 'ภาพรวม',
};

/** Matches `session.expiresIn` in `src/lib/auth/server.ts` (7 days). */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `getCookies()` in the installed `better-auth@1.6.25` (`dist/cookies/index.mjs`): `${prefix}.session_token`, `prefix` defaulting to `better-auth` — unchanged by this app's config. */
const SESSION_COOKIE_NAME = 'better-auth.session_token';
/** Matches the `baseURL` host every project resolves against (`playwright.config.ts`). */
const SESSION_COOKIE_DOMAIN = '127.0.0.1';

export interface E2eAuthUser {
  readonly email: string;
  readonly password: string;
  /** Omit only for a fixed fixture (e.g. `E2E_USER_A`) with no ready-to-hand ID — skips the user-ID match, not the session-exists check. */
  readonly id?: string;
}

/**
 * Authenticates `page`'s own BrowserContext through Better Auth's real
 * `/api/auth/sign-in/email` and `/api/auth/get-session` HTTP endpoints —
 * never the login form. `page.request` deliberately shares cookie storage
 * with `page`'s BrowserContext (a documented Playwright guarantee: the
 * `context.request`/`page.request` fixtures are backed by the same cookie
 * jar as the browser context they belong to), so the `Set-Cookie` Better
 * Auth returns here lands directly in the jar the next `page.goto` sends —
 * no separate request context, no manual cookie copying.
 *
 * This calls the RATE-LIMITED public endpoint (`/sign-in/email` — 5/min in
 * production, widened to 50/min only under `E2E_TEST_MODE`, see
 * `src/lib/auth/server.ts`) and is reserved for the small number of specs
 * that specifically exercise the real sign-in HTTP path (`e2e/auth.setup.ts`,
 * `e2e/pricing-and-auth.spec.ts`, `e2e/auth-authorization.spec.ts`) — never
 * for `e2e/entitlements.spec.ts`/`e2e/accounts.spec.ts`'s dozens of tests
 * that only need an authenticated context and don't care how it was
 * established. Those use `loginAs` (below), which does not call this
 * endpoint at all.
 *
 * Fails immediately and loudly on any unexpected outcome, rather than
 * silently continuing to a protected-route assertion that would fail many
 * steps later with a confusing "redirected to login" message and no
 * indication of which of the three checks below actually broke.
 *
 * Never logs the password, a session cookie value, or response headers —
 * only HTTP status codes and (on a user-ID mismatch) the two opaque IDs
 * being compared.
 */
export async function authenticateContext(page: Page, user: E2eAuthUser): Promise<void> {
  const signInResponse = await page.request.post('/api/auth/sign-in/email', {
    data: { email: user.email, password: user.password },
  });
  if (!signInResponse.ok()) {
    throw new Error(
      `authenticateContext: sign-in was rejected (HTTP ${signInResponse.status()}) for a freshly provisioned E2E user — the fixture, not the page under test, is broken.`,
    );
  }

  await verifySessionEstablished(page, user.id);
}

/**
 * Shared by both authentication paths below: re-reads the session from the
 * server rather than trusting the sign-in response (or the fabricated
 * cookie) alone — the same re-verification `src/server/auth/dal.ts` requires
 * of every protected read.
 */
async function verifySessionEstablished(page: Page, expectedUserId: string | undefined) {
  const sessionResponse = await page.request.get('/api/auth/get-session');
  if (!sessionResponse.ok()) {
    throw new Error(
      `verifySessionEstablished: /api/auth/get-session itself failed (HTTP ${sessionResponse.status()}).`,
    );
  }

  const session: unknown = await sessionResponse.json();
  const sessionUserId =
    session !== null && typeof session === 'object' && 'user' in session
      ? (session as { user?: { id?: unknown } }).user?.id
      : undefined;

  if (typeof sessionUserId !== 'string') {
    throw new Error(
      "verifySessionEstablished: /api/auth/get-session reports no session in this BrowserContext — the session cookie did not land in the page's cookie jar.",
    );
  }
  if (expectedUserId !== undefined && sessionUserId !== expectedUserId) {
    throw new Error(
      `verifySessionEstablished: /api/auth/get-session resolved to user ${sessionUserId}, not the expected user ${expectedUserId}.`,
    );
  }
}

/**
 * Signs a raw session token exactly as the installed `better-call@1.3.7`
 * does (`serializeSignedCookie`/`signCookieValue`, vendored into
 * `better-auth`'s cookie helpers): `base64(HMAC-SHA256(secret, token))`
 * appended to the token with a `.` separator, then URI-encoded. Confirmed
 * against the installed package source — not a reimplementation guessed
 * from documentation, since Better Auth does not publish this format.
 * `getSignedCookie` on the server side splits on the LAST `.` and verifies
 * the signature with the same secret before trusting the token, so a wrong
 * secret or a wrong signing scheme fails closed (an invalid/absent session),
 * never open.
 */
async function signSessionToken(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  const signatureBase64 = Buffer.from(signatureBuffer).toString('base64');
  return encodeURIComponent(`${token}.${signatureBase64}`);
}

/**
 * Provisions a real `sessions` row directly in the guarded test database and
 * hands the page's BrowserContext a correctly-signed session cookie for it —
 * never touching the rate-limited `/sign-in/email` endpoint. This is Option
 * B from the Phase 3C authentication-stabilization brief: isolating E2E
 * traffic by spoofing a client IP (`X-Forwarded-For`) was rejected because
 * Better Auth's installed IP resolution
 * (`@better-auth/core/utils/ip.ts::getIPFromHeader`) accepts a single-value
 * forwarded header unconditionally whenever no `trustedProxies` are
 * configured — exactly the "blindly trust an attacker-controlled header in
 * production" outcome the brief forbids, since this app has no
 * `advanced.ipAddress.trustedProxies` configured (and configuring one solely
 * to make E2E traffic look distinct would be guessing at a production proxy
 * topology this repository does not describe). A direct, real session row
 * plus the exact cookie a real sign-in would have produced sidesteps the
 * question entirely: it is authenticated, not merely accepted by a
 * weakened check.
 *
 * `entitlements.spec.ts`/`accounts.spec.ts` provision one fresh user per
 * test specifically because none of them are testing sign-in itself — this
 * is the "trusted test-only session provisioning" helper the brief asks
 * for, reserved for exactly that population. `e2e/auth.setup.ts` and the
 * real login/registration specs (`pricing-and-auth.spec.ts`,
 * `auth-authorization.spec.ts`) deliberately keep using `authenticateContext`
 * above, since a real sign-in IS what they exercise.
 */
async function establishDatabaseSession(
  page: Page,
  testUrl: string,
  user: { readonly id: string },
): Promise<void> {
  const guardedUrl = validateTestDatabaseEnvironment().testUrl;
  if (testUrl !== guardedUrl) {
    throw new Error(
      'establishDatabaseSession: refusing to write a session outside the guarded TEST_DATABASE_URL.',
    );
  }

  const token = generateId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const client = postgres(testUrl, { max: 1 });
  try {
    const db = drizzle(client, { schema: { sessions } });
    await db.insert(sessions).values({
      id: generateId(),
      userId: user.id,
      token,
      expiresAt,
    });
  } finally {
    await client.end();
  }

  const signedValue = await signSessionToken(token, resolveE2eBetterAuthSecret());
  await page.context().addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: signedValue,
      domain: SESSION_COOKIE_DOMAIN,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      expires: Math.floor(expiresAt.getTime() / 1000),
    },
  ]);

  await verifySessionEstablished(page, user.id);
}

/** Establishes a verified database-backed session without navigating; for specs whose subject is not sign-in or the dashboard. */
export async function establishAuthenticatedSession(
  page: Page,
  user: E2eAuthUser & { readonly id: string },
): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  await establishDatabaseSession(page, testUrl, user);
}

/**
 * The one shared entry point every entitlement/account E2E test uses to
 * reach an authenticated `/{locale}/app` — establishes and proves the
 * session (via a direct database-backed session, never the rate-limited
 * sign-in endpoint — see `establishDatabaseSession`) before ever opening the
 * protected route, then confirms arrival against the dashboard's own
 * landmark heading rather than the URL alone, so a proxy-level redirect
 * loop or a blank error page can't masquerade as success.
 */
export async function loginAs(
  page: Page,
  locale: 'en' | 'th',
  user: E2eAuthUser & { readonly id: string },
): Promise<void> {
  await establishAuthenticatedSession(page, user);
  await page.goto(`/${locale}/app`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/app(?:[/?]|$)`), { timeout: 15000 });
  await expect(page.getByRole('heading', { name: DASHBOARD_HEADING[locale] })).toBeVisible();
}
