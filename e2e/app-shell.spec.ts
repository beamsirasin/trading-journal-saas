import { expect, test, type Page } from '@playwright/test';

import { authStateFile } from './support/auth-state';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';

// Phase 02: every `/app/*` page now performs a real, database-verified
// session check (src/server/auth/dal.ts) — these Phase-1-era specs assume an
// already-authenticated visitor, via the storage state e2e/auth.setup.ts
// produces (see playwright.config.ts's `setup` project), and skip outright
// when no database is configured to authenticate against at all.
test.use({ storageState: authStateFile });
test.beforeEach(() => {
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
});

// PHASE 1.1. Every route now lives under a locale prefix (`localePrefix:
// 'always'`), so these target the `en` fallback explicitly. `Link` from
// `@/i18n/navigation` renders the same prefix on `aria-current="page"`
// hrefs, which is why the href values below carry it too.
/**
 * Desktop navigation is ONE panel at two widths. `RAIL_WIDTH` is the
 * collapsed footprint, which is also the icon column's own width
 * (`--shell-rail-width`, 4rem); `PANEL_WIDTH` is the footprint once the
 * labels are revealed (`--shell-nav-open-width`, rail + 10rem). Named here so
 * a token change fails loudly in one place rather than as unexplained numbers.
 */
const RAIL_WIDTH = 64;
const PANEL_WIDTH = 224;

/**
 * The resting desktop state is the RAIL ALONE, so any case that needs the
 * secondary panel has to ask for it. Both helpers are idempotent — they read
 * the toggle's current label rather than assuming a starting state.
 */
async function pinSidebar(page: Page) {
  const expand = page.getByRole('button', { name: 'Expand sidebar' });
  if ((await expand.count()) > 0) await expand.click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
}

async function railSidebar(page: Page) {
  const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
  if ((await collapse.count()) > 0) await collapse.click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
}

/** Where the sidebar's icon actually sits — the thing that must never move. */
async function navIconX(page: Page) {
  const box = await page
    .getByRole('complementary')
    .getByRole('link', { name: 'Overview' })
    .locator('svg')
    .first()
    .boundingBox();
  return Math.round(box!.x);
}

/** Horizontal centre of a locator, rounded to the nearest CSS pixel. */
async function centreX(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  return Math.round(box!.x + box!.width / 2);
}

/**
 * PRODUCT DESTINATIONS. Settings is deliberately absent: it moved out of
 * navigation entirely and into the account menu, so asserting it here would
 * be testing the old shape. That it is REACHABLE is asserted where it now
 * lives — see "Settings lives in the account menu" below.
 */
const APP_ROUTES = [
  { href: '/en/app', name: 'Overview' },
  { href: '/en/app/trades', name: 'Trades' },
  { href: '/en/app/strategies', name: 'Strategies' },
  { href: '/en/app/analytics', name: 'Analytics' },
] as const;

