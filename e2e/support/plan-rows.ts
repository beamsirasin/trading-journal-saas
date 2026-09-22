import { expect, type Locator, type Page } from '@playwright/test';

/**
 * PLAN & RISK, READ AS ROWS — the same four launcher rows in both recording
 * moments (UX Rules §20.4). Risk at Entry, Target, Exit Plan and Price levels
 * each read back what is recorded and open the one editor that records it, so
 * their inputs exist in the DOM only while that editor is open.
 *
 * These helpers know nothing about which form hosts the step: Record Open and
 * Record Closed both render it, with their own input ids inside.
 */
export type PlanConcept = 'risk' | 'target' | 'price';

export function planRow(page: Page, concept: PlanConcept): Locator {
  return page.locator(`[data-plan-row="${concept}"]`);
}

export function exitPlanRow(page: Page): Locator {
  return page.locator('[data-exit-plan-row]');
}

/** Open one row's editor and return it, ready to be read or answered. */
export async function openPlanRow(page: Page, concept: PlanConcept): Promise<Locator> {
  await planRow(page, concept).click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

/** The Exit Plan's row opens its states and its actions the same way. */
export async function openExitPlanRow(page: Page): Promise<Locator> {
  await exitPlanRow(page).click();
  const editor = page.getByRole('dialog');
  await expect(editor).toBeVisible();
  return editor;
}

/** Done keeps every answer — each keystroke is already in the host's draft. */
export async function closePlanEditor(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
