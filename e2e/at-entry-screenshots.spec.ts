import { expect, test, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import {
  exitPlans,
  setupConditions,
  setups,
  strategies,
  strategySetupVersions,
  strategyVersions,
  workspaces,
} from '../src/server/db/schema';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * AT ENTRY REVIEW CAPTURES — development tooling for a visual review, not a
 * behavioural spec.
 *
 * The pilot's own captures came from a public prototype route a plain script
 * could open. The production route is authenticated, so the capture lives here
 * instead: one provisioned user, one seeded Strategy with a default Exit Plan,
 * and the real `/app/trades/new?timing=at_entry` page at every reviewed width
 * and theme.
 *
 * It is skipped unless `AT_ENTRY_SCREENSHOTS=1`, so ordinary e2e runs never pay
 * for it. Each state is captured twice where it matters: a viewport shot, which
 * is the only honest view of the docked action bar and the sticky save panel,
 * and a full-page shot for the whole reading order.
 */
const ENABLED = process.env.AT_ENTRY_SCREENSHOTS === '1';
const OUT = 'docs/reviews/at-entry-production';
const ROUTE = (locale: 'en' | 'th') => `/${locale}/app/trades/new?timing=at_entry`;

const STRATEGY = 'Golden Breakout';
const SETUP = 'Clean Retest';

test.describe('At Entry production captures', () => {
  test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  test.skip(!ENABLED, 'Set AT_ENTRY_SCREENSHOTS=1 to capture the At Entry review set.');
  test('captures every reviewed state at 1440/1120/390/320 in Light and Dark', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'One engine is enough for a review.');
    test.setTimeout(900_000);
    // Unlimited is the default, and it turns one wrong locator into a hang.
    page.setDefaultTimeout(15_000);
    const { testUrl } = validateTestDatabaseEnvironment();
    const user = await provisionVerifiedUser(testUrl, {
      email: `at-entry-shots-${Date.now()}@example.test`,
      password: 'Correct-Horse9!',
      name: 'At Entry Review',
    });
    await seedStrategyWithExitPlan(user.id);
    await loginAs(page, 'en', user);

    for (const width of [1440, 1120, 390, 320] as const) {
      for (const theme of ['light', 'dark'] as const) {
        for (const state of STATES) {
          // Thai is captured where a long label is most likely to break a
          // layout — the narrowest width — and only for states that need no
          // interaction: every `prepare` below drives the form by its ENGLISH
          // accessible names, which do not exist on the Thai route.
          const thai = state.thai === true && state.prepare === undefined && width === 320;
          for (const locale of thai ? (['en', 'th'] as const) : (['en'] as const)) {
            if (state.widths !== undefined && !state.widths.includes(width)) continue;
            await capture(page, { width, theme, locale, state });
          }
        }
      }
    }
  });
});

interface CaptureState {
  readonly name: string;
  readonly prepare?: (page: Page) => Promise<void>;
  /** Restrict a state to the widths where it says something new. */
  readonly widths?: readonly number[];
  readonly thai?: boolean;
}

const STATES: readonly CaptureState[] = [
  { name: 'blank', thai: true },
  {
    name: 'partial',
    prepare: async (page) => {
      await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
      await clickChoice(page, 'Long');
      await page.getByLabel('Risk at entry').fill('250');
    },
  },
  {
    name: 'validation',
    prepare: async (page) => {
      await clickChoice(page, /Fixed target/);
      await page.getByRole('button', { name: /Trade idea, chart and price levels/ }).click();
      await page.getByLabel('SL price').fill('12..5');
      await page.getByRole('button', { name: 'Save open trade' }).click();
    },
  },
  {
    name: 'no-fixed-target',
    prepare: async (page) => {
      await fillMinimum(page);
      await clickChoice(page, /No fixed target/);
    },
    widths: [1440, 390],
  },
  {
    name: 'actual-risk-different',
    prepare: async (page) => {
      await fillMinimum(page);
      await page.getByRole('button', { name: 'It was different' }).click();
      await page.getByLabel('Actual risk').fill('340');
    },
    widths: [1440, 390],
  },
  {
    name: 'actual-risk-unknown',
    prepare: async (page) => {
      await fillMinimum(page);
      await page.getByRole('button', { name: 'It was different' }).click();
      await page.getByRole('button', { name: "I don't know the amount" }).click();
    },
    widths: [1440, 320],
  },
  {
    name: 'exit-plan-inherited',
    prepare: async (page) => {
      await fillMinimum(page);
      await openAnalysis(page);
      await page.getByLabel('Strategy', { exact: true }).selectOption({ label: STRATEGY });
    },
  },
  {
    name: 'exit-plan-customized',
    prepare: async (page) => {
      await fillMinimum(page);
      await openAnalysis(page);
      await page.getByLabel('Strategy', { exact: true }).selectOption({ label: STRATEGY });
      await page.getByRole('button', { name: 'Customize' }).click();
      await page
        .getByLabel('Your plan for this trade')
        .fill('Half at 1R, then trail beneath each higher low. Close all before the news.');
      await page.getByRole('button', { name: 'Done' }).click();
    },
    widths: [1440, 390],
  },
  {
    name: 'exit-plan-editor',
    prepare: async (page) => {
      await fillMinimum(page);
      await openAnalysis(page);
      await page.getByLabel('Strategy', { exact: true }).selectOption({ label: STRATEGY });
      await page.getByRole('button', { name: 'Choose another' }).click();
    },
    widths: [1440, 390],
  },
  {
    name: 'exit-plan-no-rule',
    prepare: async (page) => {
      await fillMinimum(page);
      await page.getByRole('button', { name: 'No defined exit rule' }).click();
    },
    widths: [1440, 320],
  },
  {
    name: 'analytical-answered',
    prepare: async (page) => {
      await fillMinimum(page);
      await openAnalysis(page);
      await page.getByLabel('Strategy', { exact: true }).selectOption({ label: STRATEGY });
      await page.getByLabel('Setup', { exact: true }).selectOption({ label: SETUP });
      await answerCondition(page, 'Breakout candle closed', 'Met');
      await answerCondition(page, 'Retest held', 'Not met');
      await clickChoice(page, 'High');
      await page.getByRole('button', { name: 'Focused' }).click();
    },
  },
];

