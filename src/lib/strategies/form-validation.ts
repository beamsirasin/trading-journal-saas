import { hasNoControlOrHtmlCharacters } from '../trading-accounts/validation';
import {
  CHANGE_NOTE_MAX_LENGTH,
  RULE_TITLE_MAX_LENGTH,
  STRATEGY_NAME_MAX_LENGTH,
  STRATEGY_TEXT_MAX_LENGTH,
} from './constants';

/**
 * Pure, immediate-feedback validation for the Strategy/Setup/Rule forms —
 * the same "client-side code, server-side Zod schema stays authoritative"
 * split as `src/lib/trading-accounts/form-validation.ts`. Every check here
 * mirrors a rule `src/lib/strategies/schemas.ts` already enforces
 * server-side; this only exists so a blank/too-long/invalid-character field
 * is caught before a round trip, never as a second definition of "valid."
 */

export type StrategyFieldErrorCode = 'required' | 'tooLong' | 'invalidCharacters';

function validateRequiredText(
  value: string,
  maxLength: number,
): StrategyFieldErrorCode | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > maxLength) return 'tooLong';
  if (!hasNoControlOrHtmlCharacters(trimmed)) return 'invalidCharacters';
  return undefined;
}

function validateOptionalText(
  value: string,
  maxLength: number,
): StrategyFieldErrorCode | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > maxLength) return 'tooLong';
  if (!hasNoControlOrHtmlCharacters(trimmed)) return 'invalidCharacters';
  return undefined;
}

export interface StrategyContentFormValues {
  readonly name: string;
  readonly description: string;
  readonly notes: string;
}
export type StrategyContentFormErrors = Partial<
  Record<keyof StrategyContentFormValues, StrategyFieldErrorCode>
>;

export function validateStrategyContentFields(
  values: StrategyContentFormValues,
): StrategyContentFormErrors {
  const errors: StrategyContentFormErrors = {};
  const name = validateRequiredText(values.name, STRATEGY_NAME_MAX_LENGTH);
  if (name !== undefined) errors.name = name;
  const description = validateOptionalText(values.description, STRATEGY_TEXT_MAX_LENGTH);
  if (description !== undefined) errors.description = description;
  const notes = validateOptionalText(values.notes, STRATEGY_TEXT_MAX_LENGTH);
  if (notes !== undefined) errors.notes = notes;
  return errors;
}

export interface SetupContentFormValues {
  readonly name: string;
  readonly description: string;
}
export type SetupContentFormErrors = Partial<
  Record<keyof SetupContentFormValues, StrategyFieldErrorCode>
>;

export function validateSetupContentFields(values: SetupContentFormValues): SetupContentFormErrors {
  const errors: SetupContentFormErrors = {};
  const name = validateRequiredText(values.name, STRATEGY_NAME_MAX_LENGTH);
  if (name !== undefined) errors.name = name;
  const description = validateOptionalText(values.description, STRATEGY_TEXT_MAX_LENGTH);
  if (description !== undefined) errors.description = description;
  return errors;
}

export interface RuleFormValues {
  readonly title: string;
  readonly description: string;
}
export type RuleFormErrors = Partial<Record<keyof RuleFormValues, StrategyFieldErrorCode>>;

export function validateRuleFields(values: RuleFormValues): RuleFormErrors {
  const errors: RuleFormErrors = {};
  const title = validateRequiredText(values.title, RULE_TITLE_MAX_LENGTH);
  if (title !== undefined) errors.title = title;
  const description = validateOptionalText(values.description, STRATEGY_TEXT_MAX_LENGTH);
  if (description !== undefined) errors.description = description;
  return errors;
}

/** `undefined` means valid — used only when the current Version is locked; an unlocked save never calls this. */
export function validateChangeNote(value: string): 'required' | 'tooLong' | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > CHANGE_NOTE_MAX_LENGTH) return 'tooLong';
  return undefined;
}
