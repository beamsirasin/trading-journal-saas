import { writeFileSync } from 'node:fs';

import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
  trades,
  tradingAccounts,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { dateRangeApply, draftToolbarRange } from './support/dashboard-toolbar';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/*
  D6B TRANSITION RELIABILITY STRESS GATE.

  Deliberately RETRY-FREE. Every step clicks exactly once and then waits for
  the URL it was promised; a step that does not arrive is recorded as a
  failure rather than clicked again. A retry would both hide the defect and
  perturb it, because a second click starts a second RSC request.

  The report remains useful evidence, but the full-flow test now fails unless
  every one of the 20 flows commits every single-click transition.
*/
test.describe.configure({ mode: 'serial' });

/*
  The 20-flow gate is opt-in because it is intentionally long-running. The
  historical control probe has its own flag and is not part of stabilization.
*/
const STRESS_ENABLED = process.env.D6B_STRESS === '1';
const CONTROL_ENABLED = process.env.D6B_CONTROL === '1';
const STRESS_SKIP_REASON = 'Set D6B_STRESS=1 to run the 20-flow reliability gate.';

const ITERATIONS = Number(process.env.D6B_STRESS_ITERATIONS ?? '20');
/** How long a single client transition is allowed before it counts as stalled. */
const TRANSITION_BUDGET_MS = 12_000;

function seedAnchor(): { readonly month: string; readonly day: (offset: number) => Date } {
  const now = new Date();
  const back = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 20));
  const year = back.getUTCFullYear();
  const month = back.getUTCMonth();
  return {
    month: `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`,
    day: (offset: number) => new Date(Date.UTC(year, month, 10 + offset, 10)),
  };
}

const ANCHOR = seedAnchor();
const DATE = (offset: number) => ANCHOR.day(offset).toISOString().slice(0, 10);
const POSITIVE_ACTUAL_DAY = DATE(0);
const MATCHED_GAP_DAY = DATE(2);

async function seedStressData(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
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
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('stress workspace missing');
    const workspaceId = workspace.id;
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    if (account === undefined) throw new Error('stress account missing');

    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('stress strategy missing');
    const [version] = await db
      .insert(strategyVersions)
      .values({ workspaceId, strategyId: strategy.id, versionNumber: 1, name: 'Stress v1' })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('stress version missing');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('stress setup missing');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        name: 'Stress Retest',
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('stress setup version missing');

    const framework = {
      workspaceId,
      tradingAccountId: account.id,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      setupVersionId: setupVersion.id,
      direction: 'long' as const,
      plannedEntry: '100.0000000000',
      plannedStop: '99.0000000000',
      plannedTarget: '102.0000000000',
      plannedR: '2.0000',
    };
    const trader = (exitedAt: Date, actualR: string, outcome: 'win' | 'loss') => ({
      status: 'closed' as const,
      actualResultMode: 'money' as const,
      actualEntry: '100.0000000000',
      actualInitialStop: '99.0000000000',
      actualInitialRiskMinor: 100n,
      enteredAt: new Date(exitedAt.getTime() - 60 * 60 * 1000),
      actualExit: '101.0000000000',
      netPnlMinor: BigInt(Math.round(Number(actualR) * 100)),
      exitedAt,
      actualR,
      traderOutcome: outcome,
    });
    const system = (systemExitedAt: Date, systemR: string, outcome: 'win' | 'loss') => ({
      systemStatus: 'resolved' as const,
      systemResolutionKind: 'price_exit' as const,
      systemExitPrice: '102.0000000000',
      systemExitedAt,
      systemExitReason: 'target_hit' as const,
      systemResolvedAt: systemExitedAt,
      systemR,
      systemOutcome: outcome,
    });

    async function insertTrade(
      values: typeof trades.$inferInsert,
      legs: readonly { closedBps: number; exitedAt: Date }[],
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = await tx.insert(trades).values(values).returning({ id: trades.id });
        if (row === undefined) throw new Error('stress trade missing');
        let sequence = 0;
        for (const leg of legs) {
          sequence += 1;
          await tx.insert(tradeExits).values({
            workspaceId,
            tradeId: row.id,
            mutationKey: crypto.randomUUID(),
            sequence,
            closedBps: leg.closedBps,
            exitPrice: values.actualExit ?? null,
            realizedPnlMinor: values.netPnlMinor ?? null,
            exitedAt: leg.exitedAt,
          });
        }
      });
    }

    const first = ANCHOR.day(0);
    await insertTrade(
      {
        ...framework,
        symbol: 'XAUUSD',
        ...trader(first, '2.0000', 'win'),
        ...system(ANCHOR.day(1), '3.0000', 'win'),
      },
      [{ closedBps: 10_000, exitedAt: first }],
    );
    const second = new Date(first.getTime() + 2 * 60 * 60 * 1000);
    await insertTrade(
      {
        ...framework,
        symbol: 'EURUSD',
        ...trader(second, '-1.5000', 'loss'),
        ...system(second, '-0.5000', 'loss'),
      },
      [{ closedBps: 10_000, exitedAt: second }],
    );
    const matched = ANCHOR.day(2);
    await insertTrade(
      {
        ...framework,
        symbol: 'NAS100',
        ...trader(matched, '1.0000', 'win'),
        ...system(matched, '1.0000', 'win'),
      },
      [
        { closedBps: 6_000, exitedAt: new Date(matched.getTime() - 60 * 60 * 1000) },
        { closedBps: 4_000, exitedAt: matched },
      ],
    );
  } finally {
    await client.end();
  }
}

