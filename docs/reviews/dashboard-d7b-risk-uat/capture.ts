/**
 * Dashboard D7B Risk Performance UAT capture.
 *
 * Every frame comes from the SHIPPING section running the SHIPPING CSS
 * against a real production build (`pnpm start`, the same server
 * `playwright.config.ts` boots) on the guarded, disposable test database.
 * Nothing here changes a width, a colour, a class or a figure to manufacture
 * a state, and nothing is captured from a storybook or a stub.
 *
 * WHY A PURPOSE-BUILT SEED RATHER THAN THE `Visual — Populated` FIXTURE. That
 * fixture is anchored to a fixed reference instant (2026-08-26T12:00Z), so its
 * 30D/90D windows only line up with the documented figures when the clock
 * agrees. The series below is anchored to `now` instead, and is arranged so
 * the headline figures still land exactly on the D7B contract's numbers:
 *
 *   All   opening $10,000.00   ending $12,310.00   period +$2,310.00
 *   90D   opening $10,110.00   ending $12,310.00   period +$2,200.00
 *   30D   opening $11,270.00   ending $12,310.00   period +$1,040.00
 *   peak  $12,420.00           current drawdown $110.00 · 0.89%
 *
 * Maximum drawdown is the one figure that deliberately differs from the
 * fixture ($890 · 8.09% for All and 90D, $540 · 4.57% for 30D). Matching it
 * as well would have needed the fixture's whole 66-Trade shape, which is
 * exactly the clock-anchored thing this seed avoids; the fixture's own
 * maximum-drawdown figures are locked by unit test instead.
 *
 * The three openings are deliberately all different, which is the single
 * reading this section exists to make un-misreadable: 30D shows $12,310.00
 * beside +$1,040.00, and only the carried opening explains the rest.
 *
 * Run:
 *   1. TEST_DATABASE_URL / TEST_DATABASE_ACK exported (see .env.local)
 *   2. pnpm build && DATABASE_URL=$TEST_DATABASE_URL E2E_TEST_MODE=true \
 *        BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start --port 3100
 *   3. npx tsx --conditions=react-server --env-file=.env.local \
 *        docs/reviews/dashboard-d7b-risk-uat/capture.ts
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
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
  trades,
  tradingAccounts,
  workspaces,
} from '../../../src/server/db/schema';

// Resolved from the repository root, which is where this script is run from:
// `import.meta.url` is unavailable under tsx's CJS transform on this project.
const OUT = join(process.cwd(), 'docs', 'reviews', 'dashboard-d7b-risk-uat');
const BASE = 'http://127.0.0.1:3100';
const THEME_KEY = 'trading-os-theme';
const PASSWORD = 'Correct-Horse9!';

/**
 * `[days ago, net P&L in minor units]`, in chronological order.
 *
 * Six structural rows set the three openings, the high-water mark and the
 * closing drawdown. The `+$50 / -$50` pairs exist only to give the step curve
 * more realization events, and each one sits at a balance that is strictly
 * BELOW the running peak by more than $50 and strictly ABOVE the running
 * trough by more than $50 — so it can neither set a new peak nor deepen the
 * maximum drawdown, and every checkpoint above survives it. A pair placed
 * immediately after a peak-setting Trade would do both, which is precisely
 * what the first capture pass got wrong: the peak came out $50 high at
 * $12,470 and the current drawdown $50 deep at $160.
 */
const SERIES: readonly (readonly [number, number])[] = [
  [200, 100_000], // -> $11,000.00, sets the first peak
  [120, -89_000], // -> $10,110.00  = the 90D opening, and the deepest trough
  [110, 5_000], // filler: $10,160, below the $11,000 peak, above the trough
  [105, -5_000], // -> back to $10,110.00
  [60, 170_000], // -> $11,810.00, second peak
  [40, -54_000], // -> $11,270.00  = the 30D opening
  [34, 5_000], // filler: $11,320
  [32, -5_000], // -> back to $11,270.00
  [20, 115_000], // -> $12,420.00  = the high-water mark
  [5, -11_000], // -> $12,310.00, current drawdown $110.00
  [3, 5_000], // filler: $12,360, still under the $12,420 mark
  [2, -5_000], // -> back to $12,310.00
];

function daysAgo(days: number, hour: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days, hour));
}

