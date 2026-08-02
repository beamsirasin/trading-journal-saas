import { expect, test } from '@playwright/test';

import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { E2E_USER_A } from './support/fixtures';

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
    await page.getByLabel('Password', { exact: true }).fill('a-sufficiently-long-password');
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
    await page.getByLabel('Password', { exact: true }).fill('a-sufficiently-long-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByText('Invalid email or password.')).toBeVisible();
  });

  test('registering an already-used email reaches the same screen as a genuine signup (anti-enumeration)', async ({
    page,
  }) => {
    // E2E_USER_A is provisioned (already verified) by e2e/global-setup.ts —
    // a real Better Auth USER_ALREADY_EXISTS response for this attempt.
    await page.goto('/en/register');
    await page.getByLabel('Name').fill('Someone Else');
    await page.getByLabel('Email').fill(E2E_USER_A.email);
    await page.getByLabel('Password', { exact: true }).fill('another-long-password-here');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(
      new RegExp(`/verify-email\\?email=${encodeURIComponent(E2E_USER_A.email)}`),
    );
  });
});
