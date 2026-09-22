import { z } from 'zod';

import { EMOTION_KEYS } from '@/config/emotions';
import { exitPlanInstructionsField } from '@/lib/exit-plans/schemas';
import {
  RECALLED_SETUP_CONDITION_CHECK_STATUSES,
  SETUP_CONDITION_CHECK_STATUSES,
} from '@/lib/setup-conditions/snapshots';
import {
  CHART_ATTACHMENT_STORAGE_KEY_MAX_LENGTH,
  isValidChartAttachmentStorageKey,
} from '@/lib/storage/chart-attachment';
import { parseInstant } from '@/lib/time/parse';
import {
  ACTUAL_RISK_ANSWERS,
  ENTERED_AT_SOURCES,
  EXIT_PLAN_PROVENANCES,
  RECORDING_CONTRACT_ADD_TRADE_V1,
  TARGET_STATES,
} from '@/lib/trades/add-trade-contract';
import {
  RECORDING_TIMINGS,
  SYSTEM_PLAN_BASES,
  validateNewWritePlanAuthority,
} from '@/lib/trades/recording-model';

import { hasNoControlOrHtmlCharacters } from '../trading-accounts/validation';
import {
  CONFIRMATION_NOTES_MAX_LENGTH,
  EXIT_HISTORY_COMPLETENESS_VALUES,
  EXIT_REASON_MAX_LENGTH,
  HISTORICAL_EXIT_SCOPES,
  isConfidenceStep,
  MISTAKE_NOTE_MAX_LENGTH,
  NOTES_MAX_LENGTH,
  OUTCOME_VALUES,
  PLAN_ADHERENCE_VALUES,
  RESOLVABLE_SYSTEM_EXIT_REASONS,
  REVIEW_NOTES_MAX_LENGTH,
  RULE_CHECK_STATUSES,
  SESSION_MAX_LENGTH,
  SYMBOL_MAX_LENGTH,
  SYSTEM_PLAN_PROVENANCES,
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
/** After Trade also accepts "Don't remember" (contract §8). */
const recalledSetupConditionAnswerField = () =>
  z
    .object({
      conditionKey: uuidField(),
      status: z.enum(RECALLED_SETUP_CONDITION_CHECK_STATUSES),
    })
    .strict();

const emotionKeysField = () =>
  z.array(z.enum(EMOTION_KEYS)).superRefine((keys, context) => {
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'duplicate_emotion_key' });
    }
  });

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

/** A strictly positive decimal: a price or size recorded as context only (Add Trade contract §3). */
const positiveDecimalField = () =>
  decimalField().refine((value) => !value.startsWith('-') && /[1-9]/.test(value), {
    message: 'must_be_positive',
  });

/**
 * The Exit Plan answer a contract At Entry write carries. `saved` names a
 * library plan (its wording is snapshotted on the server, never trusted from
 * the client); `customized` carries the trader's own instructions; absent
 * means Not recorded.
 */
const exitPlanChoiceField = () =>
  z.discriminatedUnion('state', [
    z
      .object({
        state: z.literal('saved'),
        exitPlanId: uuidField(),
        provenance: z.enum(EXIT_PLAN_PROVENANCES),
      })
      .strict(),
    z
      .object({
        state: z.literal('customized'),
        baseExitPlanId: uuidField().nullable(),
        // Same field as a saved library plan: line breaks allowed, blank refused.
        instructions: exitPlanInstructionsField(),
      })
      .strict(),
    z.object({ state: z.literal('no_rule') }).strict(),
  ]);

/**
 * SYSTEM COST R — OPTIONAL, AND AN EMPTY STRING MEANS UNKNOWN.
 *
 * The form posts every field it renders, so an untouched cost arrives as `''`
 * rather than as an absent key. Both mean the same thing and both normalize to
 * `null`: the counterfactual's cost was never estimated, so `system_r` and
 * `system_outcome` do not exist and the pair is reported gross-only.
 *
 * `'0'` remains perfectly valid and now means what it says — a considered "this
 * would have cost nothing" — because it can no longer arrive by default.
 */
const optionalSystemCostField = () =>
  z
    .union([decimalField(), z.literal(''), z.null()])
    .optional()
    .transform((value) => (value === '' || value === undefined ? null : value));

const systemAssessmentMetadata = {
  systemPlanProvenance: z.enum(SYSTEM_PLAN_PROVENANCES).optional(),
  planAdherence: z.enum(PLAN_ADHERENCE_VALUES).nullable().optional(),
} as const;
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

/** Historical forms post blank optional fields as `''`; preserve absence, normalize blank to NULL. */
const nullableInstantField = () =>
  z.preprocess((value) => (value === '' ? null : value), instantField().nullable().optional());

/** Historical Money input with exact `bigint` transport; blank is unknown, never zero. */
const nullableSignedMinorField = () =>
  z.preprocess((value) => (value === '' ? null : value), signedMinorField().nullable().optional());

const requiredNullableSignedMinorField = () =>
  z.preprocess((value) => (value === '' ? null : value), signedMinorField().nullable());

const nullablePositiveMinorField = () =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    positiveMinorField().nullable().optional(),
  );

