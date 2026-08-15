'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import { mapServiceErrorToPublicCode, type StrategyPublicErrorCode } from '@/lib/strategies/errors';
import {
  CreateSetupConditionSchema,
  CreateSetupSchema,
  CreateStrategyRuleSchema,
  CreateStrategySchema,
  RemoveSetupConditionSchema,
  RemoveStrategyRuleSchema,
  SetupLifecycleSchema,
  StrategyLifecycleSchema,
  UpdateSetupConditionSchema,
  UpdateSetupContentSchema,
  UpdateStrategyContentSchema,
  UpdateStrategyRuleSchema,
} from '@/lib/strategies/schemas';
import {
  ForbiddenError,
  getActiveWorkspaceContext,
  requireStrategyManagement,
} from '@/server/auth/dal';
import {
  archiveSetup,
  archiveStrategy,
  createSetup,
  createSetupCondition,
  createStrategy,
  createStrategyRule,
  removeSetupCondition,
  removeStrategyRule,
  restoreSetup,
  restoreStrategy,
  updateSetupCondition,
  updateSetupContent,
  updateStrategyContent,
  updateStrategyRule,
} from '@/server/services/strategy-management';

/**
 * Strategy/Setup/Rule Server Actions — Phase 06D. The Zod-validated,
 * session-authorized entry points a future management UI calls; none of them
 * ever reads `workspaceId`/`actorUserId` from client input —
 * `getActiveWorkspaceContext()` derives both from the session, exactly like
 * `src/server/actions/trading-accounts.ts`. `requireStrategyManagement`
 * (`src/server/auth/dal.ts`) is an additional, earlier defense-in-depth
 * check that verifies authentication and active membership only — it never
 * evaluates entitlement/access mode, so it can never block an exact-key
 * create replay that the service layer (`strategy-management.ts`) would
 * otherwise allow. The service independently re-verifies membership and
 * authorization itself, in the canonical order (membership → exact-key
 * replay lookup → entitlement for a genuinely new key), regardless of what
 * happens here — this file is not the authorization boundary by itself.
 *
 * Deliberately NOT exposed as actions: `copyCurrentVersionInTx`,
 * `lockStrategyVersionForReferenceInTx`, or any direct write to
 * `current_version_id`/`locked_at` — those are internal to the service
 * layer and Phase 08's future Trade-creation transaction, never reachable
 * from client input.
 *
 * ## The public result contract
 *
 * Every action returns {@link StrategyActionResult}, one closed,
 * JSON-serializable discriminated union: `{ ok: true; data: T }` or
 * `{ ok: false; error: { code, fieldErrors? } }` — never an `Error`
 * instance, an `undefined` field whose meaning shifts per action, a raw SQL
 * error, a stack trace, or an internal cause. Every failure — validation,
 * unauthenticated, forbidden, a mapped service denial, an unexpected
 * internal error — collapses to a {@link StrategyPublicErrorCode}.
 * Unexpected errors are logged server-side only (via the caught exception
 * being discarded here, never serialized to the client).
 *
 * Each `data` shape below is intentionally the smallest structurally useful
 * response its service call can reliably provide: an identity ID the client
 * already trusts (often its own input, echoed back for convenience — never a
 * new lookup performed solely to enrich this), the canonical *current*
 * Strategy Version (`versionId`/`versionNumber`) at response time — never
 * framed as "the version this was originally created in," since a later
 * copy-on-write can supersede it — and, where the service exposes it safely,
 * whether this call itself triggered a copy. `strategyId`/`setupId`/
 * `ruleKey` are echoed because the client already supplied and trusts them;
 * `ruleKey` (not the internal Rule row id) is the one approved Rule
 * identifier per CLAUDE.md §4's non-enumerable-ID posture. Never returned:
 * `workspaceId`, `actorUserId`, `mutationKey`, `lockedAt`, or any other
 * audit/internal-only field.
 */

type FieldErrors = Readonly<Record<string, readonly string[]>>;

export interface StrategyActionError {
  readonly code: StrategyPublicErrorCode;
  readonly fieldErrors?: FieldErrors;
}

interface StrategyActionFailure {
  readonly ok: false;
  readonly error: StrategyActionError;
}

