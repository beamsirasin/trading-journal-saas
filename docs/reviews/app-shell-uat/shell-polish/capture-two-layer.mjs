/**
 * Two-layer shell UAT capture.
 *
 * Real components, real CSS, real production build. The theme is set through
 * the product's own control (the account menu's Theme submenu) rather than by
 * forcing a class, so each screenshot shows a state a user can reach.
 */
import pkg from 'file:///d:/dev/trading-os/node_modules/@playwright/test/index.js';

const { chromium } = pkg;

const OUT = 'd:/dev/trading-os/docs/reviews/app-shell-uat/shell-polish';
const BASE = 'http://127.0.0.1:3100';
const STATE = 'd:/dev/trading-os/e2e/.auth/user-a.json';

const browser = await chromium.launch();

async function setTheme(page, value) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /theme/i }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${value}$`, 'i') }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

async function setExpanded(page, expanded) {
  const wanted = expanded ? 'Expand sidebar' : 'Collapse sidebar';
  const button = page.getByRole('button', { name: wanted });
  if ((await button.count()) > 0) await button.click();
  await page.waitForTimeout(500);
}

async function shot(page, name) {
  // Park the pointer off every control first: clicking the toggle leaves the
  // cursor on it, and a hover state captured as if it were the resting state
  // would misrepresent the design.
  await page.mouse.move(1200, 700);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  captured', name);
}

const round = (box) => ({ x: Math.round(box.x), width: Math.round(box.width) });

// ---------------------------------------------------------------- desktop
for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/app`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await setTheme(page, theme);

  console.log(`\n=== DESKTOP ${theme.toUpperCase()} ===`);

  const sidebar = page.getByRole('complementary');
  const main = page.getByRole('main');

  const icon = sidebar.getByRole('link', { name: 'Overview' }).locator('svg');

  // Collapsed: the rail alone.
  await setExpanded(page, false);
  await shot(page, `01-desktop-1440-${theme}-rail`);
  const collapsed = {
    nav: round(await sidebar.boundingBox()),

    icon: round(await icon.boundingBox()),
    workspaceX: Math.round((await main.boundingBox()).x),
  };

  // Hover must do NOTHING — opening is deliberate only.
  await sidebar.hover();
  await page.waitForTimeout(450);
  const widthAfterHover = Math.round((await sidebar.boundingBox()).width);
  await page.mouse.move(1000, 600);
  await page.waitForTimeout(300);

  // Expanded: rail + secondary panel.
  await setExpanded(page, true);
  await shot(page, `02-desktop-1440-${theme}-expanded`);
  const expanded = {
    nav: round(await sidebar.boundingBox()),

    icon: round(await icon.boundingBox()),
    workspaceX: Math.round((await main.boundingBox()).x),
  };

  console.log({
    collapsed,
    expanded,
    widthAfterHover,
    widthsCorrect: collapsed.nav.width === 64 && expanded.nav.width === 224,
    iconStationary: collapsed.icon.x === expanded.icon.x,
  });

  // Profile menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.waitForTimeout(400);
  await shot(page, `03-desktop-1440-${theme}-profile-menu`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const surfaces = await page.evaluate(() => {
    const read = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    return {
      header: read(document.querySelector('header')),

      secondaryNav: read(document.getElementById('app-sidebar')),
      page: read(document.body),
    };
  });
  console.log('  painted surfaces:', surfaces);

  await context.close();
}

// ------------------------------------------- intermediate reveal frame
{
  const context = await browser.newContext({
    storageState: STATE,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/app`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await setTheme(page, 'dark');
  await setExpanded(page, false);

  const frame = await page.evaluate(async () => {
    const aside = document.getElementById('app-sidebar');
    const main = document.getElementById('main-content');
    document.querySelector('button[aria-controls="app-sidebar"]').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const anims = document.getAnimations();
    for (const a of anims) a.pause();
    const duration = Math.max(
      ...anims
        .map((a) => a.effect?.getTiming()?.duration)
        .filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0),
    );
    for (const a of anims) a.currentTime = duration / 2;

    return {
      elapsedMs: Math.round(duration / 2),
      durationMs: duration,
      navWidth: Math.round(aside.getBoundingClientRect().width),

      workspaceX: Math.round(main.getBoundingClientRect().x),
    };
  });
  await shot(page, '04-desktop-1440-dark-reveal-mid');
  console.log('\n=== INTERMEDIATE REVEAL FRAME ===');
  console.log(frame);
  await context.close();
}

// ----------------------------------------------------------------- mobile
for (const [width, height, theme, name] of [
  [390, 844, 'light', '05-mobile-390-light-drawer-open'],
  [390, 844, 'dark', '06-mobile-390-dark-drawer-open'],
  [320, 720, 'dark', '07-mobile-320-dark-drawer-open'],
]) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(`${BASE}/en/app`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await setTheme(page, theme);

  const hasRail = await page
    .locator('[data-shell-rail]')
    .isVisible()
    .catch(() => false);

  await page.getByRole('button', { name: /open navigation menu/i }).click();
  await page.waitForTimeout(600);
  await shot(page, name);

  const mainX = await page.evaluate(
    () => document.getElementById('main-content').getBoundingClientRect().x,
  );
  console.log(`\n=== MOBILE ${width} ${theme.toUpperCase()} ===`);
  console.log({ desktopRailVisible: hasRail, workspaceXWhileDrawerOpen: mainX });

  await context.close();
}

await browser.close();
console.log('\ncaptured to', OUT);
