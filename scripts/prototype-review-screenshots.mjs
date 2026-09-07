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
  // --- 1-3. Trade Log -----------------------------------------------------
  { name: '01-trade-log-desktop-1440', path: '/en/prototype/trade-log', width: 1440, height: 1200 },
  {
    name: '01b-trade-log-desktop-1440-light',
    path: '/en/prototype/trade-log',
    width: 1440,
    height: 1200,
    theme: 'light',
  },
  { name: '02-trade-log-mobile-390', path: '/en/prototype/trade-log', width: 390, height: 844 },
  {
    name: '02b-trade-log-mobile-390-light',
    path: '/en/prototype/trade-log',
    width: 390,
    height: 844,
    theme: 'light',
  },
  { name: '03-trade-log-mobile-320', path: '/en/prototype/trade-log', width: 320, height: 800 },

  // --- 4-5. Trade Details -------------------------------------------------
  {
    name: '04-trade-details-desktop-overview',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 1440,
    height: 1100,
  },
  {
    name: '04b-trade-details-desktop-execution',
    path: '/en/prototype/trade-log?trade=t-04&tab=execution',
    width: 1440,
    height: 1100,
  },
  {
    name: '04c-trade-details-desktop-review',
    path: '/en/prototype/trade-log?trade=t-07&tab=review',
    width: 1440,
    height: 1100,
  },
  {
    // The concise "System result not recorded" + action, on a pending trade.
    name: '04d-trade-details-review-system-not-recorded',
    path: '/en/prototype/trade-log?trade=t-01&tab=review',
    width: 1440,
    height: 1100,
  },
  {
    name: '05-trade-details-mobile',
    path: '/en/prototype/trade-log?trade=t-01',
    width: 390,
    height: 844,
  },

  // --- 6. Log a trade choice ---------------------------------------------
  {
    name: '06-log-a-trade-choice',
    path: '/en/prototype/log-trade',
    width: 1440,
    height: 900,
    full: true,
  },

  // --- 7-10. At Entry -----------------------------------------------------
  {
    name: '07-at-entry-desktop',
    path: '/en/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '07b-at-entry-desktop-optional-filled',
    path: '/en/prototype/log-trade/at-entry?expand=1',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '08-at-entry-mobile-main',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
  },
  {
    name: '09-at-entry-mobile-optional-subview',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await page.getByRole('button', { name: /Entry context/ }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    name: '10-at-entry-mobile-keyboard-open',
    path: '/en/prototype/log-trade/at-entry',
    width: 390,
    height: 844,
    /*
      A REPRESENTATIVE KEYBOARD-OPEN STATE.

      Headless Chromium has no soft keyboard, so the keyboard is emulated the
      only honest way available: the visual viewport is shrunk to the height a
      real keyboard leaves (about 340px of a 844px screen), which is exactly the
      signal `useKeyboardObscuringViewport` reads. The footer then undocks on its
      own, and the shot shows the focused field and its label with nothing of
      ours covering them.
    */
    keyboard: 340,
    prepare: async (page) => {
      const field = page.getByLabel('Initial risk');
      await field.focus();
      /*
        SCROLLED INTO THE REGION THE KEYBOARD LEAVES, not into the layout
        viewport. `scrollIntoViewIfNeeded` sees an 844px window and concludes
        the field is already visible — then the keyboard covers the lower 340px
        of it. The point of this frame is that the focused field and its label
        survive a keyboard, so the scroll has to reason about the same 504px the
        reader can actually see.
      */
      await page.evaluate((keyboardHeight) => {
        const input = document.activeElement;
        if (input === null) return;
        const visible = window.innerHeight - keyboardHeight;
        const rect = input.getBoundingClientRect();
        // Leave room beneath for the field's helper/validation line.
        const target = visible - 96;
        if (rect.bottom > target) window.scrollBy(0, rect.bottom - target);
      }, 340);
      await page.waitForTimeout(400);
      // ASSERTED, NOT ASSUMED. The whole point of this frame is that the docked
      // save released itself; if it did not, the screenshot would show a bar
      // over the keyboard and quietly claim the opposite.
      const state = await page.locator('[data-form-footer]').getAttribute('data-form-footer');
      if (state !== 'inline') {
        throw new Error(`expected the save action to undock under a keyboard, got "${state}"`);
      }
    },
  },

  // --- 11-13. After Trade -------------------------------------------------
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
    name: '12-after-trade-mobile-main',
    path: '/en/prototype/log-trade/after-trade',
    width: 390,
    height: 844,
  },
  {
    name: '13-after-trade-mobile-optional-subview',
    path: '/en/prototype/log-trade/after-trade',
    width: 390,
    height: 844,
    prepare: async (page) => {
      await page.getByRole('button', { name: /Add original plan/ }).click();
      await page.waitForTimeout(400);
    },
  },

  // --- 14-15. Exits -------------------------------------------------------
  {
    name: '14-ordinary-full-close',
    path: '/en/prototype/exits',
    width: 1120,
    height: 620,
  },
  {
    name: '15-multiple-exits',
    path: '/en/prototype/exits',
    width: 1120,
    height: 1200,
    full: true,
  },
  { name: '15b-multiple-exits-mobile', path: '/en/prototype/exits', width: 390, height: 844 },

  // --- 16. Confidence / entry context -------------------------------------
  {
    name: '16-confidence-context-mobile',
    path: '/en/prototype/context',
    width: 390,
    height: 844,
  },
  {
    name: '16b-confidence-context-desktop',
    path: '/en/prototype/context',
    width: 1440,
    height: 1000,
    full: true,
  },
  {
    name: '16c-confidence-context-desktop-light',
    path: '/en/prototype/context',
    width: 1440,
    height: 1000,
    theme: 'light',
    full: true,
  },

  // --- 17. The qualified Known net P&L state ------------------------------
  {
    // The default scope contains a price-only trade and a legacy record, so the
    // money aggregate covers 110 of 112 closed trades and says so.
    name: '17-known-net-pnl-qualified',
    path: '/en/prototype/trade-log',
    width: 1440,
    height: 460,
  },
  {
    // Filtered to one strategy: every closed trade in scope carries money, so
    // the same strip reads the unqualified "Net P&L".
    name: '17b-net-pnl-complete',
    path: '/en/prototype/trade-log?strategy=Elliott%20Wave',
    width: 1440,
    height: 460,
  },
  {
    // Two currencies in scope: never summed, never converted.
    name: '17c-net-pnl-multiple-currencies',
    path: '/en/prototype/trade-log?account=all',
    width: 1440,
    height: 460,
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
