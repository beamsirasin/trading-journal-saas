'use server';

import { z } from 'zod';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import { CreateAccountSchema, UpdateAccountSchema } from '@/lib/trading-accounts/schema';
import {
  ForbiddenError,
  getActiveWorkspaceContext,
  requireTradingAccountManagement,
} from '@/server/auth/dal';
import {
  archiveTradingAccount,
  createTradingAccount,
  restoreTradingAccount,
  setActiveTradingAccount,
  updateTradingAccount,
} from '@/server/services/trading-account-management';

/**
 * Phase 3B's account-management server actions — the Zod-validated,
 * session-authorized entry points behind the accounts list, create, and edit
 * UI (CLAUDE.md §4). None of these ever reads `workspaceId` from `input`;
 * `getActiveWorkspaceContext()` derives it (and the acting user) from the
 * session exactly like `src/server/actions/onboarding.ts` already does, so a
 * forged workspace ID in a submitted payload has no field to be read from.
 *
 * Every failure — validation, an unauthenticated caller, a forbidden role, a
 * database error — collapses to a short generic code, never a raw exception
 * message. The client maps each code to localized copy.
 */

const accountIdSchema = z.string().uuid();

export type CreateTradingAccountActionResult =
  | { readonly ok: true; readonly accountId: string }
  | {
      readonly ok: false;
      readonly code: 'validation' | 'forbidden' | 'unexpected' | MutationDenialReason;
    };

export async function createTradingAccountAction(
  input: unknown,
): Promise<CreateTradingAccountActionResult> {
  const parsed = CreateAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: 'validation' };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradingAccountManagement(workspaceId);
    const result = await createTradingAccount(workspaceId, userId, parsed.data);
    return result.ok ? { ok: true, accountId: result.accountId } : { ok: false, code: result.code };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: 'unexpected' };
  }
}

export type UpdateTradingAccountActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        'validation' | 'not_found' | 'archived' | 'forbidden' | 'unexpected' | MutationDenialReason;
    };

export async function updateTradingAccountAction(
  accountId: unknown,
  input: unknown,
): Promise<UpdateTradingAccountActionResult> {
  const parsedId = accountIdSchema.safeParse(accountId);
  const parsedInput = UpdateAccountSchema.safeParse(input);
  if (!parsedId.success || !parsedInput.success) {
    return { ok: false, code: 'validation' };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradingAccountManagement(workspaceId);
    const result = await updateTradingAccount(workspaceId, userId, parsedId.data, parsedInput.data);
    return result.ok ? { ok: true } : { ok: false, code: result.code };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: 'unexpected' };
  }
}

export type SetActiveTradingAccountActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'not_found' | 'archived' | 'forbidden' | 'unexpected';
    };

export async function setActiveTradingAccountAction(
  accountId: unknown,
): Promise<SetActiveTradingAccountActionResult> {
  const parsedId = accountIdSchema.safeParse(accountId);
  if (!parsedId.success) {
    return { ok: false, code: 'not_found' };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradingAccountManagement(workspaceId);
    const result = await setActiveTradingAccount(workspaceId, userId, parsedId.data);
    return result.ok ? { ok: true } : { ok: false, code: result.code };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: 'unexpected' };
  }
}

export type ArchiveTradingAccountActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        'not_found' | 'last_account' | 'forbidden' | 'unexpected' | MutationDenialReason;
    };

export async function archiveTradingAccountAction(
  accountId: unknown,
): Promise<ArchiveTradingAccountActionResult> {
  const parsedId = accountIdSchema.safeParse(accountId);
  if (!parsedId.success) {
    return { ok: false, code: 'not_found' };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradingAccountManagement(workspaceId);
    const result = await archiveTradingAccount(workspaceId, userId, parsedId.data);
    return result.ok ? { ok: true } : { ok: false, code: result.code };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: 'unexpected' };
  }
}

export type RestoreTradingAccountActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'not_found' | 'forbidden' | 'unexpected' | MutationDenialReason;
    };

export async function restoreTradingAccountAction(
  accountId: unknown,
): Promise<RestoreTradingAccountActionResult> {
  const parsedId = accountIdSchema.safeParse(accountId);
  if (!parsedId.success) {
    return { ok: false, code: 'not_found' };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradingAccountManagement(workspaceId);
    const result = await restoreTradingAccount(workspaceId, userId, parsedId.data);
    return result.ok ? { ok: true } : { ok: false, code: result.code };
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, code: 'forbidden' };
    }
    return { ok: false, code: 'unexpected' };
  }
}
