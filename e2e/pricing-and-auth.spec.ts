import { expect, test } from '@playwright/test';

/**
 * The honesty suite.
 *
 * Every assertion here exists to catch the product claiming something it
 * cannot do. Payment processing, Google OAuth and account creation are all
 * absent, and a page that implied otherwise would be a false statement to a
 * visitor rather than merely a bug.
 */

test.describe('pricing', () => {
  test('shows three plans with the trial and no invented prices', async ({ page }) => {
    await page.goto('/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });

    for (const plan of ['Starter', 'Pro', 'Elite']) {
      await expect(pricing.getByRole('heading', { name: plan })).toBeVisible();
    }

    await expect(pricing.getByText('Pricing to be confirmed')).toHaveCount(3);
    await expect(pricing.getByRole('link', { name: /start 7-day free trial/i })).toHaveCount(3);
  });

  test('states the seven-day trial', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText(/7-day trial is free and needs no card/i).first()).toBeVisible();
  });

  test('shows the account limits the plans gate on', async ({ page }) => {
    await page.goto('/pricing');

    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });
    // `exact` matters: Playwright's string matcher is substring-and-
    // case-insensitive, so a loose "Trading accounts" also matches the
    // section's intro paragraph.
    await expect(pricing.getByText('Trading accounts', { exact: true })).toHaveCount(3);
    // The Elite limit is still an open product question and must say so.
    await expect(pricing.getByText('provisional', { exact: true })).toBeVisible();
  });

  test('does not present a working purchase path', async ({ page }) => {
    await page.goto('/pricing');

    await expect(
      page.getByText(/no payment processing is connected to this product yet/i),
    ).toBeVisible();

    // No plan CTA may lead to a checkout. They all start a trial instead.
    const ctas = page.getByRole('link', { name: /start 7-day free trial/i });
    const count = await ctas.count();
    for (let index = 0; index < count; index += 1) {
      await expect(ctas.nth(index)).toHaveAttribute('href', '/register');
    }

    const body = (await page.textContent('body')) ?? '';
    expect(body).not.toMatch(/enter card|card number|checkout now|buy now/i);
  });
});

test.describe('login and registration', () => {
  for (const route of ['/login', '/register'] as const) {
    test(`${route} is operable with the keyboard alone`, async ({ page }) => {
      await page.goto(route);

      const email = page.getByLabel('Email');
      const password = page.getByLabel('Password', { exact: true });

      // Registration has a required Name field. Leaving it empty would make
      // the browser's own validation block submission — correct behaviour,
      // but it would stop this test reaching the thing it is checking.
      if (route === '/register') {
        const name = page.getByLabel('Name');
        await name.focus();
        await page.keyboard.type('Demo Trader');
        await expect(name).toHaveValue('Demo Trader');
      }

      await email.focus();
      await page.keyboard.type('trader@example.com');
      await expect(email).toHaveValue('trader@example.com');

      await password.focus();
      await page.keyboard.type('a-sufficiently-long-password');
      await expect(password).toHaveValue('a-sufficiently-long-password');

      // Submitting by keyboard reaches the demo notice rather than navigating.
      await page.keyboard.press('Enter');
      await expect(page.getByText('Nothing was submitted')).toBeVisible();
    });

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

    test(`${route} does not pretend Google OAuth is active`, async ({ page }) => {
      await page.goto(route);

      const google = page.getByRole('button', { name: /continue with google/i });
      await expect(google).toBeVisible();
      await expect(google).toBeDisabled();
      await expect(page.getByText(/google sign-in is not connected yet/i)).toBeVisible();
    });

    test(`${route} says plainly that nothing is submitted`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByText(/authentication is not implemented/i)).toBeVisible();
    });

    test(`${route} keeps form controls at 44px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);

      const email = await page.getByLabel('Email').boundingBox();
      expect(email?.height ?? 0).toBeGreaterThanOrEqual(44);

      const submit = await page
        .getByRole('button', { name: route === '/login' ? 'Log in' : 'Create account' })
        .boundingBox();
      expect(submit?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  }

  test('registration does not create a session or navigate away', async ({ page }) => {
    await page.goto('/register');

    await page.getByLabel('Name').fill('Demo Trader');
    await page.getByLabel('Email').fill('trader@example.com');
    await page.getByLabel('Password', { exact: true }).fill('a-sufficiently-long-password');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByText('Nothing was submitted')).toBeVisible();

    // No session cookie may appear — there is no session to create.
    const cookies = await page.context().cookies();
    const sessionish = cookies.filter((cookie) => /session|auth|token/i.test(cookie.name));
    expect(sessionish).toEqual([]);
  });
});
