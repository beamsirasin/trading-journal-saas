/**
 * Dashboard D9 Consolidation UAT capture.
 *
 * D9 is a REVIEW phase, so this harness measures rather than demonstrates.
 * Every frame comes from the shipping Dashboard running the shipping CSS
 * against a real production build (`pnpm start`, the same server
 * `playwright.config.ts` boots) on the guarded, disposable test database.
 * Nothing is restyled and no figure is edited to make the page read better.
 *
 * WHAT IT MEASURES, rather than eyeballs (§18):
 *
 *   - total document height per viewport
 *   - every top-level Dashboard band: label, top, bottom, height
 *   - the GAP between consecutive bands, which is what §6's rhythm audit
 *     actually turns on
 *   - above-the-fold composition: which bands intersect the first screen and
 *     what fraction of each is visible at scroll 0
 *   - horizontal overflow at the document and at every band
 *   - a computed colour census: how many painted elements resolve to a red,
 *     green or blue hue, so §12 is answered from the rendered page rather
 *     than from a class-name grep
 *
 * ONE POPULATED ACCOUNT AND ONE EMPTY ACCOUNT (§17). The populated Account
 * is deliberately shaped so EVERY band has real content at once — that is the
 * whole point of a whole-page review, and no single earlier phase fixture
 * does it: Needs Attention has more than one non-zero count, both baselines
 * resolve, the Execution Gap is paired and negative, all three pillars reach
 * a real insight, the Trade list and Calendar are full, and the modeled
 * balance curve has enough realization events to have a peak and a live
 * drawdown.
 *
 * Run:
 *   1. TEST_DATABASE_URL / TEST_DATABASE_ACK exported (see .env.local)
 *   2. pnpm build && DATABASE_URL=$TEST_DATABASE_URL E2E_TEST_MODE=true \
 *        BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start --port 3100
 *   3. npx tsx --conditions=react-server --env-file=.env.local \
 *        docs/reviews/dashboard-d9-consolidation-uat/capture.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { provisionVerifiedUser } from '../../../e2e/support/provision-user';
import { validateTestDatabaseEnvironment } from '../../../scripts/test-database-safety.mjs';
import {
  emotionTypes,
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeExits,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradingAccounts,
  workspaces,
} from '../../../src/server/db/schema';

const OUT = join(process.cwd(), 'docs', 'reviews', 'dashboard-d9-consolidation-uat');
const BASE = 'http://127.0.0.1:3100';
const THEME_KEY = 'trading-os-theme';
const PASSWORD = 'Correct-Horse9!';

function daysAgo(days: number, hour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, hour));
}

interface SeedTrade {
  readonly index: number;
  readonly actualR: string;
  readonly systemR: string;
  readonly emotion: string | null;
  readonly confidence: number | null;
  readonly rule: 'followed' | 'violated' | 'not_checked' | null;
  readonly mistake: boolean;
  readonly classified: boolean;
}

/**
 * 28 closed Trades over the last 56 days.
 *
 * Shaped for the whole page rather than for one section: a majority-calm,
 * disciplined population that carries the System, a fear-tagged cohort that
 * under-executes a positive System (a negative paired Execution Gap and a
 * real Psychology insight), two Trades whose required check was never
 * evaluated (Discipline coverage), and two unclassified Trades so Needs
 * Attention shows more than a single count.
 */
function populatedTrades(): readonly SeedTrade[] {
  const rows: SeedTrade[] = [];
  for (let i = 0; i < 16; i += 1) {
    rows.push({
      index: i,
      actualR: i % 4 === 0 ? '-0.6000' : '1.1000',
      systemR: i % 4 === 0 ? '-0.5000' : '1.2000',
      emotion: 'calm',
      confidence: i % 2 === 0 ? 75 : 100,
      rule: 'followed',
      mistake: false,
      classified: true,
    });
  }
  for (let i = 16; i < 24; i += 1) {
    rows.push({
      index: i,
      actualR: '-0.9000',
      systemR: '0.8000',
      emotion: 'fear',
      confidence: 25,
      rule: 'violated',
      mistake: true,
      classified: true,
    });
  }
  for (let i = 24; i < 26; i += 1) {
    rows.push({
      index: i,
      actualR: '0.4000',
      systemR: '0.4000',
      emotion: 'calm',
      confidence: 50,
      rule: 'not_checked',
      mistake: false,
      classified: true,
    });
  }
  // Unclassified: no Strategy, so `review.needs-attention` has a second
  // non-zero count and the Strategy pillar has a real coverage gap to state.
  for (let i = 26; i < 28; i += 1) {
    rows.push({
      index: i,
      actualR: '0.7000',
      systemR: '0.9000',
      emotion: null,
      confidence: null,
      rule: null,
      mistake: false,
      classified: false,
    });
  }
  return rows;
}