test.describe('application shell', () => {
  test('renders the overview dashboard', async ({ page }) => {
    await page.goto('/en/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });

  test('exposes banner and main landmarks at every viewport', async ({ page }) => {
    await page.goto('/en/app');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('exposes a navigation landmark on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('reaches navigation through the drawer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    // The sidebar is display:none below `lg`, which removes it from the
    // accessibility tree entirely — so on mobile there is deliberately NO
    // navigation landmark until the drawer opens. The drawer trigger lives in
    // the banner, which is the standard discoverable path for this pattern.
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  });

  test('has no horizontal overflow', async ({ page }) => {
    await page.goto('/en/app');
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

/**
 * PHASE 01 CHANGE. Phase 00b asserted that unbuilt sections rendered as
 * `aria-disabled` placeholders rather than links to 404s. All five routes now
 * exist, so that guarantee is replaced by its successor: every nav item
 * resolves, and exactly one is marked as the current page.
 */
test.describe('application navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const route of APP_ROUTES) {
    test(`marks ${route.href} as the current page when open`, async ({ page }) => {
      await page.goto(route.href);

      const nav = page.getByRole('navigation', { name: 'Main' });
      const current = nav.locator('[aria-current="page"]');

      // Exactly one. Prefix matching would light up `/app` on every child
      // route and leave a screen reader with two "current page" claims.
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute('href', route.href);
    });
  }

  test('every navigation item resolves to a real page', async ({ page }) => {
    for (const route of APP_ROUTES) {
      const response = await page.goto(route.href);
      expect(response?.status(), `${route.href} should not 404`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('navigating between sections keeps one main landmark', async ({ page }) => {
    await page.goto('/en/app');
    const trades = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Trades' });

    // The collapsed row is intentionally 224px wide while only its 64px icon
    // column is visible. Clicking the whole anchor asks Playwright to centre
    // that off-screen box with scrollIntoViewIfNeeded; when the rail used
    // overflow-hidden, that silently scrolled the rail sideways. Click the
    // genuinely visible part of the same link instead.
    await trades.locator('svg').click();

    await expect(page).toHaveURL(/\/app\/trades$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Trades' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
  });
});

test.describe('responsive navigation', () => {
  test('shows a persistent sidebar on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeHidden();
  });

  test('shows a drawer trigger instead of a sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    await expect(page.getByRole('complementary')).toBeHidden();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeVisible();
  });

  test('keeps mobile shell controls at least 44px in each touch dimension', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    const menuButton = await page
      .getByRole('button', { name: /open navigation menu/i })
      .boundingBox();
    // The account menu, not the theme toggle. The mobile header deliberately
    // carries only navigation, brand, the account switcher and the profile
    // menu now; language and theme moved into the drawer's preferences band
    // (they are set-once preferences that were costing 88px of a ~350px row).
    // Asserting on a control that is no longer meant to be here would be
    // testing the old design.
    const accountButton = await page.getByRole('button', { name: 'Account menu' }).boundingBox();

    // Rounded to the nearest CSS pixel before comparing: every control here
    // is authored at exactly `size-11` (44px) in Tailwind. `boundingBox()`
    // reads getBoundingClientRect(), whose sub-pixel layout rounding can
    // return e.g. 43.99999237060547 for a genuinely-44px box — a rendering
    // artifact invisible to any real user, not a shrunk touch target.
    // Rounding still fails a real regression (43px rounds to 43).
    const round = (value: number | undefined) => Math.round(value ?? 0);

    expect(round(menuButton?.width)).toBeGreaterThanOrEqual(44);
    expect(round(menuButton?.height)).toBeGreaterThanOrEqual(44);
    expect(round(accountButton?.width)).toBeGreaterThanOrEqual(44);
    expect(round(accountButton?.height)).toBeGreaterThanOrEqual(44);

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    const overviewLink = await dialog.getByRole('link', { name: /Overview/ }).boundingBox();
    expect(round(overviewLink?.height)).toBeGreaterThanOrEqual(44);

    // The drawer's X is gone; the header's hamburger closes it now, and it is
    // the same 44px square in both states. Located structurally because an
    // open modal dialog strips the roles from everything behind it.
    const openTrigger = await page.locator('header button[aria-haspopup="dialog"]').boundingBox();
    expect(round(openTrigger?.width)).toBeGreaterThanOrEqual(44);
    expect(round(openTrigger?.height)).toBeGreaterThanOrEqual(44);

    await page.keyboard.press('Escape');

    // Language and theme are no longer in this drawer at all — they moved to
    // the account menu. They still have to be real touch targets there.
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');

    // Polled, not read once: the menu scales in from 0.95, so a box measured
    // on its first painted frame reports 42px for a genuinely 44px control.
    // What has to meet the minimum is the settled row.
    // The preference ROW is what a thumb lands on and what has to clear this
    // shell's 44px rule. The segments inside the language track are smaller —
    // 28px — and are measured against WCAG 2.5.8's 24x24 instead, which is
    // what let the whole block shed the weight of a settings form.
    await expect
      .poll(async () => round((await menu.locator('[data-preference-row]').boundingBox())?.height))
      .toBeGreaterThanOrEqual(44);

    for (const segment of await menu.getByRole('menuitemradio').all()) {
      const box = await segment.boundingBox();
      expect(round(box?.height)).toBeGreaterThanOrEqual(24);
      expect(round(box?.width)).toBeGreaterThanOrEqual(24);
    }

    // Theme is a single menu row now, and still a full-height target.
    await expect
      .poll(async () =>
        round((await menu.getByRole('menuitem', { name: /change theme/i }).boundingBox())?.height),
      )
      .toBeGreaterThanOrEqual(44);
  });

  test('reaches language and theme through the account menu at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    const banner = page.getByRole('banner');
    await expect(banner.getByRole('button', { name: /change theme/i })).toHaveCount(0);
    await expect(banner.getByRole('button', { name: /language|ภาษา/i })).toHaveCount(0);
    // What the mobile header DOES keep.
    await expect(banner.getByRole('button', { name: /open navigation menu/i })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // Not in the drawer any more — that surface is routes only.
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: /theme/i })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /language|ภาษา/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // In the account menu instead, which is the same place at every width.
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('group', { name: /language/i })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /change theme/i })).toBeVisible();
  });

  /**
   * THE load-bearing property of this shell: the header is global, so nothing
   * in it may move when the sidebar does.
   *
   * An earlier version nested the header inside the workspace column, which
   * shared the sidebar's left offset — so the brand, the toggle and the
   * account controls all slid sideways on every toggle. These x-positions must
   * be byte-identical in both states.
   */
  test('keeps the header, brand and toggle perfectly stationary when the sidebar toggles', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    const banner = page.getByRole('banner');
    const brand = banner.getByRole('link', { name: 'TradeChemist' });
    const toggle = page.getByRole('button', { name: /(Collapse|Expand) sidebar/ });
    const account = banner.getByRole('button', { name: 'Account menu' });

    const geometry = async () => ({
      headerX: Math.round((await banner.boundingBox())?.x ?? -1),
      headerWidth: Math.round((await banner.boundingBox())?.width ?? -1),
      brandX: Math.round((await brand.boundingBox())?.x ?? -1),
      toggleX: Math.round((await toggle.boundingBox())?.x ?? -1),
      accountX: Math.round((await account.boundingBox())?.x ?? -1),
    });

    await pinSidebar(page);
    await page.waitForTimeout(400);
    const open = await geometry();

    await railSidebar(page);
    await page.waitForTimeout(400);
    const closed = await geometry();

    expect(closed).toEqual(open);
    // And the header spans the whole viewport in both states.
    expect(open.headerX).toBe(0);
    expect(open.headerWidth).toBe(1440);
  });

  test('rests as a rail and opens a secondary panel beside it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    const sidebar = page.getByRole('complementary');
    const main = page.getByRole('main');

    // Resting: a slim rail. Present, visible and consuming exactly its own
    // width — never hidden, which is the point of a rail over a hidden panel.
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toHaveAttribute('data-state', 'rail');
    expect(Math.round((await sidebar.boundingBox())?.width ?? -1)).toBe(RAIL_WIDTH);
    expect(Math.round((await main.boundingBox())?.x ?? -1)).toBe(RAIL_WIDTH);

    await pinSidebar(page);
    await page.waitForTimeout(400);

    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(Math.round((await sidebar.boundingBox())?.width ?? -1)).toBe(PANEL_WIDTH);
    expect(Math.round((await main.boundingBox())?.x ?? -1)).toBe(PANEL_WIDTH);
    expect(Math.round((await main.boundingBox())?.width ?? -1)).toBe(1440 - PANEL_WIDTH);
  });

  test('keeps the icon column perfectly still in both states', async ({ page }) => {
    // THE load-bearing property. An earlier pass had a panel that stretched
    // from 72px to 240px, so every icon slid sideways on every toggle. Only
    // the labels beside them may appear and disappear now.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await railSidebar(page);
    await page.waitForTimeout(400);

    const sidebar = page.getByRole('complementary');
    const iconCollapsed = await navIconX(page);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(RAIL_WIDTH);

    await pinSidebar(page);
    await page.waitForTimeout(400);

    expect(await navIconX(page)).toBe(iconCollapsed);
  });

  test('aligns the header toggle with the sidebar icon column', async ({ page }) => {
    // The header's left cell IS the sidebar's icon column: same token, same
    // width, same centring. Before this they used different gutters, and the
    // toggle sat several pixels off the icons directly beneath it — close
    // enough to read as a mistake rather than a decision.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await railSidebar(page);
    await page.waitForTimeout(400);

    const toggleCentre = await centreX(
      page.getByRole('button', { name: /(Collapse|Expand) sidebar/ }).locator('svg'),
    );
    const iconCentre = await centreX(
      page.getByRole('complementary').getByRole('link', { name: 'Overview' }).locator('svg'),
    );

    expect(Math.abs(toggleCentre - iconCentre)).toBeLessThanOrEqual(1);
    // And both sit on the collapsed sidebar's own centre line.
    expect(Math.abs(toggleCentre - RAIL_WIDTH / 2)).toBeLessThanOrEqual(1);
  });

  test('starts the brand where the sidebar labels start', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await pinSidebar(page);
    await page.waitForTimeout(400);

    // The brand LINK, not its wordmark: the link leads with a 32px mark tile,
    // so the wordmark itself necessarily sits further right. What has to line
    // up with the sidebar labels is the leading edge of the brand as a whole.
    const brand = await page
      .locator('header')
      .getByRole('link', { name: 'TradeChemist' })
      .boundingBox();
    const label = await page
      .getByRole('complementary')
      .getByRole('link', { name: 'Overview' })
      .getByText('Overview')
      .boundingBox();

    // One column system: the header and the sidebar share a left edge.
    expect(Math.abs(Math.round(brand!.x) - Math.round(label!.x))).toBeLessThanOrEqual(2);
  });

  test('leaves no invisible hit area over the workspace when collapsed', async ({ page }) => {
    // The label cell is clipped OUT of the box when the panel is closed, so a
    // click 120px in belongs to the page — not to a navigation row lurking
    // under it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await railSidebar(page);
    await page.waitForTimeout(400);

    const sidebar = page.getByRole('complementary');
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(RAIL_WIDTH);

    const ownerIsSidebar = await page.evaluate(() => {
      const aside = document.getElementById('app-sidebar')!;
      const rect = aside.getBoundingClientRect();
      const target = document.elementFromPoint(140, rect.top + 40);
      return aside.contains(target);
    });
    expect(ownerIsSidebar).toBe(false);
  });

  test('does not open on hover or on focus — only on the toggle', async ({ page, isMobile }) => {
    // A previous pass expanded the navigation on pointer proximity. Crossing
    // the rail, or tabbing into it, must now change nothing at all: opening
    // navigation is a deliberate act.
    test.skip(isMobile === true, 'touch emulation has no hover state');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    const sidebar = page.getByRole('complementary');
    await railSidebar(page);
    await page.waitForTimeout(400);

    await sidebar.hover();
    await page.waitForTimeout(400);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(RAIL_WIDTH);

    await sidebar.getByRole('link', { name: 'Trades' }).focus();
    await page.waitForTimeout(400);
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(RAIL_WIDTH);
    await expect(sidebar).toHaveAttribute('data-state', 'rail');
  });

  test('survives rapid open/close toggling without sticking part-way', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    const sidebar = page.getByRole('complementary');
    const main = page.getByRole('main');

    await pinSidebar(page);
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
    }
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForTimeout(500);

    await expect(sidebar).toHaveAttribute('data-state', 'rail');
    expect(Math.round((await main.boundingBox())?.x ?? -1)).toBe(RAIL_WIDTH);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.waitForTimeout(500);
    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
    expect(Math.round((await main.boundingBox())?.x ?? -1)).toBe(PANEL_WIDTH);
  });

  test('renders a persisted rail with no flash of the expanded panel', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await railSidebar(page);
    await page.waitForTimeout(400);

    // Reload: the server reads the cookie, so the workspace must already be at
    // the rail offset on the very first frame. Sampling immediately after
    // DOMContentLoaded would catch an expanded-then-animate-closed flash.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const mainXAtFirstPaint = await page
      .getByRole('main')
      .evaluate((el) => el.getBoundingClientRect().x);

    expect(Math.round(mainXAtFirstPaint)).toBe(RAIL_WIDTH);
    await expect(page.getByRole('complementary')).toHaveAttribute('data-state', 'rail');
  });

  test('reaches language and theme through the account menu on desktop too', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');

    // They used to be two standing icon buttons in this row. One home now, at
    // every width.
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('button', { name: /change theme/i })).toHaveCount(0);

    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    const language = menu.getByRole('group', { name: /language/i });

    await expect(language).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /change theme/i })).toBeVisible();
    // Each states where it currently stands WITHOUT anything being opened —
    // the property the submenus had, which the inline controls had to keep.
    await expect(language.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // Both locales are on screen already, rather than one surface deeper.
    await expect(language.getByRole('menuitemradio', { name: 'ไทย' })).toBeVisible();
  });

  test('mobile drawer opens, traps focus and closes on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Focus restoration and Escape handling are the reason a real dialog
    // primitive is used rather than a toggled div.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /open navigation menu/i })).toBeFocused();
  });

  test('mobile drawer closes after navigating', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: /Analytics/ })
      .click();

    await expect(page).toHaveURL(/\/app\/analytics$/);
    // Without an explicit close the drawer sits over the page it just opened.
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  /**
   * The drawer opens BELOW the global header, so the header keeps its own
   * wordmark on screen for as long as the drawer is open — which is why the
   * drawer no longer carries a second one. This replaces the older
   * "closes after following its wordmark" case, whose subject no longer
   * exists; the remaining ways out (Escape, backdrop, close button, selecting
   * a route) each have their own case above.
   */
  test('mobile drawer does not repeat the wordmark the header still shows', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app/settings');

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('link', { name: 'TradeChemist' })).toHaveCount(0);
    // Structural locator, not `getByRole('banner')`: the drawer is a modal
    // dialog, so Radix marks everything outside it `aria-hidden` and the
    // header has no landmark role for as long as it is open. It is still on
    // screen and still showing the wordmark, which is the whole point.
    await expect(page.locator('header').getByText('TradeChemist')).toBeVisible();
  });

  test('shared buttons keep the 44px touch-target minimum', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/en/app/settings');

    const save = await page.getByRole('button', { name: 'Save profile' }).boundingBox();
    expect(save?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(save?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('has no horizontal overflow at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/en/app');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

/**
 * Shell motion.
 *
 * These primarily assert the SHAPE of the movement. The normal and reduced
 * policy cases also read the computed duration because their relationship is
 * now an accessibility contract: 220ms normally, 120ms when reduced. What
 * must not change is that the panel is seen to travel, that the workspace edge
 * stays welded to it, and that the shell lands in exactly one of two states.
 *
 * Every sample is taken with `requestAnimationFrame` inside the page rather
 * than by screenshotting on a timer — the browser's own frame clock is the
 * only honest witness to what was actually painted.
 */
test.describe('sidebar motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  /** Samples the sidebar and workspace edges every frame while the toggle runs. */
  async function sampleToggle(page: Page, frames = 40) {
    return page.evaluate(async (maxFrames: number) => {
      const sidebar = document.getElementById('app-sidebar')!;
      const main = document.getElementById('main-content')!;
      const toggle = document.querySelector<HTMLButtonElement>(
        'button[aria-controls="app-sidebar"]',
      )!;

      const samples: { right: number; mainLeft: number }[] = [];
      toggle.click();

      return await new Promise<typeof samples>((resolve) => {
        let seen = 0;
        function tick() {
          samples.push({
            right: sidebar.getBoundingClientRect().right,
            mainLeft: main.getBoundingClientRect().left,
          });
          seen += 1;
          if (seen < maxFrames) requestAnimationFrame(tick);
          else resolve(samples);
        }
        requestAnimationFrame(tick);
      });
    }, frames);
  }

  test('is seen to travel rather than resizing in one frame', async ({ page }) => {
    await page.goto('/en/app');
    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(false);
    await pinSidebar(page);
    await page.waitForTimeout(400);

    const normalMotion = await page.getByRole('complementary').evaluate((element) => {
      const style = getComputedStyle(element);
      return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
    });
    expect(normalMotion).toEqual({
      duration: '0.22s',
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    });
    const samples = await sampleToggle(page);

    // The defect this exists for: a panel that is at its open width on one
    // frame and at the rail on the next, which a duration-based assertion
    // would happily call a pass.
    const intermediate = samples.filter(
      (s) => s.right > RAIL_WIDTH + 4 && s.right < PANEL_WIDTH - 4,
    );
    expect(
      intermediate.length,
      'the sidebar should be painted at several part-way widths',
    ).toBeGreaterThanOrEqual(3);

    // Monotonic: it narrows, it never bounces back on the way in.
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!.right).toBeLessThanOrEqual(samples[i - 1]!.right + 0.5);
    }
    expect(samples.at(-1)!.right).toBe(RAIL_WIDTH);
  });

  test('keeps the workspace edge welded to the panel on every painted frame', async ({ page }) => {
    await page.goto('/en/app');
    await pinSidebar(page);
    await page.waitForTimeout(400);
    const samples = await sampleToggle(page);

    // No gap, no overlap, no second-stage snap: one movement seen twice.
    for (const sample of samples) {
      expect(Math.abs(sample.right - sample.mainLeft)).toBeLessThanOrEqual(1);
    }
  });

  test('reverses from where it is, without snapping to an end first', async ({ page }) => {
    await page.goto('/en/app');
    await pinSidebar(page);
    await page.waitForTimeout(400);

    const trace = await page.evaluate(async () => {
      const sidebar = document.getElementById('app-sidebar')!;
      const toggle = document.querySelector<HTMLButtonElement>(
        'button[aria-controls="app-sidebar"]',
      )!;
      const right = () => sidebar.getBoundingClientRect().right;

      toggle.click();
      // Let it get genuinely part-way out before asking for the reverse.
      await new Promise((r) => setTimeout(r, 60));
      const atReversal = right();
      toggle.click();

      const samples: number[] = [];
      return await new Promise<{ atReversal: number; samples: number[] }>((resolve) => {
        let seen = 0;
        function tick() {
          samples.push(right());
          seen += 1;
          if (seen < 40) requestAnimationFrame(tick);
          else resolve({ atReversal, samples });
        }
        requestAnimationFrame(tick);
      });
    });

    // It really was mid-flight when the reverse was asked for, otherwise this
    // case is not testing what it claims to.
    expect(trace.atReversal).toBeGreaterThan(RAIL_WIDTH);
    expect(trace.atReversal).toBeLessThan(PANEL_WIDTH);

    // The defect: collapsing to the rail (or jumping to the full panel) before
    // travelling back. Reversing from the current position means the first
    // frame after the second click continues from roughly where the first
    // left off.
    expect(trace.samples[0]).toBeGreaterThan(RAIL_WIDTH);
    expect(trace.samples.at(-1)).toBe(PANEL_WIDTH);
  });

  test('lands in one settled state after rapid toggling, in the UI and the cookie', async ({
    page,
  }) => {
    await page.goto('/en/app');
    // Start pinned, so six clicks (an even number) end pinned — the assertion
    // is that the shell lands where the LAST click asked, not that any
    // particular state wins.
    await pinSidebar(page);
    const toggle = page.getByRole('button', { name: /(Collapse|Expand) sidebar/ });

    // Six clicks with no waiting between them: whatever the animation is doing
    // when each lands, the shell must end where the last click asked.
    for (let i = 0; i < 6; i += 1) await toggle.click({ force: true });

    await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByRole('complementary')).toBeVisible();
    // No half-open state: the workspace is at one of the two offsets, not between.
    await expect
      .poll(async () => Math.round((await page.getByRole('main').boundingBox())!.x))
      .toBe(PANEL_WIDTH);

    const cookie = (await page.context().cookies()).find(
      (c) => c.name === 'shell_sidebar_collapsed',
    );
    expect(cookie?.value).toBe('0');
  });

  test('rail keeps every route focusable, named, and a single link', async ({ page }) => {
    // The inverse of what the hidden panel had to promise. A rail is on
    // screen, so its links MUST stay in the tab order — and because the
    // labels are only faded (never `hidden`), each link keeps its accessible
    // name even while the panel is cropped. A screen reader user hears
    // "Trades", not an unlabelled icon.
    await page.goto('/en/app');
    await railSidebar(page);
    await expect(page.getByRole('complementary')).toHaveAttribute('data-state', 'rail');

    const nav = page.getByRole('complementary').getByRole('navigation', { name: 'Main' });
    // FIVE links, not ten: the icon cell and the label cell are one anchor,
    // so a route is never duplicated between the two layers. Five rather than
    // the old six because Settings left navigation for the account menu.
    await expect(nav.getByRole('link')).toHaveCount(5);

    for (const name of ['Overview', 'Trades', 'Analytics']) {
      const link = nav.getByRole('link', { name });
      await expect(link).toBeVisible();
      await link.focus();
      await expect(link).toBeFocused();
    }
  });

  test('does not animate on first paint, in either persisted state', async ({ page }) => {
    await page.goto('/en/app');

    for (const collapsed of ['1', '0']) {
      await page.context().addCookies([
        {
          name: 'shell_sidebar_collapsed',
          value: collapsed,
          url: page.url(),
        },
      ]);
      await page.reload({ waitUntil: 'commit' });

      // Sampled across the first painted frames rather than once: an
      // open-then-animate-closed flash lives precisely there.
      const firstFrames = await page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const samples: number[] = [];
            function tick() {
              const main = document.getElementById('main-content');
              if (main) samples.push(main.getBoundingClientRect().left);
              if (samples.length < 6) requestAnimationFrame(tick);
              else resolve(samples);
            }
            requestAnimationFrame(tick);
          }),
      );

      const expected = collapsed === '1' ? RAIL_WIDTH : PANEL_WIDTH;
      for (const left of firstFrames) expect(Math.round(left)).toBe(expected);
    }
  });
});

