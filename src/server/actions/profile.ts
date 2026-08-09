'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import type { z } from 'zod';

import { getAuth } from '@/lib/auth/server';
import { UpdateDisplayNameSchema } from '@/lib/settings/schemas';
import { requireSession, UnauthenticatedError } from '@/server/auth/dal';
import { updateDisplayName } from '@/server/services/user-profile';

type FieldErrors = Readonly<Record<string, readonly string[]>>;
export type SettingsActionErrorCode =
  'validation_error' | 'unauthenticated' | 'invalid_timezone' | 'unexpected_error';

export interface SettingsActionFailure {
  readonly ok: false;
  readonly error: { readonly code: SettingsActionErrorCode; readonly fieldErrors?: FieldErrors };
}

export type UpdateDisplayNameActionResult =
  | { readonly ok: true; readonly data: { readonly changed: boolean; readonly name: string } }
  | SettingsActionFailure;

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

function revalidateAuthenticatedShell(): void {
  for (const locale of ['en', 'th']) {
    revalidatePath(`/${locale}/app`, 'layout');
  }
}

/** Explicit self-scoped display-name mutation; no workspace or entitlement is consulted. */
export async function updateDisplayNameAction(
  input: unknown,
): Promise<UpdateDisplayNameActionResult> {
  const parsed = UpdateDisplayNameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_error', fieldErrors: fieldErrors(parsed.error) },
    };
  }

  try {
    const session = await requireSession();
    const requestHeaders = await headers();
    const result = await updateDisplayName(
      session.user.id,
      session.user.name,
      parsed.data.name,
      async (name) => {
        await getAuth().api.updateUser({ body: { name }, headers: requestHeaders });
      },
    );
    revalidateAuthenticatedShell();
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: { code: 'unauthenticated' } };
    }
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}
