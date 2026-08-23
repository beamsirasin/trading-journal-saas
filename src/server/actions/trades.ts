'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import type { CalcFailureReason } from '@/lib/calc/types';
import type { OutcomeValue, SystemStatus, TradeStatus } from '@/lib/trades/constants';
import {
  mapPlanCalcReasonToFieldErrors,
  mapServiceErrorToPublicCode,
  mapSystemCalcReasonToFieldErrors,
  type TradePublicErrorCode,
} from '@/lib/trades/errors';
import {
  AddTradeExitSchema,
  AssignTradeClassificationSchema,
  AttachTradeMistakeSchema,
  CancelTradeSchema,
  CloseRemainingTradeSchema,
  CloseTradeSchema,
  CorrectSystemResolutionSchema,
  CorrectTradeExecutionSchema,
  CorrectTradeExitSchema,
  CorrectTradeIdentitySchema,
  CreateTradeSchema,
  MarkSystemNoTradeSchema,
  OpenTradeSchema,
  RemoveTradeMistakeSchema,
  ReplaceTradeEmotionsSchema,
  ResolveSystemTradeSchema,
  SoftDeleteTradeSchema,
  UpdateTradePlanSchema,
  UpdateTradeReviewNotesSchema,
  UpdateTradeRuleCheckSchema,
} from '@/lib/trades/schemas';
import {
  ForbiddenError,
  getActiveWorkspaceContext,
  requireTradeManagement,
} from '@/server/auth/dal';
import {
  attachTradeMistake,
  removeTradeMistake,
  replaceTradeEmotions,
  updateTradeReviewNotes,
  updateTradeRuleCheck,
} from '@/server/services/trade-discipline';
import {
  addTradeExit,
  closeRemainingTrade,
  correctTradeExit,
} from '@/server/services/trade-execution';
import {
  assignTradeClassification,
  cancelTrade,
  closeTrade,
  correctSystemResolution,
  correctTradeExecution,
  correctTradeIdentity,
  createTrade,
  markSystemNoTrade,
  openTrade,
  resolveSystemTrade,
  softDeleteTrade,
  updateTradePlan,
} from '@/server/services/trade-management';

/**
 * Trade Server Actions — Phase 08C. The Phase 08D/E UI calls these
 * Zod-validated, session-authorized entry points; none of them ever reads
 * `workspaceId`/`actorUserId` from client input — `getActiveWorkspaceContext()`
 * derives both from the session, exactly like `src/server/actions/
 * strategies.ts`. `requireTradeManagement` (`src/server/auth/dal.ts`) is an
 * additional, earlier defense-in-depth check that verifies authentication and
 * active membership ONLY — it never evaluates entitlement/access mode, so it
 * can never block an exact-key `createTrade` replay that the service layer
 * (`trade-management.ts`) would otherwise allow. The service independently
 * re-verifies membership and authorization itself, in its own canonical
 * order, regardless of what happens here — this file is not the
 * authorization boundary by itself.
 *
 * No financial formula is ever evaluated in this file. Every derived value
 * (`plannedR`, `actualR`, `traderOutcome`, `systemR`, `systemOutcome`,
 * `calcVersion`) comes from calling an 08B service, which is itself the only
 * caller of `src/lib/calc/trade.ts` — this file imports nothing from
 * `@/lib/calc/trade` at all.
 *
 * ## The public result contract
 *
 * Every action returns {@link TradeActionResult}, one closed,
 * JSON-serializable discriminated union: `{ ok: true; data: T }` or
 * `{ ok: false; error: { code, fieldErrors? } }` — never a `bigint`, a `Date`
 * object, an `Error` instance, a raw SQL error, or a stack trace. Every
 * failure — validation, unauthenticated, forbidden, a mapped service denial,
 * an unexpected internal error — collapses to a {@link TradePublicErrorCode}.
 *
 * Success payloads stay deliberately minimal — an identifier the caller
 * already trusts (echoed back for convenience), a static invariant of which
 * action ran (e.g. `status: 'open'` after `openTradeAction` succeeds — the
 * only way this action can succeed at all), and, where the underlying 08B
 * service result actually carries it, the freshly-derived value the caller
 * needs to update its own optimistic UI (`actualR`/`traderOutcome` after
 * close, `systemR`/`systemOutcome` after System resolve, `plannedR` after a
 * Plan/identity correction). Nothing here re-queries the database merely to
 * enrich a response — the Trade list/detail DAL
 * (`src/server/dal/trades.ts`) is the canonical read path the UI refreshes
 * through when rendered server data changes.
 */

