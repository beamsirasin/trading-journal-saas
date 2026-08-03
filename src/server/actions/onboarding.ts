'use server';

import { OnboardingSubmitSchema } from '@/lib/trading-accounts/schema';
import { getActiveWorkspaceContext } from '@/server/auth/dal';
import { completeOnboarding } from '@/server/services/trading-account';

export type CompleteOnboardingActionResult =
  | { readonly ok: true; readonly accountId: string }
  | { readonly ok: false; readonly code: 'validation' | 'unexpected' };

/**
 * The one server-owned mutation behind the onboarding wizard's final submit
 * (CLAUDE.md §4 — every mutation is Zod-validated, then workspace-scoped
 * server-side before touching the database).
 *
 * `input` is untrusted client data and carries no `workspaceId` field at
 * all — `getActiveWorkspaceContext()` derives it (and the acting user)
 * from the authenticated session, so a forged workspace ID in a submitted
 * payload has no field to be read from even if a caller tried to include
 * one. `completeOnboarding` (`src/server/services/trading-account.ts`) is
 * the actual transaction; this action is only its Zod-validated, session-
 * authorized entry point.
 *
 * Every failure — validation, an unauthenticated caller, a database error —
 * collapses to one of two generic codes. The client never sees a raw
 * exception message, matching the phase brief's "no arbitrary raw database
 * errors shown to users."
 */
export async function completeOnboardingAction(
  input: unknown,
): Promise<CompleteOnboardingActionResult> {
  const parsed = OnboardingSubmitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'validation' };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    const result = await completeOnboarding(workspaceId, userId, parsed.data);
    return { ok: true, accountId: result.accountId };
  } catch {
    return { ok: false, code: 'unexpected' };
  }
}
