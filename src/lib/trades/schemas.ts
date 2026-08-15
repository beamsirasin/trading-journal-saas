import { z } from 'zod';

import { SETUP_CONDITION_CHECK_STATUSES } from '@/lib/setup-conditions/snapshots';
import {
  CHART_ATTACHMENT_STORAGE_KEY_MAX_LENGTH,
  isValidChartAttachmentStorageKey,
} from '@/lib/storage/chart-attachment';
import { parseInstant } from '@/lib/time/parse';

import { hasNoControlOrHtmlCharacters } from '../trading-accounts/validation';
import {
  CONFIRMATION_NOTES_MAX_LENGTH,
  isConfidenceStep,
  MISTAKE_NOTE_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  RESOLVABLE_SYSTEM_EXIT_REASONS,
  RULE_CHECK_STATUSES,
  SESSION_MAX_LENGTH,
  SYMBOL_MAX_LENGTH,
  TIMEFRAME_MAX_LENGTH,
  TRADE_DIRECTIONS,
  TRADINGVIEW_URL_MAX_LENGTH,
} from './constants';
import { isValidTradingViewUrl } from './validation';

/**
 * Strict, reusable Zod schemas for every Trade Server Action — Phase 08C's
 * client-facing input boundary, following `src/lib/strategies/schemas.ts`'s
 * exact conventions. `.strict()` on every object schema: an unexpected key
 * (`workspaceId`, `actorUserId`, `strategyVersionId`, `setupVersionId`,
 * `actualR`, `traderOutcome`, `systemR`, `systemOutcome`, `plannedR`,
 * `calcVersion`, `systemResolvedAt`, `deletedAt`, `status`, `systemStatus`,
 * `strategyRuleId`, a Rule-check row id, a mistake severity/weight snapshot,
 * or anything else not explicitly listed) fails validation outright rather
 * than being silently stripped — CLAUDE.md §4's "the client must never
 * choose `workspace_id`" made structurally impossible, not merely unused.
 *
 * These schemas perform SHAPE validation only — non-empty after a plain
 * length/character check, valid UUID, valid enum, strict decimal/integer
 * syntax, a well-formed ISO-8601 instant. They never decide whether a Stop is
 * on the wrong side of an Entry, whether a System cost is negative, or
 * whether `exitedAt` precedes `enteredAt` — `src/lib/calc/trade.ts` and
 * `src/server/services/trade-management.ts`/`trade-discipline.ts` remain the
 * only source of those financial/business-rule decisions (never duplicated
 * here).
 *
 * One schema per explicit 08B service operation — no universal
 * `UpdateTradeSchema` that tries to cover every field of every operation.
 */

const uuidField = () => z.string().uuid();
const conditionSetTokenField = () => z.string().regex(/^[a-f0-9]{64}$/);
const setupConditionAnswerField = () =>
  z
    .object({
      conditionKey: uuidField(),
      status: z.enum(SETUP_CONDITION_CHECK_STATUSES),
    })
    .strict();

const requiredTextField = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' });

/** `''` (an untouched optional form field) becomes `undefined`, never a stored empty string — matches `src/lib/strategies/schemas.ts`'s own convention. */
const optionalTextField = (maxLength: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .max(maxLength)
      .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' })
      .optional(),
  );

/**
 * A tri-state optional+nullable text field: the KEY absent from the parsed
 * output means "no change" (`Object.hasOwn` on the service's patch input
 * distinguishes this from an explicit clear — see
 * `src/server/services/trade-recalculation.ts`'s `resolvePlanFieldsPatch`
 * doc comment for the same convention on decimal fields); an explicit `null`
 * means "clear this field"; a non-blank string sets it. Deliberately NOT the
 * same helper as {@link optionalTextField} — that one silently converts a
 * blank string to `undefined` (meaning "unchanged" here), which would make an
 * emptied HTML input impossible to ever persist as a genuine clear.
 */
const patchableTextField = (maxLength: number) =>
  z
    .string()
    .max(maxLength)
    .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' })
    .nullable()
    .optional();

/**
 * Mirrors `src/lib/calc/decimal.ts`'s own `SIGNED_DECIMAL_PATTERN` exactly —
 * this is intentional: the engine and the schema that feeds it must agree
 * bit-for-bit on what "a well-formed decimal string" means, never two
 * independently-drifting definitions. No thousands grouping, no scientific
 * notation, an optional leading sign (R values and net-adjacent decimals are
 * routinely negative; instrument prices are not in practice, but the schema
 * does not encode that business assumption — the engine's own risk-direction
 * check is what actually rejects a nonsensical price pair).
 */
