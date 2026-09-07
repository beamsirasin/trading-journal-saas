/**
 * The DESIGN-REVIEW screenshot set.
 *
 * Deliberately separate from `prototype-screenshots.mjs`, which is the working
 * capture set used while building. This one is a fixed, named manifest of the
 * screens the design review asked to see, written to its own directory so the
 * review set cannot drift as the working set is added to. It changes only when
 * the review asks for a different list.
 *
 * REAL VIEWPORTS, NOT SCALED COLUMNS. Every responsive rule in this codebase is
 * a viewport media query, so a 390px column inside a 1440px window renders the
 * DESKTOP composition squeezed — the exact failure the mobile design exists to
 * prevent, presented as though it were the design.
 *
 * POPULATED STATES ONLY. No empty journals, no untouched forms: every screen
 * here carries fixture content, because a review of an empty surface is a review
 * of nothing.
 *
 * FULL-PAGE vs FIRST FOLD is chosen per screen, not globally:
 *   - forms and specimen pages on DESKTOP capture full-page, because the thing
 *     under review is the whole form's length and hierarchy. Safe there because
 *     `FormFooter` is `lg:static` — it has no sticky element to duplicate.
 *   - MOBILE captures the real 390/320 x device-height fold, because the docked
 *     save action's real position is part of what is being judged, and a
 *     full-page capture would render it somewhere no phone ever shows it.
 *
 * Usage: node scripts/prototype-review-screenshots.mjs [--base http://localhost:3000]
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const BASE = args.includes('--base')
  ? (args[args.indexOf('--base') + 1] ?? '')
  : 'http://localhost:3000';
const OUT = path.resolve('docs/prototype/review-screenshots');

/**
 * Dark is the product's default and therefore the primary theme. A light
 * companion is captured only where theme behaviour MATERIALLY differs — the
 * dense journal surface, the mobile card list, the drawer over its dimmed
 * backdrop, the form control set, and the muted optional-details plane, whose
 * whole job is to sit below the core surface in tone.
 */
