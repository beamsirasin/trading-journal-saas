'use server';

import { revalidatePath } from 'next/cache';

import {
  CreateExitPlanSchema,
  ExitPlanIdSchema,
  SetExitPlanStrategyDefaultSchema,
  UpdateExitPlanSchema,
  type ExitPlanPublicErrorCode,
} from '@/lib/exit-plans/schemas';
import {
  ForbiddenError,
  getActiveWorkspaceContext,
  requireStrategyManagement,
} from '@/server/auth/dal';
import { selectActiveExitPlanOptions, type TradeCreateExitPlanOption } from '@/server/dal/trades';
import {
  archiveExitPlan,
  createExitPlan,
  removeExitPlanStrategyDefault,
  setExitPlanStrategyDefault,
  updateExitPlan,
  type ExitPlanLibraryErrorCode,
} from '@/server/services/exit-plan-library';

/**
 * Saved Exit Plan library Server Actions. Workspace and actor come from the
 * session, never the payload; `.strict()` schemas refuse a forged
 * `workspaceId`. The service re-verifies membership and entitlement inside
 * its own transaction and is the authorization boundary.
 */

export type ExitPlanActionResult<T> =
  | {
      readonly ok: true;
      readonly data: T;
      /**
       * The active library after this change. The At Entry editor adopts it
       * directly: a client refresh racing the action's own revalidation could
       * otherwise deliver the pre-change list, and a trader would not see the
       * plan they just saved.
       */
      readonly exitPlans: readonly TradeCreateExitPlanOption[];
    }
  | { readonly ok: false; readonly error: { readonly code: ExitPlanPublicErrorCode } };

type Failure = Extract<ExitPlanActionResult<never>, { ok: false }>;

function fail(code: ExitPlanPublicErrorCode): Failure {
  return { ok: false, error: { code } };
}

function serviceFailure(code: ExitPlanLibraryErrorCode): Failure {
  switch (code) {
    case 'blank_name':
    case 'blank_instructions':
      return fail('validation_error');
    case 'workspace_access_denied':
    case 'read_only_workspace':
    case 'over_limit_workspace':
    case 'exit_plan_not_found':
    case 'exit_plan_archived':
    case 'strategy_not_found':
    case 'strategy_archived':
      return fail(code);
    default:
      return fail('unexpected_error');
  }
}

async function resolveTrustedContext(): Promise<
  { readonly ok: true; readonly workspaceId: string; readonly userId: string } | Failure
> {
  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireStrategyManagement(workspaceId);
    return { ok: true, workspaceId, userId };
  } catch (error) {
    if (error instanceof ForbiddenError) return fail('workspace_access_denied');
    if (error instanceof Error && error.name === 'UnauthenticatedError') {
      return fail('unauthenticated');
    }
    return fail('unexpected_error');
  }
}

/** Every surface that reads the library through `getTradeCreateOptions`. */
function revalidateLibraryRoutes(): void {
  for (const locale of ['en', 'th']) {
    revalidatePath(`/${locale}/app/trades/new`);
    revalidatePath(`/${locale}/app/trades`);
  }
}

async function run<T>(
  work: (ctx: {
    workspaceId: string;
    userId: string;
  }) => Promise<{ ok: true; data: T } | { ok: false; code: ExitPlanLibraryErrorCode }>,
): Promise<ExitPlanActionResult<T>> {
  const ctx = await resolveTrustedContext();
  if (!ctx.ok) return ctx;
  try {
    const result = await work(ctx);
    if (!result.ok) return serviceFailure(result.code);
    revalidateLibraryRoutes();
    return {
      ok: true,
      data: result.data,
      exitPlans: await selectActiveExitPlanOptions(ctx.workspaceId),
    };
  } catch {
    return fail('unexpected_error');
  }
}

export async function createExitPlanAction(
  input: unknown,
): Promise<ExitPlanActionResult<{ readonly exitPlanId: string }>> {
  const parsed = CreateExitPlanSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  return run(async ({ workspaceId, userId }) => {
    const result = await createExitPlan(workspaceId, userId, parsed.data);
    return result.ok ? { ok: true, data: { exitPlanId: result.exitPlanId } } : result;
  });
}

export async function updateExitPlanAction(
  input: unknown,
): Promise<ExitPlanActionResult<{ readonly exitPlanId: string }>> {
  const parsed = UpdateExitPlanSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  const { exitPlanId, name, instructions } = parsed.data;
  return run(async ({ workspaceId, userId }) => {
    const result = await updateExitPlan(workspaceId, userId, exitPlanId, { name, instructions });
    return result.ok ? { ok: true, data: { exitPlanId } } : result;
  });
}

export async function archiveExitPlanAction(
  input: unknown,
): Promise<ExitPlanActionResult<{ readonly exitPlanId: string }>> {
  const parsed = ExitPlanIdSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  const { exitPlanId } = parsed.data;
  return run(async ({ workspaceId, userId }) => {
    const result = await archiveExitPlan(workspaceId, userId, exitPlanId);
    return result.ok ? { ok: true, data: { exitPlanId } } : result;
  });
}

export async function setExitPlanStrategyDefaultAction(
  input: unknown,
): Promise<ExitPlanActionResult<{ readonly replacedExitPlanId: string | null }>> {
  const parsed = SetExitPlanStrategyDefaultSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  const { exitPlanId, strategyId } = parsed.data;
  return run(async ({ workspaceId, userId }) => {
    const result = await setExitPlanStrategyDefault(workspaceId, userId, exitPlanId, strategyId);
    return result.ok
      ? { ok: true, data: { replacedExitPlanId: result.replacedExitPlanId } }
      : result;
  });
}

export async function removeExitPlanStrategyDefaultAction(
  input: unknown,
): Promise<ExitPlanActionResult<{ readonly exitPlanId: string }>> {
  const parsed = ExitPlanIdSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  const { exitPlanId } = parsed.data;
  return run(async ({ workspaceId, userId }) => {
    const result = await removeExitPlanStrategyDefault(workspaceId, userId, exitPlanId);
    return result.ok ? { ok: true, data: { exitPlanId } } : result;
  });
}