const SIGNED_DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/;
const DECIMAL_MAX_LENGTH = 32;

const decimalField = () => z.string().regex(SIGNED_DECIMAL_PATTERN).max(DECIMAL_MAX_LENGTH);
/** Tri-state, decimal-valued — see {@link patchableTextField}'s doc comment for the presence convention. */
const patchableDecimalField = () =>
  z.string().regex(SIGNED_DECIMAL_PATTERN).max(DECIMAL_MAX_LENGTH).nullable().optional();

const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const SIGNED_INTEGER_PATTERN = /^-?\d+$/;
const MINOR_UNIT_MAX_LENGTH = 30;

/**
 * Account-currency minor-unit money, transported as a strict integer string
 * (never a JSON number — large minor-unit values can exceed
 * `Number.MAX_SAFE_INTEGER`, and a JS `number` can never safely round-trip a
 * `bigint`). Converts to `bigint` here, inside this trusted server-only
 * schema module — never left for the client, and never re-parsed with
 * `parseInt`/`Number`.
 */
const unsignedMinorField = () =>
  z
    .string()
    .regex(UNSIGNED_INTEGER_PATTERN)
    .max(MINOR_UNIT_MAX_LENGTH)
    .transform((value) => BigInt(value));

const positiveMinorField = () =>
  unsignedMinorField().refine((value) => value > 0n, { message: 'must_be_positive' });

const signedMinorField = () =>
  z
    .string()
    .regex(SIGNED_INTEGER_PATTERN)
    .max(MINOR_UNIT_MAX_LENGTH)
    .transform((value) => BigInt(value));

/** Tri-state signed minor-unit money — see {@link patchableTextField}'s doc comment for the presence convention. */
const patchableSignedMinorField = () =>
  z
    .string()
    .regex(SIGNED_INTEGER_PATTERN)
    .max(MINOR_UNIT_MAX_LENGTH)
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? value : BigInt(value)));

/** Tri-state unsigned minor-unit money (migration 0010's `plannedRewardMinor`) — see {@link patchableTextField}'s doc comment for the presence convention. */
const patchableUnsignedMinorField = () =>
  z
    .string()
    .regex(UNSIGNED_INTEGER_PATTERN)
    .max(MINOR_UNIT_MAX_LENGTH)
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? value : BigInt(value)));

/** Tri-state strictly-positive minor-unit money (migration 0010's `plannedRiskMinor`) — see {@link patchableTextField}'s doc comment for the presence convention. */
const patchablePositiveMinorField = () =>
  z
    .string()
    .regex(UNSIGNED_INTEGER_PATTERN)
    .max(MINOR_UNIT_MAX_LENGTH)
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? value : BigInt(value)))
    .refine((value) => value === null || value === undefined || value > 0n, {
      message: 'must_be_positive',
    });

/**
 * A strict ISO-8601 instant with an explicit offset, parsed on the trusted
 * server side via `@/lib/time`'s `parseInstant` — never `new Date(string)`
 * directly (which reads an offset-less string as local time on whatever
 * machine runs it) and never the browser's own locale-aware parsing.
 */
const instantField = () =>
  z.string().transform((value, ctx) => {
    const result = parseInstant(value);
    if (!result.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error.message });
      return z.NEVER;
    }
    return result.value;
  });

const directionField = () => z.enum(TRADE_DIRECTIONS);
const checkStatusField = () => z.enum(RULE_CHECK_STATUSES);
const resolvableSystemExitReasonField = () => z.enum(RESOLVABLE_SYSTEM_EXIT_REASONS);
/**
 * Confidence is restricted to exactly five steps (Founder-UAT Confidence
 * redesign) — `isConfidenceStep` is the single source of truth shared with
 * the DB's `trades_confidence_check` and the interactive control itself, so
 * a malicious or buggy client sending e.g. `73` is rejected here, never
 * merely disallowed by the UI.
 */
const confidenceField = () =>
  z.number().int().refine(isConfidenceStep, { message: 'invalid_confidence' });

const tradingViewUrlField = () =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z
      .string()
      .max(TRADINGVIEW_URL_MAX_LENGTH)
      .refine(isValidTradingViewUrl, { message: 'invalid_tradingview_url' })
      .optional(),
  );