interface RscRecord {
  readonly url: string;
  status: number | null;
  finishedAtMs: number | null;
  failure: string | null;
  readonly startedAtMs: number;
}

interface Probe {
  readonly rsc: RscRecord[];
  readonly console: string[];
  readonly errors: string[];
  /**
   * Every request that has started and not yet finished.
   *
   * A transition that never commits while its RSC payload has already arrived
   * points at something ELSE the client is still waiting on — a lazily loaded
   * client chunk being the obvious candidate. This is how that shows up.
   */
  readonly pending: Map<string, number>;
}

function attachProbe(page: Page): Probe {
  const probe: Probe = { rsc: [], console: [], errors: [], pending: new Map() };
  page.on('request', (request) => probe.pending.set(request.url(), Date.now()));
  const settle = (url: string) => probe.pending.delete(url);
  page.on('requestfinished', (request) => settle(request.url()));
  page.on('requestfailed', (request) => settle(request.url()));
  page.on('request', (request) => {
    if (!request.url().includes('_rsc=')) return;
    probe.rsc.push({
      url: request.url(),
      status: null,
      finishedAtMs: null,
      failure: null,
      startedAtMs: Date.now(),
    });
  });
  page.on('response', (response) => {
    if (!response.url().includes('_rsc=')) return;
    const record = [...probe.rsc]
      .reverse()
      .find((entry: RscRecord) => entry.url === response.url());
    if (record === undefined) return;
    record.status = response.status();
    // `finished()` resolves when the RESPONSE BODY completes — the one signal
    // that separates "the server answered" from "the stream closed".
    void response
      .finished()
      .then(() => {
        record.finishedAtMs = Date.now();
      })
      .catch((error: unknown) => {
        record.failure = String(error).slice(0, 120);
      });
  });
  page.on('requestfailed', (request) => {
    if (!request.url().includes('_rsc=')) return;
    const record = [...probe.rsc].reverse().find((entry: RscRecord) => entry.url === request.url());
    if (record !== undefined) record.failure = request.failure()?.errorText ?? 'failed';
  });
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      probe.console.push(`${message.type()}: ${message.text().slice(0, 200)}`);
    }
  });
  page.on('pageerror', (error) => probe.errors.push(error.message.slice(0, 200)));
  return probe;
}

interface StepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly from: string;
  readonly href: string | null;
  readonly to: string;
  readonly rsc?: RscRecord | undefined;
  readonly dom?: unknown;
  readonly pending?: unknown;
}

/**
 * One click, one expectation, NO retry.
 *
 * `prepare` runs BEFORE the clock starts. It exists for the R2B toolbar
 * picker, whose applied change is reached by opening a panel and drafting a
 * preset first — both of which are deliberately NOT transitions. Timing them
 * would measure a popover opening and report it as routing latency.
 */
