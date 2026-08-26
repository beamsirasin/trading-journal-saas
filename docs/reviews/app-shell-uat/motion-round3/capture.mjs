/**
 * App-shell motion UAT capture.
 *
 * Frames come from the SHIPPING component running the SHIPPING CSS against a
 * real production build. Nothing here changes a width, an easing, a duration
 * or a class to manufacture a state.
 *
 * The five transition frames are captured by triggering the real transition
 * and then PAUSING it through the Web Animations API — `getAnimations()`
 * returns the live `CSSTransition` objects the browser created from the
 * production stylesheet, and seeking one is the same act as a high-speed
 * camera catching a real movement mid-flight. The animation is the product's;
 * only the shutter is ours.
 */
import pkg from 'file:///d:/dev/trading-os/node_modules/@playwright/test/index.js';

const { chromium } = pkg;

const OUT = 'd:/dev/trading-os/docs/reviews/app-shell-uat/motion-round3';
const BASE = 'http://127.0.0.1:3100';
const STATE = 'd:/dev/trading-os/e2e/.auth/user-a.json';

const browser = await chromium.launch();

/** Header controls whose screen position must be identical in every frame. */
async function headerGeometry(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) };
    };
    const banner = document.querySelector('header');
    return {
      header: box(banner),
      hamburger: box(banner?.querySelector('button[aria-controls="app-sidebar"]')),
      brand: box(banner?.querySelector('a[href$="/app"]')),
      utilities: box(banner?.querySelector('.ml-auto')),
    };
  });
}

// ---------------------------------------------------------------- desktop
const desktop = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1440, height: 900 },
});
const page = await desktop.newPage();
await page.goto(`${BASE}/en/app`, { waitUntil: 'load' });
await page.waitForTimeout(1000);

// Normalise to OPEN without relying on whatever the cookie happens to hold.
if (
  (await page
    .getByRole('button', { name: /(Collapse|Expand) sidebar/ })
    .getAttribute('aria-label')) === 'Expand sidebar'
) {
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.waitForTimeout(600);
}

await page.screenshot({ path: `${OUT}/01-desktop-1440-sidebar-open.png` });
const openGeom = await headerGeometry(page);
console.log(
  'desktop open  main.x =',
  await page.evaluate(() => document.getElementById('main-content').getBoundingClientRect().x),
);

/**
 * Trigger the real transition, immediately pause every animation the browser
 * started from it, and seek to the currentTime at which the panel has
 * travelled `targetProgress` of its width. The seek target is found by
 * binary search on the live animation rather than computed from the easing,
 * so the frame reflects what the browser actually does, not what the maths
 * says it should.
 */
async function seekClosingTo(page, targetProgress) {
  return page.evaluate(async (progress) => {
    const sidebar = document.getElementById('app-sidebar');
    const main = document.getElementById('main-content');
    const workspace = main.parentElement;
    const toggle = document.querySelector('button[aria-controls="app-sidebar"]');

    toggle.click();

    // React commits the state change asynchronously, and the browser only
    // creates the CSSTransition objects on the style recalculation that
    // follows. Two frames is enough for both; the transition is genuinely
    // running by then, which is exactly what we want to catch — it is then
    // paused and seeked, including back to its own time zero.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const animations = document
      .getAnimations()
      .filter((a) => a.effect?.target === sidebar || a.effect?.target === workspace);
    for (const animation of animations) animation.pause();

    const durations = animations
      .map((a) => a.effect?.getTiming()?.duration)
      .filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0);
    const duration = Math.max(...durations);
    if (!Number.isFinite(duration)) {
      throw new Error(`no running shell transition found (${animations.length} animations)`);
    }

    const visibleAt = (time) => {
      for (const animation of animations) animation.currentTime = time;
      // Force a style/layout flush so the measurement reflects the seek.
      return sidebar.getBoundingClientRect().right;
    };

    const wanted = 200 * (1 - progress);
    let low = 0;
    let high = duration;
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      if (visibleAt(mid) > wanted) low = mid;
      else high = mid;
    }
    const time = progress === 0 ? 0 : progress === 1 ? duration : (low + high) / 2;
    const right = visibleAt(time);

    return {
      elapsedMs: Math.round(time),
      durationMs: duration,
      visiblePx: Math.round(right),
      mainLeft: Math.round(main.getBoundingClientRect().left),
      gapPx: Math.round(Math.abs(right - main.getBoundingClientRect().left)),
    };
  }, targetProgress);
}

const FRAMES = [0, 0.25, 0.5, 0.75, 1];
const frameReport = [];

