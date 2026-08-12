import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeDb } from '@/server/db/client';
import { platformVatConfiguration } from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  getEffectivePlatformVatConfiguration,
  getEffectivePlatformVatConfigurationInTx,
  VatConfigurationUnavailableError,
} from './platform-vat-configuration';

/**
 * `platform_vat_configuration` is global and append-only — no per-test
 * workspace to scope inserts to, and no DELETE path (immutability trigger).
 * Every test here inserts rows with an `effectiveAt` far in the past or far
 * in the future relative to real time, specifically so it never becomes the
 * "current" configuration for any OTHER integration test file that shares
 * this database within the same suite run — this file's own `afterAll`
 * restores the exact migration-0009 baseline as the effective configuration
 * before closing, regardless of what any individual test above inserted.
 */

describe('platform VAT configuration resolver (real database)', () => {
  const db = getTestDb();

  afterAll(async () => {
    // Restore the true baseline as the current effective configuration so
    // this file leaves global VAT state exactly as it found it, regardless
    // of test order within this file.
    await db.insert(platformVatConfiguration).values({
      enabled: false,
      rateBasisPoints: 700,
      effectiveAt: new Date(),
      reasonCode: 'configuration_change',
    });
    await closeDb();
    await closeTestDb();
  });

  it('resolves the migration-0009 baseline (false / 700) when it is the only row effective', async () => {
    // Migration 0009 seeds the baseline with `effective_at: now()` AT THE
    // TIME THE MIGRATION WAS APPLIED to this database, not a fixed
    // historical date — so "now" (not an arbitrary past instant) is the
    // correct probe as long as this test runs before any other test in this
    // FILE inserts a row effective now-or-earlier (every other test below
    // uses a far-past or far-future `effectiveAt`, deliberately, so none of
    // them interfere with this one regardless of order).
    const effective = await getEffectivePlatformVatConfiguration(new Date());
    expect(effective).toEqual({ enabled: false, rateBasisPoints: 700 });
  });

  it('selects the latest effective row when several are already in the past', async () => {
    // Deliberately a FAR-FUTURE base, like every other test below — never a
    // genuinely past fixed date. A past-dated row here would become the
    // "current" effective configuration for any probe between that date and
    // this file's own `afterAll` restore (keyed to real "now"), which would
    // silently corrupt any OTHER integration test file using a fixed
    // simulated clock that happens to fall in that window (as
    // `checkout.integration.test.ts`'s `NOW = 2026-08-10` did before this
    // was caught).
    const base = new Date('2122-01-01T00:00:00Z');
    await db.insert(platformVatConfiguration).values([
      {
        enabled: true,
        rateBasisPoints: 500,
        effectiveAt: new Date(base.getTime()),
        reasonCode: 'configuration_change',
      },
      {
        enabled: true,
        rateBasisPoints: 900,
        effectiveAt: new Date(base.getTime() + 60_000),
        reasonCode: 'configuration_change',
      },
    ]);

    const effective = await getEffectivePlatformVatConfiguration(
      new Date(base.getTime() + 120_000),
    );
    expect(effective).toEqual({ enabled: true, rateBasisPoints: 900 });
  });

  it('ignores a future row before its effective time and selects it exactly at and after', async () => {
    const futureBase = new Date('2124-06-01T00:00:00Z');
    await db.insert(platformVatConfiguration).values({
      enabled: true,
      rateBasisPoints: 1_234,
      effectiveAt: futureBase,
      reasonCode: 'configuration_change',
    });

    const before = await getEffectivePlatformVatConfiguration(new Date(futureBase.getTime() - 1));
    expect(before.rateBasisPoints).not.toBe(1_234);

    const at = await getEffectivePlatformVatConfiguration(futureBase);
    expect(at).toEqual({ enabled: true, rateBasisPoints: 1_234 });

    const after = await getEffectivePlatformVatConfiguration(new Date(futureBase.getTime() + 1));
    expect(after).toEqual({ enabled: true, rateBasisPoints: 1_234 });
  });

  it('breaks an exact effectiveAt tie deterministically by createdAt then id', async () => {
    const tieInstant = new Date('2125-01-01T00:00:00Z');
    const [first, second] = await db
      .insert(platformVatConfiguration)
      .values([
        {
          enabled: false,
          rateBasisPoints: 111,
          effectiveAt: tieInstant,
          reasonCode: 'configuration_change',
        },
        {
          enabled: true,
          rateBasisPoints: 222,
          effectiveAt: tieInstant,
          reasonCode: 'configuration_change',
        },
      ])
      .returning({
        id: platformVatConfiguration.id,
        createdAt: platformVatConfiguration.createdAt,
      });
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    // Whichever of the two actually has the later (createdAt, id) wins —
    // deterministically, not "whichever Postgres returns first". Compute the
    // expected winner the exact same way the resolver orders rows.
    const rows = [first, second] as const;
    const winner = [...rows].sort((a, b) => {
      const createdAtDiff = b!.createdAt.getTime() - a!.createdAt.getTime();
      if (createdAtDiff !== 0) return createdAtDiff;
      return b!.id.localeCompare(a!.id);
    })[0]!;
    const winnerRate = winner.id === first!.id ? 111 : 222;

    const effective = await getEffectivePlatformVatConfiguration(tieInstant);
    expect(effective.rateBasisPoints).toBe(winnerRate);

    // Run it again — the tie-break must be stable across repeated calls,
    // never "whichever the planner happened to return that time".
    const effectiveAgain = await getEffectivePlatformVatConfiguration(tieInstant);
    expect(effectiveAgain).toEqual(effective);
  });

  it('InTx resolves through the same open transaction, consistently with the top-level resolver', async () => {
    const probe = new Date();
    const viaTopLevel = await getEffectivePlatformVatConfiguration(probe);
    const viaTx = await db.transaction(async (tx) => {
      return getEffectivePlatformVatConfigurationInTx(tx, probe);
    });
    expect(viaTx).toEqual(viaTopLevel);
  });

  it('fails closed with VatConfigurationUnavailableError when no row is effective yet', async () => {
    // Every real row in this database (baseline + anything any test ever
    // inserts) has `effectiveAt` no earlier than the migration's own apply
    // time, which postdates the Unix epoch by construction.
    await expect(getEffectivePlatformVatConfiguration(new Date(0))).rejects.toBeInstanceOf(
      VatConfigurationUnavailableError,
    );
  });

  it('the baseline row itself carries no admin actor (system-seeded, not Admin-authored)', async () => {
    const [baseline] = await db
      .select()
      .from(platformVatConfiguration)
      .where(eq(platformVatConfiguration.reasonCode, 'bootstrap'));
    expect(baseline).toBeDefined();
    expect(baseline?.createdByAdminId).toBeNull();
    expect(baseline?.enabled).toBe(false);
    expect(baseline?.rateBasisPoints).toBe(700);
  });
});
