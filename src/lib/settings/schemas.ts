import { z } from 'zod';

import { isValidTimeZone } from '@/lib/time/timezone';
import { hasNoControlOrHtmlCharacters } from '@/lib/trading-accounts/validation';
import { routing } from '@/i18n/routing';

export const DISPLAY_NAME_MAX_LENGTH = 80;
export const WORKSPACE_NAME_MAX_LENGTH = 80;

export const UpdateDisplayNameSchema = z
  .object({
    name: z
      .string({ error: 'required' })
      .trim()
      .min(1, { message: 'required' })
      .max(DISPLAY_NAME_MAX_LENGTH, { message: 'too_long' })
      .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' }),
  })
  .strict();

export const UpdateTimezoneSchema = z
  .object({
    timezone: z
      .string({ error: 'invalid_timezone' })
      .trim()
      .refine(isValidTimeZone, { message: 'invalid_timezone' }),
  })
  .strict();

export const UpdateWorkspaceNameSchema = z
  .object({
    name: z
      .string({ error: 'required' })
      .trim()
      .min(1, { message: 'required' })
      .max(WORKSPACE_NAME_MAX_LENGTH, { message: 'too_long' })
      .refine(hasNoControlOrHtmlCharacters, { message: 'invalid_characters' }),
  })
  .strict();

export const SyncObservedPreferencesSchema = z
  .object({
    locale: z.enum(routing.locales).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
  })
  .strict()
  .refine((value) => value.locale !== undefined || value.theme !== undefined, {
    message: 'preference_required',
  });

export type UpdateDisplayNameData = z.output<typeof UpdateDisplayNameSchema>;
export type UpdateTimezoneData = z.output<typeof UpdateTimezoneSchema>;
export type UpdateWorkspaceNameData = z.output<typeof UpdateWorkspaceNameSchema>;
export type SyncObservedPreferencesData = z.output<typeof SyncObservedPreferencesSchema>;
