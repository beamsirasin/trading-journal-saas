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
 *   - MOBILE captures the real 390/320 x device-height fold, because the sticky
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
 * backdrop, the form control set, and the selection fills on the context
 * controls. Capturing every screen twice would double the set to say the same
 * thing five more times.
 */
const SHOTS = [
  // --- Trade Log, four widths -------------------------------------------
  {
    name: '01-trade-log-desktop-1440',
    path: '/en/prototype/trade-log',
    width: 1440,
    height: 1200,
  },
  {
    name: '01b-trade-log-desktop-1440-light',
    path: '/en/prototype/trade-log',
    width: 1440,
    height: 1200,
    theme: 'light',
  },
  {
    name: '02-trade-log-desktop-1280',
    path: '/en/prototype/trade-log',
    width: 1280,
    height: 1100,
  },
  {
    name: '03-trade-log-tablet-1024',
    path: '/en/prototype/trade-log',
    width: 1024,
    height: 1100,
  },
  { name: '04-trade-log-mobile-390', path: '/en/prototype/trade-log', width: 390, height: 844 },
  {
    name: '04b-trade-log-mobile-390-light',
    path: '/en/prototype/trade-log',
    width: 390,
    height: 844,
    theme: 'light',
  },
  { name: '05-trade-log-mobile-320', path: '/en/prototype/trade-log', width: 320, height: 800 },

  // --- Trade Details ------------------------------------------------------
  // t-01 is the richest record: strategy, setup, an original plan, confidence,
  // emotions, an entry reason, a chart link, notes and rule observations.
  {
    name: '06-trade-details-desktop-overview',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 1440,
    height: 1100,
  },
  {
    name: '06b-trade-details-desktop-overview-light',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 1440,
    height: 1100,
    theme: 'light',
  },
  {
    // t-04 is the partially-closed position — the only one whose Execution tab
    // carries recorded exits, a closed percentage and a remaining fraction.
    name: '06c-trade-details-desktop-execution',
    path: '/en/prototype/trade-log?trade=t-04&tab=execution',
    width: 1440,
    height: 1100,
  },
  {
    // t-07 has a resolved system result, a real execution gap, mistakes and a
    // review note — the populated form of every Review section.
    name: '06d-trade-details-desktop-review',
    path: '/en/prototype/trade-log?trade=t-07&tab=review',
    width: 1440,
    height: 1100,
  },
  {
    name: '07-trade-details-mobile',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 390,
    height: 844,
  },

  // --- Add Trade ----------------------------------------------------------
  {
    name: '08-log-a-trade-choice',
    path: '/en/prototype/log-trade',
    width: 1440,
    height: 900,
    full: true,
  },
  {
    // The short path as it actually opens: core fields populated, optional
    // sections collapsed. That collapse IS the design claim under review.
    name: '09-at-entry-desktop',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    // The same form with its optional sections answered, so the collapsed
    // summaries ("Strategy · Elliott Wave / Wave 3") can be judged.
    name: '09b-at-entry-desktop-optional-sections-filled',
    path: '/en/prototype/log-trade/at-entry?expand=1',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '10-at-entry-mobile',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
  },
  {
    name: '11-after-trade-desktop',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '11b-after-trade-desktop-light',
    path: '/en/prototype/log-trade/after-trade',
    width: 1440,
    height: 1000,
    theme: 'light',
    full: true,
  },
  {
    name: '12-after-trade-mobile',
    path: '/en/prototype/log-trade/after-trade',
    width: 390,
    height: 844,
  },

  // --- Partial exits ------------------------------------------------------
  {
    name: '13-partial-exits-desktop',
    path: '/en/prototype/exits',
    width: 1440,
    height: 1000,
    full: true,
  },
  { name: '13b-partial-exits-mobile', path: '/en/prototype/exits', width: 390, height: 844 },

  // --- Confidence / entry context -----------------------------------------
  {
    name: '14-confidence-entry-context-desktop',
    path: '/en/prototype/context',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '14b-confidence-entry-context-desktop-light',
    path: '/en/prototype/context',
    width: 1440,
    height: 1000,
    theme: 'light',
    full: true,
  },
  {
    name: '14c-confidence-entry-context-mobile',
    path: '/en/prototype/context',
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

  const page = await context.newPage();
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  // The dev overlay's floating button belongs to Next, not to the design.
  await page.addStyleTag({
    content: 'nextjs-portal,[data-nextjs-dev-tools-button]{display:none!important}',
  });
  await page.waitForTimeout(500);

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
