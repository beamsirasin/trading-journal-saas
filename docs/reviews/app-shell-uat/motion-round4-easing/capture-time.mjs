/**
 * App-shell motion UAT capture — EQUAL-TIME edition.
 *
 * Frames come from the shipping components running the shipping CSS against a
 * real production build. Nothing changes a width, an easing, a duration or a
 * class to manufacture a state.
 *
 * The difference from the previous round: the five desktop frames are seeked
 * to fixed fractions of ELAPSED TIME (0 / 55 / 110 / 165 / 220 ms), never to a
 * desired sidebar width. Whatever the panel happens to have travelled by each
 * of those instants is what gets photographed and reported.
 *
 * Alongside the frames it records unpaused, normal-speed per-frame traces —
 * the actual sequence of positions a viewer's eye receives — because a paused
 * frame can only prove geometry, not feel.
 */
import pkg from 'file:///d:/dev/trading-os/node_modules/@playwright/test/index.js';

const { chromium } = pkg;

const OUT = 'd:/dev/trading-os/docs/reviews/app-shell-uat/motion-round4-easing';
const BASE = 'http://127.0.0.1:3100';
const STATE = 'd:/dev/trading-os/e2e/.auth/user-a.json';

const browser = await chromium.launch();

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

async function ensureOpen(page) {
  const label = await page
    .getByRole('button', { name: /(Collapse|Expand) sidebar/ })
    .getAttribute('aria-label');
  if (label === 'Expand sidebar') {
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
    await page.waitForTimeout(600);
  }
}

const desktop = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1440, height: 900 },
});
const page = await desktop.newPage();
await page.goto(`${BASE}/en/app`, { waitUntil: 'load' });
await page.waitForTimeout(1000);
await ensureOpen(page);

await page.screenshot({ path: `${OUT}/01-desktop-1440-sidebar-open.png` });
const openGeom = await headerGeometry(page);

/**
 * Trigger the real transition, pause it, and seek to `fraction` of its own
 * duration. The position is an OUTPUT here, never an input.
 */
async function seekToTimeFraction(page, fraction) {
  return page.evaluate(async (frac) => {
    const sidebar = document.getElementById('app-sidebar');
    const main = document.getElementById('main-content');
    const workspace = main.parentElement;
    const toggle = document.querySelector('button[aria-controls="app-sidebar"]');

    toggle.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const animations = document
      .getAnimations()
      .filter((a) => a.effect?.target === sidebar || a.effect?.target === workspace);
    for (const animation of animations) animation.pause();

    const duration = Math.max(
      ...animations
        .map((a) => a.effect?.getTiming()?.duration)
        .filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0),
    );
    if (!Number.isFinite(duration)) throw new Error('no running shell transition found');

    const time = duration * frac;
    for (const animation of animations) animation.currentTime = time;

    const right = sidebar.getBoundingClientRect().right;
    const mainLeft = main.getBoundingClientRect().left;
    return {
      elapsedMs: Math.round(time),
      durationMs: duration,
      visiblePx: Math.round(right),
      workspaceX: Math.round(mainLeft),
      gapPx: Math.round(Math.abs(right - mainLeft)),
    };
  }, fraction);
}

const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
const NAMES = ['01-time-000', '02-time-025', '03-time-050', '04-time-075', '05-time-100'];
const frameReport = [];

for (const [index, fraction] of FRACTIONS.entries()) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await ensureOpen(page);

  const measured = await seekToTimeFraction(page, fraction);
  const geometry = await headerGeometry(page);
  await page.screenshot({ path: `${OUT}/time-frames/${NAMES[index]}.png` });

  frameReport.push({
    frame: `${NAMES[index]}.png`,
    ...measured,
    headerIdenticalToOpen: JSON.stringify(geometry) === JSON.stringify(openGeom),
  });
}

console.log('\n=== DESKTOP CLOSING — EQUAL-TIME FRAMES ===');
console.table(frameReport);

/** Unpaused, normal speed. This is the sequence a viewer's eye actually receives. */
async function normalSpeedTrace(page, direction) {
  return page.evaluate(async (dir) => {
    const sidebar = document.getElementById('app-sidebar');
    const main = document.getElementById('main-content');
    const toggle = document.querySelector('button[aria-controls="app-sidebar"]');

    const samples = [];
    const t0 = performance.now();
    toggle.click();
    return await new Promise((resolve) => {
      function tick() {
        const t = performance.now() - t0;
        samples.push({
          t: Math.round(t),
          visible: Math.round(sidebar.getBoundingClientRect().right),
          workspaceX: Math.round(main.getBoundingClientRect().left),
        });
        if (t < 300) requestAnimationFrame(tick);
        else resolve({ dir, samples });
      }
      requestAnimationFrame(tick);
    });
  }, direction);
}

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);
await ensureOpen(page);

