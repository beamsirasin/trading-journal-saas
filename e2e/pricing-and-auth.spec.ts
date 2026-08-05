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
 * `test.info().project.name` plus a random suffix, not `Date.now()` alone —
 * a timestamp-only email is unique enough under normal timing, but a bare
 * millisecond collision between two projects' tests registering the exact
 * same address at once would corrupt both (one silently becomes the
 * anti-enumeration "already exists" outcome the other test never expected).
 */
function uniqueTestEmail(labelPrefix: string): string {
  const projectName = test.info().project.name;
  return `${labelPrefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

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
  test('shows three plans with the locked prices and an identical feature list', async ({
    page,
  }) => {
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });

    for (const plan of ['Starter', 'Trader', 'Professional']) {
      await expect(pricing.getByRole('heading', { name: plan })).toBeVisible();
    }

    for (const price of ['$5.00 / month', '$9.00 / month', '$15.00 / month']) {
      await expect(pricing.getByText(price)).toBeVisible();
    }

    // Every plan card renders the exact same shared feature list — the
    // locked decision that paid plans differ only by account allowance.
    for (const feature of ['Unlimited strategies', 'Unlimited trade history', 'All analytics']) {
      await expect(pricing.getByText(feature, { exact: true })).toHaveCount(3);
    }

    // Each plan card's protected checkout CTA, selected by the card's
    // `aria-labelledby` id (how `PricingCard` actually wires it — see the
    // tablet-viewport test below and `e2e/i18n.spec.ts`'s Thai equivalent)
    // rather than by CTA copy. The copy is translated and has already
    // changed once (Phase 1.1's "preview" wording → Phase 2's real
    // registration), so asserting the destination rather than the label is
    // what keeps this test meaningful across that kind of rename.
    for (const id of ['starter', 'trader', 'professional']) {
      const card = pricing.locator(`[aria-labelledby="plan-${id}-name"]`);
      await expect(card.getByRole('link')).toHaveAttribute(
        'href',
        new RegExp(`/app/checkout\\?plan=${id}&currency=USD$`),
      );
    }
  });

  test('states the seven-day, full-feature, one-account trial', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.getByText(/try every feature free for 7 days/i).first()).toBeVisible();
    await expect(page.getByText(/data is retained after the trial ends/i)).toBeVisible();
  });

  test('shows account limits and omits VAT launch copy while collection is disabled', async ({
    page,
  }) => {
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });
    // `exact` matters: Playwright's string matcher is substring-and-
    // case-insensitive, so a loose "Active trading accounts" also matches
    // the section's intro paragraph.
    await expect(pricing.getByText('Active trading accounts', { exact: true })).toHaveCount(3);
    await expect(pricing.getByText(/VAT/i)).toHaveCount(0);
    // No stale draft plan names or "provisional" limit marker remain.
    await expect(pricing.getByText('provisional', { exact: true })).toHaveCount(0);
    await expect(pricing.getByRole('heading', { name: 'Pro', exact: true })).toHaveCount(0);
    await expect(pricing.getByRole('heading', { name: 'Elite', exact: true })).toHaveCount(0);
  });

  /**
   * Regression: the plan grid stayed single-column until `lg` (1024px), so
   * at a tablet viewport it rendered one plan card stretched to the full
   * ~700px content width, with a full-width "Start trial" button — visibly
   * wider than the same card at mobile or desktop. Fixed by stepping to two
   * columns at `md`. Asserted by comparing row positions rather than a
   * screenshot: Starter and Trader should sit side by side (equal top), with
   * Professional wrapping to a second row (a lower top) rather than sitting
   * to Trader's right in a phantom third column.
   */
  test('renders two plan cards per row at a tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });
    const starterBox = await pricing.getByRole('heading', { name: 'Starter' }).boundingBox();
    const traderBox = await pricing.getByRole('heading', { name: 'Trader' }).boundingBox();
    const professionalBox = await pricing
      .getByRole('heading', { name: 'Professional' })
      .boundingBox();

    // A manual tolerance rather than `toBeCloseTo`: its precision digits
    // round to whole pixels, which is tighter than the sub-pixel rendering
    // variance between Playwright's desktop and mobile-emulation projects
    // actually produces for two elements that are genuinely on the same row.
    expect(Math.abs((starterBox?.y ?? 0) - (traderBox?.y ?? -100))).toBeLessThan(5);
    expect(professionalBox?.y ?? 0).toBeGreaterThan((starterBox?.y ?? 0) + 20);

    // The card should no longer be stretched to the full content width.
    // Selected via the card's own `aria-labelledby` id rather than walking up
    // from the heading, which is both more robust and matches how
    // `PricingCard` actually wires its accessible name.
    const starterCard = pricing.locator('[aria-labelledby="plan-starter-name"]');
    const cardBox = await starterCard.boundingBox();
    expect(cardBox?.width ?? 0).toBeLessThan(500);
  });

  test('presents a protected mock-checkout path without payment credential fields', async ({
    page,
  }) => {
    await page.goto('/en/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });

    await expect(page.getByText(/try every feature free for 7 days/i)).toBeVisible();

    // No plan CTA may lead to a checkout. They all go to real registration
    // instead. Selected by each card's `aria-labelledby` id rather than CTA
    // copy — see the "shows three plans" test above for why.
    // Suffix match: `Link` from `@/i18n/navigation` renders `/en/register`.
    for (const id of ['starter', 'trader', 'professional']) {
      const card = pricing.locator(`[aria-labelledby="plan-${id}-name"]`);
      await expect(card.getByRole('link')).toHaveAttribute(
        'href',
        new RegExp(`/app/checkout\\?plan=${id}&currency=USD$`),
      );
    }

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/enter card|card number|cvv|buy now/i);
    expect(body).not.toMatch(/annual|discount/i);
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
    const email = uniqueTestEmail('e2e-register');

    await page.goto('/en/register');
    await page.getByLabel('Name').fill('E2E New Trader');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('Confirm password').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    // 1. Reaches the localized verification-pending route.
    await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(email)}`));

    // Every anti-enumeration property below is scoped to the page's own
    // named "Verification email status" region, not the whole page —
    // asserting against `page.textContent('body')` with a broad regex is
    // brittle, since generic words like "account" or "new" can legitimately
    // appear in unrelated copy (nav, footer, etc.) with no bearing on
    // whether this screen leaks the submitted email's status.
    const statusRegion = page.getByRole('region', { name: 'Verification email status' });

    // 2. Generic verification messaging is visible — never a distinct
    // "account created"/"check your inbox, <name>" message that would
    // differ from the anti-enumeration screen a duplicate attempt shows.
    await expect(
      statusRegion.getByText(
        /If this email can be used to register, we have sent a verification link\./,
      ),
    ).toBeVisible();
    // 3. The Resend control is present.
    await expect(statusRegion.getByRole('button', { name: 'Resend email' })).toBeVisible();
    // 4. The Login link is present.
    await expect(statusRegion.getByRole('link', { name: 'Back to log in' })).toBeVisible();
    // 5. The Forgot-password link is present (the route already exists).
    await expect(statusRegion.getByRole('link', { name: 'Forgot password?' })).toBeVisible();
    // 6/7. No wording reveals new/existing/verified/unverified status, and
    // the submitted address itself is never rendered as visible page text —
    // only the URL (needed for the Resend button's own request) carries it.
    const regionText = (await statusRegion.textContent()) ?? '';
    expect(regionText).not.toContain(email);
    // Prohibits only explicit account-existence disclosure — never a
    // generic word ("account", "new", "unverified") that could legitimately
    // appear in this region's own intended copy. Safe to check narrowly
    // because the region itself is small and controlled (see above), not
    // the whole page.
    expect(regionText).not.toMatch(
      /email already exists|this email is already registered|an account already exists for this email/i,
    );

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
    const statusRegion = page.getByRole('region', { name: 'Verification email status' });
    expect(await statusRegion.textContent()).not.toMatch(
      /email already exists|this email is (?:already )?registered|an account already exists for this email/i,
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
    const email = uniqueTestEmail('e2e-resend-dup');
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

    const statusRegion = page.getByRole('region', { name: 'Verification email status' });
    const regionText = (await statusRegion.textContent()) ?? '';
    expect(regionText).not.toMatch(
      /email already exists|this email is (?:already )?registered|an account already exists for this email/i,
    );
  });

  test('shows a localized, accessible notice and a disabled Resend button when the verify-email page carries a rate-limited dispatch notice', async ({
    page,
  }) => {
    const email = uniqueTestEmail('e2e-notice-rate');
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
    const email = uniqueTestEmail('e2e-notice-delivery');
    await page.goto(`/en/verify-email?email=${encodeURIComponent(email)}&notice=delivery-failed`);

    await expect(
      page.getByText("We couldn't send the verification email yet. Please try again."),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend email' })).not.toBeDisabled();
  });

  test('/th/verify-email shows the localized Thai rate-limited and delivery-failed notices', async ({
    page,
  }) => {
    const email = uniqueTestEmail('e2e-th-notice');

    await page.goto(`/th/verify-email?email=${encodeURIComponent(email)}&notice=rate-limited`);
    await expect(
      page.getByText('มีการขอส่งอีเมลหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งอีเมลอีกครั้ง' })).toBeDisabled();

    await page.goto(`/th/verify-email?email=${encodeURIComponent(email)}&notice=delivery-failed`);
    await expect(page.getByText('ยังไม่สามารถส่งอีเมลยืนยันได้ กรุณาลองส่งอีกครั้ง')).toBeVisible();
    await expect(page.getByRole('button', { name: 'ส่งอีเมลอีกครั้ง' })).not.toBeDisabled();
  });

  /**
   * `E2E_STRONG_PASSWORD` is deliberately long enough to score "strong" on
   * length alone: `evaluatePasswordStrength` (src/lib/auth/password-policy.ts)
   * gives `floor((length - 12) / 4)` points for length past the 12-character
   * minimum, plus at most 1 for character diversity, and needs a total of 3
   * to reach "strong". At 30 characters that is `floor(18/4) = 4` — already
   * past the threshold regardless of the diversity bonus, so this is a
   * deterministic "strong" score, not an incidental one.
   */
  const E2E_STRONG_PASSWORD = 'Correct-Horse-Battery-Staple9!';

  test('shows the live requirement checklist and strength meter through their real deterministic states while typing a password', async ({
    page,
  }) => {
    await page.goto('/en/register');

    const password = page.getByLabel('Password', { exact: true });
    const uppercaseItem = page.locator('li', { hasText: 'Contains an uppercase letter' });
    // `PasswordStrengthMeter` renders nothing for an empty password
    // (`src/components/auth/password-strength-meter.tsx`) — its accessible
    // name is `"Password strength: <tier>"` on the `role="img"` bar group,
    // which is the semantic selector Assistive Tech would actually use.
    const strengthMeter = page.getByRole('img', { name: /^Password strength:/ });

    // 1. The requirements checklist is present from the start.
    await expect(uppercaseItem).toHaveAttribute(
      'aria-label',
      'Contains an uppercase letter: Not met yet',
    );
    // Nothing has been typed yet — the strength meter is correctly absent,
    // not merely showing an "insufficient" label.
    await expect(strengthMeter).toHaveCount(0);

    // 2. A non-empty but weak password: still fails the requirement, and
    // the strength meter now appears in its "insufficient" state.
    await password.fill('short');
    await expect(uppercaseItem).toHaveAttribute(
      'aria-label',
      'Contains an uppercase letter: Not met yet',
    );
    await expect(strengthMeter).toHaveAccessibleName(
      'Password strength: Does not meet requirements',
    );
    await expect(page.getByText('Does not meet requirements')).toBeVisible();

    // 3. A password satisfying every requirement flips the checklist item
    // and moves the meter out of "insufficient".
    await password.fill(E2E_VALID_PASSWORD);
    await expect(uppercaseItem).toHaveAttribute('aria-label', 'Contains an uppercase letter: Met');
    // E2E_VALID_PASSWORD ('Correct-Horse9!', 15 chars) scores exactly one
    // point (0 from length past the minimum, 1 from character diversity) —
    // deterministically "Medium", not merely "some non-insufficient tier".
    await expect(strengthMeter).toHaveAccessibleName('Password strength: Medium');
    await expect(page.getByText('Medium', { exact: true })).toBeVisible();

    // 4. A fully valid, genuinely long password reaches the "Strong" tier —
    // the intended final state a real user filling in a strong password sees.
    await password.fill(E2E_STRONG_PASSWORD);
    await expect(strengthMeter).toHaveAccessibleName('Password strength: Strong');
    await expect(page.getByText('Strong', { exact: true })).toBeVisible();

    // The button stays disabled until confirm-password also matches.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('/th/register shows the localized requirement checklist and strength meter through the same deterministic states', async ({
    page,
  }) => {
    await page.goto('/th/register');

    const password = page.getByLabel('รหัสผ่าน', { exact: true });
    const uppercaseItem = page.locator('li', { hasText: 'มีตัวพิมพ์ใหญ่' });
    const strengthMeter = page.getByRole('img', { name: /^ความปลอดภัยของรหัสผ่าน:/ });

    await expect(uppercaseItem).toHaveAttribute('aria-label', 'มีตัวพิมพ์ใหญ่: ยังไม่ผ่าน');
    await expect(strengthMeter).toHaveCount(0);

    await password.fill('short');
    await expect(strengthMeter).toHaveAccessibleName('ความปลอดภัยของรหัสผ่าน: ยังไม่เพียงพอ');

    await password.fill(E2E_VALID_PASSWORD);
    await expect(uppercaseItem).toHaveAttribute('aria-label', 'มีตัวพิมพ์ใหญ่: ผ่านแล้ว');
    await expect(strengthMeter).toHaveAccessibleName('ความปลอดภัยของรหัสผ่าน: ปานกลาง');

    await password.fill(E2E_STRONG_PASSWORD);
    await expect(strengthMeter).toHaveAccessibleName('ความปลอดภัยของรหัสผ่าน: แข็งแรง');
  });

  test('blocks submission on a password mismatch and shows an accessible error', async ({
    page,
  }) => {
    await page.goto('/en/register');

    await page.getByLabel('Name').fill('Mismatch Tester');
    await page.getByLabel('Email').fill(uniqueTestEmail('e2e-mismatch'));
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
    const email = uniqueTestEmail('e2e-th-register');

    await page.goto('/th/register');
    await page.getByLabel('ชื่อ').fill('ผู้ใช้ทดสอบ');
    await page.getByLabel('อีเมล').fill(email);
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(E2E_VALID_PASSWORD);
    await page.getByLabel('ยืนยันรหัสผ่าน').fill(E2E_VALID_PASSWORD);
    await page.getByRole('button', { name: 'สร้างบัญชี' }).click();

    await expect(page).toHaveURL(new RegExp(`/verify-email\\?email=${encodeURIComponent(email)}`));

    // Scoped to the page's own named "Verification email status" region —
    // mirrors the English coverage above.
    const statusRegion = page.getByRole('region', { name: 'สถานะอีเมลยืนยัน' });
    await expect(
      statusRegion.getByText(/หากอีเมลนี้สามารถใช้สมัครได้ เราได้ส่งลิงก์ยืนยันให้แล้ว/),
    ).toBeVisible();
    await expect(statusRegion.getByRole('button', { name: 'ส่งอีเมลอีกครั้ง' })).toBeVisible();
    await expect(statusRegion.getByRole('link', { name: 'กลับไปเข้าสู่ระบบ' })).toBeVisible();
    await expect(statusRegion.getByRole('link', { name: 'ลืมรหัสผ่าน?' })).toBeVisible();

    // The submitted address is never rendered as visible page text — only
    // the URL (needed for the Resend button's own request) carries it. No
    // wording distinguishes new/existing/verified/unverified status either.
    const regionText = (await statusRegion.textContent()) ?? '';
    expect(regionText).not.toContain(email);
    expect(regionText).not.toMatch(
      /อีเมลนี้ถูกใช้แล้ว|อีเมลนี้ลงทะเบียนแล้ว|มีบัญชีสำหรับอีเมลนี้อยู่แล้ว/,
    );
  });

  test('/th/register rejects a weak password with the localized policy error', async ({ page }) => {
    await page.goto('/th/register');
    await page.getByLabel('ชื่อ').fill('ผู้ใช้ทดสอบ');
    await page.getByLabel('อีเมล').fill(uniqueTestEmail('e2e-th-weak'));

    // A password that is long enough to slip past no client-side gate
    // bypass attempt but still misses a required character class — proves
    // the requirement checklist (not just length) blocks submission.
    const weakButLongEnough = 'alllowercaseonly123';
    await page.getByLabel('รหัสผ่าน', { exact: true }).fill(weakButLongEnough);
    await page.getByLabel('ยืนยันรหัสผ่าน').fill(weakButLongEnough);

    await expect(page.getByRole('button', { name: 'สร้างบัญชี' })).toBeDisabled();
  });
});