/** The one closed, serializable action-result shape every export below returns. */
export type StrategyActionResult<T> =
  { readonly ok: true; readonly data: T } | StrategyActionFailure;

/**
 * Only fields present in the schema itself can ever appear here — Zod never
 * reports a per-field error for an unrecognized key under `.strict()` (that
 * surfaces as a root-level `unrecognized_keys` issue in `formErrors`
 * instead, which this function does not read), so a forged
 * `workspaceId`/`isArchived`/etc. can never appear as a "field error" a
 * client might mistake for a validated concept. Values are error MESSAGES
 * only — the rejected raw input is never echoed back.
 */
function toFieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

function validationFailure(error: z.ZodError): StrategyActionFailure {
  return { ok: false, error: { code: 'validation_error', fieldErrors: toFieldErrors(error) } };
}

function serviceFailure(code: string): StrategyActionFailure {
  return { ok: false, error: { code: mapServiceErrorToPublicCode(code) } };
}

/** Revalidated after every successful mutation, including an idempotent replay — the only stable, documented Strategy route today. A detail route is revalidated too once the future UI phase adds and documents one; inventing one now would violate "do not invent a route that does not exist." */
function revalidateStrategyRoutes(): void {
  for (const locale of ['en', 'th']) {
    revalidatePath(`/${locale}/app/strategies`);
  }
}

/**
 * Resolves trusted context and the `'member'` authorization precheck shared
 * by every mutating action below, mapping `UnauthenticatedError`/
 * `ForbiddenError` to their public codes. This precheck is authentication
 * plus active-membership derivation ONLY — it never resolves entitlement or
 * access mode, so it can never reject an exact-mutation-key create replay
 * that ought to succeed under a `read_only`/`over_limit` workspace; that
 * distinction is drawn later, inside the service's own transaction. Callers
 * still handle their own service-specific try/catch for the "unexpected"
 * fallback, since that needs to wrap the service call too (not just context
 * resolution).
 */
async function resolveTrustedContext(): Promise<
  | { readonly ok: true; readonly workspaceId: string; readonly userId: string }
  | StrategyActionFailure
> {
  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireStrategyManagement(workspaceId);
    return { ok: true, workspaceId, userId };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: { code: 'workspace_access_denied' } };
    }
    // getActiveWorkspaceContext throws UnauthenticatedError (via requireSession)
    // for no session at all — everything else unexpected.
    if (error instanceof Error && error.name === 'UnauthenticatedError') {
      return { ok: false, error: { code: 'unauthenticated' } };
    }
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export interface CreateStrategyData {
  readonly strategyId: string;
  /** The canonical current Version at response time — Version 1 on a genuinely new create; the actual current Version on a replay, never framed as "the immutable original creation Version." */
  readonly versionId: string;
  readonly versionNumber: number;
  /** `false`: this call created the Strategy. `true`: an exact workspace-scoped `mutationKey` replay returned an existing Strategy — no new write occurred. */
  readonly alreadyCreated: boolean;
}

export type CreateStrategyActionResult = StrategyActionResult<CreateStrategyData>;