/** Tri-state TradingView URL — see {@link patchableTextField}'s doc comment for the presence convention. */
const patchableTradingViewUrlField = () =>
  z
    .string()
    .max(TRADINGVIEW_URL_MAX_LENGTH)
    .refine(isValidTradingViewUrl, { message: 'invalid_tradingview_url' })
    .nullable()
    .optional();

/**
 * Chart attachment (migration 0010) — never a raw blob/base64: the client
 * uploads through `src/lib/storage/`'s adapter FIRST (a separate Server
 * Action, into PRIVATE object storage — Founder review), then passes only
 * the resulting storage key through here. No URL field exists anywhere in
 * this domain: retrieval is exclusively through the authenticated delivery
 * route. `.refine` checks the key is shaped like something THIS app's own
 * upload path would have produced (server-generated-key-shaped) — see
 * `src/lib/storage/chart-attachment.ts`'s own doc comment for why a forged
 * value here carries no cross-tenant risk even so.
 */
const chartAttachmentStorageKeyField = () =>
  z
    .string()
    .max(CHART_ATTACHMENT_STORAGE_KEY_MAX_LENGTH)
    .refine(isValidChartAttachmentStorageKey, { message: 'invalid_chart_attachment_key' });

/**
 * Shared cross-field Plan invariants (Founder-UAT Trade Plan UX correction
 * slice, migration 0010) — applied identically to `createTrade` and
 * `updateTradePlan`'s SHAPE only (never the risk-direction/Money-ratio
 * MATH, which stays exclusively `src/lib/calc/trade.ts`'s job): Entry/Stop
 * must arrive as a complete pair or not at all, a Target requires that
 * pair, a Reward requires a Risk, and — createTrade only — at least one
 * representation must be present at all (`updateTradePlan`'s patch may
 * legitimately touch neither Price nor Money field while still leaving an
 * EXISTING representation on the Trade untouched, so that floor cannot be
 * expressed as a pure Zod shape rule there; the service layer enforces it
 * instead). Client-side enforcement only ever narrows what an honest client
 * can send — `trade-management.ts`/`trades_plan_minimum_check` remain the
 * real, non-bypassable authority (CLAUDE.md §4).
 */
function applyPlanShapeRefinements<
  T extends z.ZodType<{
    readonly plannedEntry?: string | null | undefined;
    readonly plannedStop?: string | null | undefined;
    readonly plannedTarget?: string | null | undefined;
    readonly plannedRiskMinor?: bigint | null | undefined;
    readonly plannedRewardMinor?: bigint | null | undefined;
  }>,
>(schema: T) {
  return schema
    .refine(
      (data) => ((data.plannedEntry ?? null) === null) === ((data.plannedStop ?? null) === null),
      { message: 'incomplete_price_plan', path: ['plannedStop'] },
    )
    .refine(
      (data) => (data.plannedTarget ?? null) === null || (data.plannedEntry ?? null) !== null,
      { message: 'incomplete_price_plan', path: ['plannedTarget'] },
    )
    .refine(
      (data) =>
        (data.plannedRewardMinor ?? null) === null || (data.plannedRiskMinor ?? null) !== null,
      { message: 'incomplete_money_plan', path: ['plannedRewardMinor'] },
    );
}

// ---------------------------------------------------------------------------
// 1. createTrade
// ---------------------------------------------------------------------------

const CreateTradeObjectSchema = z
  .object({
    mutationKey: uuidField(),
    tradingAccountId: uuidField(),
    strategyId: uuidField(),
    setupId: uuidField(),
    /** Opaque optimistic-concurrency guard, never an authoritative Version ID. */
    conditionSetToken: conditionSetTokenField(),
    /** Labels/order/Version ownership are resolved exclusively on the server. */
    conditionAnswers: z.array(setupConditionAnswerField()),
    symbol: requiredTextField(SYMBOL_MAX_LENGTH),
    direction: directionField(),
    /**
     * Price and Money are independent, both-optional Plan representations
     * (Founder-UAT correction slice) — a Trade may supply Price only, Money
     * only, or both. `applyPlanShapeRefinements` enforces pairing/ordering
     * shape; `no_plan_representation` below enforces the "at least one"
     * floor.
     */
    plannedEntry: decimalField().nullable().optional(),
    plannedStop: decimalField().nullable().optional(),
    /** Optional (locked Phase 08B decision) — omit or send `null` for a Target-less Price plan. */
    plannedTarget: decimalField().nullable().optional(),
    plannedPositionSize: decimalField().nullable().optional(),
    /** Account-currency minor units, in the Trading Account's own `base_currency`. */
    plannedRiskMinor: positiveMinorField().nullable().optional(),
    plannedRewardMinor: unsignedMinorField().nullable().optional(),
    timeframe: optionalTextField(TIMEFRAME_MAX_LENGTH),
    session: optionalTextField(SESSION_MAX_LENGTH),
    confirmationNotes: optionalTextField(CONFIRMATION_NOTES_MAX_LENGTH),
    confidence: confidenceField().optional(),
    tradingviewUrl: tradingViewUrlField(),
    notes: optionalTextField(NOTES_MAX_LENGTH),
    chartAttachmentStorageKey: chartAttachmentStorageKeyField().nullable().optional(),
  })
  .strict();