const SHOTS = [
  // --- 1. Log a trade · the recording choice ---------------------------------
  { name: '01-choice-desktop', path: '/en/prototype/log-trade', width: 1440, height: 760 },
  { name: '02-choice-mobile', path: '/en/prototype/log-trade', width: 390, height: 844 },

  // --- 2. Still open ---------------------------------------------------------
  {
    name: '03-still-open-desktop',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '03b-still-open-desktop-light',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
    full: true,
    theme: 'light',
  },
  {
    name: '04-still-open-mobile',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
  },
  {
    name: '05-still-open-target-added',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
    full: true,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Add target' }).click();
      await page.locator('input').last().fill('1000.00');
      await page.waitForTimeout(200);
    },
  },
  {
    name: '06-still-open-plan-editor-desktop',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1100,
    full: true,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'What is your plan?' }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: '07-still-open-feelings-editor-mobile',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'How did you feel at entry?' }).click();
      await page.waitForTimeout(300);
    },
  },
  {
    name: '08-still-open-prompts-answered',
    path: '/en/prototype/log-trade/at-entry?filled=1',
    width: 1440,
    height: 1000,
    full: true,
  },

  // --- 3. Fully closed -------------------------------------------------------
  {
    name: '09-fully-closed-desktop',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
    full: true,
  },
  {
    name: '09b-fully-closed-desktop-light',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
    full: true,
    theme: 'light',
  },
  {
    name: '10-fully-closed-mobile',
    path: '/en/prototype/log-trade/after-trade',
    width: 390,
    height: 844,
  },
  {
    name: '11-fully-closed-plan-editor',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
    full: true,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'What was your plan?' }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: '12-fully-closed-feelings-editor',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
    full: true,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'How did you feel at entry?' }).click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: '13-fully-closed-review-editor',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
    full: true,
    prepare: async (page) => {
      await page
        .getByRole('button', { name: 'What would you repeat or change next time?' })
        .click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: '14-fully-closed-prompts-answered',
    path: '/en/prototype/log-trade/after-trade?filled=1',
    width: 1440,
    height: 1200,
    full: true,
  },

  // --- 4. Date and time ------------------------------------------------------
  {
    name: '15-timestamp-picker-desktop',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1000,
    prepare: async (page) => {
      await page.getByLabel('Entry time').click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '16-timestamp-picker-mobile',
    path: '/en/prototype/log-trade/after-trade',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await page.getByLabel('Entry time').click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '17-timestamp-picker-month-year',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1000,
    prepare: async (page) => {
      await page.getByLabel('Entry time').click();
      await page.waitForTimeout(300);
      await page.getByRole('button', { name: /^September 2026$/ }).click();
      await page.waitForTimeout(300);
    },
  },

  // --- 5. Partial exits ------------------------------------------------------
  {
    name: '18-partial-exits-collapsed',
    path: '/en/prototype/log-trade/after-trade?exits=1',
    width: 1440,
    height: 1300,
    full: true,
  },
  {
    name: '19-partial-exits-collapsed-mobile',
    path: '/en/prototype/log-trade/after-trade?exits=1',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await page.getByRole('heading', { name: 'Exits' }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
    },
  },
  {
    name: '20-partial-exit-active-editor',
    path: '/en/prototype/log-trade/after-trade?exits=1&edit=e2',
    width: 1440,
    height: 1500,
    full: true,
  },
  {
    name: '21-partial-trade-closed-vs-open',
    path: '/en/prototype/trade-log?trade=t-04&tab=execution',
    width: 1440,
    height: 1100,
  },

  // --- 6. Trade Log ----------------------------------------------------------
  { name: '22-trade-log-desktop', path: '/en/prototype/trade-log', width: 1440, height: 1200 },
  {
    name: '22b-trade-log-desktop-light',
    path: '/en/prototype/trade-log',
    width: 1440,
    height: 1200,
    theme: 'light',
  },
  { name: '23-trade-log-mobile', path: '/en/prototype/trade-log', width: 390, height: 844 },
  { name: '23b-trade-log-320', path: '/en/prototype/trade-log', width: 320, height: 800 },
  {
    name: '24-trade-log-partial-trade',
    path: '/en/prototype/trade-log?state=open',
    width: 1440,
    height: 900,
  },
  {
    name: '25-trade-log-incomplete-coverage',
    path: '/en/prototype/trade-log?account=all',
    width: 1440,
    height: 900,
  },

  // --- 7. Trade details ------------------------------------------------------
  {
    name: '26-details-overview-desktop',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 1440,
    height: 1100,
  },
  {
    name: '27-details-overview-mobile',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 390,
    height: 844,
  },
  {
    name: '28-details-entry-exits-desktop',
    path: '/en/prototype/trade-log?trade=t-04&tab=execution',
    width: 1440,
    height: 1100,
  },
  {
    name: '29-details-entry-exits-mobile',
    path: '/en/prototype/trade-log?trade=t-04&tab=execution',
    width: 390,
    height: 844,
  },
  {
    name: '30-details-review-desktop',
    path: '/en/prototype/trade-log?trade=t-01&tab=review',
    width: 1440,
    height: 1100,
  },
  {
    name: '31-details-review-mobile',
    path: '/en/prototype/trade-log?trade=t-01&tab=review',
    width: 390,
    height: 844,
  },
];
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    // Captured with reduced motion so a screenshot never catches a transition
    // mid-flight and reports it as the design.
    reducedMotion: 'reduce',
  });

  // next-themes owns the theme under the key declared in `theme-contract.ts`.
  // Seeding it before first paint is what makes a theme deterministic with no
  // toggle visible in the frame — and it has to be that exact key, or the page
  // quietly renders its default and the "light" capture is a second dark one.
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem('trading-os-theme', theme);
    } catch {
      /* private mode — the page still renders its default */
    }
  }, shot.theme ?? 'dark');

  if (shot.keyboard !== undefined) {
    // Emulate a soft keyboard by shrinking the visual viewport, which is the
    // signal the docked-save logic actually listens to.
    await context.addInitScript((keyboardHeight) => {
      const viewport = window.visualViewport;
      if (viewport === null || viewport === undefined) return;
      Object.defineProperty(viewport, 'height', {
        get: () => window.innerHeight - keyboardHeight,
      });
      window.addEventListener('load', () => {
        viewport.dispatchEvent(new Event('resize'));
      });
    }, shot.keyboard);
  }

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({
    content: 'nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}',
  });
  await page.waitForTimeout(500);
  if (shot.prepare !== undefined) {
    await shot.prepare(page);
  }
  if (shot.keyboard !== undefined) {
    // Paint the region the keyboard would occupy, so the frame shows what the
    // reader can actually see rather than implying the page owns the screen.
    await page.evaluate((keyboardHeight) => {
      const bar = document.createElement('div');
      bar.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${keyboardHeight}px;background:repeating-linear-gradient(45deg,#2a2a2a,#2a2a2a 12px,#232323 12px,#232323 24px);color:#8a8a8a;font:600 13px system-ui;display:flex;align-items:center;justify-content:center;z-index:2147483647;border-top:1px solid #444`;
      bar.textContent = 'on-screen keyboard (emulated)';
      document.body.append(bar);
    }, shot.keyboard);
    await page.waitForTimeout(200);
  }

  await page.screenshot({
    path: path.join(OUT, `${shot.name}.png`),
    fullPage: shot.full ?? false,
  });
  console.log(
    `captured ${shot.name} (${shot.width}x${shot.height}${shot.full === true ? ', full page' : ''}, ${shot.theme ?? 'dark'})`,
  );

  await context.close();
}

await browser.close();
console.log(`\n${SHOTS.length} review screenshots written to ${OUT}`);
