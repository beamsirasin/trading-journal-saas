import { expect, type Page } from '@playwright/test';

/**
 * Visible dashboard landmark per locale (`dashboard.title` in
 * `messages/{en,th}.json`) — the "protected route actually rendered, not
 * just redirected to it" proof every `loginAs` call ends on.
 */
const DASHBOARD_HEADING: Record<'en' | 'th', string> = {
  en: 'Overview',
  th: 'ภาพรวม',
};

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
 * no separate request context, no manual cookie copying, and no dependency
 * on the login form's own client-side fetch + `router.push` timing (a
 * client-side navigation racing the cookie write was the suspected source
 * of Mobile Chrome protected-route tests landing back on `/login`).
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

  // Deliberately re-reads the session from the server rather than trusting
  // the sign-in response alone — this is the same re-verification
  // `src/server/auth/dal.ts` requires of every protected read, and it is
  // exactly the step the previous UI-driven helper skipped.
  const sessionResponse = await page.request.get('/api/auth/get-session');
  if (!sessionResponse.ok()) {
    throw new Error(
      `authenticateContext: /api/auth/get-session itself failed (HTTP ${sessionResponse.status()}).`,
    );
  }

  const session: unknown = await sessionResponse.json();
  const sessionUserId =
    session !== null && typeof session === 'object' && 'user' in session
      ? (session as { user?: { id?: unknown } }).user?.id
      : undefined;

  if (typeof sessionUserId !== 'string') {
    throw new Error(
      "authenticateContext: sign-in returned 200 but /api/auth/get-session reports no session in this BrowserContext — the session cookie did not land in the page's cookie jar.",
    );
  }
  if (user.id !== undefined && sessionUserId !== user.id) {
    throw new Error(
      `authenticateContext: /api/auth/get-session resolved to user ${sessionUserId}, not the signed-in user ${user.id}.`,
    );
  }
}

/**
 * The one shared entry point every entitlement/account E2E test uses to
 * reach an authenticated `/{locale}/app` — proves the session exists (see
 * `authenticateContext`) before ever opening the protected route, then
 * confirms arrival against the dashboard's own landmark heading rather than
 * the URL alone, so a proxy-level redirect loop or a blank error page can't
 * masquerade as success.
 */
export async function loginAs(page: Page, locale: 'en' | 'th', user: E2eAuthUser): Promise<void> {
  await authenticateContext(page, user);
  await page.goto(`/${locale}/app`);
  await expect(page).toHaveURL(new RegExp(`/${locale}/app(?:[/?]|$)`), { timeout: 15000 });
  await expect(page.getByRole('heading', { name: DASHBOARD_HEADING[locale] })).toBeVisible();
}
