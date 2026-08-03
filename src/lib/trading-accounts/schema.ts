import { z } from 'zod';

import { isValidTimeZone } from '@/lib/time/timezone';

import { ACCOUNT_MODES, NAME_MAX_LENGTH, OPTIONAL_TEXT_MAX_LENGTH } from './constants';
import {
  hasNoControlOrHtmlCharacters,
  isValidBaseCurrency,
  isValidPercent,
  isValidStartingBalance,
} from './validation';

/**
 * Shared Zod schemas for the onboarding wizard — imported by both the
 * client form (immediate feedback) and the server action (authoritative
 * validation), so the two can never silently drift apart. Only strings
 * cross this boundary: `startingBalance`/percentages stay decimal strings
 * end to end (CLAUDE.md §5), never a parsed JS `number`.
 */

const freeTextField = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' });

/** `''` (an untouched optional form field) becomes `undefined`, never a stored empty string. */
const optionalFreeTextField = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    freeTextField(maxLength).optional(),
  );

const optionalPercentField = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().refine(isValidPercent, { message: 'invalid_percent' }).optional(),
  );

export const OnboardingStepOneSchema = z.object({
  name: freeTextField(NAME_MAX_LENGTH).min(1, { message: 'required' }),
  brokerName: optionalFreeTextField(OPTIONAL_TEXT_MAX_LENGTH),
  platformName: optionalFreeTextField(OPTIONAL_TEXT_MAX_LENGTH),
  accountMode: z.enum(ACCOUNT_MODES),
  baseCurrency: z.string().refine(isValidBaseCurrency, { message: 'invalid_base_currency' }),
  startingBalance: z.string().refine(isValidStartingBalance, { message: 'invalid_balance' }),
});

export const OnboardingStepTwoSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, { message: 'invalid_timezone' }),
  riskPerTradePercent: optionalPercentField(),
  maximumDailyLossPercent: optionalPercentField(),
});

export const OnboardingSubmitSchema = OnboardingStepOneSchema.extend(OnboardingStepTwoSchema.shape);

export type OnboardingStepOneInput = z.input<typeof OnboardingStepOneSchema>;
export type OnboardingStepTwoInput = z.input<typeof OnboardingStepTwoSchema>;
export type OnboardingSubmitInput = z.input<typeof OnboardingSubmitSchema>;
export type OnboardingSubmitData = z.output<typeof OnboardingSubmitSchema>;

/**
 * Phase 3B reuses this exact field set for creating and editing any trading
 * account beyond onboarding's first one — same name/broker/platform/mode/
 * currency/balance/timezone/risk/max-loss shape, same validators. Aliased
 * rather than redefined so the two phases can never silently drift apart;
 * `AccountFieldsSchema` is the name account-management code reaches for so it
 * reads as what it is, not as "reusing onboarding's schema."
 */
export const AccountFieldsSchema = OnboardingSubmitSchema;
export type AccountFieldsInput = OnboardingSubmitInput;
export type AccountFieldsData = OnboardingSubmitData;

/**
 * `.strict()` on both: an update/create payload that carries an unexpected
 * key (`isArchived`, `activeTradingAccountId`, `workspaceId`, anything not
 * one of the fields above) fails validation outright rather than silently
 * stripping it. Onboarding's own `OnboardingSubmitSchema` deliberately stays
 * non-strict (Zod's default "strip unknown keys" already made a forged
 * `workspaceId` harmless there — see its action's own doc comment); Phase 3B
 * additionally requires REJECTING such a payload outright, so the two
 * schemas are not merged into one `.strict()` definition.
 */
export const CreateAccountSchema = AccountFieldsSchema.extend({
  /** Client-generated once per creation intent; validated as a UUID, never trusted as an authorization boundary — see `trading-account-management.ts`. */
  mutationKey: z.string().uuid(),
  setActive: z.boolean().optional().default(false),
}).strict();

export const UpdateAccountSchema = AccountFieldsSchema.strict();

export type CreateAccountInput = z.input<typeof CreateAccountSchema>;
export type CreateAccountData = z.output<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.input<typeof UpdateAccountSchema>;
export type UpdateAccountData = z.output<typeof UpdateAccountSchema>;
