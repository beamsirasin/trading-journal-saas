import { z } from 'zod';

import { HTML_MARKUP_PATTERN } from '../trading-accounts/validation';

/**
 * SAVED EXIT PLAN LIBRARY — the Server Action input boundary (Add Trade
 * contract §5).
 *
 * `.strict()` on every object: a forged `workspaceId`, `isArchived` or
 * `strategyId` on an edit fails validation outright rather than being
 * stripped. Shape only — the service trims and refuses blank wording, and the
 * database's `btrim(...) <> ''` CHECKs are the final boundary.
 */

export const EXIT_PLAN_NAME_MAX_LENGTH = 120;
export const EXIT_PLAN_INSTRUCTIONS_MAX_LENGTH = 2000;

/**
 * AN EXIT PLAN IS WRITTEN IN A TEXTAREA, SO IT MAY HAVE LINE BREAKS.
 *
 * `hasNoControlOrHtmlCharacters` refuses every C0 control character, which is
 * right for a one-line name and wrong for a rule a trader writes as steps:
 * pressing Enter would make the plan unsavable. Line feed, carriage return and
 * tab are allowed here; every other control character and markup still is not.
 */
export function isValidExitPlanInstructionsText(value: string): boolean {
  if (HTML_MARKUP_PATTERN.test(value)) return false;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    const lineBreakOrTab = codePoint === 0x0a || codePoint === 0x0d || codePoint === 0x09;
    if ((codePoint <= 0x1f && !lineBreakOrTab) || codePoint === 0x7f) return false;
  }
  return true;
}

export const exitPlanNameField = () =>
  z
    .string()
    .max(EXIT_PLAN_NAME_MAX_LENGTH)
    .refine((value) => value.trim() !== '', { message: 'blank_name' })
    .refine((value) => isValidExitPlanInstructionsText(value) && !/[\r\n\t]/.test(value), {
      message: 'invalid_characters',
    });

export const exitPlanInstructionsField = () =>
  z
    .string()
    .max(EXIT_PLAN_INSTRUCTIONS_MAX_LENGTH)
    .refine((value) => value.trim() !== '', { message: 'blank_instructions' })
    .refine(isValidExitPlanInstructionsText, { message: 'invalid_characters' });

export const CreateExitPlanSchema = z
  .object({
    mutationKey: z.string().uuid(),
    name: exitPlanNameField(),
    instructions: exitPlanInstructionsField(),
  })
  .strict();

export const UpdateExitPlanSchema = z
  .object({
    exitPlanId: z.string().uuid(),
    name: exitPlanNameField(),
    instructions: exitPlanInstructionsField(),
  })
  .strict();

export const ExitPlanIdSchema = z.object({ exitPlanId: z.string().uuid() }).strict();

export const SetExitPlanStrategyDefaultSchema = z
  .object({ exitPlanId: z.string().uuid(), strategyId: z.string().uuid() })
  .strict();

export type CreateExitPlanInput = z.infer<typeof CreateExitPlanSchema>;
export type UpdateExitPlanInput = z.infer<typeof UpdateExitPlanSchema>;

/** The closed public error surface of the Exit Plan library Server Actions. */
export const EXIT_PLAN_PUBLIC_ERROR_CODES = [
  'validation_error',
  'unauthenticated',
  'workspace_access_denied',
  'read_only_workspace',
  'over_limit_workspace',
  'exit_plan_not_found',
  'exit_plan_archived',
  'strategy_not_found',
  'strategy_archived',
  'unexpected_error',
] as const;

export type ExitPlanPublicErrorCode = (typeof EXIT_PLAN_PUBLIC_ERROR_CODES)[number];