test.describe('mobile drawer motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('opens below the header, which stays exactly where it was', async ({ page }) => {
    await page.goto('/en/app');

    // Structural locators throughout: an open modal dialog strips the
    // landmark roles from everything behind it, so `getByRole('banner')`
    // would resolve before the drawer opens and time out after.
    const banner = page.locator('header');
    const before = await banner.boundingBox();

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    // A drawer is "visible" from its first TRAVELLING frame, which is the
    // point of all this — so settle on the resting position before measuring
    // geometry, rather than reading a box mid-flight.
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.x)).toBe(0);

    const after = await banner.boundingBox();
    expect(after).toEqual(before);

    // The drawer starts at the header's bottom edge and runs to the viewport
    // floor — the header is never covered. The 1px tolerance is the header's
    // own bottom hairline: the drawer is offset by the header HEIGHT token, so
    // it meets that border rather than clearing it, exactly as the desktop
    // sidebar does. Anything wider than a hairline would be a real overlap.
    const drawer = (await dialog.boundingBox())!;
    const headerBottom = before!.y + before!.height;
    expect(drawer.y).toBeGreaterThanOrEqual(headerBottom - 1);
    expect(drawer.y).toBeLessThanOrEqual(headerBottom + 1);
    expect(Math.round(drawer.x)).toBe(0);
    expect(Math.round(drawer.y + drawer.height)).toBe(844);

    // 15rem ceiling at this width, leaving 150px of dimmed page beside it.
    // Asserted as an absolute number rather than a proportion of the
    // viewport: the width is deliberately no longer a percentage, and a
    // proportional assertion would keep passing through the exact regression
    // it is here to catch.
    expect(Math.round(drawer.width)).toBe(240);
  });

  test('travels in from off-screen with its backdrop, without pushing the page', async ({
    page,
  }) => {
    await page.goto('/en/app');
    const workspace = page.locator('#main-content');
    const mainLeftBefore = (await workspace.boundingBox())!.x;

    const trace = await page.evaluate(async () => {
      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Open navigation menu"]',
      )!;
      trigger.click();

      const samples: { left: number; backdrop: number }[] = [];
      return await new Promise<typeof samples>((resolve) => {
        let seen = 0;
        function tick() {
          const panel = document.querySelector('[data-slot="sheet-content"]');
          const overlay = document.querySelector('[data-slot="sheet-overlay"]');
          if (panel && overlay) {
            samples.push({
              left: panel.getBoundingClientRect().left,
              backdrop: Number(getComputedStyle(overlay).opacity),
            });
          }
          seen += 1;
          if (seen < 40) requestAnimationFrame(tick);
          else resolve(samples);
        }
        requestAnimationFrame(tick);
      });
    });

    // Painted part-way in, not conjured at its final position.
    expect(trace.filter((s) => s.left < -8 && s.left > -320).length).toBeGreaterThanOrEqual(3);
    expect(Math.round(trace.at(-1)!.left)).toBe(0);

    // The backdrop rises WITH the panel rather than landing fully opaque
    // before it has begun moving.
    expect(trace[0]!.backdrop).toBeLessThan(0.9);
    expect(trace.at(-1)!.backdrop).toBeGreaterThan(trace[0]!.backdrop);

    // A layer over the workspace, not a squeeze of it.
    expect((await workspace.boundingBox())!.x).toBe(mainLeftBefore);
  });

  test('closes from the backdrop', async ({ page }) => {
    await page.goto('/en/app');
    await page.getByRole('button', { name: /open navigation menu/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Right edge of the viewport, in the dimmed sliver beside the drawer.
    await page.mouse.click(380, 500);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('is usable, and stays below the header, at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/en/app');

    const bannerBox = (await page.locator('header').boundingBox())!;

    await page.getByRole('button', { name: /open navigation menu/i }).click();
    const dialog = page.getByRole('dialog');
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.x)).toBe(0);

    const drawer = (await dialog.boundingBox())!;
    expect(drawer.y).toBeGreaterThanOrEqual(bannerBox.y + bannerBox.height - 1);
    // The dimmed sliver survives the narrowest supported width, so the drawer
    // still reads as a layer over the page rather than a new screen.
    expect(drawer.width).toBeLessThan(320);

    await expect(dialog.getByRole('link', { name: 'Trades' })).toBeVisible();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('shell motion under reduced motion', () => {
  test('uses a shorter synchronized transition while preserving layout feedback', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Emulated on the page rather than declared as a context option, so it
    // cannot be silently lost to option merging between the project, the file
    // and this block — a reduced-motion test that is not actually running
    // under reduced motion asserts nothing at all.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en/app');

    const sidebar = page.getByRole('complementary');
    await expect(sidebar).toBeVisible();

    // The preference really is being emulated, otherwise the rest of this
    // case would quietly assert nothing.
    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true);

    // Short and calm, but deliberately not effectively zero: the workspace
    // displacement remains legible to a user who asked for less motion.
    const durations = await page.evaluate(() => {
      const panel = document.getElementById('app-sidebar')!;
      const column = document.getElementById('main-content')!.parentElement!;
      const seconds = (el: Element) =>
        getComputedStyle(el)
          .transitionDuration.split(',')
          .map((value) => Number.parseFloat(value));
      return [...seconds(panel), ...seconds(column)];
    });
    for (const seconds of durations) {
      expect(seconds).toBeGreaterThanOrEqual(0.1);
      expect(seconds).toBeLessThanOrEqual(0.14);
    }
    const reducedEasings = await page.evaluate(() => {
      const panel = document.getElementById('app-sidebar')!;
      const column = document.getElementById('main-content')!.parentElement!;
      return [panel, column].map((element) => getComputedStyle(element).transitionTimingFunction);
    });
    expect(new Set(reducedEasings)).toEqual(new Set(['cubic-bezier(0.2, 0, 0, 1)']));

    // Start from the settled rail, then sample the reduced transition on the
    // browser's frame clock just as the normal-motion cases above do.
    await railSidebar(page);
    await expect(sidebar).toHaveAttribute('data-state', 'rail');
    await expect
      .poll(async () => Math.round((await page.locator('#main-content').boundingBox())!.x))
      .toBe(RAIL_WIDTH);

    const trace = await page.evaluate(async () => {
      const panel = document.getElementById('app-sidebar')!;
      const main = document.getElementById('main-content')!;
      const icon = panel.querySelector('a svg')!;
      const toggle = document.querySelector<HTMLButtonElement>(
        'button[aria-controls="app-sidebar"]',
      )!;
      const startedAt = performance.now();
      const samples: { elapsed: number; width: number; mainLeft: number; iconX: number }[] = [];
      toggle.click();

      return await new Promise<typeof samples>((resolve) => {
        function tick() {
          samples.push({
            elapsed: performance.now() - startedAt,
            width: panel.getBoundingClientRect().width,
            mainLeft: main.getBoundingClientRect().left,
            iconX: icon.getBoundingClientRect().x,
          });
          if (performance.now() - startedAt < 190) requestAnimationFrame(tick);
          else resolve(samples);
        }
        requestAnimationFrame(tick);
      });
    });

    expect(
      trace.some((sample) => sample.width > RAIL_WIDTH + 2 && sample.width < PANEL_WIDTH - 2),
    ).toBe(true);
    for (const sample of trace) {
      expect(Math.abs(sample.width - sample.mainLeft)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.iconX - trace[0]!.iconX)).toBeLessThanOrEqual(0.5);
    }
    expect(Math.round(trace.at(-1)!.width)).toBe(PANEL_WIDTH);

    await expect(sidebar).toHaveAttribute('data-state', 'expanded');
  });
});

