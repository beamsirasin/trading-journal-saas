import { isValidTimeZone } from '@/lib/time/timezone';

import { NAME_MAX_LENGTH, OPTIONAL_TEXT_MAX_LENGTH } from './constants';
import {
  hasNoControlOrHtmlCharacters,
  isValidBaseCurrency,
  isValidPercent,
  isValidStartingBalance,
} from './validation';

/**
 * The full trading-account field set, as plain form strings (never a parsed
 * number — CLAUDE.md §5). Shared by every form that collects these fields:
 * the onboarding wizard's two steps and Phase 3B's single-page create/edit
 * form.
 */
export interface AccountFormValues {
  name: string;
  brokerName: string;
  platformName: string;
  accountMode: string;
  baseCurrency: string;
  startingBalance: string;
  timezone: string;
  riskPerTradePercent: string;
  maximumDailyLossPercent: string;
}

export type AccountFormField = keyof AccountFormValues;
export type AccountFormErrors = Partial<Record<AccountFormField, string>>;

/**
 * Pure, immediate-feedback validation for every account field at once — the
 * one place this logic exists. The onboarding wizard filters this down to
 * its per-step subset (`onboarding-wizard.tsx`'s `validateStepOne`/
 * `validateStepTwo`); the Phase 3B create/edit form (`account-fields-form.tsx`)
 * uses the full result directly, since it has no steps. Each check ultimately
 * calls the SAME pure validators (`./validation.ts`) either side already
 * shared with the server action's authoritative Zod schema
 * (`./schema.ts`) — this function only adds the "which error code" glue,
 * never a second implementation of a regex or decimal parse.
 */
export function validateAccountFields(values: AccountFormValues): AccountFormErrors {
  const errors: AccountFormErrors = {};

  const name = values.name.trim();
  if (name.length === 0) {
    errors.name = 'required';
  } else if (name.length > NAME_MAX_LENGTH || !hasNoControlOrHtmlCharacters(name)) {
    errors.name = 'invalidCharacters';
  }

  if (values.brokerName.trim().length > 0) {
    const broker = values.brokerName.trim();
    if (broker.length > OPTIONAL_TEXT_MAX_LENGTH || !hasNoControlOrHtmlCharacters(broker)) {
      errors.brokerName = 'invalidCharacters';
    }
  }

  if (values.platformName.trim().length > 0) {
    const platform = values.platformName.trim();
    if (platform.length > OPTIONAL_TEXT_MAX_LENGTH || !hasNoControlOrHtmlCharacters(platform)) {
      errors.platformName = 'invalidCharacters';
    }
  }

  if (!isValidBaseCurrency(values.baseCurrency)) {
    errors.baseCurrency = 'invalidBaseCurrency';
  }

  if (!isValidStartingBalance(values.startingBalance)) {
    errors.startingBalance = 'invalidBalance';
  }

  if (!isValidTimeZone(values.timezone)) {
    errors.timezone = 'invalidTimezone';
  }

  if (values.riskPerTradePercent.trim().length > 0 && !isValidPercent(values.riskPerTradePercent)) {
    errors.riskPerTradePercent = 'invalidPercent';
  }

  if (
    values.maximumDailyLossPercent.trim().length > 0 &&
    !isValidPercent(values.maximumDailyLossPercent)
  ) {
    errors.maximumDailyLossPercent = 'invalidPercent';
  }

  return errors;
}

/** Filters a full error map down to a fixed subset of fields — how the onboarding wizard derives its per-step errors from the shared validator above. */
export function pickFormErrors<K extends AccountFormField>(
  errors: AccountFormErrors,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = errors[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }
  return picked;
}