async function seed() {
  const { testUrl } = validateTestDatabaseEnvironment();

  const stamp = Date.now();
  const user = await provisionVerifiedUser(
    testUrl,
    { email: `d9-uat-${stamp}@example.test`, password: PASSWORD, name: 'D9 Consolidation UAT' },
    { entitlement: { status: 'active', planKey: 'professional' } },
  );

  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      workspaces,
      tradingAccounts,
      strategies,
      strategyVersions,
      strategyRules,
      setups,
      strategySetupVersions,
      trades,
      tradeExits,
      tradeEmotions,
      tradeRuleChecks,
      tradeMistakes,
      emotionTypes,
      mistakeTypes,
    },
  });

  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, user.id));
    if (workspace === undefined) throw new Error('UAT workspace missing');
    const workspaceId = workspace.id;

    const [firstAccount] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    if (firstAccount === undefined) throw new Error('UAT Account missing');
    await db
      .update(tradingAccounts)
      .set({ name: 'Dashboard — Populated', timezone: 'UTC' })
      .where(eq(tradingAccounts.id, firstAccount.id));

    const [emptyAccount] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Dashboard — Empty',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000',
        timezone: 'UTC',
      })
      .returning({ id: tradingAccounts.id });
    if (emptyAccount === undefined) throw new Error('UAT empty Account insert failed');

    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('UAT Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({ workspaceId, strategyId: strategy.id, versionNumber: 1, name: 'Elliott Wave v3' })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('UAT Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));

    const setupVersionIds: string[] = [];
    const setupIds: string[] = [];
    for (const label of ['Wave 3 Continuation', 'Wave 2 Reversal']) {
      const [setup] = await db
        .insert(setups)
        .values({ workspaceId, strategyId: strategy.id })
        .returning({ id: setups.id });
      if (setup === undefined) throw new Error('UAT Setup insert failed');
      const [setupVersion] = await db
        .insert(strategySetupVersions)
        .values({
          workspaceId,
          strategyId: strategy.id,
          strategyVersionId: version.id,
          setupId: setup.id,
          name: label,
        })
        .returning({ id: strategySetupVersions.id });
      if (setupVersion === undefined) throw new Error('UAT Setup Version insert failed');
      setupIds.push(setup.id);
      setupVersionIds.push(setupVersion.id);
    }

    const [rule] = await db
      .insert(strategyRules)
      .values({
        workspaceId,
        strategyVersionId: version.id,
        category: 'entry',
        title: 'Wait for confirmation candle',
        isRequired: true,
        isPreTradeCheck: true,
        sortOrder: 0,
      })
      .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
    if (rule === undefined) throw new Error('UAT rule insert failed');

    const strategyId = strategy.id;
    const versionId = version.id;
    const ruleId = rule.id;
    const ruleKey = rule.ruleKey;

    const emotionRows = await db
      .select({ id: emotionTypes.id, key: emotionTypes.key })
      .from(emotionTypes);
    const emotionByKey = new Map(emotionRows.map((row) => [row.key, row.id]));
    const [mistake] = await db
      .select({ id: mistakeTypes.id, key: mistakeTypes.key })
      .from(mistakeTypes)
      .where(eq(mistakeTypes.key, 'moved_stop'));

    const accountId = firstAccount.id;
    for (const row of populatedTrades()) {
      const exitedAt = daysAgo(56 - row.index * 2, 12);
      const setupIndex = row.index % 2;
      await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(trades)
          .values({
            workspaceId,
            tradingAccountId: accountId,
            ...(row.classified
              ? {
                  strategyId,
                  strategyVersionId: versionId,
                  setupId: setupIds[setupIndex] as string,
                  setupVersionId: setupVersionIds[setupIndex] as string,
                }
              : {}),
            symbol: ['XAUUSD', 'EURUSD', 'GBPUSD', 'NAS100'][row.index % 4] as string,
            direction: 'long',
            plannedEntry: '100.0000000000',
            plannedStop: '99.0000000000',
            plannedTarget: '102.0000000000',
            plannedR: '2.0000',
            status: 'closed',
            actualResultMode: 'money',
            actualEntry: '100.0000000000',
            actualInitialStop: '99.0000000000',
            actualInitialRiskMinor: 10_000n,
            actualExit: '101.0000000000',
            enteredAt: new Date(exitedAt.getTime() - 3_600_000),
            exitedAt,
            netPnlMinor: BigInt(Math.round(Number(row.actualR) * 10_000)),
            actualR: row.actualR,
            traderOutcome: Number(row.actualR) >= 0 ? 'win' : 'loss',
            ...(row.confidence === null ? {} : { confidence: row.confidence }),
            systemStatus: 'resolved',
            systemResolutionKind: 'price_exit',
            systemExitPrice: '102.0000000000',
            systemCostR: '0.0000',
            systemExitedAt: new Date(exitedAt.getTime() + 1_800_000),
            systemExitReason: 'target_hit',
            systemResolvedAt: new Date(exitedAt.getTime() + 1_800_000),
            systemR: row.systemR,
            systemOutcome: Number(row.systemR) >= 0 ? 'win' : 'loss',
          })
          .returning({ id: trades.id });
        if (inserted === undefined) throw new Error('UAT Trade insert failed');

        await tx.insert(tradeExits).values({
          workspaceId,
          tradeId: inserted.id,
          mutationKey: crypto.randomUUID(),
          sequence: 1,
          closedBps: 10_000,
          exitPrice: '101.0000000000',
          realizedPnlMinor: BigInt(Math.round(Number(row.actualR) * 10_000)),
          exitedAt,
        });

        if (row.emotion !== null) {
          const emotionTypeId = emotionByKey.get(row.emotion);
          if (emotionTypeId !== undefined) {
            await tx
              .insert(tradeEmotions)
              .values({ workspaceId, tradeId: inserted.id, emotionTypeId });
          }
        }
        if (row.rule !== null) {
          await tx.insert(tradeRuleChecks).values({
            workspaceId,
            tradeId: inserted.id,
            strategyRuleId: ruleId,
            strategyVersionId: versionId,
            ruleKey,
            checkStatus: row.rule,
            title: 'Wait for confirmation candle',
            category: 'entry',
            isRequired: true,
            isPreTradeCheck: true,
            sortOrder: 0,
          });
        }
        if (row.mistake && mistake !== undefined) {
          await tx.insert(tradeMistakes).values({
            workspaceId,
            tradeId: inserted.id,
            mistakeTypeId: mistake.id,
            severityAtTime: 'moderate',
            weightAtTime: '1.0000',
          });
        }
      });
    }

    return { user, populatedId: accountId, emptyId: emptyAccount.id };
  } finally {
    await client.end();
  }
}