for (const [index, progress] of FRAMES.entries()) {
  // Every frame starts from a settled OPEN sidebar and runs its own real
  // transition — no frame is derived from another frame's paused state.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  // The toggle persists to a cookie, so the reload could land on either state
  // — put it back to a settled OPEN before running this frame's transition.
  if (
    (await page
      .getByRole('button', { name: /(Collapse|Expand) sidebar/ })
      .getAttribute('aria-label')) === 'Expand sidebar'
  ) {
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.waitForTimeout(600);
  }

  const measured = await seekClosingTo(page, progress);
  const geometry = await headerGeometry(page);
  const name = `0${index + 1}-closing-${String(Math.round(progress * 100)).padStart(3, '0')}pct.png`;
  await page.screenshot({ path: `${OUT}/transition-frames/${name}` });

  frameReport.push({
    name,
    ...measured,
    headerMatchesOpenFrame: JSON.stringify(geometry) === JSON.stringify(openGeom),
  });
}

console.table(frameReport);

// Settled closed state, from a real toggle rather than a paused frame.
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);
if (
  (await page
    .getByRole('button', { name: /(Collapse|Expand) sidebar/ })
    .getAttribute('aria-label')) === 'Expand sidebar'
) {
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await page.waitForTimeout(600);
}
await page.getByRole('button', { name: 'Collapse sidebar' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/02-desktop-1440-sidebar-closed.png` });
const closedGeom = await headerGeometry(page);
console.log(
  'desktop closed main.x =',
  await page.evaluate(() => document.getElementById('main-content').getBoundingClientRect().x),
);
console.log(
  'header identical open vs closed:',
  JSON.stringify(openGeom) === JSON.stringify(closedGeom),
);
console.log('open geometry :', JSON.stringify(openGeom));
console.log('closed geometry:', JSON.stringify(closedGeom));

// Leave the preference OPEN so the next run starts from a known state.
await page.getByRole('button', { name: 'Expand sidebar' }).click();
await page.waitForTimeout(400);
await desktop.close();

// ----------------------------------------------------------------- mobile
async function captureMobile(width, height, prefix) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
  const mobile = await context.newPage();
  await mobile.goto(`${BASE}/en/app`, { waitUntil: 'load' });
  await mobile.waitForTimeout(1000);

  const closedGeometry = await headerGeometry(mobile);
  if (prefix === '390') {
    await mobile.screenshot({ path: `${OUT}/mobile/01-390-drawer-closed.png` });

    // Half-open, via the same pause-and-seek on the drawer's own real
    // keyframe animation and its backdrop.
    const half = await mobile.evaluate(() => {
      document.querySelector('button[aria-label="Open navigation menu"]').click();
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          const animations = document.getAnimations();
          for (const animation of animations) animation.pause();
          const duration = Math.max(...animations.map((a) => a.effect?.getTiming()?.duration ?? 0));
          const panel = document.querySelector('[data-slot="sheet-content"]');
          const overlay = document.querySelector('[data-slot="sheet-overlay"]');

          const wanted = -panel.getBoundingClientRect().width / 2;
          let low = 0;
          let high = duration;
          for (let i = 0; i < 40; i += 1) {
            const mid = (low + high) / 2;
            for (const animation of animations) animation.currentTime = mid;
            if (panel.getBoundingClientRect().left < wanted) low = mid;
            else high = mid;
          }
          resolve({
            elapsedMs: Math.round((low + high) / 2),
            durationMs: duration,
            panelLeft: Math.round(panel.getBoundingClientRect().left),
            backdropOpacity: Number(getComputedStyle(overlay).opacity).toFixed(2),
          });
        });
      });
    });
    console.log('mobile 390 half-open frame:', half);
    await mobile.screenshot({ path: `${OUT}/mobile/02-390-drawer-50pct.png` });

    await mobile.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish();
    });
    await mobile.waitForTimeout(300);
    await mobile.screenshot({ path: `${OUT}/mobile/03-390-drawer-open.png` });
  } else {
    await mobile.getByRole('button', { name: /open navigation menu/i }).click();
    await mobile.waitForTimeout(600);
    await mobile.screenshot({ path: `${OUT}/mobile/04-320-drawer-open.png` });
  }

  const openGeometry = await headerGeometry(mobile);
  const drawer = await mobile.evaluate(() => {
    const r = document.querySelector('[data-slot="sheet-content"]').getBoundingClientRect();
    const o = document.querySelector('[data-slot="sheet-overlay"]').getBoundingClientRect();
    return {
      drawerTop: Math.round(r.top),
      drawerLeft: Math.round(r.left),
      drawerBottom: Math.round(r.bottom),
      drawerWidth: Math.round(r.width),
      overlayTop: Math.round(o.top),
    };
  });
  const mainLeft = await mobile.evaluate(
    () => document.getElementById('main-content').getBoundingClientRect().x,
  );

  console.log(`mobile ${prefix}:`, {
    headerStationary: JSON.stringify(closedGeometry) === JSON.stringify(openGeometry),
    headerBottom: closedGeometry.header.y + closedGeometry.header.h,
    ...drawer,
    mainLeftWhileOpen: mainLeft,
  });

  await context.close();
}

await captureMobile(390, 844, '390');
await captureMobile(320, 720, '320');

await browser.close();
console.log('\ncaptured to', OUT);