async function step(
  page: Page,
  probe: Probe,
  name: string,
  link: Locator,
  expected: (url: URL) => boolean,
  prepare?: () => Promise<void>,
): Promise<StepResult> {
  if (prepare !== undefined) await prepare();
  const from = page.url();
  const href = await link.getAttribute('href');
  const rscBefore = probe.rsc.length;
  const started = Date.now();
  await link.click({ timeout: 10_000 });

  let ok = false;
  while (Date.now() - started < TRANSITION_BUDGET_MS) {
    if (expected(new URL(page.url()))) {
      ok = true;
      break;
    }
    await page.waitForTimeout(100);
  }
  const ms = Date.now() - started;
  const rsc = probe.rsc.slice(rscBefore).find((entry) => !entry.url.includes('/app/trades'));

  const dom = ok
    ? undefined
    : await page.evaluate(() => ({
        bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
        bodyInert: document.body.hasAttribute('inert'),
        openDialogs: document.querySelectorAll(
          '[data-slot="dialog-content"],[data-slot="sheet-content"]',
        ).length,
        ariaHiddenOnMain: document.querySelector('main')?.getAttribute('aria-hidden') ?? null,
        activeElement: document.activeElement?.getAttribute('data-day-review-trade') ?? null,
      }));
  const pending = ok
    ? undefined
    : [...probe.pending.entries()]
        .filter(([, at]) => at >= started)
        .map(([url, at]) => ({ url: url.slice(0, 160), pendingForMs: Date.now() - at }));

  return { step: name, ok, ms, from, href, to: page.url(), rsc, dom, pending };
}

/** A history traversal, measured the same way a click is — no retry. */
async function historyStep(
  page: Page,
  name: string,
  move: () => Promise<unknown>,
  expected: (url: URL) => boolean,
): Promise<StepResult> {
  const from = page.url();
  const started = Date.now();
  await move();
  let ok = false;
  while (Date.now() - started < TRANSITION_BUDGET_MS) {
    if (expected(new URL(page.url()))) {
      ok = true;
      break;
    }
    await page.waitForTimeout(100);
  }
  return { step: name, ok, ms: Date.now() - started, from, href: null, to: page.url() };
}

/**
 * CONTROL: is the stall specific to the D6B Calendar, to the Dashboard route,
 * or to every route behind the same proxy?
 *
 * Each iteration does a full document load and then exactly one navigation —
 * the shape every failure so far has had. `range->30d` is the Dashboard's own
 * pre-D6B control (it predates this phase and has its own history of being
 * slow to settle); `accounts->new` is a plain, non-streaming page reached
 * through the identical locale proxy.
 */
