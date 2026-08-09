'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import type { z } from 'zod';

import { SyncObservedPreferencesSchema, UpdateTimezoneSchema } from '@/lib/settings/schemas';
import { requireSession, UnauthenticatedError } from '@/server/auth/dal';
import { updateUserPreferences } from '@/server/services/user-preferences';

import type { SettingsActionFailure } from './profile';

type FieldErrors = Readonly<Record<string, readonly string[]>>;
type PreferenceActionResult =
  | {
      readonly ok: true;
      readonly data: { readonly changed: boolean; readonly changedFields: readonly string[] };
    }
  | SettingsActionFailure;

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

function revalidateAuthenticatedShell(): void {
  for (const locale of ['en', 'th']) {
    revalidatePath(`/${locale}/app`, 'layout');
  }
}

/** Persists the explicit database-authoritative timezone account preference. */
export async function updateTimezonePreferenceAction(
  input: unknown,
): Promise<PreferenceActionResult> {
  const parsed = UpdateTimezoneSchema.safeParse(input);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    const timezoneInvalid = errors.timezone !== undefined;
    return {
      ok: false,
      error: {
        code: timezoneInvalid ? 'invalid_timezone' : 'validation_error',
        ...(timezoneInvalid ? { fieldErrors: errors } : {}),
      },
    };
  }

  try {
    const session = await requireSession();
    const result = await updateUserPreferences(session.user.id, {
      timezone: parsed.data.timezone,
    });
    revalidateAuthenticatedShell();
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: { code: 'unauthenticated' } };
    }
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}

/** Records the existing browser-authoritative theme and route-authoritative locale when observed. */
export async function syncPreferences(input: unknown): Promise<PreferenceActionResult> {
  const parsed = SyncObservedPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_error', fieldErrors: fieldErrors(parsed.error) },
    };
  }

  try {
    const session = await requireSession();
    const observed = {
      ...(parsed.data.locale === undefined ? {} : { locale: parsed.data.locale }),
      ...(parsed.data.theme === undefined ? {} : { theme: parsed.data.theme }),
    };
    const result = await updateUserPreferences(session.user.id, observed);

    if (parsed.data.locale !== undefined) {
      const cookieStore = await cookies();
      cookieStore.set('NEXT_LOCALE', parsed.data.locale, { path: '/', sameSite: 'lax' });
    }

    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: { code: 'unauthenticated' } };
    }
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}