const nullableClosedBpsField = () =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    z.number().int().min(1).max(10_000).nullable().optional(),
  );

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
 * must arrive as a complete pair or not at all, and a Target requires that
 * pair, and a Reward requires a Risk. Since migration 0016 (Phase 14C.1)
 * NEITHER representation being present is also valid shape — the former
 * "at least one representation" floor (`no_plan_representation`) was
 * `createTrade`-only, was never a pure Zod shape rule for `updateTradePlan`
 * (whose own service-level floor is a separate, narrower business rule —
 * see `trade-management.ts`), and is now removed from `createTrade` too, to
 * match the frozen Quick Capture contract. Client-side enforcement only
 * ever narrows what an honest client can send — `trade-management.ts`
 * remains the real, non-bypassable authority (CLAUDE.md §4).
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
    /**
     * Optional since Phase 14B (Independent Trade Lifecycle) — a Trade may
     * be captured with no Strategy classification at all. `setupId` may
     * only be present alongside `strategyId` (a Setup never exists without
     * a Strategy — enforced below and by `trades_setup_requires_strategy_check`
     * at the database layer).
     */
    strategyId: uuidField().optional(),
    setupId: uuidField().optional(),
    /** Opaque optimistic-concurrency guard, never an authoritative Version ID. Required exactly when `setupId` is present — see the refine below. */
    conditionSetToken: conditionSetTokenField().optional(),
    /** Labels/order/Version ownership are resolved exclusively on the server. Meaningless (and must be empty/omitted) without a `setupId`. */
    conditionAnswers: z.array(setupConditionAnswerField()).optional(),
    symbol: requiredTextField(SYMBOL_MAX_LENGTH),
    direction: directionField(),
    /** Phase 15G.5A. Omitted only by the pre-foundation compatibility facade. */
    recordingTiming: z.enum(RECORDING_TIMINGS).optional(),
    /** Required for an explicit 15G.5A write whenever a System Plan exists. */
    systemPlanBasis: z.enum(SYSTEM_PLAN_BASES).optional(),
    /**
     * Price and Money are independent, both-optional Plan representations
     * (Founder-UAT correction slice) — a Trade may supply Price only, Money
     * only, both, or neither (Phase 14C.1 — Quick Capture Persistence
     * Completion). `applyPlanShapeRefinements` enforces pairing/ordering
     * shape only; there is no "at least one representation" floor here
     * anymore.
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
    /**
     * Stable taxonomy keys only; IDs and labels remain server-owned. Omitted
     * means the At Entry view was skipped, while an explicit empty array is a
     * truthful "none selected" answer.
     */
    emotionKeys: emotionKeysField().optional(),
    tradingviewUrl: tradingViewUrlField(),
    notes: optionalTextField(NOTES_MAX_LENGTH),
    chartAttachmentStorageKey: chartAttachmentStorageKeyField().nullable().optional(),
    /**
     * Phase 14E — Open/Close-Only Trade Flow. Present exactly when the
     * normal customer New Trade flow wants this Trade created already
     * `open` — mirrors `OpenTradeSchema`'s own Price/Money shape
     * validation (see the `superRefine` below), just validated as part of
     * Create instead of a second Open action afterward. Omitted entirely
     * still produces the pre-14E `status = 'planned'` shape — retained
     * internally for backward compatibility, no longer reachable from the
     * normal customer form.
     */
    actualResultMode: z.enum(['price', 'money']).optional(),
    actualEntry: decimalField().nullable().optional(),
    actualInitialStop: decimalField().nullable().optional(),
    /** Authoritative, never price-derived (CLAUDE.md §6) — a positive account-currency minor-unit integer string. */
    actualInitialRiskMinor: positiveMinorField().nullable().optional(),
    actualPositionSize: decimalField().nullable().optional(),
    /** Required exactly when `actualResultMode` is present — see the refine below. */
    enteredAt: instantField().optional(),
    /**
     * ADD TRADE CONTRACT v1 (docs/product-contracts/add-trade.md). Present only
     * on a contract At Entry write; every field below is rejected without it.
     */
    recordingContract: z.literal(RECORDING_CONTRACT_ADD_TRADE_V1).optional(),
    /** Absent = Unanswered. */
    targetState: z.enum(TARGET_STATES).optional(),
    targetPrice: positiveDecimalField().nullable().optional(),
    contextEntryPrice: positiveDecimalField().nullable().optional(),
    contextStopPrice: positiveDecimalField().nullable().optional(),
    contextPositionSize: positiveDecimalField().nullable().optional(),
    actualRiskAnswer: z.enum(['matched', 'different']).optional(),
    enteredAtSource: z.enum(ENTERED_AT_SOURCES).optional(),
    exitPlan: exitPlanChoiceField().optional(),
    exitPlanInheritanceDeclined: z.boolean().optional(),
    noStrategy: z.boolean().optional(),
    noSetup: z.boolean().optional(),
  })
  .strict();

const ADD_TRADE_CONTRACT_ONLY_FIELDS = [
  'targetState',
  'targetPrice',
  'contextEntryPrice',
  'contextStopPrice',
  'contextPositionSize',
  'actualRiskAnswer',
  'enteredAtSource',
  'exitPlan',
  'exitPlanInheritanceDeclined',
  'noStrategy',
  'noSetup',
] as const;

/** Price is context on a contract row: no legacy Price plan and no Price-mode Actual. */
const CONTRACT_PRICE_AUTHORITY_FIELDS = [
  'plannedEntry',
  'plannedStop',
  'plannedTarget',
  'plannedPositionSize',
  'actualEntry',
  'actualInitialStop',
  'actualPositionSize',
] as const;

type CreateTradeObject = z.output<typeof CreateTradeObjectSchema>;

/**
 * The contract At Entry write: Account, Symbol, Direction and a positive Risk
 * at Entry are required; an explicit Fixed Target needs Target Profit or a TP
 * price; an entry time carries its source.
 *
 * ACTUAL RISK IS NOT REQUIRED. Matched and Different are answers the trader
 * gives; saying nothing is Unanswered, and the row is stored with no answer
 * rather than a match nobody stated (contract §2, §8). Requiring one here is
 * what made every At Entry Save claim `matched` by default.
 */
