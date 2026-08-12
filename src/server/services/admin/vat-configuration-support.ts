import 'server-only';

import { asc } from 'drizzle-orm';

import type { AdminAuditReasonCode } from '@/config/admin-audit-actions';
import { assertValidVatRateBasisPoints } from '@/lib/billing';
import { systemClock, type Clock } from '@/lib/time';
import { lockActivePlatformAdminGrant, requirePlatformAdmin } from '@/server/auth/admin-dal';
import { getDb, type Database } from '@/server/db/client';
import { platformVatConfiguration } from '@/server/db/schema';
import {
  insertAdminAuditLog,
  type AdminAuditStateSnapshot,
} from '@/server/services/admin-audit-log';
import { getEffectivePlatformVatConfigurationInTx } from '@/server/services/platform-vat-configuration';

/**
 * The Phase 11F Admin VAT Support mutation — exactly one: `changeVatConfiguration`.
 * Mirrors Phase 11E's `src/server/services/admin/subscription-support.ts`
 * shell shape exactly (pre-transaction admin check, in-transaction admin-
 * grant row lock recheck, decide-then-write, audit written in the SAME
 * transaction as the state change) with one addition specific to VAT: this
 * is a single platform-wide configuration stream, not a per-Workspace
 * mutation, so a second lock — the immutable baseline row, acquired before
 * anything else — serializes concurrent Admin changes into a coherent order
 * (see `lockVatMutationMutex` below).
 */

export type VatConfigurationMutationErrorCode =
  'validation_error' | 'admin_required' | 'configuration_unavailable' | 'unexpected_error';

export class VatConfigurationMutationError extends Error {
  readonly code: VatConfigurationMutationErrorCode;

  constructor(code: VatConfigurationMutationErrorCode, message: string) {
    super(message);
    this.name = 'VatConfigurationMutationError';
    this.code = code;
  }
}

/** Narrower than the full closed vocabulary — Phase 11F's own locked reason set. */
export const VAT_CHANGE_REASON_CODES = new Set<AdminAuditReasonCode>([
  'configuration_change',
  'other',
]);

export interface ChangeVatConfigurationInput {
  readonly enabled: boolean;
  /** Already parsed by `parseExactVatRatePercent` (`src/lib/billing/vat.ts`) at the Server Action boundary — this service validates it again, defensively, never trusting a caller. */
  readonly rateBasisPoints: number;
  readonly reasonCode: AdminAuditReasonCode;
  readonly reasonNote?: string;
}

export interface VatConfigurationMutationResult {
  readonly changed: boolean;
}

type MutexExecutor = Pick<Database, 'select'>;

/**
 * The platform-wide VAT mutation mutex: `FOR UPDATE` on the single oldest
 * row (the migration-0009-seeded baseline, which always exists and is never
 * deleted). Every concurrent `changeVatConfiguration` call locks this SAME
 * row first, so PostgreSQL serializes them — the second transaction blocks
 * here until the first commits or rolls back, then re-reads the now-current
 * effective configuration before deciding no-op vs. change. This is safe
 * specifically because the row is immutable and permanent; locking it does
 * not block reads (`getEffectivePlatformVatConfiguration` takes no lock) and
 * never conflicts with the insert-only write path.
 */
async function lockVatMutationMutex(tx: MutexExecutor): Promise<void> {
  const [baseline] = await tx
    .select({ id: platformVatConfiguration.id })
    .from(platformVatConfiguration)
    .orderBy(asc(platformVatConfiguration.createdAt), asc(platformVatConfiguration.id))
    .limit(1)
    .for('update');
  if (baseline === undefined) {
    throw new VatConfigurationMutationError(
      'configuration_unavailable',
      'Platform VAT configuration is unavailable.',
    );
  }
}

export async function changeVatConfiguration(
  input: ChangeVatConfigurationInput,
  clock: Clock = systemClock,
): Promise<VatConfigurationMutationResult> {
  if (!VAT_CHANGE_REASON_CODES.has(input.reasonCode)) {
    throw new VatConfigurationMutationError(
      'validation_error',
      'Reason code is not valid for a VAT configuration change.',
    );
  }
  try {
    assertValidVatRateBasisPoints(input.rateBasisPoints);
  } catch {
    throw new VatConfigurationMutationError(
      'validation_error',
      'VAT rate must be an integer from 0 through 10000 basis points.',
    );
  }

  const preCheck = await requirePlatformAdmin();

  try {
    return await getDb().transaction(async (tx) => {
      const lockedGrant = await lockActivePlatformAdminGrant(tx, preCheck.user.id);
      if (lockedGrant === null) {
        throw new VatConfigurationMutationError(
          'admin_required',
          'Platform admin authority was revoked before this action completed.',
        );
      }

      await lockVatMutationMutex(tx);

      const now = clock.now();
      const current = await getEffectivePlatformVatConfigurationInTx(tx, now);
      if (current.enabled === input.enabled && current.rateBasisPoints === input.rateBasisPoints) {
        return { changed: false };
      }

      const before: AdminAuditStateSnapshot = {
        vatEnabled: current.enabled,
        vatRateBasisPoints: current.rateBasisPoints,
      };
      const after: AdminAuditStateSnapshot = {
        vatEnabled: input.enabled,
        vatRateBasisPoints: input.rateBasisPoints,
      };

      await tx.insert(platformVatConfiguration).values({
        enabled: input.enabled,
        rateBasisPoints: input.rateBasisPoints,
        effectiveAt: now,
        createdByAdminId: lockedGrant.adminGrantId,
        reasonCode: input.reasonCode,
        ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
      });

      await insertAdminAuditLog(tx, {
        actor: { actorKind: 'platform_admin', actorAdminId: lockedGrant.adminGrantId },
        action: 'vat.configuration_changed',
        reasonCode: input.reasonCode,
        ...(input.reasonNote === undefined ? {} : { reasonNote: input.reasonNote }),
        beforeState: before,
        afterState: after,
      });

      return { changed: true };
    });
  } catch (error) {
    if (error instanceof VatConfigurationMutationError) throw error;
    throw new VatConfigurationMutationError(
      'unexpected_error',
      'The VAT configuration change failed.',
    );
  }
}