type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface TradeActionError {
  readonly code: TradePublicErrorCode;
  readonly fieldErrors?: FieldErrors;
}

interface TradeActionFailure {
  readonly ok: false;
  readonly error: TradeActionError;
}

/** The one closed, serializable action-result shape every export below returns. */
export type TradeActionResult<T> = { readonly ok: true; readonly data: T } | TradeActionFailure;

/**
 * Zod's inferred output type for an `.optional()`/`.nullable().optional()`
 * field is `T | undefined` — a strictly WIDER type than the 08B service
 * input interfaces declare (`field?: T` under this project's
 * `exactOptionalPropertyTypes: true`, which distinguishes "key omitted" from
 * "key present with value `undefined`"). At RUNTIME the two can never
 * diverge for input parsed from a Server Action's JSON-only argument: JSON
 * has no `undefined` literal, so a key is either present with a real value
 * or genuinely absent — Zod never fabricates a present-with-`undefined` key
 * from that source. This helper documents and applies that one narrowing at
 * the single boundary where it is needed, rather than repeating an inline
 * cast at every call site below.
 */
function asServiceInput<T>(patch: object): T {
  return patch as T;
}

/** Values are error MESSAGES only — the rejected raw input is never echoed back (matches `src/server/actions/strategies.ts`'s own `toFieldErrors`). */
function toFieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

function validationFailure(error: z.ZodError): TradeActionFailure {
  return { ok: false, error: { code: 'validation_error', fieldErrors: toFieldErrors(error) } };
}

function serviceFailure(code: string): TradeActionFailure {
  return { ok: false, error: { code: mapServiceErrorToPublicCode(code) } };
}

interface CalcFailureResult {
  readonly code: string;
  readonly calcReason?: CalcFailureReason;
}

/** `invalid_plan` failures from `createTrade`/`updateTradePlan`/`correctTradeIdentity` — attaches a field error only when the service actually supplied a `calcReason`. */
function planFailure(result: CalcFailureResult): TradeActionFailure {
  const publicCode = mapServiceErrorToPublicCode(result.code);
  if (result.calcReason !== undefined && publicCode === 'invalid_plan') {
    return {
      ok: false,
      error: { code: publicCode, fieldErrors: mapPlanCalcReasonToFieldErrors(result.calcReason) },
    };
  }
  return { ok: false, error: { code: publicCode } };
}

/** The System-axis equivalent of {@link planFailure}, for `resolveSystemTrade`/`correctSystemResolution`. */
function systemFailure(result: CalcFailureResult): TradeActionFailure {
  const publicCode = mapServiceErrorToPublicCode(result.code);
  if (result.calcReason !== undefined && publicCode === 'invalid_system_status_transition') {
    return {
      ok: false,
      error: { code: publicCode, fieldErrors: mapSystemCalcReasonToFieldErrors(result.calcReason) },
    };
  }
  return { ok: false, error: { code: publicCode } };
}

/**
 * Revalidated after successful mutations whose rendered server data changes,
 * including an idempotent replay/no-op. The three Rule/Mistake actions are the
 * exception: their client editors reconcile the minimal, server-confirmed
 * result locally, avoiding a full authenticated detail render in the action
 * response. Reload/navigation still reads canonical DAL state.
 * `/app/trades/new`'s selector data (`getTradeCreateOptions`) reads Trading
 * Accounts/Strategies/Setups — tables no Trade mutation in this file ever
 * writes to — so it is deliberately never revalidated here.
 */