test.describe('health endpoint', () => {
  test('responds with the documented shape', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body: unknown = await response.json();
    expect(body).toEqual({ status: 'ok' });
  });

  test('leaks no environment values', async ({ request }) => {
    const response = await request.get('/api/health');
    const text = await response.text();

    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('AUTH_SECRET');
    expect(text.toLowerCase()).not.toContain('postgres');
  });

  test('is not cached', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});

/**
 * The collapsed rail's hover flyout.
 *
 * Every assertion here is one jsdom cannot make. The whole feature turns on
 * real layout: whether a `position: fixed` child genuinely escapes an
 * ancestor's `overflow-clip` AND a scroll container's `overflow-y: auto`,
 * whether it lands past the 64px rail, and whether anything else on the page
 * moved to make room for it. Only a browser knows.
 */
test.describe('Collapsed sidebar hover flyout', () => {
  const flyout = (page: Page) => page.locator('[data-nav-flyout]');

  /**
   * Hover the way a pointer actually does: over the ICON, at the coordinates
   * it occupies on screen.
   *
   * Deliberately NOT `locator.hover()`. Each collapsed row is a 224px-wide
   * box showing through a 64px window, so Playwright's built-in
   * scrollIntoViewIfNeeded drags the row 161px sideways before it ever moves
   * the mouse — measuring an artefact of the driver rather than the product.
   */
  async function hoverRow(page: Page, name: string) {
    const icon = await page
      .getByRole('complementary')
      .getByRole('link', { name })
      .locator('svg')
      .first()
      .boundingBox();
    await page.mouse.move(icon!.x + icon!.width / 2, icon!.y + icon!.height / 2);
  }

  async function railed(page: Page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await railSidebar(page);
    await page.waitForTimeout(400);
  }

  test('reveals icon + label past the rail without moving the workspace', async ({ page }) => {
    await railed(page);

    const sidebar = page.getByRole('complementary');
    const main = page.getByRole('main');

    const before = {
      sidebarWidth: Math.round((await sidebar.boundingBox())!.width),
      mainX: Math.round((await main.boundingBox())!.x),
      iconX: await navIconX(page),
    };
    expect(before.sidebarWidth).toBe(RAIL_WIDTH);
    await expect(flyout(page)).toHaveCount(0);

    await hoverRow(page, 'Accounts');
    await expect(flyout(page)).toHaveCount(1);
    await page.waitForTimeout(300);

    // THE POINT: the flyout is genuinely outside the 64px rail. If `fixed`
    // failed to escape the clipping chain this box would stop at 64.
    const box = (await flyout(page).boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeGreaterThan(RAIL_WIDTH);
    // And it carries the label, legibly, inside itself.
    await expect(flyout(page)).toContainText('Accounts');

    // Nothing else moved. Not the rail, not the workspace, not the icon.
    expect(Math.round((await sidebar.boundingBox())!.width)).toBe(before.sidebarWidth);
    expect(Math.round((await main.boundingBox())!.x)).toBe(before.mainX);
    expect(await navIconX(page)).toBe(before.iconX);
    // The sidebar never entered its open state.
    await expect(sidebar).toHaveAttribute('data-state', 'rail');
  });

  test('cannot scroll the collapsed rail sideways or displace its interactions', async ({
    page,
  }) => {
    await railed(page);

    const sidebar = page.getByRole('complementary');
    const main = page.getByRole('main');
    const before = {
      iconX: await navIconX(page),
      mainX: Math.round((await main.boundingBox())!.x),
    };

    const imperativeAttempt = await sidebar.evaluate((element) => {
      element.scrollLeft = 160;
      element.scrollBy({ left: 160 });
      return {
        overflowX: getComputedStyle(element).overflowX,
        scrollLeft: element.scrollLeft,
      };
    });
    expect(imperativeAttempt).toEqual({ overflowX: 'clip', scrollLeft: 0 });

    const sidebarBox = (await sidebar.boundingBox())!;
    await page.mouse.move(sidebarBox.x + RAIL_WIDTH / 2, sidebarBox.y + 20);
    await page.mouse.wheel(240, 0);
    await expect.poll(() => sidebar.evaluate((element) => element.scrollLeft)).toBe(0);

    expect(await navIconX(page)).toBe(before.iconX);
    expect(Math.round((await main.boundingBox())!.x)).toBe(before.mainX);

    await hoverRow(page, 'Accounts');
    await expect(flyout(page)).toHaveCount(1);
    const flyoutBox = (await flyout(page).boundingBox())!;
    expect(flyoutBox.x + flyoutBox.width).toBeGreaterThan(RAIL_WIDTH);
    expect(await navIconX(page)).toBe(before.iconX);
    expect(Math.round((await main.boundingBox())!.x)).toBe(before.mainX);

    const trades = sidebar.getByRole('link', { name: 'Trades' });
    await trades.focus();
    await expect(trades).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/trades$/);
    await expect(page.getByRole('main')).toHaveCount(1);
  });

  test('aligns the flyout icon exactly over the rail icon it covers', async ({ page }) => {
    await railed(page);

    const overview = page.getByRole('complementary').getByRole('link', { name: 'Overview' });
    const railIcon = await overview.locator('svg').first().boundingBox();

    await hoverRow(page, 'Overview');
    await expect(flyout(page)).toHaveCount(1);
    await page.waitForTimeout(300);

    const flyIcon = (await flyout(page).locator('svg').first().boundingBox())!;
    // Same centre, within a pixel — this is what makes the icon look stationary.
    expect(
      Math.abs(flyIcon.x + flyIcon.width / 2 - (railIcon!.x + railIcon!.width / 2)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(flyIcon.y + flyIcon.height / 2 - (railIcon!.y + railIcon!.height / 2)),
    ).toBeLessThanOrEqual(1);
  });

  test('retracts on mouse leave, leaving nothing over the workspace', async ({ page }) => {
    await railed(page);

    await hoverRow(page, 'Accounts');
    await expect(flyout(page)).toHaveCount(1);

    await page.mouse.move(900, 450);
    await expect(flyout(page)).toHaveCount(0);

    // Nothing invisible left behind: the workspace answers its own clicks.
    const atPoint = await page.evaluate(() => {
      const el = document.elementFromPoint(700, 400);
      return el?.closest('[data-nav-flyout]') === null && el?.closest('aside') === null;
    });
    expect(atPoint).toBe(true);
  });

  test('reveals the same label on keyboard focus', async ({ page }) => {
    await railed(page);

    await page.getByRole('complementary').getByRole('link', { name: 'Accounts' }).focus();
    await expect(flyout(page)).toHaveCount(1);
    await expect(flyout(page)).toContainText('Accounts');
  });

  test('covers the last route in the list too', async ({ page }) => {
    // Settings used to be the case here, as the one entry in the utility
    // band. It is not a nav row any more, so the property worth keeping is
    // that no route is left without a flyout — including the last one.
    await railed(page);

    await hoverRow(page, 'Analytics');
    await expect(flyout(page)).toHaveCount(1);
    await expect(flyout(page)).toContainText('Analytics');
  });

  test('shows no flyout once the panel is open', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/app');
    await pinSidebar(page);
    await page.waitForTimeout(400);

    await hoverRow(page, 'Accounts');
    await page.waitForTimeout(250);
    await expect(flyout(page)).toHaveCount(0);
  });

  test('paints an opaque surface in both themes, so the workspace cannot show through', async ({
    page,
  }) => {
    // A translucent flyout would let the workspace bleed through the label.
    // The tint layer that reproduces the pill sits ON TOP of an opaque base,
    // which is what keeps the colour identical to the in-rail pill while
    // still hiding whatever it floats over.
    for (const colorScheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme });
      await railed(page);
      await hoverRow(page, 'Accounts');
      await expect(flyout(page)).toHaveCount(1);

      const paint = await flyout(page).evaluate((el) => {
        const base = getComputedStyle(el).backgroundColor;
        const tint = getComputedStyle(el.querySelector('span')!).backgroundColor;
        // Colours arrive in whatever space the engine chose — Tailwind emits
        // `oklab(L a b / A)` for a slashed opacity, plain `rgb()` otherwise.
        // Read the slashed alpha when there is one, the legacy 4th comma
        // argument when there is not, and treat anything else as opaque.
        const alpha = (c: string) => {
          const slashed = c.match(/\/\s*([\d.]+)\s*\)/);
          if (slashed) return Number.parseFloat(slashed[1]!);
          const legacy = c.match(/rgba\(([^)]+)\)/);
          if (legacy) {
            const parts = legacy[1]!.split(',').map((v) => Number.parseFloat(v));
            if (parts.length === 4) return parts[3]!;
          }
          return 1;
        };
        return { baseAlpha: alpha(base), tintAlpha: alpha(tint), base, tint };
      });

      // Base fully opaque; tint deliberately translucent over it.
      expect(paint.baseAlpha, `${colorScheme} base ${paint.base}`).toBe(1);
      expect(paint.tintAlpha, `${colorScheme} tint ${paint.tint}`).toBeGreaterThan(0);
      expect(paint.tintAlpha).toBeLessThan(1);
    }
    await page.emulateMedia({ colorScheme: null });
  });

  test('swaps its reveal for a plain fade under reduced motion', async ({ page }) => {
    // The repo's policy shortens and de-spatialises motion rather than
    // removing it — a keyboard user must not lose the label to a preference.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await railed(page);
    await hoverRow(page, 'Accounts');
    await expect(flyout(page)).toHaveCount(1);

    const motion = await flyout(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { name: s.animationName, duration: Number.parseFloat(s.animationDuration) };
    });
    expect(motion.name).toBe('reduced-fade-in');
    expect(motion.duration).toBeLessThanOrEqual(0.12);
    // Still readable, which is the whole point.
    await expect(flyout(page)).toContainText('Accounts');

    await page.emulateMedia({ reducedMotion: null });
  });

  test('uses the spatial reveal when motion is allowed, without a spring', async ({ page }) => {
    await railed(page);
    await hoverRow(page, 'Accounts');
    await expect(flyout(page)).toHaveCount(1);

    const motion = await flyout(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        duration: Number.parseFloat(s.animationDuration),
        easing: s.animationTimingFunction,
      };
    });
    expect(motion.name).toBe('nav-flyout-reveal');
    expect(motion.duration).toBeGreaterThan(0);
    expect(motion.duration).toBeLessThanOrEqual(0.25);
    // A decelerate curve, and emphatically not a spring: no control point may
    // exceed 1 on the value axis, which is what would produce overshoot.
    const points = motion.easing.match(/-?[\d.]+/g)!.map(Number);
    expect(points).toHaveLength(4);
    expect(points[1]!).toBeLessThanOrEqual(1);
    expect(points[3]!).toBeLessThanOrEqual(1);
  });

  test('renders no native tooltip on any collapsed nav row', async ({ page }) => {
    await railed(page);

    const titles = await page
      .getByRole('complementary')
      .getByRole('link')
      .evaluateAll((els) => els.map((el) => el.getAttribute('title')));
    expect(titles.every((t) => t === null)).toBe(true);
  });
});