function addAddTradeContractIssues(
  data: CreateTradeObject,
  issue: (message: string, path: string) => void,
): void {
  if (data.recordingTiming !== 'at_entry') issue('contract_requires_at_entry', 'recordingTiming');
  if (data.systemPlanBasis !== undefined && data.systemPlanBasis !== 'money') {
    issue('contract_money_is_result_authority', 'systemPlanBasis');
  }
  for (const field of CONTRACT_PRICE_AUTHORITY_FIELDS) {
    if (data[field] != null) issue('contract_price_is_context', field);
  }
  if (data.actualResultMode !== undefined) issue('contract_price_is_context', 'actualResultMode');
  if (data.plannedRiskMinor == null) issue('contract_requires_risk_at_entry', 'plannedRiskMinor');
  const hasTargetProfit = data.plannedRewardMinor != null;
  const hasTargetPrice = data.targetPrice != null;
  if (data.targetState === 'fixed') {
    if (!hasTargetProfit && !hasTargetPrice) {
      issue('fixed_target_requires_representation', 'targetState');
    }
    if (data.plannedRewardMinor === 0n) {
      issue('target_profit_must_be_positive', 'plannedRewardMinor');
    }
  } else if (hasTargetProfit || hasTargetPrice) {
    issue('target_values_require_fixed_target', 'targetState');
  }
  if (data.actualRiskAnswer === 'matched' && data.actualInitialRiskMinor != null) {
    issue('matched_actual_risk_has_no_amount', 'actualInitialRiskMinor');
  }
  if ((data.enteredAt === undefined) !== (data.enteredAtSource === undefined)) {
    issue('entered_at_source_mismatch', 'enteredAtSource');
  }
  if (data.noStrategy === true && data.strategyId !== undefined) {
    issue('no_strategy_conflicts_with_strategy', 'noStrategy');
  }
  if (data.noSetup === true && (data.strategyId === undefined || data.setupId !== undefined)) {
    issue('no_setup_requires_strategy_without_setup', 'noSetup');
  }
  if (
    data.exitPlan?.state === 'saved' &&
    data.exitPlan.provenance === 'strategy_default' &&
    data.strategyId === undefined
  ) {
    issue('inherited_exit_plan_requires_strategy', 'exitPlan');
  }
  if (
    data.exitPlan?.state === 'saved' &&
    data.exitPlan.provenance === 'strategy_default' &&
    data.exitPlanInheritanceDeclined === true
  ) {
    issue('inherited_exit_plan_conflicts_with_declined', 'exitPlan');
  }
  if (
    data.actualRiskAnswer === 'different' &&
    data.actualInitialRiskMinor != null &&
    data.actualInitialRiskMinor === data.plannedRiskMinor
  ) {
    issue('different_actual_risk_equals_risk_at_entry', 'actualInitialRiskMinor');
  }
}

export const CreateTradeSchema = applyPlanShapeRefinements(CreateTradeObjectSchema)
  // Phase 14B: a Setup never exists without a Strategy — the same pairing
  // `trades_setup_requires_strategy_check` enforces at the database layer.
  .refine((data) => data.setupId === undefined || data.strategyId !== undefined, {
    message: 'setup_requires_strategy',
    path: ['setupId'],
  })
  // `conditionSetToken`/`conditionAnswers` are meaningful, and required,
  // exactly when a Setup is selected — never sent for a Setup-less Trade,
  // never omitted for one that has a Setup.
  .refine((data) => (data.setupId === undefined) === (data.conditionSetToken === undefined), {
    message: 'setup_requires_condition_token',
    path: ['conditionSetToken'],
  })
  .refine((data) => data.setupId !== undefined || (data.conditionAnswers ?? []).length === 0, {
    message: 'condition_answers_require_setup',
    path: ['conditionAnswers'],
  })
  // Phase 14E: Actual-execution fields are only meaningful alongside
  // `actualResultMode` (open-at-creation); a legacy/internal `planned`
  // create (no `actualResultMode`) must not smuggle in Actual values —
  // Actual is fact, Planned is optional intent, kept conceptually separate
  // (brief §6).
  .superRefine((data, context) => {
    const authority = validateNewWritePlanAuthority(data, data.systemPlanBasis, {
      allowInferredBasis: data.recordingTiming === undefined,
    });
    if (!authority.ok) {
      context.addIssue({
        code: 'custom',
        message: authority.code,
        path: ['systemPlanBasis'],
      });
    }

    const issue = (message: string, path: string) =>
      context.addIssue({ code: 'custom', message, path: [path] });
    if (data.recordingContract !== undefined) {
      addAddTradeContractIssues(data, issue);
      return;
    }
    for (const field of ADD_TRADE_CONTRACT_ONLY_FIELDS) {
      if (data[field] !== undefined) issue('contract_fields_require_contract', field);
    }

    if (data.actualResultMode === undefined) {
      if (
        data.actualEntry != null ||
        data.actualInitialStop != null ||
        data.actualInitialRiskMinor != null ||
        data.actualPositionSize != null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'actual_execution_requires_result_mode',
          path: ['actualResultMode'],
        });
      }
      if (data.recordingTiming === 'at_entry') {
        if (authority.ok && authority.systemPlanBasis === null) {
          context.addIssue({
            code: 'custom',
            message: 'at_entry_requires_opening_basis',
            path: ['actualResultMode'],
          });
        }
        if (data.enteredAt == null) {
          context.addIssue({ code: 'custom', message: 'entered_at_required', path: ['enteredAt'] });
        }
      } else if (data.enteredAt != null) {
        context.addIssue({
          code: 'custom',
          message: 'actual_execution_requires_result_mode',
          path: ['actualResultMode'],
        });
      }
      return;
    }
    if (data.enteredAt == null) {
      context.addIssue({ code: 'custom', message: 'entered_at_required', path: ['enteredAt'] });
    }
    const hasPrice = data.actualEntry != null && data.actualInitialStop != null;
    const hasPartialPrice = (data.actualEntry == null) !== (data.actualInitialStop == null);
    if (hasPartialPrice || (data.actualResultMode === 'price' && !hasPrice)) {
      context.addIssue({
        code: 'custom',
        message: 'incomplete_actual_price_context',
        path: ['actualEntry'],
      });
    }
    if (data.actualResultMode === 'price' && data.actualInitialRiskMinor != null) {
      context.addIssue({
        code: 'custom',
        message: 'price_mode_forbids_money_risk',
        path: ['actualInitialRiskMinor'],
      });
    }
    if (data.actualResultMode === 'money' && data.actualInitialRiskMinor == null) {
      context.addIssue({
        code: 'custom',
        message: 'money_mode_requires_risk',
        path: ['actualInitialRiskMinor'],
      });
    }
  });