function revalidateTradeRoutes(): void {
  for (const locale of ['en', 'th']) {
    revalidatePath(`/${locale}/app/trades`);
  }
}

/**
 * Resolves trusted context and the `'member'` authorization precheck shared
 * by every mutating action below — authentication plus active-membership
 * derivation ONLY, exactly `src/server/actions/strategies.ts`'s own
 * `resolveTrustedContext`. Never resolves entitlement/access mode; that
 * distinction is drawn later, inside each service's own transaction.
 */
async function resolveTrustedContext(): Promise<
  { readonly ok: true; readonly workspaceId: string; readonly userId: string } | TradeActionFailure
> {
  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradeManagement(workspaceId);
    return { ok: true, workspaceId, userId };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: { code: 'workspace_access_denied' } };
    }
    if (error instanceof Error && error.name === 'UnauthenticatedError') {
      return { ok: false, error: { code: 'unauthenticated' } };
    }
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 1. createTradeAction
// ---------------------------------------------------------------------------

export interface CreateTradeData {
  readonly tradeId: string;
  /** `false`: this call created the Trade. `true`: an exact workspace-scoped `mutationKey` replay returned an existing Trade — no new write occurred. */
  readonly alreadyCreated: boolean;
}

export type CreateTradeActionResult = TradeActionResult<CreateTradeData>;

export async function createTradeAction(input: unknown): Promise<CreateTradeActionResult> {
  const parsed = CreateTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await createTrade(ctx.workspaceId, ctx.userId, {
      mutationKey: parsed.data.mutationKey,
      tradingAccountId: parsed.data.tradingAccountId,
      recordingTiming: parsed.data.recordingTiming,
      systemPlanBasis: parsed.data.systemPlanBasis,
      strategyId: parsed.data.strategyId,
      setupId: parsed.data.setupId,
      conditionSetToken: parsed.data.conditionSetToken,
      conditionAnswers: parsed.data.conditionAnswers,
      symbol: parsed.data.symbol,
      direction: parsed.data.direction,
      plannedEntry: parsed.data.plannedEntry ?? null,
      plannedStop: parsed.data.plannedStop ?? null,
      plannedTarget: parsed.data.plannedTarget ?? null,
      plannedPositionSize: parsed.data.plannedPositionSize ?? null,
      plannedRiskMinor: parsed.data.plannedRiskMinor ?? null,
      plannedRewardMinor: parsed.data.plannedRewardMinor ?? null,
      timeframe: parsed.data.timeframe ?? null,
      session: parsed.data.session ?? null,
      confirmationNotes: parsed.data.confirmationNotes ?? null,
      confidence: parsed.data.confidence ?? null,
      ...(parsed.data.emotionKeys === undefined ? {} : { emotionKeys: parsed.data.emotionKeys }),
      tradingviewUrl: parsed.data.tradingviewUrl ?? null,
      notes: parsed.data.notes ?? null,
      chartAttachmentStorageKey: parsed.data.chartAttachmentStorageKey ?? null,
      // Phase 14E — present exactly when the normal customer New Trade form
      // wants this Trade created already `open`; omitted for the legacy
      // `planned` create path.
      actualResultMode: parsed.data.actualResultMode,
      actualEntry: parsed.data.actualEntry ?? null,
      actualInitialStop: parsed.data.actualInitialStop ?? null,
      actualInitialRiskMinor: parsed.data.actualInitialRiskMinor ?? null,
      actualPositionSize: parsed.data.actualPositionSize ?? null,
      enteredAt: parsed.data.enteredAt,
    });
    if (!result.ok) return planFailure(result);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId: result.tradeId, alreadyCreated: result.alreadyCreated } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 2. updateTradePlanAction
// ---------------------------------------------------------------------------

