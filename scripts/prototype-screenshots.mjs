/**
 * Captures the prototype review set.
 *
 * DEVELOPMENT TOOLING FOR A DESIGN REVIEW, not part of the product build. It
 * drives the dev server's `/prototype` routes at the exact viewport widths the
 * brief asks to see, in both themes, and writes PNGs to
 * `docs/prototype/screenshots/`.
 *
 * The widths are REAL VIEWPORTS, not a narrow div inside a wide window. Every
 * responsive rule in this codebase is a viewport media query, so a 390px column
 * rendered in a 1440px browser would show the desktop composition squeezed —
 * exactly the thing the mobile design exists to avoid — and the screenshot
 * would be of a layout no phone will ever produce.
 *
 * Usage:  node scripts/prototype-screenshots.mjs [--base http://localhost:3000] [--filter substring]
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

const BASE = arg('--base', 'http://localhost:3000');
const FILTER = arg('--filter', '');
const OUT = path.resolve('docs/prototype/screenshots');

/** @type {{name: string, path: string, width: number, height: number, theme?: 'dark'|'light', full?: boolean, prepare?: (page: import('@playwright/test').Page) => Promise<void>}[]} */
const SHOTS = [
  // --- Prototype 1-3: the journal at three widths -------------------------
  { name: '01-trade-log-desktop-1440', path: '/en/prototype/trade-log', width: 1440, height: 1200 },
  {
    name: '01-trade-log-desktop-1440-light',
    path: '/en/prototype/trade-log',
    width: 1440,
    height: 1200,
    theme: 'light',
  },
  { name: '02-trade-log-laptop-1120', path: '/en/prototype/trade-log', width: 1120, height: 1000 },
  { name: '02-trade-log-laptop-1280', path: '/en/prototype/trade-log', width: 1280, height: 1000 },
  { name: '03-trade-log-mobile-390', path: '/en/prototype/trade-log', width: 390, height: 844 },
  {
    name: '03-trade-log-mobile-390-light',
    path: '/en/prototype/trade-log',
    width: 390,
    height: 844,
    theme: 'light',
  },
  {
    name: '03b-trade-log-mobile-320',
    path: '/en/prototype/trade-log',
    width: 320,
    height: 780,
  },
  {
    name: '03c-trade-log-desktop-thai',
    path: '/en/prototype/trade-log?lang=th',
    width: 1440,
    height: 1000,
  },
  {
    name: '03d-trade-log-all-accounts-mixed-currency',
    path: '/en/prototype/trade-log?account=all',
    width: 1440,
    height: 900,
  },
  {
    name: '03e-trade-log-open-state',
    path: '/en/prototype/trade-log?state=open',
    width: 1440,
    height: 900,
  },

  // --- Prototype 4: trade details ----------------------------------------
  {
    name: '04-trade-detail-desktop-overview',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 1440,
    height: 1000,
  },
  {
    name: '04b-trade-detail-desktop-execution',
    path: '/en/prototype/trade-log?trade=t-04',
    width: 1440,
    height: 1000,
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'Execution' }).click();
    },
  },
  {
    name: '04c-trade-detail-desktop-review',
    path: '/en/prototype/trade-log?trade=t-07',
    width: 1440,
    height: 1000,
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'Review' }).click();
    },
  },
  {
    name: '04d-trade-detail-mobile',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 390,
    height: 844,
  },
  {
    name: '04e-trade-detail-mobile-review-pending',
    path: '/en/prototype/trade-log?trade=t-02',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await page.getByRole('tab', { name: 'Review' }).click();
    },
  },

  // --- Prototype 5: the entry choice -------------------------------------
  {
    name: '05-log-trade-choice-desktop',
    path: '/en/prototype/log-trade',
    width: 1440,
    height: 900,
  },
  { name: '05b-log-trade-choice-mobile', path: '/en/prototype/log-trade', width: 390, height: 844 },

  // --- Prototype 6-7: At Entry -------------------------------------------
  {
    name: '06-at-entry-desktop',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1100,
  },
  {
    name: '06b-at-entry-desktop-expanded',
    path: '/en/prototype/log-trade/at-entry?expand=1',
    width: 1440,
    height: 1400,
  },
  {
    name: '07-at-entry-mobile',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
  },

  // --- Prototype 8-9: After Trade ----------------------------------------
  {
    name: '08-after-trade-desktop',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
  },
  {
    name: '08b-after-trade-desktop-light',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1200,
    theme: 'light',
  },
  {
    name: '09-after-trade-mobile',
    path: '/en/prototype/log-trade/after-trade',
    width: 390,
    height: 844,
  },

  // --- Prototype 10: partial exits ---------------------------------------
  { name: '10-partial-exits-desktop', path: '/en/prototype/exits', width: 1440, height: 1300 },
  { name: '10b-partial-exits-mobile', path: '/en/prototype/exits', width: 390, height: 950 },

  // --- Prototype 11: confidence and entry context ------------------------
  {
    name: '11-confidence-context-desktop',
    path: '/en/prototype/context',
    width: 1440,
    height: 1300,
  },
  {
    name: '11b-confidence-context-light',
    path: '/en/prototype/context',
    width: 1440,
    height: 1300,
    theme: 'light',
  },
  { name: '11c-confidence-context-mobile', path: '/en/prototype/context', width: 390, height: 950 },
  // --- Journal states, added after the implementation-quality audit ----
  {
    name: '12-journal-loading',
    path: '/en/prototype/trade-log?demo=loading',
    width: 1440,
    height: 800,
  },
  {
    name: '12b-journal-first-use',
    path: '/en/prototype/trade-log?demo=first-use',
    width: 1440,
    height: 800,
  },
  {
    name: '12c-journal-error',
    path: '/en/prototype/trade-log?demo=error',
    width: 1440,
    height: 800,
  },
  {
    name: '12d-journal-no-match',
    path: '/en/prototype/trade-log?q=zzzzz',
    width: 1440,
    height: 800,
  },
];

const shots = FILTER === '' ? SHOTS : SHOTS.filter((shot) => shot.name.includes(FILTER));

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });

  // The product's theme is owned by next-themes under the key declared in
  // `theme-contract.ts`. Seeding it before the first paint is how a screenshot
  // gets a deterministic theme with no visible toggle in the frame — and it has
  // to be that exact key, not `theme`, or the page quietly renders its default
  // and the "light" capture is a second copy of the dark one.
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem('trading-os-theme', theme);
    } catch {
      /* private mode — the page still renders its default */
    }
  }, shot.theme ?? 'dark');

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  // The dev overlay's floating button belongs to Next, not to the design.
  await page.addStyleTag({
    content: 'nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}',
  });
  await page.waitForTimeout(400);
  if (shot.prepare !== undefined) {
    await shot.prepare(page);
    await page.waitForTimeout(400);
  }

  const file = path.join(OUT, `${shot.name}.png`);
  await page.screenshot({ path: file, fullPage: shot.full ?? false });
  console.log(`captured ${shot.name} (${shot.width}x${shot.height})`);

  await context.close();
}

await browser.close();
console.log(`\n${shots.length} screenshots written to ${OUT}`);
