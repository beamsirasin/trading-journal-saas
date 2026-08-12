import 'server-only';

import { desc, lte } from 'drizzle-orm';

import { getDb, type Database } from '@/server/db/client';
import { platformVatConfiguration } from '@/server/db/schema';

/**
 * The ONE canonical runtime source of the platform's VAT configuration
 * (Phase 11F) — every quotation, checkout, and billing-presentation surface
 * resolves it from here, never from `src/config/billing.server.ts`'s legacy
 * `VAT_CONFIGURATION_LAUNCH_FIXTURE` constant, which Phase 11F retires from
 * every production code path (see that file's own comment).
 *
 * `platform_vat_configuration` is append-only and effective-dated (Phase
 * 11B): a change INSERTS a new row rather than updating the previous one, so
 * "the effective configuration as of `now`" is always the latest row whose
 * `effective_at` has already passed. Migration 0009 seeds exactly one
 * baseline row (`enabled: false`, `700` basis points) specifically so this
 * resolver can assume a row always exists — see `assertConfigurationExists`.
 */

/** Narrow domain DTO — never a raw `platform_vat_configuration` row (no id, no actor, no reason). */
export interface EffectivePlatformVatConfiguration {
  readonly enabled: boolean;
  readonly rateBasisPoints: number;
}

/**
 * Thrown when no effective row exists at all — a data-integrity failure,
 * never a normal "VAT is off" state (that is `{ enabled: false, ... }`, a
 * successful resolution). Every caller must fail closed on this, never
 * silently substitute a default: a missing tax configuration silently
 * treated as "VAT disabled" could produce an incorrect commercial record.
 */
export class VatConfigurationUnavailableError extends Error {
  constructor() {
    super('Platform VAT configuration is unavailable.');
    this.name = 'VatConfigurationUnavailableError';
  }
}

/** Structurally matches both `getDb()` and a Drizzle transaction handle. */
type Executor = Pick<Database, 'select'>;

async function resolveEffective(
  executor: Executor,
  now: Date,
): Promise<EffectivePlatformVatConfiguration> {
  const [row] = await executor
    .select({
      enabled: platformVatConfiguration.enabled,
      rateBasisPoints: platformVatConfiguration.rateBasisPoints,
    })
    .from(platformVatConfiguration)
    .where(lte(platformVatConfiguration.effectiveAt, now))
    // Deterministic even if two rows somehow share `effective_at` exactly —
    // `created_at` then `id` break the tie the same total-order way every
    // time, never "whichever row Postgres happens to return first".
    .orderBy(
      desc(platformVatConfiguration.effectiveAt),
      desc(platformVatConfiguration.createdAt),
      desc(platformVatConfiguration.id),
    )
    .limit(1);

  if (row === undefined) {
    throw new VatConfigurationUnavailableError();
  }
  return { enabled: row.enabled, rateBasisPoints: row.rateBasisPoints };
}

/** The default runtime resolution path — opens its own connection via `getDb()`. */
export async function getEffectivePlatformVatConfiguration(
  now: Date = new Date(),
): Promise<EffectivePlatformVatConfiguration> {
  return resolveEffective(getDb(), now);
}

/**
 * Transaction-aware resolution for a caller that already holds an open `tx`
 * (checkout's `prepareCheckout`) — reads through the SAME executor so the
 * commercial operation resolves VAT exactly once, from one consistent
 * executor, rather than risking a second query racing a concurrent Admin
 * change mid-operation.
 */
export async function getEffectivePlatformVatConfigurationInTx(
  tx: Executor,
  now: Date,
): Promise<EffectivePlatformVatConfiguration> {
  return resolveEffective(tx, now);
}