export async function createStrategyAction(input: unknown): Promise<CreateStrategyActionResult> {
  const parsed = CreateStrategySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await createStrategy(ctx.workspaceId, ctx.userId, {
      mutationKey: parsed.data.mutationKey,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      notes: parsed.data.notes ?? null,
    });
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: result.strategyId,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        alreadyCreated: result.alreadyCreated,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export interface UpdateStrategyData {
  readonly strategyId: string;
  /** The canonical current Version after this edit — the same Version, updated in place, unless `copied` is `true`. */
  readonly versionId: string;
  readonly versionNumber: number;
  /** `true` when the prior current Version was locked, so this edit created Version _n+1_ by copy-on-write rather than editing in place. */
  readonly copied: boolean;
}

export type UpdateStrategyActionResult = StrategyActionResult<UpdateStrategyData>;

export async function updateStrategyAction(input: unknown): Promise<UpdateStrategyActionResult> {
  const parsed = UpdateStrategyContentSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await updateStrategyContent(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        notes: parsed.data.notes ?? null,
        changeNote: parsed.data.changeNote ?? null,
      },
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export interface StrategyLifecycleData {
  readonly strategyId: string;
  /** The Strategy's archive state immediately after this call succeeds — a static invariant of which action ran (archive always leaves `true`, restore always leaves `false`), not a value the service returns or a value this action re-queries for. */
  readonly isArchived: boolean;
}

export type StrategyLifecycleActionResult = StrategyActionResult<StrategyLifecycleData>;

export async function archiveStrategyAction(
  input: unknown,
): Promise<StrategyLifecycleActionResult> {
  const parsed = StrategyLifecycleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await archiveStrategy(ctx.workspaceId, ctx.userId, parsed.data.strategyId);
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return { ok: true, data: { strategyId: parsed.data.strategyId, isArchived: true } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export async function restoreStrategyAction(
  input: unknown,
): Promise<StrategyLifecycleActionResult> {
  const parsed = StrategyLifecycleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await restoreStrategy(ctx.workspaceId, ctx.userId, parsed.data.strategyId);
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return { ok: true, data: { strategyId: parsed.data.strategyId, isArchived: false } };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export interface CreateSetupData {
  readonly setupId: string;
  readonly strategyId: string;
  /** The canonical current Strategy Version at response time — not guaranteed to be the Version the Setup was originally snapshotted into once a later copy-on-write has run. */
  readonly versionId: string;
  readonly versionNumber: number;
  readonly alreadyCreated: boolean;
  readonly copied: boolean;
}

export type CreateSetupActionResult = StrategyActionResult<CreateSetupData>;

export async function createSetupAction(input: unknown): Promise<CreateSetupActionResult> {
  const parsed = CreateSetupSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await createSetup(ctx.workspaceId, ctx.userId, parsed.data.strategyId, {
      mutationKey: parsed.data.mutationKey,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      sortOrder: parsed.data.sortOrder,
      changeNote: parsed.data.changeNote ?? null,
    });
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        setupId: result.setupId,
        strategyId: parsed.data.strategyId,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        alreadyCreated: result.alreadyCreated,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export interface UpdateSetupData {
  readonly strategyId: string;
  readonly setupId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly copied: boolean;
}

export type UpdateSetupActionResult = StrategyActionResult<UpdateSetupData>;

export async function updateSetupAction(input: unknown): Promise<UpdateSetupActionResult> {
  const parsed = UpdateSetupContentSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await updateSetupContent(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.setupId,
      {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        sortOrder: parsed.data.sortOrder,
        changeNote: parsed.data.changeNote ?? null,
      },
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        setupId: parsed.data.setupId,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export interface SetupLifecycleData {
  readonly strategyId: string;
  readonly setupId: string;
  /** The Setup's archive state immediately after this call succeeds — same static-invariant reasoning as {@link StrategyLifecycleData.isArchived}. */
  readonly isArchived: boolean;
}

export type SetupLifecycleActionResult = StrategyActionResult<SetupLifecycleData>;

export async function archiveSetupAction(input: unknown): Promise<SetupLifecycleActionResult> {
  const parsed = SetupLifecycleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await archiveSetup(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.setupId,
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: { strategyId: parsed.data.strategyId, setupId: parsed.data.setupId, isArchived: true },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export async function restoreSetupAction(input: unknown): Promise<SetupLifecycleActionResult> {
  const parsed = SetupLifecycleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await restoreSetup(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.setupId,
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: { strategyId: parsed.data.strategyId, setupId: parsed.data.setupId, isArchived: false },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// Setup Conditions
// ---------------------------------------------------------------------------

export interface SetupConditionActionData {
  readonly strategyId: string;
  readonly setupId: string;
  readonly conditionKey: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly copied: boolean;
}

export type SetupConditionActionResult = StrategyActionResult<SetupConditionActionData>;

export async function createSetupConditionAction(
  input: unknown,
): Promise<SetupConditionActionResult> {
  const parsed = CreateSetupConditionSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const result = await createSetupCondition(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.setupId,
      {
        label: parsed.data.label,
        sortOrder: parsed.data.sortOrder,
        changeNote: parsed.data.changeNote ?? null,
      },
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        setupId: parsed.data.setupId,
        conditionKey: result.conditionKey,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export async function updateSetupConditionAction(
  input: unknown,
): Promise<SetupConditionActionResult> {
  const parsed = UpdateSetupConditionSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const result = await updateSetupCondition(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.setupId,
      parsed.data.conditionKey,
      {
        label: parsed.data.label,
        sortOrder: parsed.data.sortOrder,
        changeNote: parsed.data.changeNote ?? null,
      },
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        setupId: parsed.data.setupId,
        conditionKey: result.conditionKey,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export type RemoveSetupConditionActionResult = StrategyActionResult<
  SetupConditionActionData & { readonly alreadyRemoved: boolean }
>;

export async function removeSetupConditionAction(
  input: unknown,
): Promise<RemoveSetupConditionActionResult> {
  const parsed = RemoveSetupConditionSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const result = await removeSetupCondition(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.setupId,
      parsed.data.conditionKey,
      { changeNote: parsed.data.changeNote ?? null },
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        setupId: parsed.data.setupId,
        conditionKey: result.conditionKey,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
        alreadyRemoved: result.alreadyRemoved,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface CreateStrategyRuleData {
  readonly strategyId: string;
  /** The stable, client-supplied logical identity — the one approved Rule identifier. The internal Rule row id is never exposed. */
  readonly ruleKey: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly alreadyCreated: boolean;
  readonly copied: boolean;
}

export type CreateStrategyRuleActionResult = StrategyActionResult<CreateStrategyRuleData>;

export async function createStrategyRuleAction(
  input: unknown,
): Promise<CreateStrategyRuleActionResult> {
  const parsed = CreateStrategyRuleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const result = await createStrategyRule(ctx.workspaceId, ctx.userId, parsed.data.strategyId, {
      ruleKey: parsed.data.ruleKey,
      setupId: parsed.data.setupId ?? null,
      category: parsed.data.category,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      isRequired: parsed.data.isRequired,
      isPreTradeCheck: false,
      sortOrder: parsed.data.sortOrder,
      changeNote: parsed.data.changeNote ?? null,
    });
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        ruleKey: parsed.data.ruleKey,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        alreadyCreated: result.alreadyCreated,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export interface UpdateStrategyRuleData {
  readonly strategyId: string;
  readonly ruleKey: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly copied: boolean;
}

export type UpdateStrategyRuleActionResult = StrategyActionResult<UpdateStrategyRuleData>;

export async function updateStrategyRuleAction(
  input: unknown,
): Promise<UpdateStrategyRuleActionResult> {
  const parsed = UpdateStrategyRuleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    // `setupId` is accepted for client-payload symmetry with create (per
    // the Phase 06D brief's schema spec) but is not a service parameter —
    // the service resolves Strategy-vs-Setup scope from the stored Rule row
    // itself via `ruleKey`, the single approved identifier.
    const result = await updateStrategyRule(
      ctx.workspaceId,
      ctx.userId,
      parsed.data.strategyId,
      parsed.data.ruleKey,
      {
        category: parsed.data.category,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        isRequired: parsed.data.isRequired,
        sortOrder: parsed.data.sortOrder,
        changeNote: parsed.data.changeNote ?? null,
      },
    );
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId: parsed.data.strategyId,
        ruleKey: parsed.data.ruleKey,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

export interface RemoveStrategyRuleData {
  readonly strategyId: string;
  readonly ruleKey: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly copied: boolean;
  /** `true` when the Rule was already absent from the current Version — an idempotent no-op, not an error. */
  readonly alreadyRemoved: boolean;
}

export type RemoveStrategyRuleActionResult = StrategyActionResult<RemoveStrategyRuleData>;

export async function removeStrategyRuleAction(
  input: unknown,
): Promise<RemoveStrategyRuleActionResult> {
  const parsed = RemoveStrategyRuleSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);

  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;

  try {
    const { strategyId, ruleKey } = parsed.data;
    const result = await removeStrategyRule(ctx.workspaceId, ctx.userId, strategyId, ruleKey, {
      changeNote: parsed.data.changeNote ?? null,
    });
    if (!result.ok) return serviceFailure(result.code);
    revalidateStrategyRoutes();
    return {
      ok: true,
      data: {
        strategyId,
        ruleKey,
        versionId: result.versionId,
        versionNumber: result.versionNumber,
        copied: result.copied,
        alreadyRemoved: result.alreadyRemoved,
      },
    };
  } catch {
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}
