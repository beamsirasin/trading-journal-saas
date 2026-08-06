import { z } from 'zod';

import { hasNoControlOrHtmlCharacters } from '../trading-accounts/validation';
import {
  CHANGE_NOTE_MAX_LENGTH,
  RULE_TITLE_MAX_LENGTH,
  STRATEGY_NAME_MAX_LENGTH,
  STRATEGY_RULE_CATEGORIES,
  STRATEGY_TEXT_MAX_LENGTH,
} from './constants';

/**
 * Strict, reusable Zod schemas for every Strategy/Setup/Rule Server Action —
 * Phase 06D's client-facing input boundary. `.strict()` on every object
 * schema below: an unexpected key (`workspaceId`, `actorUserId`,
 * `isArchived`, `currentVersionId`, `versionNumber`, `lockedAt`, a Rule row
 * `id`, or anything else not explicitly listed) fails validation outright
 * rather than being silently stripped — CLAUDE.md §4's "the client must
 * never be able to choose `workspace_id`" made structurally impossible, not
 * merely unused.
 *
 * These schemas perform SHAPE validation only (non-empty after a plain
 * length/character check, valid UUID, valid enum, non-negative integer) —
 * they never trim, normalize, or reject "blank after trimming" themselves.
 * `src/lib/strategies/validation.ts`'s `normalizeRequiredText`/
 * `normalizeChangeNote` remain the one authoritative normalization step,
 * applied inside the service (`strategy-management.ts`) — duplicating that
 * logic here would create two subtly different definitions of "blank" that
 * could silently drift apart. A string of only whitespace passes this
 * layer's `.min(1)` and is caught downstream by the service's own
 * `blank_name`/`blank_title`, mapped back to the same public
 * `validation_error` a schema rejection would have produced (see
 * `src/lib/strategies/errors.ts`).
 */

const uuidField = () => z.string().uuid();

const requiredTextField = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' });

/** `''` (an untouched optional form field) becomes `undefined`, never a stored empty string — same convention as the onboarding schema. */
const optionalTextField = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .max(maxLength)
      .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' })
      .optional(),
  );

const changeNoteField = () => optionalTextField(CHANGE_NOTE_MAX_LENGTH);

const sortOrderField = () => z.number().int().min(0);

const ruleCategoryField = () => z.enum(STRATEGY_RULE_CATEGORIES);

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export const CreateStrategySchema = z
  .object({
    mutationKey: uuidField(),
    name: requiredTextField(STRATEGY_NAME_MAX_LENGTH),
    description: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    notes: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
  })
  .strict();
export type CreateStrategyInput = z.input<typeof CreateStrategySchema>;
export type CreateStrategyData = z.output<typeof CreateStrategySchema>;

export const UpdateStrategyContentSchema = z
  .object({
    strategyId: uuidField(),
    name: requiredTextField(STRATEGY_NAME_MAX_LENGTH),
    description: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    notes: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    // Not forced here: required only when the current Version is locked, a
    // fact only the authoritative service can know at transaction time.
    changeNote: changeNoteField(),
  })
  .strict();
export type UpdateStrategyContentInput = z.input<typeof UpdateStrategyContentSchema>;
export type UpdateStrategyContentData = z.output<typeof UpdateStrategyContentSchema>;

export const StrategyLifecycleSchema = z
  .object({
    strategyId: uuidField(),
  })
  .strict();
export type StrategyLifecycleInput = z.input<typeof StrategyLifecycleSchema>;
export type StrategyLifecycleData = z.output<typeof StrategyLifecycleSchema>;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export const CreateSetupSchema = z
  .object({
    strategyId: uuidField(),
    mutationKey: uuidField(),
    name: requiredTextField(STRATEGY_NAME_MAX_LENGTH),
    description: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    sortOrder: sortOrderField(),
    changeNote: changeNoteField(),
  })
  .strict();
export type CreateSetupInput = z.input<typeof CreateSetupSchema>;
export type CreateSetupData = z.output<typeof CreateSetupSchema>;

export const UpdateSetupContentSchema = z
  .object({
    strategyId: uuidField(),
    setupId: uuidField(),
    name: requiredTextField(STRATEGY_NAME_MAX_LENGTH),
    description: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    sortOrder: sortOrderField(),
    changeNote: changeNoteField(),
  })
  .strict();
export type UpdateSetupContentInput = z.input<typeof UpdateSetupContentSchema>;
export type UpdateSetupContentData = z.output<typeof UpdateSetupContentSchema>;

export const SetupLifecycleSchema = z
  .object({
    strategyId: uuidField(),
    setupId: uuidField(),
  })
  .strict();
export type SetupLifecycleInput = z.input<typeof SetupLifecycleSchema>;
export type SetupLifecycleData = z.output<typeof SetupLifecycleSchema>;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const CreateStrategyRuleSchema = z
  .object({
    strategyId: uuidField(),
    /** Absent = Strategy-level. Present = scoped to that Setup's snapshot in the current Version. */
    setupId: uuidField().optional(),
    ruleKey: uuidField(),
    category: ruleCategoryField(),
    title: requiredTextField(RULE_TITLE_MAX_LENGTH),
    description: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    isRequired: z.boolean(),
    isPreTradeCheck: z.boolean(),
    sortOrder: sortOrderField(),
    changeNote: changeNoteField(),
  })
  .strict();
export type CreateStrategyRuleInput = z.input<typeof CreateStrategyRuleSchema>;
export type CreateStrategyRuleData = z.output<typeof CreateStrategyRuleSchema>;

export const UpdateStrategyRuleSchema = z
  .object({
    strategyId: uuidField(),
    setupId: uuidField().optional(),
    ruleKey: uuidField(),
    category: ruleCategoryField(),
    title: requiredTextField(RULE_TITLE_MAX_LENGTH),
    description: optionalTextField(STRATEGY_TEXT_MAX_LENGTH),
    isRequired: z.boolean(),
    isPreTradeCheck: z.boolean(),
    sortOrder: sortOrderField(),
    changeNote: changeNoteField(),
  })
  .strict();
export type UpdateStrategyRuleInput = z.input<typeof UpdateStrategyRuleSchema>;
export type UpdateStrategyRuleData = z.output<typeof UpdateStrategyRuleSchema>;

export const RemoveStrategyRuleSchema = z
  .object({
    strategyId: uuidField(),
    setupId: uuidField().optional(),
    ruleKey: uuidField(),
    changeNote: changeNoteField(),
  })
  .strict();
export type RemoveStrategyRuleInput = z.input<typeof RemoveStrategyRuleSchema>;
export type RemoveStrategyRuleData = z.output<typeof RemoveStrategyRuleSchema>;

/** A trusted, already-validated Strategy ID — used by read actions/DAL callers that only need shape validation, no full object schema. */
export const StrategyIdSchema = uuidField();
