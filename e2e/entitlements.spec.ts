import { expect, test, type Page } from '@playwright/test';

import { validateTestDatabaseEnvironment } from '../scripts/test-database-safety.mjs';
import { loginAs } from './support/authenticate';
import { E2E_SKIP_REASON, hasE2eDatabase } from './support/env';
import { provisionVerifiedUser } from './support/provision-user';

/**
 * Phase 3C trial entitlements and account limits — deterministic database
 * fixtures only (`provisionVerifiedUser`'s `entitlement`/`additionalAccounts`
 * options), never a mocked clock or a real 7-day wait. Every test provisions
 * its own fresh user, matching `e2e/accounts.spec.ts`'s own reasoning: this
 * suite's create/archive/restore mutations must never bleed into another
 * test's state under Playwright's `fullyParallel: true`.
 *
 * Locked plan decision (correcting the earlier starter/pro/elite 1/3/10
 * draft): the trial is a fixed 1-account allowance (never the highest
 * plan's), and paid limits are starter=1, trader=5, professional=15. Tests
 * here that want real trial semantics pass `entitlement: {}` explicitly —
 * `provisionVerifiedUser`'s default (entitlement omitted entirely) seeds an
 * active Professional plan instead, for every OTHER spec file that creates
 * several accounts without knowing entitlements exist.
 */
const VALID_TEST_PASSWORD = 'Correct-Horse9!';

/**
 * `test.info().project.name` (chromium/mobile-chrome) is folded into the
 * address purely for debuggability when inspecting the disposable test
 * database — the actual uniqueness guarantee is the timestamp + random
 * suffix, which already rules out a collision regardless of which project
 * or how many tests run concurrently.
 */