export const CreateTradeSchema = applyPlanShapeRefinements(CreateTradeObjectSchema).refine(
  (data) =>
    ((data.plannedEntry ?? null) !== null && (data.plannedStop ?? null) !== null) ||
    (data.plannedRiskMinor ?? null) !== null,
  { message: 'no_plan_representation', path: ['plannedEntry'] },
);
export type CreateTradeActionInput = z.input<typeof CreateTradeSchema>;
export type CreateTradeActionData = z.output<typeof CreateTradeSchema>;

// ---------------------------------------------------------------------------
// 2. updateTradePlan
// ---------------------------------------------------------------------------

const UpdateTradePlanObjectSchema = z
  .object({
    tradeId: uuidField(),
    /** Presence-sensitive — migration 0010 widened this from set-only to tri-state, so a Price plan can be cleared down to Money-only. See {@link patchableTextField}. */
    plannedEntry: patchableDecimalField(),
    plannedStop: patchableDecimalField(),
    plannedTarget: patchableDecimalField(),
    plannedPositionSize: patchableDecimalField(),
    plannedRiskMinor: patchablePositiveMinorField(),
    plannedRewardMinor: patchableUnsignedMinorField(),
    timeframe: patchableTextField(TIMEFRAME_MAX_LENGTH),
    session: patchableTextField(SESSION_MAX_LENGTH),
    confirmationNotes: patchableTextField(CONFIRMATION_NOTES_MAX_LENGTH),
    confidence: confidenceField().nullable().optional(),
    tradingviewUrl: patchableTradingViewUrlField(),
    notes: patchableTextField(NOTES_MAX_LENGTH),
  })
  .strict();

/**
 * A PATCH cannot safely apply {@link applyPlanShapeRefinements}'s "Target
 * requires a Price pair"/"Reward requires a Risk"/"at least one
 * representation" rules — those depend on the Trade's CURRENT stored state
 * (a key genuinely ABSENT here means "leave unchanged," not "clear"), which
 * this isolated Zod schema never sees. `updateTradePlan`
 * (`src/server/services/trade-management.ts`) merges the patch against the
 * stored Trade via `resolvePlanFieldsPatch` and re-runs the equivalent
 * checks there — the real, non-bypassable authority for this patch's
 * cross-field integrity (CLAUDE.md §4). The one check that IS safe to make
 * here, without any server state: if a caller explicitly provides BOTH
 * halves of a pair in the SAME call, their null-ness must agree — sending
 * `{ plannedEntry: '100', plannedStop: null }` in one patch is never
 * meaningful.
 */
export const UpdateTradePlanSchema = UpdateTradePlanObjectSchema.refine(
  (data) =>
    !Object.hasOwn(data, 'plannedEntry') ||
    !Object.hasOwn(data, 'plannedStop') ||
    (data.plannedEntry === null) === (data.plannedStop === null),
  { message: 'incomplete_price_plan', path: ['plannedStop'] },
).refine(
  (data) =>
    !Object.hasOwn(data, 'plannedRiskMinor') ||
    !Object.hasOwn(data, 'plannedRewardMinor') ||
    data.plannedRewardMinor === null ||
    data.plannedRiskMinor !== null,
  { message: 'incomplete_money_plan', path: ['plannedRewardMinor'] },
);
export type UpdateTradePlanActionInput = z.input<typeof UpdateTradePlanSchema>;
export type UpdateTradePlanActionData = z.output<typeof UpdateTradePlanSchema>;