/**
 * The shell-polish pass: what the profile menu holds, what the drawer is
 * made of, and how wide it gets.
 *
 * Locators here are deliberately structural in places. An open modal dialog
 * makes Radix mark everything behind it `aria-hidden`, so the header's own
 * controls leave the accessibility tree for as long as the drawer is up —
 * `getByRole('banner')` resolves before it opens and times out after.
 */
test.describe('shell polish — profile menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('Settings lives in the account menu, not in navigation', async ({ page }) => {
    await page.goto('/en/app');

    // Gone from the sidebar entirely.
    const nav = page.getByRole('complementary').getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(nav.locator('a[href="/en/app/settings"]')).toHaveCount(0);

    // Present in the account menu, pointing at the unchanged route.
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');
    const settings = menu.getByRole('menuitem', { name: 'Settings' });
    await expect(settings).toBeVisible();
    await expect(settings).toHaveAttribute('href', '/en/app/settings');
  });

  test('navigates to the unchanged Settings route from the menu', async ({ page }) => {
    await page.goto('/en/app');

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page).toHaveURL(/\/en\/app\/settings$/);
  });

  test('drops the duplicated workspace block the switcher already shows', async ({ page }) => {
    await page.goto('/en/app');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');

    // The "WORKSPACE" heading and the name under it are both gone — the
    // account switcher standing beside this trigger already names the active
    // context, and saying it twice a few pixels apart is noise.
    await expect(menu.getByText('Workspace', { exact: true })).toHaveCount(0);
  });

  test('leaves no submenu behind for language or theme', async ({ page }) => {
    await page.goto('/en/app');
    await page.getByRole('button', { name: 'Account menu' }).click();
    const menu = page.getByRole('menu');

    await expect(menu.locator('[aria-haspopup="menu"]')).toHaveCount(0);
    await expect(menu.getByRole('group', { name: /language/i })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /change theme/i })).toBeVisible();
  });

  test('switches language from the inline segmented control', async ({ page }) => {
    await page.goto('/en/app');
    await page.getByRole('button', { name: 'Account menu' }).click();

    const language = page.getByRole('menu').getByRole('group', { name: /language/i });
    await expect(language.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await language.getByRole('menuitemradio', { name: 'ไทย' }).click();
    await expect(page).toHaveURL(/\/th\/app$/);
  });

  test('flips theme from a two-state toggle, with no System mode anywhere', async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ['trading-os-theme', 'dark'],
    );
    await page.goto('/en/app');
    await page.getByRole('button', { name: 'Account menu' }).click();

    const menu = page.getByRole('menu');
    const toggle = menu.getByRole('menuitem', { name: /change theme/i });

    // A toggle, not a picker: no group, no radios, no third option.
    await expect(menu.getByRole('group', { name: /theme/i })).toHaveCount(0);
    await expect(menu.getByRole('menuitemradio', { name: /system/i })).toHaveCount(0);
    await expect(toggle).toHaveAccessibleName(/dark/i);

    await toggle.click();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe('light');
    // Changing a preference does not dismiss the menu — the user sees the
    // change against the surface they are already looking at, and the control
    // relabels itself in place.
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /change theme/i })).toHaveAccessibleName(
      /light/i,
    );

    await menu.getByRole('menuitem', { name: /change theme/i }).click();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme))
      .toBe('dark');
  });

  test('names no theme mode the product no longer has', async ({ page }) => {
    await page.goto('/en/app');
    await page.getByRole('button', { name: 'Account menu' }).click();

    expect(await page.getByRole('menu').textContent()).not.toMatch(/system/i);
  });

  test('does not grow the menu past the viewport on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await page.goto('/en/app');
    await page.getByRole('button', { name: 'Account menu' }).click();

    const box = (await page.getByRole('menu').boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});