console.log('\n=== NORMAL-SPEED PLAYBACK (unpaused, real frames) ===');
for (let round = 0; round < 3; round += 1) {
  const closing = await normalSpeedTrace(page, 'closing');
  await page.waitForTimeout(500);
  const opening = await normalSpeedTrace(page, 'opening');
  await page.waitForTimeout(500);

  for (const trace of [closing, opening]) {
    const shown = trace.samples.filter((s) => s.t <= 240);
    const distinct = new Set(shown.map((s) => s.visible)).size;
    const midFrames = shown.filter((s) => s.visible > 40 && s.visible < 160).length;
    console.log(
      `round ${round + 1} ${trace.dir.padEnd(8)}`,
      `frames<=240ms=${String(shown.length).padStart(2)}`,
      `distinct positions=${String(distinct).padStart(2)}`,
      `frames in the middle third=${String(midFrames).padStart(2)}`,
      '|',
      shown
        .filter((_, i) => i % 2 === 0)
        .map((s) => `${s.t}ms:${s.visible}`)
        .join('  '),
    );
    const maxGap = Math.max(...shown.map((s) => Math.abs(s.visible - s.workspaceX)));
    if (maxGap > 1) console.log('   !! workspace gap detected:', maxGap);
  }
}

console.log('\n=== REVERSE MID-MOTION ===');
for (const first of ['Collapse sidebar', 'Expand sidebar']) {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  if (first === 'Collapse sidebar') await ensureOpen(page);
  else {
    await ensureOpen(page);
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.waitForTimeout(600);
  }

  const trace = await page.evaluate(async () => {
    const sidebar = document.getElementById('app-sidebar');
    const toggle = document.querySelector('button[aria-controls="app-sidebar"]');
    const right = () => Math.round(sidebar.getBoundingClientRect().right);

    toggle.click();
    await new Promise((r) => setTimeout(r, 110));
    const atReversal = right();
    toggle.click();

    const samples = [];
    return await new Promise((resolve) => {
      function tick() {
        samples.push(right());
        if (samples.length < 30) requestAnimationFrame(tick);
        else resolve({ atReversal, samples });
      }
      requestAnimationFrame(tick);
    });
  });

  console.log(
    `${first.padEnd(16)} -> reversed at ${String(trace.atReversal).padStart(3)}px |`,
    'first 8 frames after reversal:',
    trace.samples.slice(0, 8).join(', '),
    '| settled:',
    trace.samples.at(-1),
  );
}

await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(700);
await ensureOpen(page);
await page.getByRole('button', { name: 'Collapse sidebar' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/02-desktop-1440-sidebar-closed.png` });
const closedGeom = await headerGeometry(page);

console.log('\n=== STATIONARY HEADER ===');
console.log(
  'identical across open, closed and all five frames:',
  JSON.stringify(openGeom) === JSON.stringify(closedGeom) &&
    frameReport.every((f) => f.headerIdenticalToOpen),
);
console.log('geometry:', JSON.stringify(openGeom));

await page.getByRole('button', { name: 'Expand sidebar' }).click();
await page.waitForTimeout(400);
await desktop.close();

// ----------------------------------------------------------------- mobile
async function captureMobile(width, height) {
  const context = await browser.newContext({ storageState: STATE, viewport: { width, height } });
  const mobile = await context.newPage();
  await mobile.goto(`${BASE}/en/app`, { waitUntil: 'load' });
  await mobile.waitForTimeout(1000);

  const closedGeometry = await headerGeometry(mobile);
  if (width === 390) await mobile.screenshot({ path: `${OUT}/mobile/01-390-drawer-closed.png` });

  // Half of the drawer's own TIME, not half of its distance.
  const half = await mobile.evaluate(async () => {
    document.querySelector('button[aria-label="Open navigation menu"]').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const panel = document.querySelector('[data-slot="sheet-content"]');
    const overlay = document.querySelector('[data-slot="sheet-overlay"]');
    const animations = document
      .getAnimations()
      .filter((a) => a.effect?.target === panel || a.effect?.target === overlay);
    for (const animation of animations) animation.pause();

    const duration = Math.max(
      ...animations
        .map((a) => a.effect?.getTiming()?.duration)
        .filter((d) => typeof d === 'number' && Number.isFinite(d) && d > 0),
    );
    for (const animation of animations) animation.currentTime = duration / 2;

    const rect = panel.getBoundingClientRect();
    return {
      elapsedMs: Math.round(duration / 2),
      durationMs: duration,
      panelLeft: Math.round(rect.left),
      panelWidth: Math.round(rect.width),
      travelledPct: Math.round((1 + rect.left / rect.width) * 100),
      backdropOpacity: Number(getComputedStyle(overlay).opacity).toFixed(2),
    };
  });
  if (width === 390) {
    await mobile.screenshot({ path: `${OUT}/mobile/02-390-drawer-050-time.png` });
    console.log('\n=== MOBILE 390 — DRAWER AT 50% OF TIME ===');
    console.log(half);
  }

  await mobile.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await mobile.waitForTimeout(400);
  await mobile.screenshot({
    path: `${OUT}/mobile/${width === 390 ? '03-390-drawer-open' : '04-320-drawer-open'}.png`,
  });

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
  const wordmarksInDrawer = await mobile
    .getByRole('dialog')
    .getByRole('link', { name: 'TradeChemist' })
    .count();
  const mainX = await mobile.evaluate(
    () => document.getElementById('main-content').getBoundingClientRect().x,
  );

  console.log(`\n=== MOBILE ${width} ===`);
  console.log({
    headerStationary: JSON.stringify(closedGeometry) === JSON.stringify(openGeometry),
    headerBottom: closedGeometry.header.y + closedGeometry.header.h,
    ...drawer,
    wordmarksInDrawer,
    workspaceXWhileOpen: mainX,
  });

  await context.close();
}

await captureMobile(390, 844);
await captureMobile(320, 720);

await browser.close();
console.log('\ncaptured to', OUT);
