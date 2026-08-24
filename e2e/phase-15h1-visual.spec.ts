import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

test.use({ storageState: authStateFile });
test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

const outputDir = path.join(os.tmpdir(), 'phase-15h1-screenshots');

async function capture(
  page: Page,
  name: string,
  width: number,
  height: number,
  fullPage = false,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width + 1);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage });
}

test('captures the authenticated Phase 15H.1 structural workspace', async ({ page }) => {
  test.setTimeout(240_000);
  await fs.mkdir(outputDir, { recursive: true });
  await page.addInitScript(() => window.localStorage.setItem('trading-os-theme', 'dark'));

  await page.goto('/en/app/trades/new');
  await expect(page.getByRole('button', { name: 'Open Trade' })).toBeVisible();
  await capture(page, '1440-new-trade-at-entry', 1440, 1000);

  await page.getByRole('button', { name: 'After Trade' }).click();
  await page.getByRole('textbox', { name: 'Symbol' }).fill('STRUCTURE');
  await page.getByRole('button', { name: 'Long' }).click();
  await page.getByLabel('Entered At').fill('2026-08-23T10:00');
  await page.getByLabel('Exited At').fill('2026-08-23T12:00');
  await page.getByLabel('Entry', { exact: true }).fill('100');
  await page.getByLabel('Stop Loss', { exact: true }).fill('90');
  await page.getByLabel(/Take Profit/).fill('130');
  await page.getByTestId('new-trade-view-nav').getByRole('button', { name: 'Result' }).click();
  await page.getByLabel('Actual Entry').fill('100');
  await page.getByLabel('Actual Initial Stop').fill('90');
  await page.getByLabel('Exit Price').fill('120');
  await expect(page.getByText('+2.00R')).toBeVisible();
  await capture(page, '1440-new-trade-after-trade-result', 1440, 1000);
  await page.getByRole('button', { name: 'Save Completed Trade' }).click();

  await expect(page).toHaveURL(/trade=[0-9a-f-]+/, { timeout: 60_000 });
  const detailUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Actual Result' })).toBeVisible();
  await capture(page, '1440-trade-detail-actual', 1440, 1000);
  await page.getByRole('navigation', { name: 'Trade sections' }).getByRole('link').nth(1).click();
  await expect(page.getByRole('heading', { name: 'System Plan' })).toBeVisible();
  await capture(page, '1440-trade-detail-system', 1440, 1000);

  await page.goto('/en/app/trades?view=log');
  await expect(page.getByText('STRUCTURE', { exact: true }).first()).toBeVisible();
  await capture(page, '1440-trade-log', 1440, 1000);
  await page.goto('/en/app');
  await expect(page.getByText('STRUCTURE', { exact: true }).first()).toBeVisible();
  await capture(page, '1440-dashboard', 1440, 1000, true);
  await page.goto('/en/app/analytics');
  await capture(page, '1440-analytics-overview', 1440, 1000, true);
  await page.goto('/en/app/analytics?view=edge');
  await capture(page, '1440-analytics-edge', 1440, 1000, true);

  for (const width of [390, 320] as const) {
    const height = width === 390 ? 844 : 780;
    const prefix = String(width);
    if (width === 390) {
      await page.goto('/en/app');
      await capture(page, `${prefix}-dashboard`, width, height, true);
      await page.goto('/en/app/trades?view=log');
      await capture(page, `${prefix}-trade-log`, width, height, true);
    }
    await page.goto('/en/app/trades/new');
    await capture(page, `${prefix}-new-trade`, width, height, true);
    await page.goto(detailUrl.replace('section=system', 'section=actual'));
    await capture(page, `${prefix}-trade-detail`, width, height, true);
    await page.goto('/en/app/analytics');
    await capture(page, `${prefix}-analytics`, width, height, true);
  }

  await page.goto('/th/app/trades/new');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await capture(page, '390-new-trade-th', 390, 844);
});