async function fillMinimum(page: Page) {
  await page.getByRole('textbox', { name: 'Symbol' }).fill('XAUUSD');
  await clickChoice(page, 'Long');
  await page.getByLabel('Risk at entry').fill('250');
}

async function openAnalysis(page: Page) {
  const toggle = page.locator('#entry-analysis-toggle');
  if (await toggle.isVisible()) await toggle.click();
}

async function clickChoice(page: Page, name: RegExp | string) {
  const radio = page.getByRole('radio', { name, exact: typeof name === 'string' });
  const id = await radio.getAttribute('id');
  if (id === null) throw new Error(`choice "${String(name)}" has no id`);
  await page.locator(`label[for="${id}"]`).click();
}

async function answerCondition(page: Page, label: string, answer: 'Met' | 'Not met') {
  const group = page.getByRole('group', { name: new RegExp(label) });
  const radio = group.getByRole('radio', { name: answer, exact: true });
  const id = await radio.getAttribute('id');
  if (id === null) throw new Error(`condition "${label}" has no id`);
  await group.locator(`label[for="${id}"]`).click();
}

async function capture(
  page: Page,
  options: {
    width: number;
    theme: 'light' | 'dark';
    locale: 'en' | 'th';
    state: CaptureState;
  },
) {
  const { width, theme, locale, state } = options;
  await page.setViewportSize({ width, height: width >= 1120 ? 1000 : 844 });
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem('trading-os-theme', value);
    } catch {
      /* private mode — the page still renders its default */
    }
  }, theme);
  await page.goto(ROUTE(locale));
  await expect(page.locator('[data-at-entry-linear-form]')).toBeVisible();
  if (state.prepare !== undefined) await state.prepare(page);
  await page.waitForTimeout(300);

  const prefix = `${OUT}/${width}-${theme}-${locale}-${state.name}`;
  // The docked action bar and the sticky save panel only exist in a viewport
  // shot; a full-page capture scrolls them out of their own position.
  await page.screenshot({ path: `${prefix}.png` });
  await page.screenshot({ path: `${prefix}-full.png`, fullPage: true });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(
    overflow,
    `${width}px ${theme} ${locale} ${state.name}: horizontal overflow ${overflow}px`,
  ).toBeLessThanOrEqual(1);
}

/** One Strategy, one Setup with Conditions, and a default Exit Plan to inherit. */
async function seedStrategyWithExitPlan(userId: string): Promise<void> {
  const { testUrl } = validateTestDatabaseEnvironment();
  const client = postgres(testUrl, { max: 1 });
  const db = drizzle(client, {
    schema: {
      workspaces,
      strategies,
      strategyVersions,
      setups,
      strategySetupVersions,
      setupConditions,
      exitPlans,
    },
  });
  try {
    const [workspace] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.personalOwnerUserId, userId));
    if (workspace === undefined) throw new Error('At Entry capture workspace missing');

    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: workspace.id })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('At Entry capture Strategy insert failed');
    const [version] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: workspace.id,
        strategyId: strategy.id,
        versionNumber: 1,
        name: STRATEGY,
      })
      .returning({ id: strategyVersions.id });
    if (version === undefined) throw new Error('At Entry capture Version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: version.id })
      .where(eq(strategies.id, strategy.id));

    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: workspace.id, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('At Entry capture Setup insert failed');
    const [setupVersion] = await db
      .insert(strategySetupVersions)
      .values({
        workspaceId: workspace.id,
        strategyVersionId: version.id,
        strategyId: strategy.id,
        setupId: setup.id,
        name: SETUP,
        sortOrder: 0,
      })
      .returning({ id: strategySetupVersions.id });
    if (setupVersion === undefined) throw new Error('At Entry capture Setup Version insert failed');

    await db.insert(setupConditions).values([
      {
        workspaceId: workspace.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        label: 'Breakout candle closed',
        sortOrder: 0,
      },
      {
        workspaceId: workspace.id,
        setupId: setup.id,
        setupVersionId: setupVersion.id,
        label: 'Retest held',
        sortOrder: 1,
      },
    ]);

    await db.insert(exitPlans).values({
      workspaceId: workspace.id,
      strategyId: strategy.id,
      name: 'Scale out at structure',
      instructions: 'Half at 1R, trail the rest beneath each higher low.',
    });
  } finally {
    await client.end();
  }
}