test.describe('shell polish — desktop hamburger', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('toggles the sidebar between 64 and 224 without moving the icons', async ({ page }) => {
    await page.goto('/en/app');
    await railSidebar(page);

    const widthOf = async () =>
      Math.round((await page.getByRole('complementary').boundingBox())!.width);

    expect(await widthOf()).toBe(RAIL_WIDTH);
    const railIcon = await navIconX(page);

    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await expect.poll(widthOf).toBe(PANEL_WIDTH);
    expect(await navIconX(page)).toBe(railIcon);

    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect.poll(widthOf).toBe(RAIL_WIDTH);
    expect(await navIconX(page)).toBe(railIcon);
  });

  test('draws a hamburger, on the sidebar icon centre line', async ({ page }) => {
    await page.goto('/en/app');
    await railSidebar(page);

    const glyph = page.getByRole('button', { name: 'Expand sidebar' }).locator('svg');

    // A hamburger — three horizontal rules — rather than the panel diagram
    // this used to be. Asserted on rendered geometry rather than a class
    // name: three marks, every one of them wider than it is tall.
    const lines = await glyph
      .locator('path, line')
      .evaluateAll((els) =>
        els
          .map((el) => el.getBoundingClientRect())
          .map((rect) => ({ w: Math.round(rect.width), h: Math.round(rect.height) })),
      );
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.w).toBeGreaterThan(line.h);

    // Same centre line as the nav icons directly beneath it. `navIconX`
    // reports the icon's LEFT edge, so the comparison has to be made against
    // that icon's own centre rather than against its origin.
    const navIcon = (await page
      .getByRole('complementary')
      .getByRole('link', { name: 'Overview' })
      .locator('svg')
      .first()
      .boundingBox())!;
    expect(await centreX(glyph)).toBe(Math.round(navIcon.x + navIcon.width / 2));
  });

  test('keeps a 44px hit target', async ({ page }) => {
    await page.goto('/en/app');
    const box = (await page.getByRole('button', { name: /sidebar/i }).boundingBox())!;
    expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  });
});

