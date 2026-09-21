import { expect, type Locator, type Page } from '@playwright/test';

/**
 * RECORD OPEN TRADE, DRIVEN THE WAY A TRADER DRIVES IT.
 *
 * `/app/trades/new?timing=at_entry` is four canonical stages in the shared
 * step flow — Trade Details, Plan & Risk, Setup & Checklist, Entry Context &
 * Evidence (UX Rules §20.4). Step 1 is read-first: each concept is a launcher
 * row whose editor is a bottom sheet on a phone and a dialog on a desktop.
 * Strategy and Setup are launcher rows on Setup & Checklist. Save Open Trade
 * is the last step's button, and Save now from Plan & Risk on.
 */
export type RecordOpenStep = 'trade' | 'plan' | 'setup' | 'context';

/** Open one of the four steps from the step list (the rail on a phone, the list beside a wide form). */
export async function recordOpenStep(page: Page, step: RecordOpenStep) {
  await page.locator(`[data-step-link="${step}"]:visible`).first().click();
  await expect(page.locator('[data-record-open-form]')).toHaveAttribute(
    'data-record-open-step',
    step,
  );
}

/** A Step 1 row: what it records, readable without opening its editor. */
export function recordOpenConcept(page: Page, concept: string): Locator {
  return page.locator(`#entry-row-${concept}`);
}

/**
 * The Symbol editor is a picker: the field searches, and recording is a
 * deliberate press — the saved row, or the offer to add what was typed.
 */
export async function recordOpenSymbol(page: Page, symbol: string) {
  await recordOpenStep(page, 'trade');
  await recordOpenConcept(page, 'symbol').click();
  const editor = page.getByRole('dialog');
  await editor.getByRole('combobox', { name: 'Symbol' }).fill(symbol);
  const add = editor.getByRole('button', { name: /^Add/ });
  if ((await add.count()) > 0) await add.click();
  await editor.getByRole('option', { name: new RegExp(`^${symbol}`, 'i') }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Direction is one tap: the choice records it and closes the sheet. */
export async function recordOpenDirection(page: Page, direction: 'Long' | 'Short') {
  await recordOpenStep(page, 'trade');
  await recordOpenConcept(page, 'direction').click();
  await page.getByRole('dialog').getByRole('button', { name: direction, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(recordOpenConcept(page, 'direction')).toHaveAttribute(
    'data-value',
    direction.toLowerCase(),
  );
}

/** Risk at Entry — the 1R baseline — on Plan & Risk. */
export async function recordOpenRisk(page: Page, amount: string) {
  await recordOpenStep(page, 'plan');
  await page.locator('#entry-risk').fill(amount);
}

/** Save Open Trade's minimum: Symbol and Direction on Step 1, Risk at Entry on Plan & Risk. */
export async function recordOpenMinimum(
  page: Page,
  { symbol, direction, risk }: { symbol: string; direction: 'Long' | 'Short'; risk: string },
) {
  await recordOpenSymbol(page, symbol);
  await recordOpenDirection(page, direction);
  await recordOpenRisk(page, risk);
}

/** Strategy, then Setup, each chosen in its own editor on Setup & Checklist. */
export async function recordOpenClassify(page: Page, strategy: string, setup?: string) {
  await recordOpenStep(page, 'setup');
  await page.locator('#entry-strategy').click();
  await page.getByRole('dialog').getByRole('button', { name: strategy, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (setup === undefined) return;
  await page.locator('#entry-setup').click();
  await page.getByRole('dialog').getByRole('button', { name: setup, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Opens the folded price levels on Plan & Risk — context, never a result. */
export async function recordOpenPriceLevels(page: Page) {
  await recordOpenStep(page, 'plan');
  const toggle = page.locator('#entry-plan-price');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}

/** Save Open Trade from the last step, where it is the primary action. */
export async function recordOpenSave(page: Page) {
  await recordOpenStep(page, 'context');
  await page.getByRole('button', { name: 'Save open trade', exact: true }).click();
}
