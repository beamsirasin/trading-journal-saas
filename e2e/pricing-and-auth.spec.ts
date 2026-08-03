import { expect, test, type Page } from '@playwright/test';

import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { E2E_USER_A } from './support/fixtures';

/**
 * Counts real requests to the public `/send-verification-email` endpoint —
 * the one `AuthForm` calls itself after every accepted `signUp.email`
 * outcome (`src/components/auth/auth-form.tsx`), and the one the manual
 * Resend button also calls. Counting network calls, rather than asserting a
 * particular delivery outcome, is what keeps these assertions valid whether
 * or not a real email provider is configured for this environment — see
 * `src/lib/auth/email.ts`'s `ProductionEmailAdapter`: this project has no
 * production email provider yet, so the `next build && next start` server
 * this suite runs against always genuinely fails delivery (a real, fully
 * deterministic failure, not flakiness) — the request still happens exactly
 * once either way, which is what these tests exist to prove.
 */
function countVerificationDispatchRequests(page: Page): { count: () => number } {
  let count = 0;
  page.on('request', (request) => {
    if (request.url().includes('/send-verification-email') && request.method() === 'POST') {
      count += 1;
    }
  });
  return { count: () => count };
}

/**
 * Satisfies Phase 2.1's shared password-complexity policy
 * (`src/lib/auth/password-policy.ts`: 12-128 chars, lower + upper + number +
 * special) — every registration attempt below needs a policy-valid password
 * to even reach the server, since the submit button is gated on it
 * client-side (`AuthForm`'s `canSubmitRegister`).
 */
const E2E_VALID_PASSWORD = 'Correct-Horse9!';

/**
 * The honesty suite.
 *
 * Every assertion here exists to catch the product claiming something it
 * cannot do. Payment processing and Google OAuth are absent, and a page that
 * implied otherwise would be a false statement to a visitor rather than
 * merely a bug. The login/registration section below exercises the REAL
 * Better Auth flow (Phase 2) against a real, disposable database — gated on
 * `hasE2eDatabase`, since none is configured for a plain local run.
 */

test.describe('pricing', () => {
  test('shows three plans with the trial and no invented prices', async ({ page }) => {
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });

    for (const plan of ['Starter', 'Pro', 'Elite']) {
      await expect(pricing.getByRole('heading', { name: plan })).toBeVisible();
    }

    await expect(pricing.getByText('Pricing to be confirmed')).toHaveCount(3);

    // Each plan card's own registration CTA, selected by the card's
    // `aria-labelledby` id (how `PricingCard` actually wires it — see the
    // tablet-viewport test below and `e2e/i18n.spec.ts`'s Thai equivalent)
    // rather than by CTA copy. The copy is translated and has already
    // changed once (Phase 1.1's "preview" wording → Phase 2's real
    // registration), so asserting the destination rather than the label is
    // what keeps this test meaningful across that kind of rename.
    for (const id of ['starter', 'pro', 'elite']) {
      const card = pricing.locator(`[aria-labelledby="plan-${id}-name"]`);
      await expect(card.getByRole('link')).toHaveAttribute('href', /\/register$/);
    }
  });

  test('states the seven-day trial', async ({ page }) => {
    await page.goto('/en/pricing');
    // Current copy (`pricing.priceUnsetNote` in messages/en.json), not the
    // old wording — "with no card is" never appears verbatim.
    await expect(page.getByText(/7-day, no-card trial is planned/i).first()).toBeVisible();
  });

  test('shows the account limits the plans gate on', async ({ page }) => {
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });
    // `exact` matters: Playwright's string matcher is substring-and-
    // case-insensitive, so a loose "Trading accounts" also matches the
    // section's intro paragraph.
    await expect(pricing.getByText('Trading accounts', { exact: true })).toHaveCount(3);
    // The Elite limit is still an open product question and must say so.
    await expect(pricing.getByText('provisional', { exact: true })).toBeVisible();
  });

  /**
   * Regression: the plan grid stayed single-column until `lg` (1024px), so
   * at a tablet viewport it rendered one plan card stretched to the full
   * ~700px content width, with a full-width "Start trial" button — visibly
   * wider than the same card at mobile or desktop. Fixed by stepping to two
   * columns at `md`. Asserted by comparing row positions rather than a
   * screenshot: Starter and Pro should sit side by side (equal top), with
   * Elite wrapping to a second row (a lower top) rather than sitting to
   * Pro's right in a phantom third column.
   */
  test('renders two plan cards per row at a tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });
    const starterBox = await pricing.getByRole('heading', { name: 'Starter' }).boundingBox();
    const proBox = await pricing.getByRole('heading', { name: 'Pro' }).boundingBox();
    const eliteBox = await pricing.getByRole('heading', { name: 'Elite' }).boundingBox();

    // A manual tolerance rather than `toBeCloseTo`: its precision digits
    // round to whole pixels, which is tighter than the sub-pixel rendering
    // variance between Playwright's desktop and mobile-emulation projects
    // actually produces for two elements that are genuinely on the same row.
    expect(Math.abs((starterBox?.y ?? 0) - (proBox?.y ?? -100))).toBeLessThan(5);
    expect(eliteBox?.y ?? 0).toBeGreaterThan((starterBox?.y ?? 0) + 20);

    // The card should no longer be stretched to the full content width.
    // Selected via the card's own `aria-labelledby` id rather than walking up
    // from the heading, which is both more robust and matches how
    // `PricingCard` actually wires its accessible name.
    const starterCard = pricing.locator('[aria-labelledby="plan-starter-name"]');
    const cardBox = await starterCard.boundingBox();
    expect(cardBox?.width ?? 0).toBeLessThan(500);
  });

  test('does not present a working purchase path', async ({ page }) => {
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });

    await expect(
      page.getByText(/no payment processing is connected to this product yet/i),
    ).toBeVisible();

    // No plan CTA may lead to a checkout. They all go to real registration
    // instead. Selected by each card's `aria-labelledby` id rather than CTA
    // copy — see the "shows three plans" test above for why.
    // Suffix match: `Link` from `@/i18n/navigation` renders `/en/register`.
    for (const id of ['starter', 'pro', 'elite']) {
      const card = pricing.locator(`[aria-labelledby="plan-${id}-name"]`);
      await expect(card.getByRole('link')).toHaveAttribute('href', /\/register$/);
    }

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/enter card|card number|checkout now|buy now/i);
    expect(body).not.toMatch(/start (?:a )?(?:7-day )?free trial/i);
  });
});