async function seed() {
  const { testUrl } = validateTestDatabaseEnvironment();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await provisionVerifiedUser(
    testUrl,
    { email: `d7b-uat-${stamp}@example.test`, password: PASSWORD, name: 'D7B Risk UAT' },
    // A paid plan, so the second Account below never puts the workspace
    // over its limit and no entitlement banner intrudes on the captures.
    { entitlement: { status: 'active', planKey: 'trader' } },
  );

  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      workspaces,
      tradingAccounts,
      strategies,
      strategyVersions,
      setups,
      strategySetupVersions,
      tradeExits,
      trades,
    },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, user.id));
    if (workspace === undefined) throw new Error('UAT workspace missing');
    const workspaceId = workspace.id;

    const [populated] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    if (populated === undefined) throw new Error('UAT Account missing');
    await db
      .update(tradingAccounts)
      .set({ name: 'Visual — Populated', timezone: 'UTC' })
      .where(eq(tradingAccounts.id, populated.id));

    // A second Account with the same declared Starting Balance and no closed
    // Trades at all: the available-but-empty state, not an error state.
    const [empty] = await db
      .insert(tradingAccounts)
      .values({
        workspaceId,
        name: 'Visual — Empty',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000',
        timezone: 'UTC',
      })
      .returning({ id: tradingAccounts.id });
    if (empty === undefined) throw new Error('UAT empty Account insert failed');

    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('UAT Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({ workspaceId, strategyId: strategy.id, versionNumber: 1, name: 'UAT Momentum v1' })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('UAT Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
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
        name: 'UAT Opening Retest',
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('UAT Setup Version insert failed');

    const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'NAS100', 'BTCUSD', 'USDJPY'];
    for (const [index, entry] of SERIES.entries()) {
      const [days, netPnlMinor] = entry;
      const exitedAt = daysAgo(days, 12);
      // ONE TRANSACTION per position. `trade_execution_consistency_deferred`
      // requires a closed Trade's Exit legs to sum to exactly 10000 bps, and
      // it is checked at commit — so the parent and its single full-close leg
      // have to land together, exactly as the Dashboard E2E seed does it.
      await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(trades)
          .values({
            workspaceId,
            tradingAccountId: populated.id,
            strategyId: strategy.id,
            strategyVersionId: version.id,
            setupId: setup.id,
            setupVersionId: setupVersion.id,
            symbol: symbols[index % symbols.length] as string,
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
            enteredAt: new Date(exitedAt.getTime() - 60 * 60 * 1000),
            exitedAt,
            netPnlMinor: BigInt(netPnlMinor),
            actualR: (netPnlMinor / 10_000).toFixed(4),
            traderOutcome: netPnlMinor >= 0 ? 'win' : 'loss',
          })
          .returning({ id: trades.id });
        if (row === undefined) throw new Error('UAT Trade insert failed');
        await tx.insert(tradeExits).values({
          workspaceId,
          tradeId: row.id,
          mutationKey: crypto.randomUUID(),
          sequence: 1,
          closedBps: 10_000,
          exitPrice: '101.0000000000',
          realizedPnlMinor: BigInt(netPnlMinor),
          exitedAt,
        });
      });
    }

    return { user, populatedId: populated.id, emptyId: empty.id, strategyId: strategy.id };
  } finally {
    await client.end();
  }
}