export type CreateTradeActionInput = z.input<typeof CreateTradeSchema>;
export type CreateTradeActionData = z.output<typeof CreateTradeSchema>;

// ---------------------------------------------------------------------------
// 2. updateTradePlan
// ---------------------------------------------------------------------------

const UpdateTradePlanObjectSchema = z
  .object({
    tradeId: uuidField(),
    /** Supplying this is the only way to switch canonical Plan basis. */
    systemPlanBasis: z.enum(SYSTEM_PLAN_BASES).optional(),
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
    actualResultMode: z.enum(['price', 'money']),
    actualEntry: decimalField().nullable().optional(),
    actualInitialStop: decimalField().nullable().optional(),
    /** Authoritative, never price-derived (CLAUDE.md §6) — a positive account-currency minor-unit integer string. */
    actualInitialRiskMinor: positiveMinorField().nullable().optional(),
    actualPositionSize: decimalField().nullable().optional(),
    enteredAt: instantField(),
  })
  .strict()
  .superRefine((data, context) => {
    const hasPrice = data.actualEntry != null && data.actualInitialStop != null;
    const hasPartialPrice = (data.actualEntry == null) !== (data.actualInitialStop == null);
    if (hasPartialPrice || (data.actualResultMode === 'price' && !hasPrice)) {
      context.addIssue({ code: 'custom', message: 'incomplete_actual_price_context' });
    }
    if (data.actualResultMode === 'price' && data.actualInitialRiskMinor != null) {
      context.addIssue({ code: 'custom', message: 'price_mode_forbids_money_risk' });
    }
    if (data.actualResultMode === 'money' && data.actualInitialRiskMinor == null) {
      context.addIssue({ code: 'custom', message: 'money_mode_requires_risk' });
    }
  });
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

const sharedExitPayload = {
  tradeId: uuidField(),
  actualResultMode: z.enum(['price', 'money']),
  exitPrice: decimalField().nullable().optional(),
  realizedPnlMinor: signedMinorField().nullable().optional(),
  exitReason: optionalTextField(EXIT_REASON_MAX_LENGTH),
  exitedAt: instantField(),
};

function validateModeSpecificExit(
  data: {
    actualResultMode: 'price' | 'money';
    exitPrice?: string | null | undefined;
    realizedPnlMinor?: bigint | null | undefined;
  },
  context: z.RefinementCtx,
) {
  if (
    data.actualResultMode === 'price' &&
    (data.exitPrice == null || data.realizedPnlMinor != null)
  ) {
    context.addIssue({ code: 'custom', message: 'invalid_price_exit' });
  }
  if (data.actualResultMode === 'money' && data.realizedPnlMinor == null) {
    context.addIssue({ code: 'custom', message: 'invalid_money_exit' });
  }
}

const addExitPayload = {
  ...sharedExitPayload,
  mutationKey: uuidField(),
  closedBps: z.number().int().min(1).max(10_000),
};

export const AddTradeExitSchema = z
  .object(addExitPayload)
  .strict()
  .superRefine(validateModeSpecificExit);

export const CloseRemainingTradeSchema = z
  .object({ ...sharedExitPayload, mutationKey: uuidField() })
  .strict()
  .superRefine(validateModeSpecificExit);
export const CorrectTradeExitSchema = z
  .object({
    ...sharedExitPayload,
    exitId: uuidField(),
    closedBps: z.number().int().min(1).max(10_000),
  })
  .strict()
  .superRefine(validateModeSpecificExit);

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
    actualResultMode: z.enum(['price', 'money']).optional(),
    actualEntry: decimalField().nullable().optional(),
    actualInitialStop: decimalField().nullable().optional(),
    actualInitialRiskMinor: positiveMinorField().nullable().optional(),
    actualPositionSize: patchableDecimalField(),
    enteredAt: instantField().optional(),
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

const PriceSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    resolutionKind: z.literal('price_exit'),
    systemExitPrice: decimalField(),
    systemExitedAt: instantField().nullable(),
    /** `setup_invalidated` excluded at the schema layer — a closed-set membership check, not a formula (see `markSystemNoTradeAction` for that transition instead). */
    systemExitReason: resolvableSystemExitReasonField(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const MoneyTargetSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    resolutionKind: z.literal('money_target'),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const MoneyStopSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    resolutionKind: z.literal('money_stop'),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const MoneyBreakEvenSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    resolutionKind: z.literal('money_break_even'),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const MoneyCustomSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    resolutionKind: z.literal('money_custom'),
    systemGrossRInput: decimalField(),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

export const ResolveSystemTradeSchema = z.discriminatedUnion('resolutionKind', [
  PriceSystemResolutionSchema.extend({ tradeId: uuidField() }),
  MoneyTargetSystemResolutionSchema.extend({ tradeId: uuidField() }),
  MoneyStopSystemResolutionSchema.extend({ tradeId: uuidField() }),
  MoneyBreakEvenSystemResolutionSchema.extend({ tradeId: uuidField() }),
  MoneyCustomSystemResolutionSchema.extend({ tradeId: uuidField() }),
]);
export type ResolveSystemTradeActionInput = z.input<typeof ResolveSystemTradeSchema>;
export type ResolveSystemTradeActionData = z.output<typeof ResolveSystemTradeSchema>;

// ---------------------------------------------------------------------------
// 8a. createCompletedTrade (Phase 15G.5B service/action foundation)
// ---------------------------------------------------------------------------

/** A price recorded as context only: blank is not recorded, never zero. */
const nullablePositiveDecimalField = () =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    positiveDecimalField().nullable().optional(),
  );

const nullableUnsignedMinorField = () =>
  z.preprocess(
    (value) => (value === '' ? null : value),
    unsignedMinorField().nullable().optional(),
  );

/**
 * One reconstructed exit (contract §10). Every field is optional and a
 * reason-only exit is valid; scope may be an explicit Unknown. P&L and price
 * are independent — price is context and never computes the P&L.
 */
const CompletedTradeExitSchema = z
  .object({
    closedBps: nullableClosedBpsField(),
    exitScope: z.preprocess(
      (value) => (value === '' ? null : value),
      z.enum(HISTORICAL_EXIT_SCOPES).nullable().optional(),
    ),
    exitPrice: nullablePositiveDecimalField(),
    realizedPnlMinor: nullableSignedMinorField(),
    exitReason: optionalTextField(EXIT_REASON_MAX_LENGTH),
    exitedAt: nullableInstantField(),
  })
  .strict()
  .refine(
    (exit) =>
      exit.closedBps != null ||
      exit.exitScope != null ||
      exit.exitPrice != null ||
      exit.realizedPnlMinor != null ||
      exit.exitReason != null ||
      exit.exitedAt != null,
    { message: 'empty_historical_exit' },
  );

/** The most exit events one historical Trade may record. The After Trade form enforces the same limit. */
export const HISTORICAL_EXIT_LIMIT = 50;

/**
 * SAVE CLOSED TRADE — the Add Trade contract After Trade write (contract §13).
 *
 * Only Account, Symbol and Direction are required. Every other answer may be
 * absent, and absent means Unanswered or not recorded — never zero, None, a
 * loss or Not Met. Money is the only result authority: there is no result
 * basis, no price geometry, and Trader Outcome is the trader's own choice,
 * accepted as given and never derived from P&L or R.
 */
const CompletedTradeObjectSchema = z
  .object({
    mutationKey: uuidField(),
    tradingAccountId: uuidField(),
    recordingTiming: z.literal('after_trade'),
    recordingContract: z.literal(RECORDING_CONTRACT_ADD_TRADE_V1),
    symbol: requiredTextField(SYMBOL_MAX_LENGTH),
    direction: directionField(),
    enteredAt: nullableInstantField(),
    exitedAt: nullableInstantField(),
    /** Risk at Entry — the 1R baseline. Blank is not recorded. */
    plannedRiskMinor: nullablePositiveMinorField(),
    /** Absent = Unanswered. */
    actualRiskAnswer: z.enum(ACTUAL_RISK_ANSWERS).optional(),
    /** Only with Different; blank is Different, amount unknown. */
    actualInitialRiskMinor: nullablePositiveMinorField(),
    /** Absent = Unanswered. */
    targetState: z.enum(TARGET_STATES).optional(),
    /** Target Profit — monetary intent. */
    plannedRewardMinor: nullableUnsignedMinorField(),
    /** TP price — context only. */
    targetPrice: nullablePositiveDecimalField(),
    /** Price levels and size — context only, never calculation inputs. */
    contextEntryPrice: nullablePositiveDecimalField(),
    contextStopPrice: nullablePositiveDecimalField(),
    contextPositionSize: nullablePositiveDecimalField(),
    /** Absent = Not recorded. */
    exitPlan: exitPlanChoiceField().optional(),
    /** The authoritative whole-Trade result. Blank is not recorded. */
    finalPnlMinor: nullableSignedMinorField(),
    /**
     * "Use recorded exits as final result" was chosen explicitly (contract
     * §11). A claim only: the service re-checks the history before it
     * records Final Net P&L as adopted from exit history.
     */
    finalPnlAdoptedFromExits: z.literal(true).optional(),
    /** The trader's own classification. Absent = Unanswered. */
    traderOutcome: z.enum(OUTCOME_VALUES).optional(),
    /** Absent = Unanswered; asked only once an exit is recorded. */
    exitHistoryCompleteness: z.enum(EXIT_HISTORY_COMPLETENESS_VALUES).optional(),
    exits: z.array(CompletedTradeExitSchema).max(HISTORICAL_EXIT_LIMIT).optional().default([]),
    strategyId: uuidField().optional(),
    setupId: uuidField().optional(),
    noStrategy: z.boolean().optional(),
    noSetup: z.boolean().optional(),
    conditionSetToken: conditionSetTokenField().optional(),
    /** A partial set is valid; an omitted condition stays Unanswered. */
    conditionAnswers: z.array(recalledSetupConditionAnswerField()).optional(),
    /** Recalled Entry Confidence. */
    confidence: confidenceField().optional(),
    /** Recalled Entry Emotion: omitted = Unanswered, `[]` = None of these. */
    emotionKeys: emotionKeysField().optional(),
    /** Post-Trade Emotion, separate from Entry Emotion. Same conventions. */
    postTradeEmotionKeys: emotionKeysField().optional(),
    timeframe: optionalTextField(TIMEFRAME_MAX_LENGTH),
    session: optionalTextField(SESSION_MAX_LENGTH),
    confirmationNotes: optionalTextField(CONFIRMATION_NOTES_MAX_LENGTH),
    tradingviewUrl: tradingViewUrlField(),
    notes: optionalTextField(NOTES_MAX_LENGTH),
    chartAttachmentStorageKey: chartAttachmentStorageKeyField().nullable().optional(),
    /**
     * Stage 6 After-Trade Context, answered before the Trade exists and saved
     * with it: distinct from the entry notes and the before-entry chart link.
     * Blank is Unanswered; the link follows the Entry Context rule.
     */
    afterTradeNote: optionalTextField(NOTES_MAX_LENGTH),
    afterTradeTradingviewUrl: tradingViewUrlField(),
  })
  .strict();

