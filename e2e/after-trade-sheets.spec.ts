import { expect, test, type Locator, type Page } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * WHERE A STEP 1 EDITOR SITS ON A PHONE.
 *
 * A single-answer editor — one account, Long or Short — has very little in it,
 * and a bottom sheet sized to that content reads as a strip stuck to the
 * bottom edge rather than a place to make a decision. So a Step 1 sheet has a
 * floor: it is still anchored to the bottom, but rises to about the middle of
 * the screen however little it holds, and a sheet with more in it (the Entry
 * calendar) grows past that floor up to the existing ceiling and then scrolls
 * inside itself. Desktop dialogs are not touched.
 *
 * Geometry is measured, not eyeballed: each case below judges the sheet's own
 * box against the viewport it sits in.
 */
const ROUTE = '/en/app/trades/new?timing=after_trade';
const PHONE = { width: 390, height: 844 };
/** The floor and ceiling the sheet is asked to respect, as viewport fractions. */
const FLOOR = 0.42;
const CEILING = 0.92;
const SHOTS = process.env.AFTER_TRADE_SHEET_SHOTS;

test.describe('After Trade Step 1 sheets', () => {
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

  test('rise to mid-screen on a phone, grow with their content, and stay anchored', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'chromium', 'One engine is enough for geometry.');
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await signIn(page, 'after-trade-sheets');
    await page.setViewportSize(PHONE);
    await page.goto(ROUTE);
    await expect(page.locator('[data-after-trade-form]')).toBeVisible();

    // One saved symbol, so the picker's short state is the one measured.
    const picker = await openConcept(page, 'Symbol');
    await picker.getByRole('combobox', { name: 'Symbol' }).fill('XAUUSD');
    await picker.getByRole('button', { name: /^Add/ }).click();
    await expect(picker.locator('[data-symbol-option="XAUUSD"]')).toBeVisible();
    await closeSheet(page);

    const short: Array<[string, string]> = [
      ['Trading Account', 'account'],
      ['Direction', 'direction'],
      ['Symbol', 'symbol'],
      ['Entry date & time', 'entered-at-collapsed'],
    ];
    const heights: Record<string, number> = {};
    for (const [field, name] of short) {
      const sheet = await openConcept(page, field);
      const box = await settledBox(sheet);
      await shot(page, `phone-${name}`);
      heights[name] = box.height;
      expectAnchored(box, PHONE.height);
      // THE FLOOR: never a strip along the bottom edge.
      expect(box.height, `${field} rises to mid-screen`).toBeGreaterThanOrEqual(
        PHONE.height * FLOOR,
      );
      expect(box.height, `${field} stays under the ceiling`).toBeLessThanOrEqual(
        PHONE.height * CEILING + 1,
      );
      // The editor starts at the top of the sheet, not floated to its middle.
      const title = await sheet.getByRole('heading', { name: field }).boundingBox();
      expect(title!.y - box.y, `${field} content starts at the top`).toBeLessThan(32);
      await closeSheet(page);
    }

    // THE CALENDAR GROWS THE SHEET, up to the ceiling, and scrolls beyond it.
    const stamp = await openConcept(page, 'Entry date & time');
    await stamp.locator('#after-entry-date').click();
    await expect(stamp.locator('[data-range-date]').first()).toBeVisible();
    const grown = await settledBox(stamp);
    await shot(page, 'phone-entered-at-calendar');
    expectAnchored(grown, PHONE.height);
    expect(grown.height, 'the calendar makes the sheet taller').toBeGreaterThan(
      heights['entered-at-collapsed']! + 40,
    );
    expect(grown.height).toBeLessThanOrEqual(PHONE.height * CEILING + 1);
    // Whatever does not fit is reachable inside the sheet, never off-screen.
    const body = stamp.locator('[data-sheet-body]');
    await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(stamp.locator('[data-range-date]').last()).toBeInViewport();
    await closeSheet(page);

    // No horizontal page overflow with a sheet open or closed.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // THE DESKTOP IS NOT TOUCHED: a dialog sized to its content, no floor.
    await page.setViewportSize({ width: 1120, height: 1000 });
    await expect(page.locator('[data-after-trade-form]')).toBeVisible();
    const dialog = await openConcept(page, 'Direction');
    const desktop = await settledBox(dialog);
    await shot(page, 'desktop-direction');
    expect(desktop.height, 'a desktop dialog has no phone floor').toBeLessThan(1000 * FLOOR);
    expect(desktop.y + desktop.height, 'and is not bottom-anchored').toBeLessThan(1000 - 40);
    await closeSheet(page);
  });
});

async function signIn(page: Page, prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}@example.test`,
    password: 'Correct-Horse9!',
    name: 'After Trade Sheets',
  });
  await loginAs(page, 'en', user);
}

async function openConcept(page: Page, field: string): Promise<Locator> {
  await page.locator('[data-step-link="trade"]').click();
  await page.getByRole('button', { name: `Edit ${field}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeSheet(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** The box once the entrance transition has finished moving it. */
async function settledBox(locator: Locator) {
  let last = await locator.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await locator.page().waitForTimeout(60);
    const next = await locator.boundingBox();
    if (next !== null && last !== null && next.y === last.y && next.height === last.height) {
      return next;
    }
    last = next;
  }
  throw new Error('the sheet never settled');
}

function expectAnchored(box: { y: number; height: number }, viewportHeight: number) {
  expect(Math.abs(box.y + box.height - viewportHeight), 'bottom-anchored').toBeLessThanOrEqual(1);
}

async function shot(page: Page, name: string) {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
