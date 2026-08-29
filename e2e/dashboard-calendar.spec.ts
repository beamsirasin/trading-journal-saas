import { expect, test, type Page } from '@playwright/test';
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
import { applyToolbarRange } from './support/dashboard-toolbar';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/*
  §29 — a real routing suite, run SERIALLY.

  Every assertion here is a navigation: a mode change, a month page, a day
  selection, a Trade selection, a Back. Those are App Router client
  transitions against a remote Neon instance, and running them concurrently
  with other specs makes them fail on queueing rather than on behaviour (the
  exact failure mode the 30D assertion in `dashboard.spec.ts` was diagnosed
  down to). CI already pins `workers: 1`; this makes the file honest locally
  too.
*/
test.describe.configure({ mode: 'serial' });

/**
 * Every seeded day lands in ONE calendar month, ~15–22 days ago.
 *
 * Anchoring to "the 10th of the month containing three weeks ago" is what
 * makes this deterministic on every day of the year: seeding at fixed
 * day-offsets from today would straddle a month boundary whenever the suite
 * ran near the start of a month, and the Calendar would then legitimately show
 * an empty grid the assertions did not expect. Every date stays inside the
 * default 90-day range, so the §23 month-range intersection never silently
 * empties the month either.
 *
 * The seeded workspace timezone is the `user_preferences` default, `UTC`, so
 * a 10:00 UTC instant is unambiguously that UTC calendar date.
 */
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

/** The five seeded local dates, named for what each one proves. */
const POSITIVE_ACTUAL_DAY = DATE(0); // +0.50R Actual, -2.00R Gap
const SYSTEM_ONLY_DAY = DATE(1); // a System exit with no Actual exit of its own
const MATCHED_GAP_DAY = DATE(2); // +1.00R Actual, 0.00R Gap, partially closed
const NEGATIVE_ACTUAL_DAY = DATE(3); // -1.00R Actual, -2.00R Gap
const BREAK_EVEN_DAY = DATE(4); // 0.00R Actual, System still pending