export interface UpdateTradePlanData {
  readonly tradeId: string;
  readonly plannedR: string | null;
}

export type UpdateTradePlanActionResult = TradeActionResult<UpdateTradePlanData>;

export async function updateTradePlanAction(input: unknown): Promise<UpdateTradePlanActionResult> {
  const parsed = UpdateTradePlanSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...patch } = parsed.data;
    const result = await updateTradePlan(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      asServiceInput(patch),
    );
    if (!result.ok) return planFailure(result);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, plannedR: result.plannedR } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 3. correctTradeIdentityAction
// ---------------------------------------------------------------------------

export interface CorrectTradeIdentityData {
  readonly tradeId: string;
  readonly plannedR: string | null;
}

export type CorrectTradeIdentityActionResult = TradeActionResult<CorrectTradeIdentityData>;

export async function correctTradeIdentityAction(
  input: unknown,
): Promise<CorrectTradeIdentityActionResult> {
  const parsed = CorrectTradeIdentitySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...patch } = parsed.data;
    const result = await correctTradeIdentity(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      asServiceInput(patch),
    );
    if (!result.ok) return planFailure(result);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, plannedR: result.plannedR } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 4. openTradeAction
// ---------------------------------------------------------------------------

export interface OpenTradeData {
  readonly tradeId: string;
  /** Static — the only way this action can succeed at all is the `planned -> open` transition. */
  readonly status: Extract<TradeStatus, 'open'>;
}

export type OpenTradeActionResult = TradeActionResult<OpenTradeData>;

export async function openTradeAction(input: unknown): Promise<OpenTradeActionResult> {
  const parsed = OpenTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...rest } = parsed.data;
    const result = await openTrade(ctx.workspaceId, ctx.userId, tradeId, asServiceInput(rest));
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, status: 'open' } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 5. closeTradeAction
// ---------------------------------------------------------------------------

export interface CloseTradeData {
  readonly tradeId: string;
  readonly status: Extract<TradeStatus, 'closed'>;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
}

export type CloseTradeActionResult = TradeActionResult<CloseTradeData>;