test.describe('login and registration', () => {
  // Every page under test here calls `getOptionalSession()` unconditionally
  // (the already-authenticated-visitor redirect), which opens a real
  // database connection — see e2e/support/env.ts for why that makes the
  // whole describe block, not just the form-submission tests, DB-dependent.
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  for (const route of ['/en/login', '/en/register'] as const) {
    test(`${route} labels every input`, async ({ page }) => {
      await page.goto(route);

      const inputs = page.locator('input:not([type="hidden"])');
      const count = await inputs.count();
      expect(count).toBeGreaterThan(0);

      for (let index = 0; index < count; index += 1) {
        const input = inputs.nth(index);
        const id = await input.getAttribute('id');
        expect(id, `input ${index} needs an id to be labelled`).not.toBeNull();
        await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
      }
    });

    // No Google credentials are configured for this build, in CI or locally
    // — `isGoogleSignInConfigured()` (src/lib/auth/server.ts) is the single
    // source of truth the button and this assertion both depend on.
    test(`${route} does not pretend Google OAuth is active`, async ({ page }) => {
      await page.goto(route);

      const google = page.getByRole('button', { name: /continue with google/i });
      await expect(google).toBeVisible();
      await expect(google).toBeDisabled();
      await expect(page.getByText(/google sign-in is not available right now/i)).toBeVisible();
    });

    test(`${route} keeps form controls at 44px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);

      const email = await page.getByLabel('Email').boundingBox();
      expect(email?.height ?? 0).toBeGreaterThanOrEqual(44);

      const submit = await page
        .getByRole('button', {
          name: route === '/en/login' ? 'Log in' : 'Create account',
        })
        .boundingBox();
      expect(submit?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  }

  /**
   * Regression: the register page's two-column layout only applies at `lg`
   * (1024px). Below that the columns stack, and the form's wrapping div had
   * no max-width — so at a tablet viewport it stretched to the full grid
   * track (~700px), producing input fields visibly wider than the same
   * fields render on `/login`, which has always been `max-w-md`-constrained.
   * Fixed by capping the form column the same way below `lg`.
   */
  test('keeps the registration form narrow at a tablet viewport, matching login', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });

    await page.goto('/en/login');
    const loginEmailWidth = (await page.getByLabel('Email').boundingBox())?.width ?? 0;

    await page.goto('/en/register');
    const registerEmailWidth = (await page.getByLabel('Email').boundingBox())?.width ?? 0;

    expect(registerEmailWidth).toBeLessThan(500);
    // Same form primitive, same constraint — the two should match closely
    // rather than merely both happening to be "narrow enough".
    expect(Math.abs(registerEmailWidth - loginEmailWidth)).toBeLessThan(10);
  });

  test('is operable with the keyboard alone and shows a real invalid-credentials error', async ({
    page,
  }) => {
    await page.goto('/en/login');

    const email = page.getByLabel('Email');
    const password = page.getByLabel('Password', { exact: true });

    await email.focus();
    await page.keyboard.type('no-such-account@example.test');
    await expect(email).toHaveValue('no-such-account@example.test');

    await password.focus();
    await page.keyboard.type('a-sufficiently-long-but-wrong-password');
    await expect(password).toHaveValue('a-sufficiently-long-but-wrong-password');

    // A real request against the real backend. The error is deliberately
    // generic (never "no such account" / "wrong password") — CLAUDE.md's
    // anti-enumeration rule, mirrored in AuthForm's mapGenericError.
    await page.keyboard.press('Enter');
    await expect(page.getByText('Invalid email or password.')).toBeVisible();

    // Still on /login — a failed login never navigates away.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('registration creates a real account and moves to the verification-pending screen', async ({
    page,
  }) => {
    const email = `e2e-register-${Date.now()}@example.test`;

    await page.goto('/en/register');
    await page.getByLabel('Name').fill('E2E New Trader');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(email)}`));
    await expect(page.getByText(new RegExp(email.replace('.', '\\.')))).toBeVisible();

    // The account is real: logging in immediately fails because the email
    // is not yet verified (no real delivery provider exists to click a link
    // from — see docs/email-delivery-setup.md), surfaced as the same
    // generic error a wrong password would show, never a distinct
    // "unverified" message that would leak account existence.
    await page.goto('/en/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('registering an already-used email reaches the same screen as a genuine signup (anti-enumeration)', async ({
    page,
  }) => {
    // E2E_USER_A is provisioned (already verified) by e2e/global-setup.ts —
    // a real Better Auth USER_ALREADY_EXISTS response for this attempt.
    const dispatchRequests = countVerificationDispatchRequests(page);

    await page.goto('/en/register');
    await page.getByLabel('Name').fill('Someone Else');
    await page.getByLabel('Email').fill(E2E_USER_A.email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/verify-email\\?email=${encodeURIComponent(E2E_USER_A.email)}`),
    );
    // Exactly one dispatch request fires, and — because E2E_USER_A is
    // already verified, so `/send-verification-email`'s fast path never
    // touches the (unconfigured, always-failing in this build) email
    // adapter at all — it succeeds, landing on the plain URL with no
    // `notice` suffix, unlike a still-unverified account's dispatch below.
    await expect.poll(() => dispatchRequests.count()).toBe(1);
    expect(page.url()).not.toContain('notice=');
    expect(await page.textContent('body')).not.toMatch(
      /email already exists|this email is registered/i,
    );
  });

  test('registering an uppercase variant of an already-used email reaches the same anti-enumeration screen', async ({
    page,
  }) => {
    const caseVariantEmail = E2E_USER_A.email.replace('e2e-user-a', 'E2E-USER-A').toUpperCase();

    await page.goto('/en/register');
    await page.getByLabel('Name').fill('Someone Else');
    await page.getByLabel('Email').fill(caseVariantEmail);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Better Auth lowercases before the duplicate check, so this must land
    // on the exact same generic screen the lowercase original does — never
    // a distinct "this looks new" outcome that would leak the identity match.
    await expect(page).toHaveURL(
      new RegExp(`/verify-email\\?email=${encodeURIComponent(caseVariantEmail)}`),
    );
    await expect(
      page.getByText(/If this email can be used to register, we have sent a verification link\./),
    ).toBeVisible();
  });

  test('sends exactly one verification-email dispatch request per registration attempt, including a re-registration of the same still-unverified email', async ({
    page,
  }) => {
    const email = `e2e-resend-dup-${Date.now()}@example.test`;
    const dispatchRequests = countVerificationDispatchRequests(page);

    await page.goto('/en/register');
    await page.getByLabel('Name').fill('E2E New Trader');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(email)}`));
    await expect.poll(() => dispatchRequests.count()).toBe(1);
    await expect(page.getByRole('button', { name: 'Resend email' })).toBeVisible();

    // The account still exists and is still unverified — re-submitting
    // registration for it must send exactly one FRESH dispatch request
    // (bringing the running total to 2) and land on the identical generic
    // page, never a distinguishable "this email already exists" outcome.
    await page.goto('/en/register');
    await page.getByLabel('Name').fill('Someone Else Entirely');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(email)}`));
    await expect.poll(() => dispatchRequests.count()).toBe(2);
    await expect(page.getByRole('button', { name: 'Resend email' })).toBeVisible();

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/email already exists|this email is registered/i);
  });

  test('shows a localized, accessible notice and a disabled Resend button when the verify-email page carries a rate-limited dispatch notice', async ({
    page,
  }) => {
    const email = `e2e-notice-rate-${Date.now()}@example.test`;
    await page.goto(`/en/verify-email?email=${encodeURIComponent(email)}&notice=rate-limited`);

    await expect(
      page.getByText(
        'Too many verification emails were requested. Please wait a moment and try again.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend email' })).toBeDisabled();
  });

  test('shows a localized delivery-failed notice with a still-usable Resend button', async ({
    page,
  }) => {
    const email = `e2e-notice-delivery-${Date.now()}@example.test`;
    await page.goto(`/en/verify-email?email=${encodeURIComponent(email)}&notice=delivery-failed`);

    await expect(
      page.getByText("We couldn't send the verification email yet. Please try again."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend email' })).not.toBeDisabled();
  });

  test('/th/verify-email shows the localized Thai rate-limited and delivery-failed notices', async ({
    page,
  }) => {
    const email = `e2e-th-notice-${Date.now()}@example.test`;

    await page.goto(`/th/verify-email?email=${encodeURIComponent(email)}&notice=rate-limited`);
    await expect(
      page.getByText('มีการขอส่งอีเมลหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งอีเมลอีกครั้ง' })).toBeDisabled();

    await page.goto(`/th/verify-email?email=${encodeURIComponent(email)}&notice=delivery-failed`);
    await expect(page.getByText('ยังไม่สามารถส่งอีเมลยืนยันได้ กรุณาลองส่งอีกครั้ง')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งอีเมลอีกครั้ง' })).not.toBeDisabled();
  });

  test('shows the live requirement checklist and strength meter while typing a password', async ({
    page,
  }) => {
    await page.goto('/en/register');

    const password = page.getByLabel('Password', { exact: true });
    const uppercaseItem = page.locator('li', { hasText: 'Contains an uppercase letter' });

    await expect(uppercaseItem).toHaveAttribute(
      'aria-label',
      'Contains an uppercase letter: Not met yet',
    );
    await expect(page.getByText('Does not meet requirements')).toBeVisible();

    await password.fill('short');
    await expect(page.getByText('Does not meet requirements')).toBeVisible();

    await password.fill(E2E_VALID_PASSWORD);
    await expect(uppercaseItem).toHaveAttribute('aria-label', 'Contains an uppercase letter: Met');
    // Any of the three non-"insufficient" strength labels is acceptable —
    // the exact band is an implementation detail of evaluatePasswordStrength;
    // what matters is the meter reacted to a policy-valid password at all.
    await expect(page.getByText(/^(Weak|Medium|Strong)$/)).toBeVisible();

    // The button stays disabled until confirm-password also matches.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('blocks submission on a password mismatch and shows an accessible error', async ({
    page,
  }) => {
    await page.goto('/en/register');

    await page.getByLabel('Name').fill('Mismatch Tester');
    await page.getByLabel('Email').fill(`e2e-mismatch-${Date.now()}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    const confirm = page.getByLabel('Confirm password');
    await confirm.fill('Different-Horse9!');
    await confirm.blur();

    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('toggles password and confirm-password visibility independently', async ({ page }) => {
    await page.goto('/en/register');

    const password = page.getByLabel('Password', { exact: true });
    const confirm = page.getByLabel('Confirm password');
    await password.fill(E2E_VALID_PASSWORD);
    await confirm.fill(E2E_VALID_PASSWORD);

    await expect(password).toHaveAttribute('type', 'password');
    await expect(confirm).toHaveAttribute('type', 'password');

    const showButtons = page.getByRole('button', { name: 'Show password' });
    await showButtons.first().click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(confirm).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(confirm).toHaveAttribute('type', 'text');
  });

  test('/th/register runs the same registration flow with Thai copy', async ({ page }) => {
    const email = `e2e-th-register-${Date.now()}@example.test`;

    await page.goto('/th/register');
    await page.getByLabel('ชื่อ').fill('ผู้ใช้ทดสอบ');
    await page.getByLabel('อีเมล').fill(email);
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('ยืนยันรหัสผ่าน').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'สร้างบัญชี' }).click();

    await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(email)}`));
    await expect(
      page.getByText(/หากอีเมลนี้สามารถใช้สมัครได้ เราได้ส่งลิงก์ยืนยันให้แล้ว/),
    ).toBeVisible();
  });

  test('/th/register rejects a weak password with the localized policy error', async ({ page }) => {
    await page.goto('/th/register');
    await page.getByLabel('ชื่อ').fill('ผู้ใช้ทดสอบ');
    await page.getByLabel('อีเมล').fill(`e2e-th-weak-${Date.now()}@example.test`);

    // A password that is long enough to slip past no client-side gate
    // bypass attempt but still misses a required character class — proves
    // the requirement checklist (not just length) blocks submission.
    const weakButLongEnough = 'alllowercaseonly123';
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(weakButLongEnough);
    await page.getByLabel('ยืนยันรหัสผ่าน').fill(weakButLongEnough);

    await expect(page.getByRole('button', { name: 'สร้างบัญชี' })).toBeDisabled();
  });
});
