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
