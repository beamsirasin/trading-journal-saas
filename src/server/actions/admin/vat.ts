'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { parseExactVatRatePercent } from '@/lib/billing';
import { getOptionalPlatformAdmin } from '@/server/auth/admin-dal';
import { getOptionalSession } from '@/server/auth/dal';
import {
  changeVatConfiguration,
  VatConfigurationMutationError,
} from '@/server/services/admin/vat-configuration-support';

/**
 * The Phase 11F Admin VAT Server Action — exactly one, mirroring
 * `src/server/actions/admin/subscription-support.ts`'s established shape
 * (`input: unknown` + `.strict()` Zod parse, a closed discriminated result
 * union, a `mapError` that switches on the service error's `.code`).
 *
 * Authority is checked HERE (for a precise `unauthenticated` vs.
 * `admin_required` UI code) AND independently re-verified inside
 * `vat-configuration-support.ts`'s own service function — neither layer
 * trusts the other alone, per Phase 11E's established convention.
 *
 * `ratePercent` is a STRING parsed by `parseExactVatRatePercent`
 * (`src/lib/billing/vat.ts`) — never `z.coerce.number()` or any other
 * floating-point-capable path — so "7.001", "1e2", and every other invalid
 * form Phase 11F's rate grammar rejects is rejected here, not silently
 * rounded.
 */

const CONFIRM_PHRASE = 'VAT';

const changeVatConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    ratePercent: z.string().min(1).max(10),
    reasonCode: z.enum(['configuration_change', 'other']),
    reasonNote: z.string().trim().min(1).max(500).optional(),
    confirmation: z.literal(CONFIRM_PHRASE),
  })
  .strict();

export type VatConfigurationActionCode =
  'validation' | 'unauthenticated' | 'admin_required' | 'configuration_unavailable' | 'unexpected';

export type VatConfigurationActionResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly code: VatConfigurationActionCode };

function mapError(error: unknown): VatConfigurationActionResult {
  if (!(error instanceof VatConfigurationMutationError)) {
    return { ok: false, code: 'unexpected' };
  }
  switch (error.code) {
    case 'validation_error':
      return { ok: false, code: 'validation' };
    case 'admin_required':
      return { ok: false, code: 'admin_required' };
    case 'configuration_unavailable':
      return { ok: false, code: 'configuration_unavailable' };
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

export async function changeVatConfigurationAction(
  input: unknown,
): Promise<VatConfigurationActionResult> {
  const authority = await requireAdminActionAuthority();
  if (!authority.ok) return { ok: false, code: authority.code };

  const parsed = changeVatConfigurationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation' };

  let rateBasisPoints: number;
  try {
    rateBasisPoints = parseExactVatRatePercent(parsed.data.ratePercent);
  } catch {
    return { ok: false, code: 'validation' };
  }

  try {
    const result = await changeVatConfiguration({
      enabled: parsed.data.enabled,
      rateBasisPoints,
      reasonCode: parsed.data.reasonCode,
      ...(parsed.data.reasonNote === undefined ? {} : { reasonNote: parsed.data.reasonNote }),
    });
    revalidatePath('/admin/vat');
    revalidatePath('/admin/audit');
    return { ok: true, changed: result.changed };
  } catch (error) {
    return mapError(error);
  }
}