/**
 * Switches the PERSISTED active Account, the way the shell's own switcher
 * does, rather than reaching the empty state through a `?account=` URL
 * filter. Both are valid D1 scope inputs, but only the preference is what the
 * shell chip reads — driving the page by URL alone produced a capture whose
 * header named one Account while the body named another, which is an artifact
 * of the harness and not something the product's UI can reach.
 */
async function setActiveAccount(userId: string, accountId: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  try {
    await client`
      update user_preferences set active_trading_account_id = ${accountId}
      where user_id = ${userId}`;
  } finally {
    await client.end();
  }
}

/**
 * Whole-page geometry, read from the rendered DOM.
 *
 * The Dashboard's top-level bands are the direct children of the container
 * `RealDashboard` returns, so they are located structurally rather than by a
 * list of selectors this file would have to keep in sync with the page.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector('#performance-heading');
    const root = heading?.closest('section')?.parentElement ?? null;
    const viewportHeight = window.innerHeight;

    function labelFor(node: Element): string {
      const panels = [...node.querySelectorAll('[data-dashboard-panel]')].map((p) =>
        p.getAttribute('data-dashboard-panel'),
      );
      const own = node.getAttribute('data-dashboard-panel');
      if (own !== null) return own;
      if (panels.length > 0) return panels.join('+');
      const widgets = [...node.querySelectorAll('[data-dashboard-widget]')].map((w) =>
        w.getAttribute('data-dashboard-widget'),
      );
      if (widgets.length > 0) return widgets.join('+');
      const h = node.querySelector('h2, h3');
      return h?.textContent?.trim().slice(0, 40) ?? node.tagName.toLowerCase();
    }

    const bands = [...(root?.children ?? [])].map((node, index) => {
      const box = node.getBoundingClientRect();
      const top = Math.round(box.top + window.scrollY);
      const height = Math.round(box.height);
      const visible = Math.max(0, Math.min(viewportHeight, top + height) - Math.max(0, top));
      return {
        index,
        label: labelFor(node),
        top,
        bottom: top + height,
        height,
        width: Math.round(box.width),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        firstScreenVisiblePx: Math.round(visible),
        firstScreenVisiblePct: height === 0 ? 0 : Math.round((visible / height) * 100),
      };
    });

    const gaps = bands.slice(1).map((band, i) => ({
      between: `${bands[i]?.label ?? '?'} -> ${band.label}`,
      px: band.top - (bands[i]?.bottom ?? band.top),
    }));

    // Computed colour census. Every painted element's resolved text colour and
    // background colour is bucketed by hue, so §12 is answered from what the
    // browser actually painted rather than from Tailwind class names.
    function bucket(color: string): string | null {
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color);
      if (m === null) return null;
      const r = Number(m[1]);
      const g = Number(m[2]);
      const b = Number(m[3]);
      const a = m[4] === undefined ? 1 : Number(m[4]);
      if (a < 0.05) return null;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 26) return null; // grey / near-grey: not a signal colour
      if (r === max) return 'red';
      if (g === max) return 'green';
      return 'blue';
    }

    const colors: Record<string, number> = { red: 0, green: 0, blue: 0 };
    const backgrounds: Record<string, number> = { red: 0, green: 0, blue: 0 };
    const swatches: { text: string; sample: string }[] = [];
    for (const node of document.querySelectorAll('*')) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const hasOwnText = [...node.childNodes].some(
        (child) => child.nodeType === 3 && (child.textContent ?? '').trim().length > 0,
      );
      if (hasOwnText) {
        const b = bucket(style.color);
        if (b !== null) {
          colors[b] = (colors[b] ?? 0) + 1;
          if (swatches.length < 60) {
            swatches.push({
              text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
              sample: `${b} ${style.color}`,
            });
          }
        }
      }
      const bg = bucket(style.backgroundColor);
      if (bg !== null) backgrounds[bg] = (backgrounds[bg] ?? 0) + 1;
    }

    return {
      viewport: { width: window.innerWidth, height: viewportHeight },
      documentHeight: document.documentElement.scrollHeight,
      overflow: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      },
      bandCount: bands.length,
      bands,
      gaps,
      firstScreen: bands
        .filter((band) => band.firstScreenVisiblePx > 0)
        .map((band) => `${band.label} (${band.firstScreenVisiblePct}%)`),
      panelOrder: [...document.querySelectorAll('[data-dashboard-panel]')].map((n) =>
        n.getAttribute('data-dashboard-panel'),
      ),
      colors,
      backgrounds,
      swatches,
    };
  });
}

const metrics: Record<string, unknown> = {};

/**
 * Loads the page and waits until EVERY streamed boundary has landed and every
 * chart has painted, because a height or a pixel recorded mid-flight is not a
 * measurement of the shipping page. The first pass proved that: a 600ms fixed
 * delay caught a light-mode frame with all three chart areas still blank, and
 * very nearly reported a light-mode defect that does not exist.
 *
 * Two mechanics matter here and neither is a product concern:
 *
 *   - the Risk boundary's chart is a `ResponsiveContainer`, which paints only
 *     after it has observed a size, and headless Chromium can defer that for a
 *     subtree that has never been on screen. A real reader scrolls to it; so
 *     does the harness, then returns to the top.
 *   - the waits poll on an interval rather than on `requestAnimationFrame`,
 *     which is throttled for a page that is not the foreground tab.
 *
 * A stalled streamed boundary is retried once with a fresh load rather than
 * silently captured half-rendered.
 */
