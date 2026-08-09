import { expect, test } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { establishAuthenticatedSession } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

const PASSWORD = 'Correct-Horse9!';

async function provision(label: string, options?: Parameters<typeof provisionVerifiedUser>[2]) {
  const { testUrl } = validateTestDatabaseEnvironment();
  return provisionVerifiedUser(
    testUrl,
    {
      email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
      password: PASSWORD,
      name: `Settings ${label}`,
    },
    options,
  );
}

test.describe('Phase 10C Settings', () => {
  test.beforeEach(() => test.skip(!hasE2eDatabase, E2E_SKIP_REASON));

  test('requires authentication', async ({ page }) => {
    await page.goto('/en/app/settings');
    await expect(page).toHaveURL(/\/en\/login/);
  });

  test('persists real profile/timezone data and exposes only canonical destinations', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    const user = await provision('desktop');
    await establishAuthenticatedSession(page, user);
    await page.goto('/en/app/settings');

    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveValue(user.name);
    await expect(page.getByText(user.email).last()).toBeVisible();
    await expect(page.getByTestId('demo-badge')).toHaveCount(0);
    await expect(page.getByText(/Reporting currency/i)).toHaveCount(0);
    await expect(page.getByText(/Danger Zone/i)).toHaveCount(0);
    await expect(page.getByText('Email/password')).toBeVisible();
    await expect(page.getByText('Email is read-only in this release.')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toHaveCount(0);

    await expect(page.getByLabel('Workspace name')).toHaveValue('Personal workspace');
    await expect(page.getByText('Personal workspace').first()).toBeVisible();
    await expect(page.getByText('Owner')).toBeVisible();
    await expect(page.getByLabel(/slug/i)).toHaveCount(0);
    await page.getByLabel('Workspace name').fill('Canonical Trading Workspace');
    await page.getByRole('button', { name: 'Save workspace' }).click();
    await expect(page.getByText('Workspace saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Canonical Trading Workspace');

    await page.getByLabel('Display name').fill('Canonical Settings Name');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Display name')).toHaveValue('Canonical Settings Name');
    await expect(page.getByRole('button', { name: /account menu/i })).toContainText(
      'Canonical Settings Name',
    );

    await expect(page.getByLabel('Timezone')).toHaveValue('UTC');
    await page.getByLabel('Timezone').fill('Europe/London');
    await page.getByRole('button', { name: 'Save timezone' }).click();
    await expect(page.getByText('Timezone saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Timezone')).toHaveValue('Europe/London');

    await expect(page.getByRole('radio', { name: /Light/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Dark/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /System/ })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Preferences' })
        .getByRole('button', { name: /Language: English/i }),
    ).toBeVisible();

    await expect(page.getByRole('link', { name: 'Manage trading accounts' })).toHaveAttribute(
      'href',
      '/en/app/accounts',
    );
    await expect(page.getByText('Active account: Main Trading Account')).toBeVisible();
    await expect(page.getByText('Professional').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage plan' })).toHaveAttribute(
      'href',
      '/en/app/plan',
    );
    await expect(page.getByRole('link', { name: 'View billing history' })).toHaveAttribute(
      'href',
      '/en/app/billing',
    );
    await expect(page.getByRole('link', { name: /invoice|receipt/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /invoice|receipt|vat/i })).toHaveCount(0);
    await expect(page.getByText(/Export|Security|Danger Zone/i)).toHaveCount(0);
  });

  test('keeps profile and timezone editable in a read-only workspace', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    const user = await provision('read-only', {
      entitlement: { status: 'expired', planKey: null },
    });
    await establishAuthenticatedSession(page, user);
    await page.goto('/en/app/settings');

    await page.getByLabel('Display name').fill('Read Only Profile Edit');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await page.getByLabel('Timezone').fill('Asia/Tokyo');
    await page.getByRole('button', { name: 'Save timezone' }).click();
    await expect(page.getByText('Timezone saved.')).toBeVisible();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Personal workspace');
    await expect(page.getByLabel('Workspace name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save workspace' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage plan' })).toHaveAttribute(
      'href',
      '/en/app/plan',
    );
    await expect(page.getByRole('link', { name: 'View billing history' })).toHaveAttribute(
      'href',
      '/en/app/billing',
    );
  });

  test('keeps real summaries readable while an owner is over the account limit', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    const user = await provision('over-limit', {
      entitlement: { status: 'active', planKey: 'starter' },
      additionalAccounts: 1,
    });
    await establishAuthenticatedSession(page, user);
    await page.goto('/en/app/settings');

    await expect(page.getByText('Over account limit')).toBeVisible();
    await expect(page.getByLabel('Workspace name')).toBeDisabled();
    await expect(page.getByText('Starter').first()).toBeVisible();
    await expect(page.getByText('2 / 1')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage trading accounts' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage plan' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View billing history' })).toBeVisible();
  });

  test('is reachable before onboarding while unrelated main routes stay guarded', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    const user = await provision('pending', { onboarded: false });
    await establishAuthenticatedSession(page, user);
    await page.goto('/en/app/settings');

    await expect(page).toHaveURL(/\/en\/app\/settings$/);
    await expect(page.getByLabel('Display name')).toBeEnabled();
    await expect(page.getByLabel('Timezone')).toBeEnabled();
    await expect(page.getByLabel('Workspace name')).toHaveValue('Personal workspace');
    await expect(page.getByLabel('Workspace name')).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Complete onboarding' }).first()).toHaveAttribute(
      'href',
      '/en/app/onboarding',
    );
    await expect(page.getByRole('link', { name: 'Manage trading accounts' })).toHaveCount(0);

    await page.goto('/en/app/accounts');
    await expect(page).toHaveURL(/\/en\/app\/onboarding$/);
  });

  test('remains usable without horizontal overflow at 320px', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome');
    const user = await provision('mobile');
    await establishAuthenticatedSession(page, user);
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/en/app/settings');

    await expect(page.getByLabel('Display name')).toBeVisible();
    await expect(page.getByLabel('Timezone')).toBeVisible();
    await expect(page.getByLabel('Workspace name')).toBeVisible();
    await expect(page.getByRole('radio', { name: /System/ })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Preferences' })
        .getByRole('button', { name: /Language: English/i }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);

    for (const control of [
      page.getByRole('button', { name: 'Save profile' }),
      page.getByRole('button', { name: 'Save timezone' }),
      page.getByRole('button', { name: 'Save workspace' }),
      page
        .getByRole('region', { name: 'Preferences' })
        .getByRole('button', { name: /Language: English/i }),
    ]) {
      const box = await control.boundingBox();
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
      expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    }
  });
});