export async function closeTradeAction(input: unknown): Promise<CloseTradeActionResult> {
  const parsed = CloseTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...rest } = parsed.data;
    const result = await closeTrade(ctx.workspaceId, ctx.userId, tradeId, asServiceInput(rest));
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return {
      ok: true,
      data: {
        tradeId,
        status: 'closed',
        actualR: result.actualR,
        traderOutcome: result.traderOutcome,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export type TradeExitActionResult = TradeActionResult<{
  readonly tradeId: string;
  readonly exitId: string;
  readonly status: 'open' | 'closed';
  readonly closedBps: number;
  readonly remainingBps: number;
  readonly realizedR: string;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
}>;

export async function addTradeExitAction(input: unknown): Promise<TradeExitActionResult> {
  const parsed = AddTradeExitSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const { tradeId, actualResultMode: _mode, ...exit } = parsed.data;
    const result = await addTradeExit(ctx.workspaceId, ctx.userId, tradeId, asServiceInput(exit));
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, ...result } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export async function closeRemainingTradeAction(input: unknown): Promise<TradeExitActionResult> {
  const parsed = CloseRemainingTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const { tradeId, actualResultMode: _mode, ...exit } = parsed.data;
    const result = await closeRemainingTrade(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      asServiceInput(exit),
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, ...result } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export async function correctTradeExitAction(input: unknown): Promise<TradeExitActionResult> {
  const parsed = CorrectTradeExitSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const { tradeId, exitId, actualResultMode: _mode, ...exit } = parsed.data;
    const result = await correctTradeExit(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      exitId,
      asServiceInput(exit),
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, ...result } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 6. cancelTradeAction
// ---------------------------------------------------------------------------

export interface CancelTradeData {
  readonly tradeId: string;
  readonly status: Extract<TradeStatus, 'canceled'>;
}

export type CancelTradeActionResult = TradeActionResult<CancelTradeData>;

export async function cancelTradeAction(input: unknown): Promise<CancelTradeActionResult> {
  const parsed = CancelTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId } = parsed.data;
    const result = await cancelTrade(ctx.workspaceId, ctx.userId, tradeId);
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, status: 'canceled' } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 7. correctTradeExecutionAction
// ---------------------------------------------------------------------------

export interface CorrectTradeExecutionData {
  readonly tradeId: string;
}

export type CorrectTradeExecutionActionResult = TradeActionResult<CorrectTradeExecutionData>;

export async function correctTradeExecutionAction(
  input: unknown,
): Promise<CorrectTradeExecutionActionResult> {
  const parsed = CorrectTradeExecutionSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...patch } = parsed.data;
    const result = await correctTradeExecution(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      asServiceInput(patch),
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 8. resolveSystemTradeAction
// ---------------------------------------------------------------------------

export interface ResolveSystemTradeData {
  readonly tradeId: string;
  readonly systemStatus: Extract<SystemStatus, 'resolved'>;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
}

export type ResolveSystemTradeActionResult = TradeActionResult<ResolveSystemTradeData>;

export async function resolveSystemTradeAction(
  input: unknown,
): Promise<ResolveSystemTradeActionResult> {
  const parsed = ResolveSystemTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...rest } = parsed.data;
    const result = await resolveSystemTrade(ctx.workspaceId, ctx.userId, tradeId, rest);
    if (!result.ok) return systemFailure(result);
    revalidateTradeRoutes();
    return {
      ok: true,
      data: {
        tradeId,
        systemStatus: 'resolved',
        systemR: result.systemR,
        systemOutcome: result.systemOutcome,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 9. markSystemNoTradeAction
// ---------------------------------------------------------------------------

export interface MarkSystemNoTradeData {
  readonly tradeId: string;
  readonly systemStatus: Extract<SystemStatus, 'no_trade'>;
}

export type MarkSystemNoTradeActionResult = TradeActionResult<MarkSystemNoTradeData>;

export async function markSystemNoTradeAction(
  input: unknown,
): Promise<MarkSystemNoTradeActionResult> {
  const parsed = MarkSystemNoTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId } = parsed.data;
    const result = await markSystemNoTrade(ctx.workspaceId, ctx.userId, tradeId);
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, systemStatus: 'no_trade' } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 10. correctSystemResolutionAction
// ---------------------------------------------------------------------------

export interface CorrectSystemResolutionData {
  readonly tradeId: string;
  readonly systemStatus: Extract<SystemStatus, 'resolved' | 'no_trade'>;
}

export type CorrectSystemResolutionActionResult = TradeActionResult<CorrectSystemResolutionData>;

export async function correctSystemResolutionAction(
  input: unknown,
): Promise<CorrectSystemResolutionActionResult> {
  const parsed = CorrectSystemResolutionSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...request } = parsed.data;
    const result = await correctSystemResolution(ctx.workspaceId, ctx.userId, tradeId, request);
    if (!result.ok) return systemFailure(result);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, systemStatus: parsed.data.target } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 11. softDeleteTradeAction
// ---------------------------------------------------------------------------

export interface SoftDeleteTradeData {
  readonly tradeId: string;
  readonly deleted: true;
}

export type SoftDeleteTradeActionResult = TradeActionResult<SoftDeleteTradeData>;

export async function softDeleteTradeAction(input: unknown): Promise<SoftDeleteTradeActionResult> {
  const parsed = SoftDeleteTradeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId } = parsed.data;
    const result = await softDeleteTrade(ctx.workspaceId, ctx.userId, tradeId);
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return { ok: true, data: { tradeId, deleted: true } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 12. updateTradeRuleCheckAction
// ---------------------------------------------------------------------------

export interface UpdateTradeRuleCheckData {
  readonly tradeId: string;
  readonly ruleKey: string;
  readonly checkStatus: string;
}

export type UpdateTradeRuleCheckActionResult = TradeActionResult<UpdateTradeRuleCheckData>;

export async function updateTradeRuleCheckAction(
  input: unknown,
): Promise<UpdateTradeRuleCheckActionResult> {
  const parsed = UpdateTradeRuleCheckSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ruleKey, checkStatus } = parsed.data;
    const result = await updateTradeRuleCheck(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      ruleKey,
      checkStatus,
    );
    if (!result.ok) return serviceFailure(result.code);
    return { ok: true, data: { tradeId, ruleKey, checkStatus } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 13. attachTradeMistakeAction
// ---------------------------------------------------------------------------

export interface AttachTradeMistakeData {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly alreadyAttached: boolean;
}

export type AttachTradeMistakeActionResult = TradeActionResult<AttachTradeMistakeData>;

export async function attachTradeMistakeAction(
  input: unknown,
): Promise<AttachTradeMistakeActionResult> {
  const parsed = AttachTradeMistakeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, mistakeTypeId, note } = parsed.data;
    const result = await attachTradeMistake(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      mistakeTypeId,
      note ?? null,
    );
    if (!result.ok) return serviceFailure(result.code);
    return {
      ok: true,
      data: { tradeId, mistakeTypeId, alreadyAttached: result.alreadyAttached },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 14. removeTradeMistakeAction
// ---------------------------------------------------------------------------

export interface RemoveTradeMistakeData {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly alreadyRemoved: boolean;
}

export type RemoveTradeMistakeActionResult = TradeActionResult<RemoveTradeMistakeData>;

export async function removeTradeMistakeAction(
  input: unknown,
): Promise<RemoveTradeMistakeActionResult> {
  const parsed = RemoveTradeMistakeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, mistakeTypeId } = parsed.data;
    const result = await removeTradeMistake(ctx.workspaceId, ctx.userId, tradeId, mistakeTypeId);
    if (!result.ok) return serviceFailure(result.code);
    return {
      ok: true,
      data: { tradeId, mistakeTypeId, alreadyRemoved: result.alreadyRemoved },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 15. replaceTradeEmotionsAction
// ---------------------------------------------------------------------------

export async function replaceTradeEmotionsAction(input: unknown): Promise<
  TradeActionResult<{
    readonly tradeId: string;
    readonly emotionKeys: readonly string[];
  }>
> {
  const parsed = ReplaceTradeEmotionsSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const result = await replaceTradeEmotions(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.tradeId,
      parsed.data.emotionKeys,
    );
    if (!result.ok) return serviceFailure(result.code);
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 16. updateTradeReviewNotesAction
// ---------------------------------------------------------------------------

export async function updateTradeReviewNotesAction(input: unknown): Promise<
  TradeActionResult<{
    readonly tradeId: string;
    readonly reviewNotes: string | null;
  }>
> {
  const parsed = UpdateTradeReviewNotesSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const result = await updateTradeReviewNotes(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.tradeId,
      parsed.data.reviewNotes,
    );
    if (!result.ok) return serviceFailure(result.code);
    return { ok: true, data: { tradeId: parsed.data.tradeId, reviewNotes: result.reviewNotes } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// 17. assignTradeClassificationAction (Phase 14B)
// ---------------------------------------------------------------------------

export interface AssignTradeClassificationData {
  readonly tradeId: string;
  readonly strategyId: string;
  readonly setupId: string | null;
}

export type AssignTradeClassificationActionResult =
  TradeActionResult<AssignTradeClassificationData>;

export async function assignTradeClassificationAction(
  input: unknown,
): Promise<AssignTradeClassificationActionResult> {
  const parsed = AssignTradeClassificationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { tradeId, ...rest } = parsed.data;
    const result = await assignTradeClassification(
      ctx.workspaceId,
      ctx.userId,
      tradeId,
      asServiceInput(rest),
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateTradeRoutes();
    return {
      ok: true,
      data: { tradeId, strategyId: result.strategyId, setupId: result.setupId },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}