async function provisionCalendarUser(prefix: string, seed: boolean) {
  const { testUrl } = validateTestDatabaseEnvironment();
  const email = `${prefix}-${test.info().project.name}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const user = await provisionVerifiedUser(testUrl, {
    email,
    password: 'Correct-Horse9!',
    name: 'E2E Calendar Tester',
  });
  if (seed) await seedCalendarData(user.id);
  return user;
}

async function seedCalendarData(userId: string): Promise<void> {
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
    if (workspace === undefined) throw new Error('Calendar E2E workspace missing');
    const workspaceId = workspace.id;
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspaceId));
    if (account === undefined) throw new Error('Calendar E2E Account missing');

    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('Calendar E2E Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({
        workspaceId,
        strategyId: strategy.id,
        versionNumber: 1,
        name: 'Calendar Momentum v1',
      })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('Calendar E2E Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('Calendar E2E Setup insert failed');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId,
        strategyId: strategy.id,
        strategyVersionId: version.id,
        setupId: setup.id,
        name: 'Calendar Opening Retest',
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('Calendar E2E Setup Version insert failed');

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
    const trader = (exitedAt: Date, actualR: string, outcome: 'win' | 'loss' | 'break_even') => ({
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

    // One transaction per Trade so a multi-leg position's deferred
    // closed-basis-points constraint is checked once, at commit.
    async function insertTrade(
      values: typeof trades.$inferInsert,
      legs: readonly { closedBps: number; exitedAt: Date }[],
    ): Promise<void> {
      await db.transaction(async (tx) => {
        const [row] = await tx.insert(trades).values(values).returning({ id: trades.id });
        if (row === undefined) throw new Error('Calendar E2E Trade missing');
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

    const dayZero = ANCHOR.day(0);
    // The System exit deliberately lands on the NEXT local day: the same Trade
    // belongs to different Calendar days in Actual and in System mode, which
    // is information rather than drift and is what §5's separate axes mean.
    await insertTrade(
      {
        ...framework,
        symbol: 'XAUUSD',
        ...trader(dayZero, '2.0000', 'win'),
        ...system(ANCHOR.day(1), '3.0000', 'win'),
      },
      [{ closedBps: 10_000, exitedAt: dayZero }],
    );
    const dayZeroSecond = new Date(dayZero.getTime() + 2 * 60 * 60 * 1000);
    await insertTrade(
      {
        ...framework,
        symbol: 'EURUSD',
        ...trader(dayZeroSecond, '-1.5000', 'loss'),
        ...system(dayZeroSecond, '-0.5000', 'loss'),
      },
      [{ closedBps: 10_000, exitedAt: dayZeroSecond }],
    );

    // Partially closed, and matched against its own System: two exit legs, one
    // Calendar count, a 0.00R Gap.
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

    const negative = ANCHOR.day(3);
    await insertTrade(
      {
        ...framework,
        symbol: 'GBPUSD',
        ...trader(negative, '-1.0000', 'loss'),
        ...system(negative, '1.0000', 'win'),
      },
      [{ closedBps: 10_000, exitedAt: negative }],
    );

    // Closed, exactly flat, and its System side is still pending: it must
    // appear as an eligible 0.00R day rather than being confused with a date
    // that has no Trades, and its row must keep an unresolved Gap.
    const flat = ANCHOR.day(4);
    await insertTrade({ ...framework, symbol: 'USDJPY', ...trader(flat, '0.0000', 'break_even') }, [
      { closedBps: 10_000, exitedAt: flat },
    ]);
  } finally {
    await client.end();
  }
}

const calendar = (page: Page) => page.locator('[data-dashboard-panel="calendar"]');
const recent = (page: Page) => page.locator('[data-dashboard-panel="recent-trades"]');
const cell = (page: Page, date: string) => page.locator(`[data-calendar-date="${date}"]`);

/** The Calendar month page, at the seeded month, with an explicit range. */
function monthUrl(extra = ''): string {
  return `/en/app?range=all&month=${ANCHOR.month}${extra}`;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('Dashboard Calendar, Day Review and Quick Preview', () => {
  test('desktop: modes, month paging, day selection, Trade preview and Back all live in the URL', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionCalendarUser('e2e-calendar-desktop', true);
    await loginAs(page, 'en', user);
    await page.goto(monthUrl());

    // §1 — both widgets render, side by side, in one section.
    await expect(calendar(page)).toBeVisible();
    await expect(recent(page)).toBeVisible();
    const [calendarBox, recentBox] = await Promise.all([
      calendar(page).boundingBox(),
      recent(page).boundingBox(),
    ]);
    // §23 — they share a top edge, and the Calendar is the narrower of the two
    // (five of twelve columns beside seven).
    expect(Math.round(calendarBox?.y ?? -1)).toBe(Math.round(recentBox?.y ?? -2));
    expect(calendarBox?.width ?? 0).toBeLessThan(recentBox?.width ?? 0);
    await expectNoHorizontalOverflow(page);

    // §2/§3 — the Recent Trades preview, with the Gap on the row and an
    // unresolved System side kept unresolved rather than shown as 0.00R.
    await expect(recent(page).getByText('Actual R').first()).toBeVisible();
    await expect(recent(page).getByText('Gap').first()).toBeVisible();
    await expect(
      recent(page).locator('[data-recent-gap-status="unavailable"]').first(),
    ).toContainText('Pending');

    // §7/§8 — Actual mode: a positive day, a negative day, and a genuinely
    // flat-but-eligible day that is NOT the same thing as an empty date.
    await expect(cell(page, POSITIVE_ACTUAL_DAY)).toHaveAttribute('data-calendar-tone', 'positive');
    await expect(cell(page, POSITIVE_ACTUAL_DAY)).toContainText('+0.50R');
    await expect(cell(page, NEGATIVE_ACTUAL_DAY)).toHaveAttribute('data-calendar-tone', 'negative');
    await expect(cell(page, NEGATIVE_ACTUAL_DAY)).toContainText('-1.00R');
    await expect(cell(page, BREAK_EVEN_DAY)).toHaveAttribute('data-calendar-cell', 'populated');
    await expect(cell(page, BREAK_EVEN_DAY)).toContainText('0.00R');
    // The System-only day carries no Actual exit, so in Actual mode it is an
    // ordinary empty date rather than a 0R day.
    await expect(cell(page, SYSTEM_ONLY_DAY)).toHaveAttribute('data-calendar-cell', 'empty');

    // The Dashboard range control uses the same document-navigation boundary.
    // Since R2B it is the TOOLBAR picker rather than the retired section-local
    // links: each applied change is one Apply, and the canonical filter
    // serializer still owns which defaults are omitted.
    await applyToolbarRange(page, 'Last 30 days');
    await expect(page).toHaveURL((url) => url.searchParams.get('range') === '30d', {
      timeout: 20_000,
    });
    await expect(page).toHaveURL((url) => url.searchParams.get('unit') === 'r');
    await applyToolbarRange(page, 'Last 90 days');
    await expect(page).toHaveURL((url) => url.searchParams.get('range') === '90d', {
      timeout: 20_000,
    });
    await expect(page).toHaveURL((url) => url.searchParams.get('unit') === 'r');
    await applyToolbarRange(page, 'All time');
    await expect(page).toHaveURL((url) => url.searchParams.get('range') === 'all', {
      timeout: 20_000,
    });

    // Restore the explicitly selected seeded month before exercising Calendar
    // state. This is a direct setup load, not a transition retry.
    await page.goto(monthUrl());

    // §5 — switching mode is a URL change, and the axes genuinely differ: the
    // day that was empty in Actual is populated in System.
    await page.waitForLoadState('networkidle');
    await page.locator('[data-calendar-mode-option="system"]').click();
    await expect(page).toHaveURL(/mode=system/, { timeout: 20_000 });
    await expect(page.locator('[data-calendar-mode-option="system"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(cell(page, SYSTEM_ONLY_DAY)).toHaveAttribute('data-calendar-cell', 'populated');
    await expect(cell(page, SYSTEM_ONLY_DAY)).toContainText('+3.00R');

    // The mode survives a full reload — it is not component state.
    await page.reload();
    await expect(page.locator('[data-calendar-mode-option="system"]')).toHaveAttribute(
      'aria-current',
      'page',
    );

    // §14 — Gap mode: relative vocabulary, and a matched day that is neither
    // a win nor a loss.
    await page.waitForLoadState('networkidle');
    await page.locator('[data-calendar-mode-option="gap"]').click();
    await expect(page).toHaveURL(/mode=gap/, { timeout: 20_000 });
    await expect(cell(page, MATCHED_GAP_DAY)).toHaveAttribute('data-calendar-tone', 'neutral');
    await expect(cell(page, POSITIVE_ACTUAL_DAY)).toHaveAttribute('data-calendar-tone', 'negative');
    await expect(cell(page, POSITIVE_ACTUAL_DAY)).toContainText('-2.00R');
    await expect(calendar(page).getByText('Execution Gap')).toBeVisible();

    // §6 — paging the month keeps the mode AND every Dashboard filter.
    await page.waitForLoadState('networkidle');
    await page.locator('[data-calendar-nav="previous"]').click();
    await expect(page).toHaveURL(/month=/, { timeout: 20_000 });
    await expect(page).toHaveURL(/range=all/);
    await expect(page).toHaveURL(/mode=gap/);
    await expect(page).not.toHaveURL(new RegExp(`month=${ANCHOR.month}`));
    await page.locator('[data-calendar-nav="next"]').click();
    await expect(page).toHaveURL(new RegExp(`month=${ANCHOR.month}`), { timeout: 20_000 });

    // Actual is a state transition too; selecting it clears mode while keeping
    // the month and Dashboard filters. Then open a day without a setup reload.
    await page.locator('[data-calendar-mode-option="actual"]').click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('mode'), { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`month=${ANCHOR.month}`));
    await expect(page).toHaveURL(/range=all/);

    // §10 — open a day. The Calendar stays on screen.
    await cell(page, POSITIVE_ACTUAL_DAY).click();
    await expect(page).toHaveURL(new RegExp(`day=${POSITIVE_ACTUAL_DAY}`), {
      timeout: 20_000,
    });
    const review = page.getByRole('dialog');
    await expect(review).toBeVisible();
    await expect(calendar(page)).toBeVisible();
    // §11/§12 — the headline is the clicked square's own figure.
    await expect(review.locator('[data-day-review-headline="actual"]')).toContainText('+0.50R');
    await expect(review.getByText('Eligible Trades')).toBeVisible();
    await expect(review.locator('[data-day-review-row]')).toHaveCount(2);

    // §15/§16 — selecting a Trade opens the Quick Preview beside the day.
    await page.waitForLoadState('networkidle');
    await review.locator('[data-day-review-trade]').first().click();
    await expect(page).toHaveURL(/trade=[0-9a-f-]{36}/, { timeout: 20_000 });
    const preview = page.locator('[data-trade-preview]');
    await expect(preview).toBeVisible();
    // §17 — the three attribution figures lead the Overview.
    const results = preview.locator('[data-trade-preview-results]');
    await expect(results.getByText('Actual R')).toBeVisible();
    await expect(results.getByText('System R')).toBeVisible();
    await expect(results.getByText('Execution Gap')).toBeVisible();

    // A selected Trade is reconstructible from its deep link after reload.
    await page.reload();
    await expect(page).toHaveURL(/trade=[0-9a-f-]{36}/);
    await expect(page.locator('[data-trade-preview]')).toBeVisible();

    // §18 — closing the Trade leaves the Day Review open.
    await page.waitForLoadState('networkidle');
    await page.locator('[data-trade-preview] [data-trade-preview-close]').click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('trade'), { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`day=${POSITIVE_ACTUAL_DAY}`));
    await expect(page.locator('[data-trade-preview]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();

    // §18 — Back traverses the selection states rather than leaving the page.
    await page.goBack();
    await expect(page).toHaveURL(/trade=[0-9a-f-]{36}/, { timeout: 15_000 });
    await expect(page.locator('[data-trade-preview]')).toBeVisible();
    await page.goForward();
    await expect(page).not.toHaveURL(/trade=/, { timeout: 15_000 });

    // §10 — a refresh reconstructs the Day Review from the URL alone.
    await page.reload();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(
      page.getByRole('dialog').locator('[data-day-review-headline="actual"]'),
    ).toContainText('+0.50R');
    await expect(calendar(page)).toBeVisible();
    await expect(cell(page, POSITIVE_ACTUAL_DAY)).toHaveAttribute('aria-current', 'page');

    // §10 — closing the Day Review keeps the Calendar at the same month,
    // mode and filters.
    await page.waitForLoadState('networkidle');
    await page.getByRole('dialog').locator('[data-day-review-close]').click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('day'), { timeout: 20_000 });
    await expect(page).toHaveURL(new RegExp(`month=${ANCHOR.month}`));
    await expect(page).toHaveURL(/range=all/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(calendar(page)).toBeVisible();
    await expect(cell(page, POSITIVE_ACTUAL_DAY)).toBeVisible();
  });

  test('desktop: the Quick Preview shows every exit leg of a partially closed position', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionCalendarUser('e2e-calendar-legs', true);
    await loginAs(page, 'en', user);
    await page.goto(monthUrl());
    await page.waitForLoadState('networkidle');
    await cell(page, MATCHED_GAP_DAY).click();
    await expect(page).toHaveURL(new RegExp(`day=${MATCHED_GAP_DAY}`), { timeout: 20_000 });

    // One position is one Calendar row, however many times it was scaled out.
    const review = page.getByRole('dialog');
    await expect(review.locator('[data-day-review-row]')).toHaveCount(1);
    await expect(review.locator('[data-day-review-row]')).toContainText('NAS100');

    await page.waitForLoadState('networkidle');
    await review.locator('[data-day-review-trade]').first().click();
    await expect(page).toHaveURL(/trade=[0-9a-f-]{36}/, { timeout: 20_000 });
    const preview = page.locator('[data-trade-preview]');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await preview.locator('[data-trade-preview-tab="executions"]').click();
    await expect(preview.locator('[data-trade-preview-exits]')).toHaveAttribute(
      'data-trade-preview-exits',
      '2',
    );
    await expect(preview.getByText('Exit 1')).toBeVisible();
    await expect(preview.getByText('Exit 2')).toBeVisible();
  });

  test('mobile: the Day Review and Quick Preview are sheets, and nothing overflows', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'mobile-chrome', 'Mobile Chrome coverage');
    test.setTimeout(300_000);
    const user = await provisionCalendarUser('e2e-calendar-mobile', true);
    await loginAs(page, 'en', user);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(monthUrl());
      await expect(calendar(page)).toBeVisible();
      await expect(recent(page)).toBeVisible();
      // §1 — stacked, not side by side, and never panned horizontally.
      const [calendarBox, recentBox] = await Promise.all([
        calendar(page).boundingBox(),
        recent(page).boundingBox(),
      ]);
      expect(calendarBox?.y ?? 0).toBeGreaterThan(recentBox?.y ?? 0);
      expect(Math.round(calendarBox?.width ?? 0)).toBeGreaterThan(width - 60);
      await expectNoHorizontalOverflow(page);
      // §24 — the grid stays readable: seven columns, no inner scroll.
      const grid = page.locator('[data-calendar-grid]');
      const gridOverflow = await grid.evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(gridOverflow).toBeLessThanOrEqual(1);
    }

    /*
      §19 — a near-full-height sheet, with the Calendar still behind it.

      Reached by TAPPING a Calendar square, which is the mobile journey this
      section exists to describe. The deep-link-and-refresh path is asserted
      on desktop, where the same URL contract is exercised end to end; here
      what matters is the geometry of the two surfaces and that the Calendar
      survives behind them.
    */
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(monthUrl());
    await page.waitForLoadState('networkidle');
    await cell(page, POSITIVE_ACTUAL_DAY).click();
    await expect(page).toHaveURL(new RegExp(`day=${POSITIVE_ACTUAL_DAY}`), {
      timeout: 20_000,
    });
    const review = page.getByRole('dialog');
    await expect(review).toBeVisible();
    /*
      POLLED, BECAUSE `toBeVisible()` RESOLVES AT ANIMATION FRAME ZERO.

      The Day Review is a `dialog-content`, and its open animation
      (`menu-content-in`, globals.css) starts at `transform: scale(0.95)`. A
      single `boundingBox()` taken the instant the element becomes visible can
      therefore measure 95% of the real width — at a 390px viewport, exactly
      370.5px — which is a measurement of the animation, not of the layout.
      This showed up only under a loaded parallel run, which is the worst way
      for a geometry assertion to fail. Polling asserts the SETTLED geometry
      and keeps the threshold honest rather than lowering it to accommodate a
      mid-animation frame.

      Full-bleed to the viewport edges; the few pixels of slack are the
      scrollbar gutter, not a narrow centred modal.
    */
    await expect
      .poll(async () => (await review.boundingBox())?.width ?? 0, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(374);
    const reviewBox = await review.boundingBox();
    expect(reviewBox?.height ?? 0).toBeLessThan(800);
    await expect(calendar(page)).toBeAttached();
    await expectNoHorizontalOverflow(page);

    // §20 — the Quick Preview is a full-width mobile sheet, not a narrow panel.
    await page.waitForLoadState('networkidle');
    await review.locator('[data-day-review-trade]').first().click();
    await expect(page).toHaveURL(/trade=[0-9a-f-]{36}/, { timeout: 20_000 });
    const preview = page.locator('[data-trade-preview]');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    const previewBox = await preview.boundingBox();
    expect(previewBox?.width ?? 0).toBeGreaterThanOrEqual(374);
    await expectNoHorizontalOverflow(page);

    // Closing the Trade returns to the day, exactly as on desktop.
    await page.waitForLoadState('networkidle');
    await preview.locator('[data-trade-preview-close]').click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('trade'), { timeout: 20_000 });
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('an empty workspace gets intentional empty states, not skeletons or an error', async ({
    page,
  }) => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
    test.skip(test.info().project.name !== 'chromium', 'Desktop Chromium coverage');
    test.setTimeout(300_000);
    const user = await provisionCalendarUser('e2e-calendar-empty', false);
    await loginAs(page, 'en', user);
    await page.goto('/en/app');

    // §28 — Recent Trades says what to do next; the Calendar says the month
    // holds nothing eligible. Neither is an error, and no Day Review is open.
    await expect(recent(page).locator('[data-recent-trades-state="empty"]')).toBeVisible();
    await expect(recent(page).getByRole('link', { name: 'Log a Trade' })).toBeVisible();
    await expect(calendar(page).locator('[data-calendar-state="empty"]')).toBeVisible();
    await expect(calendar(page).getByText('Nothing eligible this month')).toBeVisible();
    await expect(calendar(page).locator('[data-calendar-grid]')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Scoped to the two widgets: Next.js always renders its own empty
    // route-announcer with role="alert", and a page-wide query would match
    // that rather than an application error.
    await expect(calendar(page).getByRole('alert')).toHaveCount(0);
    await expect(recent(page).getByRole('alert')).toHaveCount(0);
    await expect(page.locator('[data-calendar-state="error"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // The month control still works on an empty month.
    await page.waitForLoadState('networkidle');
    await page.locator('[data-calendar-nav="previous"]').click();
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/, { timeout: 20_000 });
    await expect(calendar(page)).toBeVisible();
  });
});