// ---------------------------------------------------------------------------
// 3. correctTradeIdentity
// ---------------------------------------------------------------------------

export const CorrectTradeIdentitySchema = z
  .object({
    tradeId: uuidField(),
    symbol: requiredTextField(SYMBOL_MAX_LENGTH).optional(),
    direction: directionField().optional(),
    /**
     * Optional, and NOT forced to accompany a Direction change at the
     * schema layer — the service alone decides whether a given
     * Direction/Entry/Stop combination is valid (a Direction-only flip
     * against unchanged prices is mathematically always invalid; see
     * `trade-management.ts`'s `correctTradeIdentity` doc comment), and a
     * symbol-only correction must never be forced to also resend
     * unrelated, unchanged prices.
     */
    plannedEntry: decimalField().optional(),
    plannedStop: decimalField().optional(),
  })
  .strict()
  .refine((data) => data.symbol !== undefined || data.direction !== undefined, {
    message: 'at_least_one_correction_field_required',
  });
export type CorrectTradeIdentityActionInput = z.input<typeof CorrectTradeIdentitySchema>;
export type CorrectTradeIdentityActionData = z.output<typeof CorrectTradeIdentitySchema>;

// ---------------------------------------------------------------------------
// 4. openTrade
// ---------------------------------------------------------------------------

export const OpenTradeSchema = z
  .object({
    tradeId: uuidField(),
    actualEntry: decimalField(),
    actualInitialStop: decimalField(),
    /** Authoritative, never price-derived (CLAUDE.md §6) — a positive account-currency minor-unit integer string. */
    actualInitialRiskMinor: positiveMinorField(),
    actualPositionSize: decimalField().nullable().optional(),
    enteredAt: instantField(),
  })
  .strict();
export type OpenTradeActionInput = z.input<typeof OpenTradeSchema>;
export type OpenTradeActionData = z.output<typeof OpenTradeSchema>;

// ---------------------------------------------------------------------------
// 5. closeTrade
// ---------------------------------------------------------------------------

export const CloseTradeSchema = z
  .object({
    tradeId: uuidField(),
    actualExit: decimalField(),
    /** Already the authoritative net figure — never re-subtract commission/fees/swap from it (CLAUDE.md §6). */
    netPnlMinor: signedMinorField(),
    exitedAt: instantField(),
    grossPnlMinor: signedMinorField().nullable().optional(),
    commissionMinor: unsignedMinorField().optional(),
    feesMinor: unsignedMinorField().optional(),
    swapMinor: unsignedMinorField().optional(),
  })
  .strict();
export type CloseTradeActionInput = z.input<typeof CloseTradeSchema>;
export type CloseTradeActionData = z.output<typeof CloseTradeSchema>;

// ---------------------------------------------------------------------------
// 6. cancelTrade
// ---------------------------------------------------------------------------

export const CancelTradeSchema = z.object({ tradeId: uuidField() }).strict();
export type CancelTradeActionInput = z.input<typeof CancelTradeSchema>;
export type CancelTradeActionData = z.output<typeof CancelTradeSchema>;

// ---------------------------------------------------------------------------
// 7. correctTradeExecution
// ---------------------------------------------------------------------------

export const CorrectTradeExecutionSchema = z
  .object({
    tradeId: uuidField(),
    actualEntry: decimalField().optional(),
    actualInitialStop: decimalField().optional(),
    actualInitialRiskMinor: positiveMinorField().optional(),
    actualPositionSize: patchableDecimalField(),
    enteredAt: instantField().optional(),
    actualExit: decimalField().optional(),
    netPnlMinor: signedMinorField().optional(),
    exitedAt: instantField().optional(),
    grossPnlMinor: patchableSignedMinorField(),
    commissionMinor: unsignedMinorField().optional(),
    feesMinor: unsignedMinorField().optional(),
    swapMinor: unsignedMinorField().optional(),
  })
  .strict();
export type CorrectTradeExecutionActionInput = z.input<typeof CorrectTradeExecutionSchema>;
export type CorrectTradeExecutionActionData = z.output<typeof CorrectTradeExecutionSchema>;

// ---------------------------------------------------------------------------
// 8. resolveSystemTrade
// ---------------------------------------------------------------------------