/**
 * Reads back what the section actually rendered — measured, never asserted.
 *
 * Deliberately free of inner helper functions. tsx compiles this file with
 * esbuild's `keepNames`, which wraps every named function in a `__name(...)`
 * call — and that helper does not exist inside the page, so a tidier version
 * of this with a `round()`/`text()` pair throws `__name is not defined` the
 * moment Playwright serialises it. The repetition below is the cost of the
 * callback staying self-contained.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-dashboard-panel="risk-performance"]');
    const box = section?.getBoundingClientRect();
    const figures: Record<string, string> = {};
    for (const node of document.querySelectorAll('[data-risk-metric]')) {
      figures[node.getAttribute('data-risk-metric') ?? ''] = node.textContent?.trim() ?? '';
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflow: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      section:
        box === undefined
          ? null
          : {
              x: Math.round(box.x * 100) / 100,
              w: Math.round(box.width * 100) / 100,
              h: Math.round(box.height * 100) / 100,
            },
      sectionOverflow:
        section === null ? null : { scroll: section.scrollWidth, client: section.clientWidth },
      status:
        document.querySelector('[data-risk-status]')?.getAttribute('data-risk-status') ?? null,
      reason:
        document.querySelector('[data-risk-reason]')?.getAttribute('data-risk-reason') ?? null,
      range: document.querySelector('[data-risk-range]')?.getAttribute('data-risk-range') ?? null,
      modeledBalance: figures.modeledBalance ?? null,
      periodPnl: figures.periodPnl ?? null,
      currentDrawdown: figures.currentDrawdown ?? null,
      maxDrawdown: figures.maxDrawdown ?? null,
      peakBalance: figures.peakBalance ?? null,
      opening:
        document
          .querySelector('[data-dashboard-widget="account.balance"] p')
          ?.textContent?.trim() ?? null,
      scopeNote: document.querySelector('[data-risk-scope-note]')?.textContent?.trim() ?? null,
      noTrades:
        document.querySelector('[data-risk-state="no-trades"]')?.textContent?.trim() ?? null,
      chartPathCommands:
        document.querySelector('path.recharts-line-curve')?.getAttribute('d')?.slice(0, 60) ?? null,
      chartCurveCommands: /[CcSsQqTtAa]/.test(
        document.querySelector('path.recharts-line-curve')?.getAttribute('d') ?? '',
      ),
      seriesPoints: document.querySelectorAll('table tbody tr').length,
    };
  });
}

const metrics: Record<string, unknown> = {};

async function capture(page: Page, name: string, url: string) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-dashboard-panel="risk-performance"]');
  // Every context runs with `reducedMotion: 'reduce'`, so the chart paints
  // its settled state with no entry animation to race — see `main()`.
  await page.waitForTimeout(700);
  metrics[name] = await measure(page);
  await page.screenshot({ path: join(OUT, `${name}-page.png`), fullPage: true });
  await page
    .locator('[data-dashboard-panel="risk-performance"]')
    .screenshot({ path: join(OUT, `${name}-section.png`) });
  console.log(`captured ${name}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const fixture = await seed();
  const browser = await chromium.launch();

  for (const [theme, viewport, label] of [
    ['dark', { width: 1440, height: 900 }, 'desktop-1440-dark'],
    ['light', { width: 1440, height: 900 }, 'desktop-1440-light'],
    ['dark', { width: 1920, height: 1080 }, 'desktop-1920-dark'],
    ['dark', { width: 390, height: 844 }, 'mobile-390-dark'],
    ['light', { width: 390, height: 844 }, 'mobile-390-light'],
    ['dark', { width: 320, height: 800 }, 'mobile-320-dark'],
  ] as const) {
    /*
      `reducedMotion: 'reduce'` IS THE SHUTTER, NOT A STYLE OVERRIDE.

      Recharts animates a line in by growing a clip rect over the path, and
      the path's own `d` is final from the first frame — so there is nothing
      to poll for, and two fixed waits (900ms, then 2600ms) both published a
      half-drawn line whenever a cold context hydrated late. The chart already
      honours `prefers-reduced-motion` and skips the animation entirely under
      it, which paints the settled state on the first frame. That is a real
      product mode rather than a capture hack, and it is the state these
      frames exist to show; the animated path is covered by the theme E2E.
    */
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    await context.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [THEME_KEY, theme],
    );
    const page = await context.newPage();
    const signIn = await page.request.post(`${BASE}/api/auth/sign-in/email`, {
      data: { email: fixture.user.email, password: PASSWORD },
    });
    if (!signIn.ok()) throw new Error(`UAT sign-in rejected: HTTP ${signIn.status()}`);

    const account = `account=${fixture.populatedId}`;
    if (label.startsWith('desktop-1440-dark')) {
      await capture(page, `01-${label}-30d`, `/en/app?range=30d&unit=r&${account}`);
      await capture(page, `02-${label}-90d`, `/en/app?range=90d&unit=r&${account}`);
      await capture(page, `03-${label}-all`, `/en/app?range=all&unit=r&${account}`);
      await capture(
        page,
        `04-${label}-strategy-filtered`,
        `/en/app?range=90d&unit=r&${account}&strategy=${fixture.strategyId}`,
      );
      await capture(
        page,
        `05-${label}-empty-account`,
        `/en/app?range=90d&unit=r&account=${fixture.emptyId}`,
      );
      await capture(page, `06-${label}-all-accounts`, `/en/app?range=90d&unit=r&account=all`);
    } else if (label === 'desktop-1440-light') {
      await capture(page, `07-${label}-30d`, `/en/app?range=30d&unit=r&${account}`);
      await capture(
        page,
        `08-${label}-empty-account`,
        `/en/app?range=90d&unit=r&account=${fixture.emptyId}`,
      );
    } else if (label === 'desktop-1920-dark') {
      await capture(page, `09-${label}-30d`, `/en/app?range=30d&unit=r&${account}`);
    } else if (label === 'mobile-390-dark') {
      await capture(page, `10-${label}-30d`, `/en/app?range=30d&unit=r&${account}`);
      await capture(page, `11-${label}-all-accounts`, `/en/app?range=90d&unit=r&account=all`);
    } else if (label === 'mobile-390-light') {
      await capture(page, `12-${label}-30d`, `/en/app?range=30d&unit=r&${account}`);
    } else {
      await capture(page, `13-${label}-30d`, `/en/app?range=30d&unit=r&${account}`);
      await capture(
        page,
        `14-${label}-empty-account`,
        `/en/app?range=90d&unit=r&account=${fixture.emptyId}`,
      );
    }
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
