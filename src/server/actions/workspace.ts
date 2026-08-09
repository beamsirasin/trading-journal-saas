'use server';

import { revalidatePath } from 'next/cache';
import type { z } from 'zod';

import { UpdateWorkspaceNameSchema } from '@/lib/settings/schemas';
import { getActiveWorkspaceContext, UnauthenticatedError } from '@/server/auth/dal';
import {
  renameWorkspace,
  type RenameWorkspaceErrorCode,
} from '@/server/services/workspace-settings';

type FieldErrors = Readonly<Record<string, readonly string[]>>;
export type UpdateWorkspaceNameErrorCode =
  'validation_error' | 'unauthenticated' | RenameWorkspaceErrorCode | 'unexpected_error';

export type UpdateWorkspaceNameActionResult =
  | { readonly ok: true; readonly data: { readonly changed: boolean; readonly name: string } }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: UpdateWorkspaceNameErrorCode;
        readonly fieldErrors?: FieldErrors;
      };
    };

function fieldErrors(error: z.ZodError): FieldErrors {
  return error.flatten().fieldErrors as FieldErrors;
}

/** Browser input contains only the new name; workspace and actor identity are session-derived. */
export async function updateWorkspaceNameAction(
  input: unknown,
): Promise<UpdateWorkspaceNameActionResult> {
  const parsed = UpdateWorkspaceNameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: 'validation_error', fieldErrors: fieldErrors(parsed.error) },
    };
  }

  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    const result = await renameWorkspace(workspaceId, userId, parsed.data);
    if (!result.ok) return { ok: false, error: { code: result.code } };
    for (const locale of ['en', 'th']) revalidatePath(`/${locale}/app/settings`);
    return { ok: true, data: { changed: result.changed, name: result.name } };
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { ok: false, error: { code: 'unauthenticated' } };
    }
    return { ok: false, error: { code: 'unexpected_error' } };
  }
}
