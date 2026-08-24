import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { tradeExits, trades, tradingAccounts, workspaces } from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

test.skip(!hasE2eDatabase, E2E_SKIP_REASON);

const outputDir = path.join(os.tmpdir(), 'phase-15h2-screenshots');
const calendarTimezone = 'Asia/Bangkok';

function currentCalendarMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: calendarTimezone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Unable to resolve the Phase 15H.2 visual fixture month.');
  }
  return { year, month };
}

function calendarInstant(day: number, hour = 6): Date {
  const { year, month } = currentCalendarMonth();
  // 06:00 UTC is 13:00 in the fixture Account's persisted Asia/Bangkok
  // timezone, safely away from either local-day boundary.
  return new Date(Date.UTC(year, month - 1, day, hour));
}

async function provisionCalendarUser(prefix: string) {
  const { testUrl } = validateTestDatabaseEnvironment();
  return provisionVerifiedUser(testUrl, {
    email: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`,
    password: 'Correct-Horse9!',
    name: 'Calendar Visual Tester',
  });
}

async function seedPopulatedCalendar(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, { schema: { workspaces, tradingAccounts, trades, tradeExits } });

  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('Calendar visual workspace missing.');
    const [account] = await db
      .select({ id: tradingAccounts.id })
      .from(tradingAccounts)
      .where(eq(tradingAccounts.workspaceId, workspace.id));
    if (account === undefined) throw new Error('Calendar visual Account missing.');

    const fixture = [
      { day: 3, actualR: '1.2500', systemR: '1.0000' },
      { day: 5, actualR: '-0.7500', systemR: '-1.0000' },
      { day: 9, actualR: '1.2000', systemR: '1.5000' },
      { day: 9, actualR: '0.8000', pending: true },
      { day: 12, actualR: '0.0000', systemR: '0.0000' },
      { day: 16, actualR: '-1.5000', systemR: '0.5000' },
      { day: 20, actualR: '0.8000', noTrade: true },
      { day: 23, actualR: '1.3000', systemR: '2.1000' },
    ] as const;

    for (const [index, record] of fixture.entries()) {
      const exitedAt = calendarInstant(record.day, 5 + (index % 3));
      const isLoss = record.actualR.startsWith('-');
      const isBreakEven = Number(record.actualR) === 0;
      const systemR = 'systemR' in record ? record.systemR : undefined;
      const systemStatus =
        'pending' in record && record.pending
          ? ('pending' as const)
          : 'noTrade' in record && record.noTrade
            ? ('no_trade' as const)
            : ('resolved' as const);
      const systemFields =
        systemStatus === 'resolved' && systemR !== undefined
          ? {
              systemStatus,
              systemResolutionKind: systemR.startsWith('-')
                ? ('money_stop' as const)
                : Number(systemR) === 0
                  ? ('money_break_even' as const)
                  : ('money_custom' as const),
              systemGrossRInput: systemR,
              systemR,
              systemOutcome: systemR.startsWith('-')
                ? ('loss' as const)
                : Number(systemR) === 0
                  ? ('break_even' as const)
                  : ('win' as const),
              systemExitReason: systemR.startsWith('-')
                ? ('stop_hit' as const)
                : Number(systemR) === 0
                  ? ('break_even_rule' as const)
                  : ('manual_system_valid_exit' as const),
              systemExitedAt: new Date(exitedAt.getTime() + 20 * 60 * 1000),
              systemResolvedAt: new Date(exitedAt.getTime() + 20 * 60 * 1000),
            }
          : systemStatus === 'no_trade'
            ? {
                systemStatus,
                systemExitReason: 'setup_invalidated' as const,
                systemResolvedAt: new Date(exitedAt.getTime() + 20 * 60 * 1000),
              }
            : { systemStatus };

      await db.transaction(async (tx) => {
        const [trade] = await tx
          .insert(trades)
          .values({
            workspaceId: workspace.id,
            tradingAccountId: account.id,
            symbol: `CAL${String(record.day).padStart(2, '0')}${index + 1}`,
            direction: index % 2 === 0 ? 'long' : 'short',
            plannedRiskMinor: 100n,
            plannedRewardMinor: 200n,
            plannedR: '2.0000',
            status: 'closed',
            actualResultMode: 'money',
            actualInitialRiskMinor: 100n,
            enteredAt: new Date(exitedAt.getTime() - 60 * 60 * 1000),
            exitedAt,
            netPnlMinor: isLoss ? -100n : isBreakEven ? 0n : 100n,
            actualR: record.actualR,
            traderOutcome: isLoss ? 'loss' : isBreakEven ? 'break_even' : 'win',
            ...systemFields,
          })
          .returning({ id: trades.id });
        if (trade === undefined) throw new Error('Calendar visual Trade insert failed.');
        await tx.insert(tradeExits).values({
          workspaceId: workspace.id,
          tradeId: trade.id,
          mutationKey: crypto.randomUUID(),
          sequence: 1,
          closedBps: 10_000,
          realizedPnlMinor: isLoss ? -100n : isBreakEven ? 0n : 100n,
          exitedAt,
        });
      });
    }
  } finally {
    await client.end();
  }
}

async function assertNoPageOverflow(page: Page, width: number): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(width + 1);
}

async function capture(locator: Locator, name: string): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.screenshot({ path: path.join(outputDir, `${name}.png`) });
}

test('Phase 15H.2 authenticated premium Dashboard Calendar visual acceptance', async ({ page }) => {
  test.setTimeout(300_000);
  await fs.mkdir(outputDir, { recursive: true });
  await page.addInitScript(() => window.localStorage.setItem('trading-os-theme', 'dark'));

  const emptyUser = await provisionCalendarUser('e2e-calendar-empty');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginAs(page, 'en', emptyUser);
  await page.waitForLoadState('networkidle');
  const emptyCalendar = page.getByTestId('trading-calendar');
  await capture(emptyCalendar.locator('..'), '1440-dashboard-calendar-mostly-empty');

  await page.context().clearCookies();
  const populatedUser = await provisionCalendarUser('e2e-calendar-populated');
  await seedPopulatedCalendar(populatedUser.id);
  await loginAs(page, 'en', populatedUser);
  await page.waitForLoadState('networkidle');

  let calendar = page.getByTestId('trading-calendar');
  await expect(calendar.locator('[data-calendar-tone="positive"]')).not.toHaveCount(0);
  await expect(calendar.locator('[data-calendar-tone="negative"]')).not.toHaveCount(0);
  await expect(calendar.locator('[data-calendar-tone="neutral"]')).not.toHaveCount(0);
  await expect(calendar.locator('[data-calendar-week-summary]')).not.toHaveCount(0);
  await capture(calendar.locator('..'), '1440-dashboard-calendar-populated');

  const systemAxis = calendar.getByRole('radio', { name: 'System' });
  await systemAxis.focus();
  await page.keyboard.press('Space');
  await expect(systemAxis).toBeChecked();
  await expect(calendar.locator('[data-calendar-tone="positive"]')).not.toHaveCount(0);

  const previousMonth = calendar.getByRole('link', { name: 'Previous month' });
  const nextMonth = calendar.getByRole('link', { name: 'Next month' });
  const today = calendar.getByRole('link', { name: 'Today' });
  await expect(previousMonth).toHaveAttribute('href', /view=calendar&month=/);
  await expect(nextMonth).toHaveAttribute('href', /view=calendar&month=/);
  await expect(today).toHaveAttribute('href', '/en/app/trades?view=calendar');

  await calendar.locator('[data-calendar-day]').first().click();
  await expect(page).toHaveURL(/\/app\/trades\?view=log&month=\d{4}-\d{2}&date=\d{4}-\d{2}-\d{2}/);
  await page.goBack();
  await expect(page.getByTestId('trading-calendar')).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844, name: '390-dashboard-calendar-populated' },
    { width: 320, height: 780, name: '320-dashboard-calendar-populated' },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/en/app');
    await page.waitForLoadState('networkidle');
    await assertNoPageOverflow(page, viewport.width);
    calendar = page.getByTestId('trading-calendar');
    await capture(calendar, viewport.name);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/th/app');
  await expect(page.locator('html')).toHaveAttribute('lang', 'th');
  await expect(page.getByTestId('trading-calendar')).toBeVisible();
  await assertNoPageOverflow(page, 390);
});
