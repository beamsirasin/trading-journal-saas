'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getOptionalPlatformAdmin } from '@/server/auth/admin-dal';
import { getOptionalSession } from '@/server/auth/dal';
import {
  AdminSubscriptionMutationError,
  extendTrialByAdmin,
  grantComplimentaryPlan,
  revokeComplimentaryPlan,
} from '@/server/services/admin/subscription-support';

/**
 * The Phase 11E Admin Subscription Support Server Actions — exactly three,
 * mirroring `src/server/actions/subscription-management.ts`'s established
 * shape (`input: unknown` + `.strict()` Zod parse, a closed discriminated
 * result union, a `mapError` that switches on the service error's `.code`).
 *
 * Authority is checked HERE (for a precise `unauthenticated` vs.
 * `admin_required` UI code) AND independently re-verified inside
 * `subscription-support.ts`'s own service functions (which throw
 * `admin_required` again if the row-locked in-transaction recheck fails) —
 * neither layer trusts the other alone, per Phase 11E's own instruction.
 */

const trialExtensionReasonCodeSchema = z.enum([
  'trial_extension_goodwill',
  'support_adjustment',
  'other',
]);
const complimentaryGrantReasonCodeSchema = z.enum([
  'complimentary_access',
  'support_adjustment',
  'other',
]);
const complimentaryRevokeReasonCodeSchema = z.enum([
  'access_revoke',
  'support_adjustment',
  'other',
]);
const reasonNoteSchema = z.string().trim().min(1).max(500).optional();

const extendTrialSchema = z
  .object({
    workspaceId: z.string().uuid(),
    newTrialEndsAt: z.string().min(1),
    reasonCode: trialExtensionReasonCodeSchema,
    reasonNote: reasonNoteSchema,
  })
  .strict();

const grantComplimentaryPlanSchema = z
  .object({
    workspaceId: z.string().uuid(),
    planKey: z.enum(['starter', 'trader', 'professional']),
    reasonCode: complimentaryGrantReasonCodeSchema,
    reasonNote: reasonNoteSchema,
  })
  .strict();

const revokeComplimentaryPlanSchema = z
  .object({
    workspaceId: z.string().uuid(),
    reasonCode: complimentaryRevokeReasonCodeSchema,
    reasonNote: reasonNoteSchema,
  })
  .strict();

export type AdminSubscriptionActionCode =
  | 'validation'
  | 'unauthenticated'
  | 'admin_required'
  | 'not_found'
  | 'incompatible_state'
  | 'invalid_transition'
  | 'data_integrity_error'
  | 'unexpected';

export type AdminSubscriptionActionResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly code: AdminSubscriptionActionCode };

function mapError(error: unknown): AdminSubscriptionActionResult {
  if (!(error instanceof AdminSubscriptionMutationError)) {
    return { ok: false, code: 'unexpected' };
  }
  switch (error.code) {
    case 'validation_error':
      return { ok: false, code: 'validation' };
    case 'unauthenticated':
      return { ok: false, code: 'unauthenticated' };
    case 'admin_required':
      return { ok: false, code: 'admin_required' };
    case 'not_found':
      return { ok: false, code: 'not_found' };
    case 'incompatible_state':
      return { ok: false, code: 'incompatible_state' };
    case 'invalid_transition':
      return { ok: false, code: 'invalid_transition' };
    case 'data_integrity_error':
      return { ok: false, code: 'data_integrity_error' };
    case 'unexpected_error':
      return { ok: false, code: 'unexpected' };
  }
}

/** Precise pre-check for the UI-facing `unauthenticated`/`admin_required` distinction — the service layer independently re-verifies regardless of this result. */
async function requireAdminActionAuthority(): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'unauthenticated' | 'admin_required' }
> {
  const session = await getOptionalSession();
  if (session === null) {
    return { ok: false, code: 'unauthenticated' };
  }
  const adminContext = await getOptionalPlatformAdmin();
  if (adminContext === null) {
    return { ok: false, code: 'admin_required' };
  }
  return { ok: true };
}

/** Narrow revalidation: the mutated Workspace's own detail page and the Audit list that now has a new event — never a blanket `revalidatePath('/admin')`. */
function revalidateAfterMutation(workspaceId: string): void {
  revalidatePath(`/admin/workspaces/${workspaceId}`);
  revalidatePath('/admin/audit');
}

export async function extendTrialAction(input: unknown): Promise<AdminSubscriptionActionResult> {
  const authority = await requireAdminActionAuthority();
  if (!authority.ok) return { ok: false, code: authority.code };

  const parsed = extendTrialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };
  const newTrialEndsAt = new Date(parsed.data.newTrialEndsAt);
  if (Number.isNaN(newTrialEndsAt.getTime())) return { ok: false, code: 'validation' };

  try {
    const result = await extendTrialByAdmin({
      workspaceId: parsed.data.workspaceId,
      newTrialEndsAt,
      reasonCode: parsed.data.reasonCode,
      ...(parsed.data.reasonNote === undefined ? {} : { reasonNote: parsed.data.reasonNote }),
    });
    revalidateAfterMutation(parsed.data.workspaceId);
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error);
  }
}

export async function grantComplimentaryPlanAction(
  input: unknown,
): Promise<AdminSubscriptionActionResult> {
  const authority = await requireAdminActionAuthority();
  if (!authority.ok) return { ok: false, code: authority.code };

  const parsed = grantComplimentaryPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };

  try {
    const result = await grantComplimentaryPlan({
      workspaceId: parsed.data.workspaceId,
      planKey: parsed.data.planKey,
      reasonCode: parsed.data.reasonCode,
      ...(parsed.data.reasonNote === undefined ? {} : { reasonNote: parsed.data.reasonNote }),
    });
    revalidateAfterMutation(parsed.data.workspaceId);
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error);
  }
}

export async function revokeComplimentaryPlanAction(
  input: unknown,
): Promise<AdminSubscriptionActionResult> {
  const authority = await requireAdminActionAuthority();
  if (!authority.ok) return { ok: false, code: authority.code };

  const parsed = revokeComplimentaryPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };

  try {
    const result = await revokeComplimentaryPlan({
      workspaceId: parsed.data.workspaceId,
      reasonCode: parsed.data.reasonCode,
      ...(parsed.data.reasonNote === undefined ? {} : { reasonNote: parsed.data.reasonNote }),
    });
    revalidateAfterMutation(parsed.data.workspaceId);
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error);
  }
}
