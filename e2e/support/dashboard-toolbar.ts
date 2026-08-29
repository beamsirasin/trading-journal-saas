import type { Locator, Page } from '@playwright/test';

/**
 * The sticky Dashboard toolbar's Date Range control.
 *
 * R2B retired the section-local 30D/90D/All links: the toolbar is now the one
 * visible owner of the applied range, and it offers the full canonical preset
 * set plus Custom rather than three of the nine.
 */
export const dateRangeTrigger = (page: Page): Locator =>
  page.locator('[data-dashboard-toolbar-control="date-range"]');

export const dateRangeApply = (page: Page): Locator =>
  page.locator('[data-dashboard-toolbar-apply="date-range"]');

/**
 * Opens the picker, drafts a preset, and applies it.
 *
 * The open and the preset click are DRAFT edits and perform no Dashboard
 * transition at all; only the final Apply does. Callers that measure a
 * transition should therefore time the Apply, not this whole helper.
 */
export async function applyToolbarRange(page: Page, presetLabel: string): Promise<void> {
  await dateRangeTrigger(page).click();
  await page.getByRole('button', { name: presetLabel, exact: true }).click();
  await dateRangeApply(page).click();
}

/** Opens the picker and drafts a preset, stopping short of Apply. */
export async function draftToolbarRange(page: Page, presetLabel: string): Promise<void> {
  await dateRangeTrigger(page).click();
  await page.getByRole('button', { name: presetLabel, exact: true }).click();
}
