/**
 * Dashboard D8B Insight Pillars UAT capture.
 *
 * Every frame comes from the SHIPPING section running the SHIPPING CSS
 * against a real production build (`pnpm start`, the same server
 * `playwright.config.ts` boots) on the guarded, disposable test database.
 * Nothing is restyled, and no figure is edited to make a card read better.
 *
 * FOUR ACCOUNTS, ONE WORKSPACE, SIX FOCUSED STATES (§32). `Visual —
 * Populated` cannot exercise every pillar state at once, and the canonical
 * D1–D8 fixture metrics must not be altered to force one — so the states are
 * reached by SWITCHING ACCOUNT, which is exactly how a trader would reach
 * them:
 *
 *   rich      Strategy available · Psychology available · Discipline
 *             available with a negative associated Execution Gap
 *   sparse    Strategy insufficient sample (3 closed Trades)
 *   untagged  Psychology low coverage · Discipline unevaluated
 *   empty     all three pillars `no_eligible_trades`
 *
 * Contexts run with `reducedMotion: 'reduce'` so the shutter is
 * deterministic — the same reason D7B's capture does, and a real product mode
 * rather than a capture hack.
 *
 * Run:
 *   1. TEST_DATABASE_URL / TEST_DATABASE_ACK exported (see .env.local)
 *   2. pnpm build && DATABASE_URL=$TEST_DATABASE_URL E2E_TEST_MODE=true \
 *        BETTER_AUTH_URL=http://127.0.0.1:3100 pnpm start --port 3100
 *   3. npx tsx --conditions=react-server docs/reviews/dashboard-d8b-insight-uat/capture.ts
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

const OUT = join(process.cwd(), 'docs', 'reviews', 'dashboard-d8b-insight-uat');
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
}

/**
 * The rich Account.
 *
 * Shaped so every pillar has something real to say: two Setups with genuinely
 * different System expectancy, a majority-tagged Emotion population where the
 * `fear` cohort underperforms the scoped baseline, a spread of canonical
 * confidence levels, and a violated-rule cohort that also carries a mistake
 * tag and a negative paired Execution Gap.
 */
function richTrades(): readonly SeedTrade[] {
  const rows: SeedTrade[] = [];
  // 14 disciplined, calm, well-executed Trades on the strong Setup.
  for (let i = 0; i < 14; i += 1) {
    rows.push({
      index: i,
      actualR: i % 4 === 0 ? '-0.6000' : '1.1000',
      systemR: i % 4 === 0 ? '-0.5000' : '1.2000',
      emotion: 'calm',
      confidence: i % 2 === 0 ? 75 : 100,
      rule: 'followed',
      mistake: false,
    });
  }
  // 8 fear-tagged Trades that under-executed a positive System — a negative
  // paired Execution Gap, and a mistake tag on each.
  for (let i = 14; i < 22; i += 1) {
    rows.push({
      index: i,
      actualR: '-0.9000',
      systemR: '0.8000',
      emotion: 'fear',
      confidence: 25,
      rule: 'violated',
      mistake: true,
    });
  }
  // 2 Trades whose required check was never completed.
  for (let i = 22; i < 24; i += 1) {
    rows.push({
      index: i,
      actualR: '0.4000',
      systemR: '0.4000',
      emotion: 'calm',
      confidence: 50,
      rule: 'not_checked',
      mistake: false,
    });
  }
  return rows;
}

/** Three closed Trades — below D8A's five-observation floor. */
function sparseTrades(): readonly SeedTrade[] {
  return [0, 1, 2].map((index) => ({
    index,
    actualR: '0.7000',
    systemR: '0.7000',
    emotion: 'calm',
    confidence: 75,
    rule: 'followed',
    mistake: false,
  }));
}

/** Twenty closed Trades with nothing recorded about state or rules. */
function untaggedTrades(): readonly SeedTrade[] {
  return Array.from({ length: 20 }, (_, index) => ({
    index,
    actualR: index % 3 === 0 ? '-0.5000' : '0.9000',
    systemR: index % 3 === 0 ? '-0.4000' : '1.0000',
    emotion: null,
    confidence: null,
    rule: null,
    mistake: false,
  }));
}