function uniqueEmail(labelPrefix: string): string {
  const projectName = test.info().project.name;
  return `${labelPrefix}-${projectName}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

async function provisionUser(
  labelPrefix: string,
  options: Parameters<typeof provisionVerifiedUser>[2] = {},
) {
  const { testUrl } = validateTestDatabaseEnvironment();
  return provisionVerifiedUser(
    testUrl,
    {
      email: uniqueEmail(labelPrefix),
      password: VALID_TEST_PASSWORD,
      name: 'E2E Entitlements Tester',
    },
    { onboarded: true, ...options },
  );
}

async function createAccountViaUI(page: Page, name: string): Promise<void> {
  await page.goto('/en/app/accounts/new');
  await page.getByLabel('Trading account name').fill(name);
  await page.getByLabel('Starting balance').fill('1000');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/status=created$/);
}

test.describe('trial entitlements and account limits', () => {
  test.beforeEach(() => {
    test.skip(!hasE2eDatabase, E2E_SKIP_REASON);
  });

  test('shows the trial banner with the full-feature 7-day/1-account summary and days remaining', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-banner', { entitlement: {} });
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    const banner = page.getByRole('region', { name: 'Trial status' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Free trial');
    await expect(banner).toContainText(
      'Your 7-day full-feature trial includes 1 active trading account.',
    );
    await expect(banner).toContainText('days remaining');
    await expect(banner.getByRole('link', { name: 'View plans' })).toBeVisible();
  });

  test('account usage starts at 1/1 during the trial and a second account is rejected', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-trial-limit', { entitlement: {} });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('1 of 1 trading accounts used')).toBeVisible();
    await expect(page.getByText('Account limit reached')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    // A direct submission to /app/accounts/new is rejected server-side
    // rather than merely hidden client-side — no form is rendered at all.
    // Scoped to the page's own "Create unavailable" region: the persistent
    // app-shell trial banner (still visible while trialing, even at the
    // limit) renders its own separate "View plans" link, so an unscoped
    // `getByRole('link', { name: 'View plans' })` here would match two.
    await page.goto('/en/app/accounts/new');
    const blockedRegion = page.getByRole('region', { name: 'Create unavailable' });
    await expect(blockedRegion).toBeVisible();
    await expect(
      blockedRegion.getByText("You've used your plan's active trading account limit."),
    ).toBeVisible();
    await expect(
      blockedRegion.getByText('Additional accounts require the Trader or Professional plan.'),
    ).toBeVisible();
    await expect(blockedRegion.getByRole('link', { name: 'Back to accounts' })).toBeVisible();
    await expect(blockedRegion.getByRole('link', { name: 'View plans' })).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toHaveCount(0);
  });

  test('archiving an account below the Trader limit makes Create available again', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-archive-frees-slot', {
      entitlement: { status: 'active', planKey: 'trader', trialEndsAt: null },
      additionalAccounts: 4,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('5 of 5 trading accounts used')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    await page
      .getByRole('region', { name: 'Additional Account 1' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await page.getByRole('button', { name: 'Archive account' }).click();

    await expect(page.getByText('4 of 5 trading accounts used')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();

    await createAccountViaUI(page, 'Freshly Allowed Account');
    await expect(page.getByRole('region', { name: 'Freshly Allowed Account' })).toBeVisible();
  });

  test('restoring an archived account is blocked once it would exceed the Starter limit', async ({
    page,
  }) => {
    // Starter plan (limit 1), already at its limit with the seed account —
    // an archived second account exists but restoring it would push the
    // workspace to 2 active accounts, over the plan's allowance.
    const user = await provisionUser('e2e-entitlements-restore-blocked', {
      entitlement: { status: 'active', planKey: 'starter', trialEndsAt: null },
      additionalArchivedAccounts: 1,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByText('1 of 1 trading accounts used')).toBeVisible();

    const archivedRegion = page.getByRole('region', { name: 'Archived Account 1' });
    await expect(archivedRegion).toBeVisible();
    await expect(archivedRegion.getByRole('button', { name: 'Restore' })).toBeDisabled();
    await expect(
      archivedRegion.getByText("You've used your plan's active trading account limit."),
    ).toBeVisible();
  });

  test('an expired trial preserves existing accounts and blocks only create/restore', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-expired', {
      entitlement: { status: 'trialing', trialEndsAt: new Date(Date.now() - 60_000) },
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    const banner = page.getByRole('region', { name: 'Trial status' });
    await expect(banner).toContainText('Your trial has expired');

    await page.goto('/en/app/accounts');
    await expect(
      page.getByRole('region', { name: 'Main Trading Account' }).getByRole('heading', {
        name: 'Main Trading Account',
      }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    // Editing is also blocked while read-only — `updateTradingAccount`
    // enforces `authorizeWorkspaceMutation(..., 'ordinary_write')` under lock
    // exactly like create/restore, so Edit must not be offered as a live
    // control the server is certain to reject (Phase 05C). Set-active and
    // Archive remain unaffected — neither is gated by subscription status.
    const mainAccountRegion = page.getByRole('region', { name: 'Main Trading Account' });
    await expect(mainAccountRegion.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await expect(mainAccountRegion.getByRole('link', { name: 'Edit' })).toHaveCount(0);

    await page.goto('/en/app/accounts/new');
    await expect(page.getByText('Create unavailable')).toBeVisible();
  });

  test('an over-limit Starter workspace preserves all accounts and blocks create/restore with a clear notice', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-over-limit', {
      entitlement: { status: 'active', planKey: 'starter', trialEndsAt: null },
      additionalAccounts: 2,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app');
    await expect(page.getByRole('region', { name: 'Trial status' })).toContainText(
      "This workspace is over its plan's account limit",
    );

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('region', { name: 'Main Trading Account' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Additional Account 1' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Additional Account 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  });

  test('the plan page shows Starter/Trader/Professional with locked prices and real checkout options', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-plan-page', { entitlement: {} });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/plan');
    // Proves the destination, not just the heading: a proxy-level bounce
    // back to /login would otherwise only surface as "heading not found",
    // which is indistinguishable from a genuine rendering bug.
    await expect(page).toHaveURL(/\/en\/app\/plan$/);
    await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
    await expect(
      page.getByText(
        'All plans include the same features and analytics. Plans differ only by how many active trading accounts you can keep.',
      ),
    ).toBeVisible();

    const expectations: Array<[string, string]> = [
      ['Starter', '$5.00 / month'],
      ['Trader', '$9.00 / month'],
      ['Professional', '$15.00 / month'],
    ];
    for (const [planName, price] of expectations) {
      await expect(page.getByRole('heading', { name: planName })).toBeVisible();
      await expect(page.getByText(price)).toBeVisible();
    }
    // No stale draft plan names remain.
    await expect(page.getByRole('heading', { name: 'Pro', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Elite', exact: true })).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'Choose plan' })).toHaveCount(3);
  });

  test('the public pricing page shows the same Starter/Trader/Professional 1/5/15 limits and identical feature lists', async ({
    page,
  }) => {
    await page.goto('/en/pricing');
    // `/pricing`'s own section heading is "Choose by how many accounts you
    // trade" (`pricingPage.sectionTitle`) — distinct from the landing page's
    // "Three plans, one free trial" (`pricing.title`), which labels the SAME
    // `PricingSection` component when it renders on `/`. Asserting the wrong
    // page's heading here made this locator match zero elements.
    const pricing = page.getByRole('region', { name: /choose by how many accounts/i });
    await expect(pricing).toBeVisible();

    // Exactly one trial presentation, exactly three paid plan cards. Scoped
    // to `pricing`, not `page`: the page's own intro paragraph
    // (`pricingPage.description`) separately mentions the trial in
    // different wording, so an unscoped match risks coincidentally
    // colliding with (or missing) that other sentence.
    await expect(pricing.getByText('Try every feature free for 7 days')).toBeVisible();
    await expect(pricing.getByRole('heading', { level: 3 })).toHaveCount(3);

    const expectations: Array<[name: string, limit: string, price: string]> = [
      ['Starter', '1', '$5.00 / month'],
      ['Trader', '5', '$9.00 / month'],
      ['Professional', '15', '$15.00 / month'],
    ];
    for (const [planName, limit, price] of expectations) {
      await expect(pricing.getByRole('heading', { name: planName, exact: true })).toBeVisible();
      await expect(pricing.getByText(price)).toBeVisible();
      await expect(pricing.getByText(limit, { exact: true })).toBeVisible();
    }
    await expect(pricing.getByText(/VAT/i)).toHaveCount(0);

    // Every shared feature string appears exactly once per plan card —
    // three cards, so exactly three occurrences each. A per-plan feature
    // list divergence (the old pro/elite design) would break this count.
    const sharedFeatures = ['Unlimited strategies', 'Unlimited trade history', 'All analytics'];
    for (const feature of sharedFeatures) {
      await expect(pricing.getByText(feature, { exact: true })).toHaveCount(3);
    }

    // No plan CTA leads to a checkout — every card links to real
    // registration instead, never a purchase flow.
    for (const id of ['starter', 'trader', 'professional']) {
      const card = pricing.locator(`[aria-labelledby="plan-${id}-name"]`);
      await expect(card.getByRole('link')).toHaveAttribute(
        'href',
        new RegExp(`/app/checkout\\?plan=${id}&currency=USD$`),
      );
    }
  });

  test('trial banner and plan page render correctly in Thai', async ({ page }) => {
    const user = await provisionUser('e2e-entitlements-th', { entitlement: {} });
    await loginAs(page, 'th', user);

    await page.goto('/th/app');
    const banner = page.getByRole('region', { name: 'สถานะการทดลองใช้' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('ทดลองใช้ฟรี');
    await expect(banner).toContainText(
      'ทดลองใช้ทุกฟีเจอร์ 7 วัน พร้อมบัญชีเทรดที่ใช้งานอยู่ 1 บัญชี',
    );

    await page.goto('/th/app/plan');
    await expect(page).toHaveURL(/\/th\/app\/plan$/);
    await expect(page.getByRole('heading', { name: 'แผนและการเรียกเก็บเงิน' })).toBeVisible();
  });

  test('no horizontal overflow at a 320px viewport with the trial banner and usage summary visible', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-mobile-320', { entitlement: {} });
    await page.setViewportSize({ width: 320, height: 720 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(page.getByRole('region', { name: 'Trial status' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('when the entitlement snapshot is unavailable, Create and Restore fail closed while existing accounts stay usable', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-unavailable', {
      omitEntitlementRow: true,
      additionalArchivedAccounts: 1,
    });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');

    // A named, accessible region rather than one long exact-text locator —
    // the SAME "couldn't check this workspace's plan" sentence also appears
    // in the Create-button's own reason paragraph AND in each archived
    // account's Restore-blocked explanation, so a bare, unscoped
    // `getByText(...)` on this sentence matches three elements at once.
    const unavailableRegion = page.getByRole('status', {
      name: 'Account entitlement unavailable',
    });
    await expect(unavailableRegion).toBeVisible();
    await expect(unavailableRegion).toContainText(
      "We couldn't check this workspace's plan right now. Please try again in a moment.",
    );

    // Create is unavailable.
    await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();

    // Existing accounts — active and archived — remain fully visible.
    await expect(page.getByRole('region', { name: 'Main Trading Account' })).toBeVisible();
    const archivedRegion = page.getByRole('region', { name: 'Archived Account 1' });
    await expect(archivedRegion).toBeVisible();

    // Restore is disabled with an accessible explanation, not merely a
    // color change.
    const restoreButton = archivedRegion.getByRole('button', { name: 'Restore' });
    await expect(restoreButton).toBeDisabled();
    const describedById = await restoreButton.getAttribute('aria-describedby');
    expect(describedById).not.toBeNull();
    await expect(page.locator(`#${describedById}`)).toContainText(
      "We couldn't check this workspace's plan right now.",
    );

    // Editing the existing active account is also blocked while the
    // entitlement snapshot is unavailable — `updateTradingAccount` fails
    // closed on a `null` entitlement exactly like create/restore (Phase 05C:
    // the UI must not offer Edit as a live control the server is certain to
    // reject).
    await expect(
      page
        .getByRole('region', { name: 'Main Trading Account' })
        .getByRole('button', { name: 'Edit' }),
    ).toBeDisabled();

    // A direct submission to /app/accounts/new is rejected server-side too.
    await page.goto('/en/app/accounts/new');
    await expect(page.getByRole('region', { name: 'Create unavailable' })).toBeVisible();
    await expect(page.getByLabel('Trading account name')).toHaveCount(0);
  });

  test('the entitlement-unavailable state has no horizontal overflow at a 320px viewport', async ({
    page,
  }) => {
    const user = await provisionUser('e2e-entitlements-unavailable-mobile', {
      omitEntitlementRow: true,
      additionalArchivedAccounts: 1,
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await loginAs(page, 'en', user);

    await page.goto('/en/app/accounts');
    await expect(
      page.getByRole('status', { name: 'Account entitlement unavailable' }),
    ).toBeVisible();

    // Not merely "no reported scrollbar" — the actual document width must
    // match the viewport exactly, so a real overflowing element (rather
    // than one masked by `overflow-x: hidden` somewhere in the tree) cannot
    // hide behind this assertion.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBe(clientWidth);
  });

  test('the entitlement-unavailable state renders correctly in Thai', async ({ page }) => {
    const user = await provisionUser('e2e-entitlements-unavailable-th', {
      omitEntitlementRow: true,
      additionalArchivedAccounts: 1,
    });
    await loginAs(page, 'th', user);

    await page.goto('/th/app/accounts');
    const unavailableRegion = page.getByRole('status', {
      name: 'ไม่สามารถตรวจสอบสิทธิ์แพ็กเกจได้',
    });
    await expect(unavailableRegion).toBeVisible();
    await expect(unavailableRegion).toContainText(
      'ไม่สามารถตรวจสอบแผนของพื้นที่ทำงานนี้ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง',
    );
    await expect(page.getByRole('button', { name: 'สร้างบัญชี' })).toBeDisabled();
  });
});
