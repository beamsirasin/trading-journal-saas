import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { savedSymbols, workspaces } from '../src/server/db/schema';
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

/*
  THE SYMBOL PICKER WITH A PHONE KEYBOARD UP.

  iOS Safari, and Chrome on Android by default, lay the keyboard OVER the page:
  the layout viewport keeps its height, only the visual viewport shrinks, and a
  sheet fixed to the bottom of the layout viewport sits behind the keyboard.
  Measured before the fix, a 390x844 phone with one saved symbol had its search
  field at 571-619px under a keyboard whose top edge was at 508px, and with a
  twelve-symbol library the last rows could never be scrolled above it.

  No desktop engine raises a real keyboard, so this models the one the page
  sees: `window.visualViewport` is replaced by a stand-in whose height the test
  shrinks by a real keyboard's height (336px on a 390x844 iPhone, 260px on a
  375x667 one, suggestion bar included), in a mobile-emulated Chromium. It
  judges the sheet the way a trader would: is the field being typed into above
  the keyboard, can every row be scrolled above it, and does the sheet go back
  where it was when the keyboard leaves.
*/
const PHONES = [
  { name: '390x844', width: 390, height: 844, keyboard: 336 },
  { name: '375x667', width: 375, height: 667, keyboard: 260 },
] as const;
const LIBRARY = [
  'XAUUSD',
  'NAS100',
  'US30.cash',
  'GER40',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'BTCUSD',
  'ETHUSD',
  'SPX500',
  'XAGUSD',
  'AUDUSD',
];