type CompletedTradeObject = z.output<typeof CompletedTradeObjectSchema>;

/**
 * The After Trade blocking rules: malformed values, and an explicitly selected
 * answer that is incomplete as chosen. Nothing here requires an optional
 * answer, and nothing here rewrites one.
 */
function addAfterTradeContractIssues(
  data: CompletedTradeObject,
  issue: (message: string, path: (string | number)[]) => void,
): void {
  if (data.setupId !== undefined && data.strategyId === undefined) {
    issue('setup_requires_strategy', ['setupId']);
  }
  if ((data.setupId === undefined) !== (data.conditionSetToken === undefined)) {
    issue('setup_requires_condition_token', ['conditionSetToken']);
  }
  if (data.setupId === undefined && (data.conditionAnswers ?? []).length > 0) {
    issue('condition_answers_require_setup', ['conditionAnswers']);
  }
  if (data.noStrategy === true && data.strategyId !== undefined) {
    issue('no_strategy_conflicts_with_strategy', ['noStrategy']);
  }
  if (data.noSetup === true && (data.strategyId === undefined || data.setupId !== undefined)) {
    issue('no_setup_requires_strategy_without_setup', ['noSetup']);
  }
  // After Trade never inherits today's Strategy default (contract §5).
  if (data.exitPlan?.state === 'saved' && data.exitPlan.provenance !== 'selected') {
    issue('after_trade_exit_plan_is_selected', ['exitPlan']);
  }

  const hasTargetProfit = data.plannedRewardMinor != null;
  const hasTargetPrice = data.targetPrice != null;
  if (data.targetState === 'fixed') {
    if (!hasTargetProfit && !hasTargetPrice) {
      issue('fixed_target_requires_representation', ['targetState']);
    }
    if (data.plannedRewardMinor === 0n) {
      issue('target_profit_must_be_positive', ['plannedRewardMinor']);
    }
  } else if (hasTargetProfit || hasTargetPrice) {
    issue('target_values_require_fixed_target', ['targetState']);
  }

  if (data.actualRiskAnswer === 'matched' && data.plannedRiskMinor == null) {
    issue('matched_actual_risk_requires_risk_at_entry', ['actualRiskAnswer']);
  }
  if (data.actualRiskAnswer !== 'different' && data.actualInitialRiskMinor != null) {
    issue('actual_risk_amount_requires_different', ['actualInitialRiskMinor']);
  }
  if (
    data.actualRiskAnswer === 'different' &&
    data.actualInitialRiskMinor != null &&
    data.actualInitialRiskMinor === data.plannedRiskMinor
  ) {
    issue('different_actual_risk_equals_risk_at_entry', ['actualInitialRiskMinor']);
  }

  if (data.exits.length === 0 && data.exitHistoryCompleteness !== undefined) {
    issue('exit_completeness_requires_history', ['exitHistoryCompleteness']);
  }
}

export const CreateCompletedTradeSchema = CompletedTradeObjectSchema.superRefine(
  (data, context) => {
    addAfterTradeContractIssues(data, (message, path) =>
      context.addIssue({ code: 'custom', message, path }),
    );
  },
);
export type CreateCompletedTradeActionInput = z.input<typeof CreateCompletedTradeSchema>;
export type CreateCompletedTradeActionData = z.output<typeof CreateCompletedTradeSchema>;

// ---------------------------------------------------------------------------
// 8b. historical closed-Money provenance transitions
// ---------------------------------------------------------------------------

export const AdoptHistoricalExitSubtotalSchema = z.object({ tradeId: uuidField() }).strict();

export const EditHistoricalFinalResultSchema = z
  .object({ tradeId: uuidField(), finalPnlMinor: requiredNullableSignedMinorField() })
  .strict();

