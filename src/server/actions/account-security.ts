'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { z } from 'zod';

import {
  ChangePasswordSchema,
  RevokeOtherSessionsSchema,
  RevokeSessionSchema,
} from '@/lib/settings/schemas';
import { requireSession, UnauthenticatedError } from '@/server/auth/dal';
import {
  AccountSecurityError,
  changeOwnPassword,
  revokeAllOwnOtherSessions,
  revokeOwnOtherSession,
  type AccountSecurityErrorCode,
} from '@/server/services/account-security';

type FieldErrors = Readonly<Record<string, readonly string[]>>;
type CommonActionErrorCode = 'validation_error' | 'unauthenticated' | 'unexpected_error';
export type ChangePasswordActionErrorCode =
  CommonActionErrorCode | 'password_not_available' | 'incorrect_current_password' | 'rate_limited';
export type SessionSecurityActionErrorCode =
  CommonActionErrorCode | 'cannot_revoke_current_session';
export type SecurityActionErrorCode =
  ChangePasswordActionErrorCode | SessionSecurityActionErrorCode;

export interface SecurityActionFailure<Code extends SecurityActionErrorCode> {
  readonly ok: false;
  readonly error: {
    readonly code: Code;
    readonly fieldErrors?: FieldErrors;
  };
}

export type ChangePasswordActionResult =
  | { readonly ok: true; readonly data: { readonly otherSessionsRevoked: true } }
  | SecurityActionFailure<ChangePasswordActionErrorCode>;

export type RevokeSessionActionResult =
  | { readonly ok: true; readonly data: { readonly revoked: boolean } }
  | SecurityActionFailure<SessionSecurityActionErrorCode>;

export type RevokeOtherSessionsActionResult =
  | { readonly ok: true; readonly data: { readonly revokedCount: number } }
  | SecurityActionFailure<CommonActionErrorCode>;

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

function securityErrorCode(error: unknown): AccountSecurityErrorCode {
  if (error instanceof UnauthenticatedError) {
    return 'unauthenticated';
  }
  if (error instanceof AccountSecurityError) {
    return error.code;
  }
  return 'unexpected_error';
}

function passwordFailure(error: unknown): SecurityActionFailure<ChangePasswordActionErrorCode> {
  const code = securityErrorCode(error);
  if (
    code === 'password_not_available' ||
    code === 'incorrect_current_password' ||
    code === 'rate_limited' ||
    code === 'unauthenticated'
  ) {
    return { ok: false, error: { code } };
  }
  return { ok: false, error: { code: 'unexpected_error' } };
}

function sessionFailure(error: unknown): SecurityActionFailure<SessionSecurityActionErrorCode> {
  const code = securityErrorCode(error);
  if (code === 'cannot_revoke_current_session' || code === 'unauthenticated') {
    return { ok: false, error: { code } };
  }
  return { ok: false, error: { code: 'unexpected_error' } };
}

function bulkSessionFailure(error: unknown): SecurityActionFailure<CommonActionErrorCode> {
  return {
    ok: false,
    error: {
      code: securityErrorCode(error) === 'unauthenticated' ? 'unauthenticated' : 'unexpected_error',
    },
  };
}

function refreshSettings(): void {
  for (const locale of ['en', 'th']) revalidatePath(`/${locale}/app/settings`);
}

/** Browser input is strictly the three password fields; revocation policy is server-locked. */
export async function changePasswordAction(input: unknown): Promise<ChangePasswordActionResult> {
  const parsed = ChangePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_error', fieldErrors: fieldErrors(parsed.error) },
    };
  }

  try {
    const session = await requireSession();
    const result = await changeOwnPassword(
      session.user.id,
      session.sessionId,
      parsed.data,
      await headers(),
    );
    refreshSettings();
    return { ok: true, data: result };
  } catch (error) {
    return passwordFailure(error);
  }
}

/** Browser submits a safe opaque ID; ownership and the token are resolved server-side. */
export async function revokeSessionAction(input: unknown): Promise<RevokeSessionActionResult> {
  const parsed = RevokeSessionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_error', fieldErrors: fieldErrors(parsed.error) },
    };
  }

  try {
    const session = await requireSession();
    const result = await revokeOwnOtherSession(
      session.user.id,
      session.sessionId,
      parsed.data.sessionId,
      await headers(),
    );
    refreshSettings();
    return { ok: true, data: result };
  } catch (error) {
    return sessionFailure(error);
  }
}

/** The empty strict input prevents a browser from supplying victim IDs or tokens. */
export async function revokeOtherSessionsAction(
  input: unknown,
): Promise<RevokeOtherSessionsActionResult> {
  const parsed = RevokeOtherSessionsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_error', fieldErrors: fieldErrors(parsed.error) },
    };
  }

  try {
    const session = await requireSession();
    const result = await revokeAllOwnOtherSessions(
      session.user.id,
      session.sessionId,
      await headers(),
    );
    refreshSettings();
    return { ok: true, data: result };
  } catch (error) {
    return bulkSessionFailure(error);
  }
}