async function seed() {
  const { testUrl } = validateTestDatabaseEnvironment();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const user = await provisionVerifiedUser(
    testUrl,
    { email: `d8b-uat-${stamp}@example.test`, password: PASSWORD, name: 'D8B Insight UAT' },
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
      .set({ name: 'Insights — Rich', timezone: 'UTC' })
      .where(eq(tradingAccounts.id, firstAccount.id));

    const accountIds: Record<string, string> = { rich: firstAccount.id };
    for (const name of ['Insights — Sparse', 'Insights — Untagged', 'Insights — Empty']) {
      const [row] = await db
        .insert(tradingAccounts)
        .values({
          workspaceId,
          name,
          accountMode: 'live',
          baseCurrency: 'USD',
          startingBalance: '10000',
          timezone: 'UTC',
        })
        .returning({ id: tradingAccounts.id });
      if (row === undefined) throw new Error(`UAT Account insert failed: ${name}`);
      accountIds[name.split('— ')[1]?.toLowerCase() ?? name] = row.id;
    }

    // One Strategy, one pinned Version, two Setups with different System
    // expectancy, and two required rules to check against.
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

    // Bound after their guards: TypeScript's narrowing does not survive into
    // the nested `seedAccount` closure below.
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

    async function seedAccount(accountId: string, rows: readonly SeedTrade[]) {
      for (const row of rows) {
        const exitedAt = daysAgo(60 - row.index * 2, 12);
        const setupIndex = row.index % 2;
        await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(trades)
            .values({
              workspaceId,
              tradingAccountId: accountId,
              strategyId,
              strategyVersionId: versionId,
              setupId: setupIds[setupIndex] as string,
              setupVersionId: setupVersionIds[setupIndex] as string,
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
              // A PRICE plan is recorded above, so the System resolution kind must
              // be `price_exit` — `trades_system_status_consistency_check`
              // rejects a money kind alongside a planned entry/stop.
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
    }

    await seedAccount(accountIds.rich as string, richTrades());
    await seedAccount(accountIds.sparse as string, sparseTrades());
    await seedAccount(accountIds.untagged as string, untaggedTrades());
    // `empty` stays intentionally without a single Trade.

    return { user, accountIds, strategyId: strategy.id };
  } finally {
    await client.end();
  }
}

/** Reads back what the three pillars actually rendered — measured, not asserted. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const pillars: Record<string, unknown> = {};
    for (const node of document.querySelectorAll('[data-insight-pillar]')) {
      const name = node.getAttribute('data-insight-pillar') ?? '';
      const box = node.getBoundingClientRect();
      pillars[name] = {
        status: node.getAttribute('data-insight-status'),
        reason: node.getAttribute('data-insight-reason'),
        statements: [...node.querySelectorAll('[data-insight-statement]')].map((s) =>
          s.getAttribute('data-insight-statement'),
        ),
        headlines: [...node.querySelectorAll('[data-insight-headline]')].map((h) =>
          h.textContent?.trim(),
        ),
        comparisons: [...node.querySelectorAll('[data-insight-comparison]')].map((c) =>
          c.getAttribute('data-insight-comparison'),
        ),
        sample: node.querySelector('[data-insight-sample]')?.textContent?.trim() ?? null,
        coverage: node.querySelector('[data-insight-coverage]')?.textContent?.trim() ?? null,
        nonAdditive: node.querySelector('[data-insight-non-additive]') !== null,
        analytics: node.querySelector('[data-insight-analytics]')?.getAttribute('href') ?? null,
        box: {
          x: Math.round(box.x),
          w: Math.round(box.width),
          h: Math.round(box.height),
        },
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
      };
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overflow: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      pillarCount: document.querySelectorAll('[data-insight-pillar]').length,
      pillars,
      // §33 — proof the whole D3→D7 stack is present in one page.
      sections: [...document.querySelectorAll('[data-dashboard-panel]')].map((n) =>
        n.getAttribute('data-dashboard-panel'),
      ),
      documentHeight: document.documentElement.scrollHeight,
    };
  });
}

const metrics: Record<string, unknown> = {};

async function capture(page: Page, name: string, url: string) {
  const started = Date.now();
  await page.goto(`${BASE}${url}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-insight-pillar]');
  const settledMs = Date.now() - started;
  await page.waitForTimeout(500);
  metrics[name] = { ...(await measure(page)), pageSettledMs: settledMs };
  await page.screenshot({ path: join(OUT, `${name}-page.png`), fullPage: true });
  const section = page.locator('[data-insight-pillar]').first().locator('xpath=../..');
  await section.screenshot({ path: join(OUT, `${name}-section.png`) });
  console.log(`captured ${name} (${settledMs}ms to pillars)`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const fixture = await seed();
  const browser = await chromium.launch();

  const cases: readonly (readonly [string, { width: number; height: number }, 'dark' | 'light'])[] =
    [
      ['desktop-1920-dark', { width: 1920, height: 1080 }, 'dark'],
      ['desktop-1440-dark', { width: 1440, height: 900 }, 'dark'],
      ['desktop-1440-light', { width: 1440, height: 900 }, 'light'],
      ['tablet-768-dark', { width: 768, height: 1024 }, 'dark'],
      ['mobile-390-dark', { width: 390, height: 844 }, 'dark'],
      ['mobile-390-light', { width: 390, height: 844 }, 'light'],
      ['mobile-320-dark', { width: 320, height: 800 }, 'dark'],
    ];

  let ordinal = 0;
  for (const [label, viewport, theme] of cases) {
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

    ordinal += 1;
    const prefix = String(ordinal).padStart(2, '0');
    const rich = `account=${fixture.accountIds.rich}`;
    await capture(page, `${prefix}-${label}-rich`, `/en/app?range=all&unit=r&${rich}`);

    if (label === 'desktop-1440-dark') {
      await capture(
        page,
        `${prefix}b-${label}-sparse`,
        `/en/app?range=all&unit=r&account=${fixture.accountIds.sparse}`,
      );
      await capture(
        page,
        `${prefix}c-${label}-untagged`,
        `/en/app?range=all&unit=r&account=${fixture.accountIds.untagged}`,
      );
      await capture(
        page,
        `${prefix}d-${label}-empty`,
        `/en/app?range=all&unit=r&account=${fixture.accountIds.empty}`,
      );
      await capture(
        page,
        `${prefix}e-${label}-strategy-filtered`,
        `/en/app?range=all&unit=r&${rich}&strategy=${fixture.strategyId}`,
      );
      await capture(page, `${prefix}f-${label}-rich-30d`, `/en/app?range=30d&unit=r&${rich}`);
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