const HistoricalExitCorrectionSchema = z
  .object({
    exitId: uuidField().optional(),
    closedBps: nullableClosedBpsField(),
    /** `unknown` is refused by the service on a legacy row. */
    exitScope: z.preprocess(
      (value) => (value === '' ? null : value),
      z.enum(HISTORICAL_EXIT_SCOPES).nullable().optional(),
    ),
    realizedPnlMinor: nullableSignedMinorField(),
    exitReason: optionalTextField(EXIT_REASON_MAX_LENGTH),
    exitedAt: nullableInstantField(),
  })
  .strict()
  .refine(
    (exit) =>
      exit.closedBps != null ||
      exit.exitScope != null ||
      exit.realizedPnlMinor != null ||
      exit.exitReason != null ||
      exit.exitedAt != null,
    { message: 'empty_historical_exit' },
  );

export const ApplyHistoricalExitHistoryCorrectionSchema = z
  .object({
    tradeId: uuidField(),
    exitHistoryCompleteness: z.enum(EXIT_HISTORY_COMPLETENESS_VALUES).nullable(),
    exits: z.array(HistoricalExitCorrectionSchema),
  })
  .strict()
  .superRefine((data, context) => {
    if ((data.exits.length === 0) !== (data.exitHistoryCompleteness === null)) {
      context.addIssue({
        code: 'custom',
        message: 'exit_completeness_history_mismatch',
        path: ['exitHistoryCompleteness'],
      });
    }
    const ids = data.exits.flatMap((exit) => (exit.exitId === undefined ? [] : [exit.exitId]));
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'duplicate_exit_id', path: ['exits'] });
    }
  });

export type ApplyHistoricalExitHistoryCorrectionActionData = z.output<
  typeof ApplyHistoricalExitHistoryCorrectionSchema
>;

// ---------------------------------------------------------------------------
// 9. markSystemNoTrade
// ---------------------------------------------------------------------------

export const MarkSystemNoTradeSchema = z
  .object({ tradeId: uuidField(), ...systemAssessmentMetadata })
  .strict();
export type MarkSystemNoTradeActionInput = z.input<typeof MarkSystemNoTradeSchema>;
export type MarkSystemNoTradeActionData = z.output<typeof MarkSystemNoTradeSchema>;

export const MarkSystemCannotDetermineSchema = z
  .object({ tradeId: uuidField(), ...systemAssessmentMetadata })
  .strict();
export type MarkSystemCannotDetermineActionInput = z.input<typeof MarkSystemCannotDetermineSchema>;
export type MarkSystemCannotDetermineActionData = z.output<typeof MarkSystemCannotDetermineSchema>;

// ---------------------------------------------------------------------------
// 10. correctSystemResolution
// ---------------------------------------------------------------------------

const CorrectPriceSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('resolved'),
    resolutionKind: z.literal('price_exit'),
    systemExitPrice: decimalField(),
    systemExitedAt: instantField().nullable(),
    systemExitReason: resolvableSystemExitReasonField(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const CorrectMoneyTargetSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('resolved'),
    resolutionKind: z.literal('money_target'),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const CorrectMoneyStopSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('resolved'),
    resolutionKind: z.literal('money_stop'),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const CorrectMoneyBreakEvenSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('resolved'),
    resolutionKind: z.literal('money_break_even'),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const CorrectMoneyCustomSystemResolutionSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('resolved'),
    resolutionKind: z.literal('money_custom'),
    systemGrossRInput: decimalField(),
    systemExitedAt: instantField().nullable(),
    systemCostR: optionalSystemCostField(),
  })
  .strict();

const CorrectSystemResolutionToResolvedSchema = z.discriminatedUnion('resolutionKind', [
  CorrectPriceSystemResolutionSchema,
  CorrectMoneyTargetSystemResolutionSchema,
  CorrectMoneyStopSystemResolutionSchema,
  CorrectMoneyBreakEvenSystemResolutionSchema,
  CorrectMoneyCustomSystemResolutionSchema,
]);

const CorrectSystemResolutionToNoTradeSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('no_trade'),
  })
  .strict();

const CorrectSystemResolutionToCannotDetermineSchema = z
  .object({
    ...systemAssessmentMetadata,
    tradeId: uuidField(),
    target: z.literal('cannot_determine'),
  })
  .strict();

/**
 * A discriminated union on `target` — structurally, `target: 'pending'` does
 * not exist as a member, so reverting terminal System state to `pending` is
 * rejected at the schema layer, not merely by the service's own runtime
 * check (`trade-management.ts`'s `correctSystemResolution` doc comment).
 */