async function load(page: Page, url: string, populated: boolean): Promise<number> {
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
      await page.waitForSelector('[data-dashboard-panel="risk-performance"]', { timeout: 45_000 });
      await page.waitForSelector('[data-insight-pillar="discipline"]', { timeout: 45_000 });
      if (populated) {
        await page.waitForSelector('[data-calendar-status]', { timeout: 45_000 });
        await page
          .locator('[data-dashboard-panel="risk-performance"]')
          .scrollIntoViewIfNeeded({ timeout: 45_000 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(
          () => document.querySelectorAll('svg.recharts-surface').length >= 3,
          { timeout: 45_000, polling: 250 },
        );
      }
      return Date.now() - started;
    } catch (error) {
      if (attempt === 2) throw error;
      console.warn(`  retrying ${url} after a stalled boundary`);
    }
  }
  throw new Error('unreachable');
}

async function capture(page: Page, name: string, url: string, populated: boolean) {
  const settledMs = await load(page, url, populated);
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  metrics[name] = { ...(await measure(page)), pageSettledMs: settledMs };
  await page.screenshot({ path: join(OUT, `${name}-page.png`), fullPage: true });
  await page.screenshot({ path: join(OUT, `${name}-firstscreen.png`) });
  console.log(`captured ${name} (${settledMs}ms)`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const fixture = await seed();
  const browser = await chromium.launch();

  const cases: readonly (readonly [
    string,
    { width: number; height: number },
    'dark' | 'light',
    boolean,
  ])[] = [
    ['01-1920-dark-populated', { width: 1920, height: 1080 }, 'dark', true],
    ['02-1440-dark-populated', { width: 1440, height: 900 }, 'dark', true],
    ['03-1440-light-populated', { width: 1440, height: 900 }, 'light', true],
    ['04-1280-dark-populated', { width: 1280, height: 800 }, 'dark', true],
    ['05-768-dark-populated', { width: 768, height: 1024 }, 'dark', true],
    ['06-390-dark-populated', { width: 390, height: 844 }, 'dark', true],
    ['07-390-light-populated', { width: 390, height: 844 }, 'light', true],
    ['08-320-dark-populated', { width: 320, height: 800 }, 'dark', true],
    ['09-1440-dark-empty', { width: 1440, height: 900 }, 'dark', false],
    ['10-390-dark-empty', { width: 390, height: 844 }, 'dark', false],
  ];

  let activeIsPopulated = true;
  for (const [label, viewport, theme, populated] of cases) {
    if (populated !== activeIsPopulated) {
      await setActiveAccount(fixture.user.id, populated ? fixture.populatedId : fixture.emptyId);
      activeIsPopulated = populated;
    }
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    // tsx compiles this file with esbuild's `keepNames`, which rewrites every
    // named function inside a `page.evaluate` body into a `__name(...)` call
    // that does not exist in the browser. Injected as a raw string so it is
    // not itself transformed, this makes the helper a no-op identity.
    await context.addInitScript({
      content: 'globalThis.__name = globalThis.__name || function (fn) { return fn; };',
    });
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [THEME_KEY, theme],
    );
    const page = await context.newPage();
    const signIn = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: fixture.user.email, password: PASSWORD },
    });
    if (!signIn.ok()) throw new Error(`UAT sign-in rejected: HTTP ${signIn.status()}`);

    await capture(page, label, '/en/app?range=all&unit=r', populated);
    await context.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(`wrote ${Object.keys(metrics).length} cases to metrics.json`);
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
