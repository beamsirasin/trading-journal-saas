/**
 * Captures the At Entry visual-pilot review set.
 *
 * DEVELOPMENT TOOLING FOR A DESIGN REVIEW, not part of the product build. Drives
 * the dev server's `/prototype/design-pilot/at-entry` route (development only)
 * at real viewport widths, in both themes, and writes PNGs to
 * `docs/reviews/at-entry-visual-pilot/pilot/`. The production baseline was
 * captured separately from the real `/app/trades/new?timing=at_entry` route.
 *
 * Usage:  node scripts/at-entry-pilot-screenshots.mjs [--base http://localhost:3000] [--filter substring]
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
const OUT = path.resolve('docs/reviews/at-entry-visual-pilot/pilot');
const ROUTE = '/en/prototype/design-pilot/at-entry';

const WIDTHS = [1440, 1120, 390, 320];
const THEMES = ['light', 'dark'];

/** @type {{name: string, query: string, width: number, theme: string, full?: boolean, prepare?: (page: import('@playwright/test').Page) => Promise<void>}[]} */
const SHOTS = [];

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    SHOTS.push({ name: `${width}-${theme}-untouched`, query: 'state=untouched', width, theme });
    SHOTS.push({
      name: `${width}-${theme}-untouched-full`,
      query: 'state=untouched',
      width,
      theme,
      full: true,
    });
  }
}

const STATES = [
  ['partial', [1440, 'light'], [390, 'dark']],
  ['no-target', [1440, 'dark'], [390, 'light']],
  ['inherited', [1440, 'dark'], [390, 'light'], [1120, 'light']],
  ['customized', [1440, 'light'], [390, 'dark']],
  ['validation', [1440, 'dark'], [390, 'light'], [320, 'dark']],
  ['analytical', [1440, 'light'], [1120, 'dark'], [390, 'dark'], [320, 'light']],
];

for (const [state, ...targets] of STATES) {
  for (const [width, theme] of targets) {
    SHOTS.push({
      name: `${width}-${theme}-${state}`,
      query: `state=${state}`,
      width,
      theme,
      full: true,
    });
  }
}

SHOTS.push({
  name: '1440-dark-partial-figures-mono',
  query: 'state=partial&figures=mono',
  width: 1440,
  theme: 'dark',
});
SHOTS.push({
  name: '1440-dark-partial-figures-tabular',
  query: 'state=partial',
  width: 1440,
  theme: 'dark',
});

for (const [width, theme] of [
  [1440, 'dark'],
  [390, 'light'],
]) {
  SHOTS.push({
    name: `${width}-${theme}-exit-plan-editor`,
    query: 'state=inherited',
    width,
    theme,
    prepare: async (page) => {
      await page.getByRole('button', { name: 'Choose another' }).click();
    },
  });
}

const shots = FILTER === '' ? SHOTS : SHOTS.filter((shot) => shot.name.includes(FILTER));

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const shot of shots) {
  const height = shot.width >= 1120 ? 900 : 844;
  const context = await browser.newContext({
    viewport: { width: shot.width, height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem('trading-os-theme', theme);
    } catch {
      /* private mode — the page still renders its default */
    }
  }, shot.theme);

  const page = await context.newPage();
  await page.goto(`${BASE}${ROUTE}?${shot.query}`, { waitUntil: 'networkidle' });
  await page.addStyleTag({
    content: 'nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}',
  });
  await page.waitForTimeout(400);
  if (shot.prepare !== undefined) {
    await shot.prepare(page);
    await page.waitForTimeout(500);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: shot.full ?? false });
  console.log(
    `captured ${shot.name}${overflow > 1 ? `  (horizontal overflow ${overflow}px)` : ''}`,
  );
  await context.close();
}

await browser.close();
console.log(`\n${shots.length} screenshots written to ${OUT}`);