export const CorrectSystemResolutionSchema = z.union([
  CorrectSystemResolutionToResolvedSchema,
  CorrectSystemResolutionToNoTradeSchema,
  CorrectSystemResolutionToCannotDetermineSchema,
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
// ---------------------------------------------------------------------------
// 15. replaceTradeEmotions
// ---------------------------------------------------------------------------

export const ReplaceTradeEmotionsSchema = z
  .object({ tradeId: uuidField(), emotionKeys: emotionKeysField() })
  .strict();
export type ReplaceTradeEmotionsActionInput = z.input<typeof ReplaceTradeEmotionsSchema>;
export type ReplaceTradeEmotionsActionData = z.output<typeof ReplaceTradeEmotionsSchema>;

// ---------------------------------------------------------------------------
// 16. updateTradeReviewNotes
// ---------------------------------------------------------------------------

export const UpdateTradeReviewNotesSchema = z
  .object({
    tradeId: uuidField(),
    reviewNotes: z
      .string()
      .max(REVIEW_NOTES_MAX_LENGTH)
      .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' })
      .nullable(),
  })
  .strict();
export type UpdateTradeReviewNotesActionInput = z.input<typeof UpdateTradeReviewNotesSchema>;
export type UpdateTradeReviewNotesActionData = z.output<typeof UpdateTradeReviewNotesSchema>;

// ---------------------------------------------------------------------------
// 17. assignTradeClassification (Phase 14B)
// ---------------------------------------------------------------------------

/**
 * Late Strategy/Setup classification — supports only the three sanctioned
 * progressive transitions (`no framework -> Strategy`,
 * `no framework -> Strategy + Setup`, `Strategy only -> + Setup`); the
 * service independently re-verifies which transition is actually legal for
 * the Trade's CURRENT stored classification (unknowable from this isolated
 * schema, exactly {@link UpdateTradePlanSchema}'s own reasoning). At least
 * one of `strategyId`/`setupId` must be present.
 */
export const AssignTradeClassificationSchema = z
  .object({
    tradeId: uuidField(),
    strategyId: uuidField().optional(),
    setupId: uuidField().optional(),
  })
  .strict()
  .refine((data) => data.strategyId !== undefined || data.setupId !== undefined, {
    message: 'no_classification_provided',
    path: ['strategyId'],
  });
export type AssignTradeClassificationActionInput = z.input<typeof AssignTradeClassificationSchema>;
export type AssignTradeClassificationActionData = z.output<typeof AssignTradeClassificationSchema>;

export const TradeIdSchema = uuidField();

// ---------------------------------------------------------------------------
// 18. Record Exit / Final Close — the Add Trade contract live exit (§10–§12)
// ---------------------------------------------------------------------------

/**
 * ONE EXIT LEG ON A LIVE TRADE (contract §10). Every field is optional: P&L
 * for this exit, % of the original position, exit time, exit price (context
 * only) and a reason. No Money/Price basis exists here — Money is the result
 * authority and a price is never turned into one (§3).
 */
const contractExitLegFields = {
  realizedPnlMinor: nullableSignedMinorField(),
  closedBps: nullableClosedBpsField(),
  exitPrice: nullablePositiveDecimalField(),
  exitedAt: nullableInstantField(),
  exitReason: optionalTextField(EXIT_REASON_MAX_LENGTH),
};

/**
 * PART — one exit leg while the position stays open (contract §10–§11).
 * `.strict()` is the boundary that makes a Part unable to carry a whole-Trade
 * result: Final Net P&L, Trader Outcome, completeness or a final exit time are
 * unrecognized keys here, not ignored ones.
 */
const RecordPartExitSchema = z
  .object({
    tradeId: uuidField(),
    mutationKey: uuidField(),
    scope: z.literal('part'),
    ...contractExitLegFields,
  })
  .strict();

/**
 * ALL REMAINING — the Final Close (contract §11). Choosing this scope IS the
 * explicit confirmation that the remaining position is closed. Final Net P&L
 * and Trader Outcome are strongly prompted and optional; Final Net P&L is the
 * authoritative whole-Trade result, and the exit subtotal is adopted only by
 * the explicit `finalPnlAdoptedFromExits` claim, which the service re-checks.
 * Post-Trade Emotion (After-Trade Context, §9) may be recorded with it.
 */
const FinalCloseSchema = z
  .object({
    tradeId: uuidField(),
    mutationKey: uuidField(),
    scope: z.literal('all_remaining'),
    ...contractExitLegFields,
    /** The authoritative whole-Trade result. Absent/null = not recorded. */
    finalPnlMinor: nullableSignedMinorField(),
    finalPnlAdoptedFromExits: z.literal(true).optional(),
    /** The trader's own classification. Absent = Unanswered. */
    traderOutcome: z.enum(OUTCOME_VALUES).optional(),
    /** Absent = Unanswered. */
    exitHistoryCompleteness: z.enum(EXIT_HISTORY_COMPLETENESS_VALUES).optional(),
    /** The Trade's final exit time. Optional; never filled in by the server. Post-Trade Emotion is not part of a close (stage 6). */
    finalExitedAt: nullableInstantField(),
  })
  .strict();

export const RecordContractExitSchema = z.discriminatedUnion('scope', [
  RecordPartExitSchema,
  FinalCloseSchema,
]);
export type RecordContractExitActionInput = z.input<typeof RecordContractExitSchema>;
export type RecordContractExitActionData = z.output<typeof RecordContractExitSchema>;

// ---------------------------------------------------------------------------
// 19. Stage 6 — After-Trade Context
// ---------------------------------------------------------------------------

/**
 * A three-way patch: a key left out is unchanged, `null` clears it back to
 * Unanswered, and a value sets it. A note is trimmed and never blank — clear
 * it with `null`. The chart link follows the Entry Context rule exactly.
 * Post-Trade Emotion: `[]` is an explicit None, a list is the trader's choice.
 */
const afterTradeNoteField = () =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z
      .string()
      .min(1, { message: 'blank_note' })
      .max(NOTES_MAX_LENGTH)
      .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' })
      .nullable()
      .optional(),
  );

export const RecordAfterTradeContextSchema = z
  .object({
    tradeId: uuidField(),
    mutationKey: uuidField(),
    afterTradeNote: afterTradeNoteField(),
    afterTradeTradingviewUrl: patchableTradingViewUrlField(),
    postTradeEmotionKeys: emotionKeysField().nullable().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.afterTradeNote !== undefined ||
      input.afterTradeTradingviewUrl !== undefined ||
      input.postTradeEmotionKeys !== undefined,
    { message: 'empty_patch' },
  );
export type RecordAfterTradeContextActionInput = z.input<typeof RecordAfterTradeContextSchema>;
export type RecordAfterTradeContextActionData = z.output<typeof RecordAfterTradeContextSchema>;