test.describe('After Trade Symbol sheet with a phone keyboard up', () => {
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  test.use({ isMobile: true, hasTouch: true });

  for (const phone of PHONES) {
    for (const size of [1, LIBRARY.length]) {
      test(`keeps search and every row above the keyboard at ${phone.name}, ${size} saved`, async ({
        page,
      }) => {
        test.skip(test.info().project.name !== 'chromium', 'One engine is enough for geometry.');
        test.setTimeout(120_000);
        page.setDefaultTimeout(15_000);
        await modelKeyboard(page);
        await page.setViewportSize({ width: phone.width, height: phone.height });
        await signIn(page, 'after-trade-keyboard', LIBRARY.slice(0, size));
        await page.goto(ROUTE);
        await expect(page.locator('[data-after-trade-form]')).toBeVisible();

        const sheet = await openConcept(page, 'Symbol');
        const resting = await settledBox(sheet);
        const search = sheet.getByRole('combobox', { name: 'Symbol' });
        await search.focus();
        await page.evaluate((height) => window.__keyboard(height), phone.keyboard);
        const line = phone.height - phone.keyboard;
        const lifted = await settledBox(sheet);
        await shot(page, `keyboard-${phone.width}-${size}`);

        // The sheet sits on the keyboard, whole, inside what is visible.
        expect(Math.abs(lifted.y + lifted.height - line), 'on the keyboard').toBeLessThanOrEqual(1);
        expect(lifted.y, 'never above the top of the screen').toBeGreaterThanOrEqual(0);
        // The field being typed into is above the keyboard, and still focused.
        const field = (await search.boundingBox())!;
        expect(field.y + field.height, 'search above the keyboard').toBeLessThanOrEqual(line);
        expect(field.y).toBeGreaterThanOrEqual(0);
        await expect(search).toBeFocused();
        // Every row can be scrolled above the keyboard, inside the sheet.
        const body = sheet.locator('[data-sheet-body]');
        await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
        const last = (await sheet.locator('[data-symbol-option]').last().boundingBox())!;
        expect(last.y + last.height, 'last row reachable').toBeLessThanOrEqual(line);
        /*
          SEARCH STAYS PUT while the rows scroll: still directly under the
          header, still above the keyboard, and on top — the point at its middle
          is the field itself, not a row sliding beneath it.
        */
        const scrolled = await body.evaluate((element) => element.scrollTop > 0);
        await shot(page, `keyboard-${phone.width}-${size}-scrolled`);
        /*
          NO ROW SHOWS BETWEEN THE HEADER AND THE SEARCH. Walked through every
          scroll position: the strip under the header must be the search strip,
          never a row sliding up through a gap above it.
        */
        const peeking = await body.evaluate((element) => {
          const header = element.previousElementSibling!.getBoundingClientRect();
          const found: number[] = [];
          for (let top = 0; top <= element.scrollHeight; top += 4) {
            element.scrollTop = top;
            for (let y = header.bottom + 1; y < header.bottom + 20; y += 2) {
              const hit = document.elementFromPoint(header.left + 40, y);
              if (hit?.closest('[data-symbol-option]')) found.push(element.scrollTop);
            }
          }
          element.scrollTop = element.scrollHeight;
          return found;
        });
        expect(peeking, 'no row between header and search').toEqual([]);
        expect(scrolled, 'a long library scrolls; a short one does not').toBe(size > 1);
        const header = (await sheet.locator('[data-slot="sheet-header"]').boundingBox())!;
        const pinned = (await search.boundingBox())!;
        expect(pinned.y, 'search right under the header').toBeGreaterThanOrEqual(
          header.y + header.height - 1,
        );
        // Only a scrolled list moves the field up; at rest it sits below the description.
        if (scrolled) {
          expect(pinned.y, 'search right under the header').toBeLessThanOrEqual(
            header.y + header.height + 24,
          );
        }
        expect(pinned.y + pinned.height, 'search above the keyboard').toBeLessThanOrEqual(line);
        expect(
          await search.evaluate((input) => {
            const box = input.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return hit !== null && input.parentElement!.contains(hit);
          }),
          'search is on top of the rows',
        ).toBe(true);
        await expect(search).toBeFocused();
        // The page behind never scrolls to make room.
        expect(await page.evaluate(() => window.scrollY)).toBe(0);
        // A typed symbol with no match offers Add above the keyboard too.
        await search.fill('ZZTEST');
        const add = (await sheet.getByRole('button', { name: /^Add/ }).boundingBox())!;
        expect(add.y + add.height, 'Add above the keyboard').toBeLessThanOrEqual(line);
        await search.fill('');

        // Keyboard dismissed: the sheet goes back exactly where it was.
        await page.evaluate(() => window.__keyboard(0));
        const back = await settledBox(sheet);
        expectAnchored(back, phone.height);
        expect(Math.round(back.height)).toBe(Math.round(resting.height));
      });
    }
  }
});

declare global {
  interface Window {
    __keyboard: (height: number) => void;
  }
}

/** Replace `visualViewport` with one the test can shrink, as a keyboard does. */
async function modelKeyboard(page: Page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    let keyboard = 0;
    Object.defineProperties(viewport, {
      height: { get: () => window.innerHeight - keyboard },
      width: { get: () => window.innerWidth },
      offsetTop: { get: () => 0 },
      offsetLeft: { get: () => 0 },
      pageTop: { get: () => window.scrollY },
      pageLeft: { get: () => window.scrollX },
      scale: { get: () => 1 },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => viewport });
    window.__keyboard = (height: number) => {
      keyboard = height;
      viewport.dispatchEvent(new Event('resize'));
    };
  });
}

async function signIn(page: Page, prefix: string, library: readonly string[] = []) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'After Trade Sheets',
  });
  if (library.length > 0) {
    const client = postgres(testUrl, { max: 1 });
    try {
      const db = drizzle(client, { schema: { savedSymbols, workspaces } });
      const [workspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.personalOwnerUserId, user.id));
      const now = Date.now();
      await db.insert(savedSymbols).values(
        library.map((symbol, index) => ({
          workspaceId: workspace!.id,
          symbol,
          createdAt: new Date(now - index * 1000),
        })),
      );
    } finally {
      await client.end();
    }
  }
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