export const ResolveSystemTradeSchema = z
  .object({
    tradeId: uuidField(),
    systemExitPrice: decimalField(),
    systemExitedAt: instantField(),
    /** `setup_invalidated` excluded at the schema layer — a closed-set membership check, not a formula (see `markSystemNoTradeAction` for that transition instead). */
    systemExitReason: resolvableSystemExitReasonField(),
    systemCostR: decimalField(),
  })
  .strict();
export type ResolveSystemTradeActionInput = z.input<typeof ResolveSystemTradeSchema>;
export type ResolveSystemTradeActionData = z.output<typeof ResolveSystemTradeSchema>;

// ---------------------------------------------------------------------------
// 9. markSystemNoTrade
// ---------------------------------------------------------------------------

export const MarkSystemNoTradeSchema = z.object({ tradeId: uuidField() }).strict();
export type MarkSystemNoTradeActionInput = z.input<typeof MarkSystemNoTradeSchema>;
export type MarkSystemNoTradeActionData = z.output<typeof MarkSystemNoTradeSchema>;

// ---------------------------------------------------------------------------
// 10. correctSystemResolution
// ---------------------------------------------------------------------------

const CorrectSystemResolutionToResolvedSchema = z
  .object({
    tradeId: uuidField(),
    target: z.literal('resolved'),
    systemExitPrice: decimalField(),
    systemExitedAt: instantField(),
    systemExitReason: resolvableSystemExitReasonField(),
    systemCostR: decimalField(),
  })
  .strict();

const CorrectSystemResolutionToNoTradeSchema = z
  .object({
    tradeId: uuidField(),
    target: z.literal('no_trade'),
  })
  .strict();

/**
 * A discriminated union on `target` — structurally, `target: 'pending'` does
 * not exist as a member, so reverting terminal System state to `pending` is
 * rejected at the schema layer, not merely by the service's own runtime
 * check (`trade-management.ts`'s `correctSystemResolution` doc comment).
 */
export const CorrectSystemResolutionSchema = z.discriminatedUnion('target', [
  CorrectSystemResolutionToResolvedSchema,
  CorrectSystemResolutionToNoTradeSchema,
]);
export type CorrectSystemResolutionActionInput = z.input<typeof CorrectSystemResolutionSchema>;
export type CorrectSystemResolutionActionData = z.output<typeof CorrectSystemResolutionSchema>;

// ---------------------------------------------------------------------------
// 11. softDeleteTrade
// ---------------------------------------------------------------------------

export const SoftDeleteTradeSchema = z.object({ tradeId: uuidField() }).strict();
export type SoftDeleteTradeActionInput = z.input<typeof SoftDeleteTradeSchema>;
export type SoftDeleteTradeActionData = z.output<typeof SoftDeleteTradeSchema>;

// ---------------------------------------------------------------------------
// 12. updateTradeRuleCheck
// ---------------------------------------------------------------------------

export const UpdateTradeRuleCheckSchema = z
  .object({
    tradeId: uuidField(),
    /** The stable logical Rule identity — never `strategyRuleId` or the internal `trade_rule_checks` row id. */
    ruleKey: uuidField(),
    checkStatus: checkStatusField(),
  })
  .strict();
export type UpdateTradeRuleCheckActionInput = z.input<typeof UpdateTradeRuleCheckSchema>;
export type UpdateTradeRuleCheckActionData = z.output<typeof UpdateTradeRuleCheckSchema>;

// ---------------------------------------------------------------------------
// 13. attachTradeMistake
// ---------------------------------------------------------------------------

export const AttachTradeMistakeSchema = z
  .object({
    tradeId: uuidField(),
    mistakeTypeId: uuidField(),
    note: optionalTextField(MISTAKE_NOTE_MAX_LENGTH),
  })
  .strict();
export type AttachTradeMistakeActionInput = z.input<typeof AttachTradeMistakeSchema>;
export type AttachTradeMistakeActionData = z.output<typeof AttachTradeMistakeSchema>;

// ---------------------------------------------------------------------------
// 14. removeTradeMistake
// ---------------------------------------------------------------------------

export const RemoveTradeMistakeSchema = z
  .object({
    tradeId: uuidField(),
    mistakeTypeId: uuidField(),
  })
  .strict();
export type RemoveTradeMistakeActionInput = z.input<typeof RemoveTradeMistakeSchema>;
export type RemoveTradeMistakeActionData = z.output<typeof RemoveTradeMistakeSchema>;

/** A trusted, already-validated Trade ID — used by read actions/DAL callers that only need shape validation, no full object schema. */
export const TradeIdSchema = uuidField();