test.describe('shell polish — mobile drawer', () => {
  /** Viewport width -> the drawer width the min() contract produces there. */
  const DRAWER_WIDTHS = [
    { viewport: 320, drawer: 240 },
    { viewport: 390, drawer: 240 },
    { viewport: 430, drawer: 240 },
    { viewport: 440, drawer: 240 },
  ] as const;

  for (const { viewport, drawer } of DRAWER_WIDTHS) {
    test(`settles at ${drawer}px on a ${viewport}px viewport, leaving the page visible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport, height: 844 });
      await page.goto('/en/app');
      await page.getByRole('button', { name: /open navigation menu/i }).click();

      const dialog = page.getByRole('dialog');
      // Settle on the resting position first: a drawer is "visible" from its
      // first travelling frame, and a box read mid-flight is meaningless.
      await expect.poll(async () => Math.round((await dialog.boundingBox())!.x)).toBe(0);
      await expect.poll(async () => Math.round((await dialog.boundingBox())!.width)).toBe(drawer);

      // A strip of dimmed page always remains to the right — the thing that
      // says "layer over your workspace" rather than "new screen". At 240px
      // that strip is at least 80px even on the narrowest phone, and more than
      // a third of the viewport on a normal one.
      expect(viewport - drawer).toBeGreaterThanOrEqual(80);
      expect(drawer).toBeLessThanOrEqual(viewport * 0.75);

      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);
    });
  }

  test('opens and closes from the same hamburger, which never becomes an X', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app');

    const trigger = page.locator('header button[aria-haspopup="dialog"]');
    const glyphBefore = await trigger.locator('svg').innerHTML();

    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // The glyph is the same mark in both states.
    expect(await trigger.locator('svg').innerHTML()).toBe(glyphBefore);

    // The same press takes it away again — one press, not close-then-reopen.
    await trigger.click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // And it still opens on the next press, so it is a real toggle.
    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('shows no X control inside the drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app');
    await page.getByRole('button', { name: /open navigation menu/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The primitive's own corner X is off, and the drawer's own close
    // affordance is `sr-only` until focused — a 1px clipped box, which
    // Playwright still reports as "visible", so the assertion is on the
    // rendered SIZE rather than on visibility.
    const close = dialog.getByRole('button', { name: 'Close' });
    const box = (await close.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    // And it carries no glyph at all — nothing that could read as an X.
    await expect(close.locator('svg')).toHaveCount(0);

    // Nothing else in the drawer is drawn over the first navigation row.
    const firstRow = (await dialog.getByRole('link').first().boundingBox())!;
    expect(firstRow.y).toBeGreaterThan((await dialog.boundingBox())!.y);
  });

  test('still closes on Escape, on the backdrop, and on navigating', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app');
    const open = page.locator('header button[aria-haspopup="dialog"]');

    await open.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await open.click();
    await expect
      .poll(async () => Math.round((await page.getByRole('dialog').boundingBox())!.x))
      .toBe(0);
    // The backdrop, well clear of the panel's 240px right edge.
    await page.mouse.click(340, 500);
    await expect(page.getByRole('dialog')).toBeHidden();

    await open.click();
    await page.getByRole('dialog').getByRole('link', { name: 'Trades' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/en\/app\/trades$/);
  });

  test('gives keyboard users a focusable way out even without a visible X', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app');
    await page.getByRole('button', { name: /open navigation menu/i }).click();

    const close = page.getByRole('dialog').getByRole('button', { name: 'Close' });
    await close.focus();
    // `focus-visible:not-sr-only` — it becomes a real, visible, labelled
    // button the moment a keyboard reaches it.
    await expect(close).toBeVisible();
    await close.press('Enter');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('carries routes only — no Settings, no preferences', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/app');
    await page.getByRole('button', { name: /open navigation menu/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link')).toHaveCount(5);
    await expect(dialog.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(dialog.locator('a[href="/en/app/settings"]')).toHaveCount(0);
    await expect(dialog.getByRole('group', { name: /language|theme/i })).toHaveCount(0);
    await expect(dialog.getByRole('menuitem')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`shares the header chrome surface in ${scheme}, with AA nav contrast`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/en/app');
      await page.getByRole('button', { name: /open navigation menu/i }).click();

      const dialog = page.getByRole('dialog');
      await expect.poll(async () => Math.round((await dialog.boundingBox())!.x)).toBe(0);

      const measured = await page.evaluate(() => {
        type Rgb = [number, number, number];
        const parts = (value: string) => value.match(/[\d.]+/g)!.map(Number);
        const rgb = (value: string) => parts(value).slice(0, 3) as Rgb;
        const luminance = ([r, g, b]: Rgb) => {
          const channels = [r, g, b].map((channel) => {
            const v = channel / 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
        };
        const contrast = (fg: Rgb, bg: Rgb) => {
          const a = luminance(fg);
          const b = luminance(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        /** Composite a possibly-translucent colour over an opaque backdrop. */
        const over = (value: string, bg: Rgb): Rgb => {
          const channels = parts(value);
          const alpha = channels.length > 3 ? channels[3]! : 1;
          return [0, 1, 2].map((i) => channels[i]! * alpha + bg[i]! * (1 - alpha)) as Rgb;
        };

        const panel = document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!;
        const header = document.querySelector<HTMLElement>('header')!;
        const panelBg = rgb(getComputedStyle(panel).backgroundColor);
        const headerBg = rgb(getComputedStyle(header).backgroundColor);

        const rows = [...panel.querySelectorAll<HTMLAnchorElement>('nav a')];
        const active = rows.find((row) => row.getAttribute('aria-current') === 'page')!;
        const inactive = rows.find((row) => row.getAttribute('aria-current') !== 'page')!;

        const pillElement = active.querySelector<HTMLElement>('[data-active-indicator]')!;
        const pill = over(getComputedStyle(pillElement).backgroundColor, panelBg);
        const activeLabel = rgb(getComputedStyle(active).color);
        const activeIcon = rgb(getComputedStyle(active.querySelector('svg')!).color);

        /** How far a colour sits from neutral grey, 0 = perfectly neutral. */
        const chroma = ([r, g, b]: Rgb) => Math.max(r, g, b) - Math.min(r, g, b);

        return {
          panelBg,
          headerBg,
          panelLuminance: luminance(panelBg),
          panelChroma: chroma(panelBg),
          pillChroma: chroma(pill),
          activeLabelChroma: chroma(activeLabel),
          activeIconChroma: chroma(activeIcon),
          activeLabelOnPill: contrast(activeLabel, pill),
          activeIconOnPill: contrast(activeIcon, pill),
          inactiveOnPanel: contrast(rgb(getComputedStyle(inactive).color), panelBg),
        };
      });

      // The drawer IS the header's surface, in both themes — not merely a
      // similar one. That is what `data-shell-chrome` buys, and it is the
      // whole reason the two read as one piece of chrome.
      expect(measured.panelBg).toEqual(measured.headerBg);
      // And it is a DARK chrome in both themes, light mode included.
      expect(measured.panelLuminance).toBeLessThan(0.1);

      expect(measured.activeLabelOnPill).toBeGreaterThanOrEqual(4.5);
      expect(measured.activeIconOnPill).toBeGreaterThanOrEqual(3);
      expect(measured.inactiveOnPanel).toBeGreaterThanOrEqual(4.5);

      // WHERE THE BLUE IS. The panel and the active pill are near-neutral —
      // a chroma of a few points, which is a cool cast, not a colour — while
      // the active ICON is saturated. That inversion is the pass: the accent
      // is on the smallest mark in the row instead of on the largest area.
      // Asserted numerically because "less blue" is otherwise a matter of
      // opinion, and this is exactly the kind of thing that creeps back.
      expect(measured.panelChroma).toBeLessThanOrEqual(8);
      expect(measured.pillChroma).toBeLessThanOrEqual(12);
      expect(measured.activeLabelChroma).toBeLessThanOrEqual(12);
      expect(measured.activeIconChroma).toBeGreaterThan(60);
    });
  }
});