test('control: first navigation after a document load, Dashboard vs a plain route', async ({
  page,
}) => {
  test.skip(!CONTROL_ENABLED, 'Historical diagnostic only — set D6B_CONTROL=1 to run.');
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
  test.setTimeout(20 * 60_000);

  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `e2e-control-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'E2E Control',
  });
  await loginAs(page, 'en', user);
  const probe = attachProbe(page);
  const results: StepResult[] = [];

  for (let iteration = 0; iteration < 10; iteration += 1) {
    await page.goto('/en/app');
    await page.waitForLoadState('networkidle');
    results.push(
      await step(
        page,
        probe,
        'dashboard:range->30d',
        dateRangeApply(page),
        (url) => url.searchParams.get('range') === '30d',
        () => draftToolbarRange(page, 'Last 30 days'),
      ),
    );

    // Same page, PATHNAME navigation — the discriminator against the
    // search-param-only transitions above.
    await page.goto('/en/app');
    await page.waitForLoadState('networkidle');
    results.push(
      await step(
        page,
        probe,
        'dashboard:->analytics',
        page.getByRole('link', { name: /View full analytics/i }),
        (url) => url.pathname.includes('/app/analytics'),
      ),
    );

    // A search-param-only navigation on a DIFFERENT route: separates
    // "search-param navigations stall" from "the Dashboard route stalls".
    await page.goto('/en/app/trades');
    await page.waitForLoadState('networkidle');
    results.push(
      await step(
        page,
        probe,
        'trades:view->calendar',
        page.getByRole('link', { name: 'Calendar' }).first(),
        (url) => url.searchParams.get('view') === 'calendar',
      ),
    );

    await page.goto('/en/app/accounts');
    await page.waitForLoadState('networkidle');
    results.push(
      await step(
        page,
        probe,
        'accounts:->new',
        page.getByRole('link', { name: 'Create account' }).first(),
        (url) => url.pathname.includes('/accounts/new'),
      ),
    );
  }

  const byStep = new Map<string, { total: number; failed: number; slowest: number }>();
  for (const result of results) {
    const bucket = byStep.get(result.step) ?? { total: 0, failed: 0, slowest: 0 };
    bucket.total += 1;
    if (!result.ok) bucket.failed += 1;
    bucket.slowest = Math.max(bucket.slowest, result.ms);
    byStep.set(result.step, bucket);
  }
  writeFileSync(
    process.env.D6B_CONTROL_REPORT ?? 'd6b-control-report.json',
    `${JSON.stringify({ byStep: Object.fromEntries(byStep), failures: results.filter((r) => !r.ok) }, null, 2)}\n`,
    'utf8',
  );
  console.log('CONTROL DONE');
});

test('D6B transition stress: 20 iterations, single click per transition, no retry', async ({
  page,
}) => {
  test.skip(!STRESS_ENABLED, STRESS_SKIP_REASON);
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
  test.setTimeout(30 * 60_000);

  const { testUrl } = validateTestDatabaseEnvironment();
  const user = await provisionVerifiedUser(testUrl, {
    email: `e2e-stress-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'E2E Stress',
  });
  await seedStressData(user.id);
  await loginAs(page, 'en', user);

  const probe = attachProbe(page);
  const base = `/en/app?range=all&month=${ANCHOR.month}`;
  const results: StepResult[] = [];
  const flowOutcomes: boolean[] = [];

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    const flowStart = results.length;
    await page.goto(base);
    await page.waitForLoadState('networkidle');

    results.push(
      await step(
        page,
        probe,
        'range->30d',
        dateRangeApply(page),
        (url) => url.searchParams.get('range') === '30d',
        () => draftToolbarRange(page, 'Last 30 days'),
      ),
    );
    results.push(
      await step(
        page,
        probe,
        'range->90d',
        dateRangeApply(page),
        (url) => url.searchParams.get('range') === '90d',
        () => draftToolbarRange(page, 'Last 90 days'),
      ),
    );
    results.push(
      await step(
        page,
        probe,
        'range->all',
        dateRangeApply(page),
        (url) => url.searchParams.get('range') === 'all',
        () => draftToolbarRange(page, 'All time'),
      ),
    );

    // Range changes intentionally use the filter serializer's established
    // contract, which does not carry Calendar state. Restore the explicit
    // seeded month as setup for the Calendar half of this flow.
    await page.goto(base);
    await page.waitForLoadState('networkidle');

    results.push(
      await step(
        page,
        probe,
        'mode->system',
        page.locator('[data-calendar-mode-option="system"]'),
        (url) => url.searchParams.get('mode') === 'system',
      ),
    );
    results.push(
      await step(
        page,
        probe,
        'mode->gap',
        page.locator('[data-calendar-mode-option="gap"]'),
        (url) => url.searchParams.get('mode') === 'gap',
      ),
    );
    results.push(
      await step(
        page,
        probe,
        'month->previous',
        page.locator('[data-calendar-nav="previous"]'),
        (url) => url.searchParams.get('month') !== ANCHOR.month,
      ),
    );
    results.push(
      await step(
        page,
        probe,
        'month->next',
        page.locator('[data-calendar-nav="next"]'),
        (url) => url.searchParams.get('month') === ANCHOR.month,
      ),
    );

    results.push(
      await step(
        page,
        probe,
        'mode->actual',
        page.locator('[data-calendar-mode-option="actual"]'),
        (url) => !url.searchParams.has('mode'),
      ),
    );

    const dayOfInterest = iteration % 2 === 0 ? MATCHED_GAP_DAY : POSITIVE_ACTUAL_DAY;
    results.push(
      await step(
        page,
        probe,
        'day->open',
        page.locator(`[data-calendar-date="${dayOfInterest}"]`),
        (url) => url.searchParams.get('day') === dayOfInterest,
      ),
    );

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    results.push(
      await step(
        page,
        probe,
        'trade->open',
        dialog.locator('[data-day-review-trade]').first(),
        (url) => url.searchParams.has('trade'),
      ),
    );

    // The selected Trade deep link must reconstruct the preview after a full
    // document reload; URL presence alone is not enough.
    await page.reload();
    await expect(page.locator('[data-trade-preview]')).toBeVisible();

    if (page.url().includes('trade=')) {
      results.push(
        await step(
          page,
          probe,
          'trade->close',
          page.locator('[data-trade-preview] [data-trade-preview-close]'),
          (url) => !url.searchParams.has('trade'),
        ),
      );
    }

    /*
      History traversal follows the same selection states created by the
      document navigations. Both directions remain client-owned browser
      history operations and must still commit.
    */
    results.push(
      await historyStep(
        page,
        'back->trade',
        () => page.goBack(),
        (url) => url.searchParams.has('trade'),
      ),
    );
    results.push(
      await historyStep(
        page,
        'forward->no-trade',
        () => page.goForward(),
        (url) => !url.searchParams.has('trade'),
      ),
    );

    if (page.url().includes('day=')) {
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('dialog')).toBeVisible();

      /*
        Alternate the two accessible overlay journeys after a selected-day
        reload: Escape exercises the button-semantic dismissal path; the Trade
        row and footer exercise ordinary document-navigation anchors.
      */
      if (iteration % 2 === 1) {
        results.push(
          await historyStep(
            page,
            'after-reload:escape->close-day',
            () => page.keyboard.press('Escape'),
            (url) => !url.searchParams.has('day'),
          ),
        );
      } else {
        results.push(
          await step(
            page,
            probe,
            'after-reload:trade->open',
            page.getByRole('dialog').locator('[data-day-review-trade]').first(),
            (url) => url.searchParams.has('trade'),
          ),
        );
        if (page.url().includes('trade=')) {
          results.push(
            await step(
              page,
              probe,
              'after-reload:trade->close',
              page.locator('[data-trade-preview] [data-trade-preview-close]'),
              (url) => !url.searchParams.has('trade'),
            ),
          );
        }
      }
    }

    if (page.url().includes('day=')) {
      results.push(
        await step(
          page,
          probe,
          'day->close',
          page.getByRole('dialog').locator('[data-day-review-close]'),
          (url) => !url.searchParams.has('day'),
        ),
      );
    }

    flowOutcomes.push(results.slice(flowStart).every((result) => result.ok));
  }

  const byStep = new Map<string, { total: number; failed: number; slowest: number }>();
  for (const result of results) {
    const bucket = byStep.get(result.step) ?? { total: 0, failed: 0, slowest: 0 };
    bucket.total += 1;
    if (!result.ok) bucket.failed += 1;
    bucket.slowest = Math.max(bucket.slowest, result.ms);
    byStep.set(result.step, bucket);
  }
  const failed = results.filter((result) => !result.ok).length;
  const passedFlows = flowOutcomes.filter(Boolean).length;
  const report = {
    iterations: ITERATIONS,
    flows: `${passedFlows}/${ITERATIONS}`,
    committed: `${results.length - failed}/${results.length}`,
    byStep: Object.fromEntries(byStep),
    failures: results.filter((result) => !result.ok),
    console: probe.console.slice(0, 30),
    pageErrors: probe.errors.slice(0, 30),
  };
  writeFileSync(
    process.env.D6B_STRESS_REPORT ?? 'd6b-stress-report.json',
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(`STRESS TOTAL ${results.length - failed}/${results.length} transitions committed`);
  expect(passedFlows, JSON.stringify(report.failures, null, 2)).toBe(ITERATIONS);
  expect(failed, JSON.stringify(report.failures, null, 2)).toBe(0);
});
