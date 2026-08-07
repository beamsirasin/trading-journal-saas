import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CANONICAL_SYSTEM_MISTAKE_TYPES,
  isCanonicalMistakeKey,
  MISTAKE_SEVERITY_WEIGHTS,
} from './mistakes';

/**
 * Proves the Phase 07B correction: the nine canonical system mistake types
 * are seeded with one deliberately neutral default (severity `moderate`,
 * weight `1.0000`) rather than an unjustified, evidence-free
 * differentiation — and that this config can never silently drift from the
 * migration's own seed `INSERT`, since the migration cannot import
 * TypeScript and duplicates these values by hand.
 */
describe('CANONICAL_SYSTEM_MISTAKE_TYPES', () => {
  it('defines exactly nine system mistake types', () => {
    expect(CANONICAL_SYSTEM_MISTAKE_TYPES).toHaveLength(9);
  });

  it('has unique keys', () => {
    const keys = CANONICAL_SYSTEM_MISTAKE_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('preserves the nine canonical keys and labels, unchanged', () => {
    const keys = CANONICAL_SYSTEM_MISTAKE_TYPES.map((t) => t.key).sort();
    expect(keys).toEqual(
      [
        'moved_stop',
        'early_exit',
        'oversized_position',
        'no_setup',
        'revenge_trade',
        'chased_entry',
        'ignored_invalidation',
        'moved_target',
        'no_stop',
      ].sort(),
    );
  });

  it('every default severity is exactly moderate', () => {
    for (const type of CANONICAL_SYSTEM_MISTAKE_TYPES) {
      expect(type.severity).toBe('moderate');
    }
  });

  it('every default weight is exactly 1.0000', () => {
    for (const type of CANONICAL_SYSTEM_MISTAKE_TYPES) {
      expect(type.defaultWeight).toBe('1.0000');
    }
  });

  it('does not derive its neutral default from MISTAKE_SEVERITY_WEIGHTS', () => {
    // MISTAKE_SEVERITY_WEIGHTS['moderate'] is '0.35' — a different value,
    // deliberately. The nine canonical rows use a separate, explicit
    // neutral override, not the general severity-weight framework.
    expect(MISTAKE_SEVERITY_WEIGHTS.moderate).toBe('0.35');
    for (const type of CANONICAL_SYSTEM_MISTAKE_TYPES) {
      expect(type.defaultWeight).not.toBe(MISTAKE_SEVERITY_WEIGHTS[type.severity]);
    }
  });

  it('isCanonicalMistakeKey recognizes every canonical key and rejects an unknown one', () => {
    for (const type of CANONICAL_SYSTEM_MISTAKE_TYPES) {
      expect(isCanonicalMistakeKey(type.key)).toBe(true);
    }
    expect(isCanonicalMistakeKey('not_a_real_key')).toBe(false);
  });

  describe('drift-proofing against the migration seed', () => {
    const migrationSql = readFileSync(
      join(process.cwd(), 'drizzle', '0008_trade_domain_and_discipline.sql'),
      'utf8',
    );

    /**
     * Parses the nine `('id', NULL, 'key', 'label', 'severity', weight, ...)`
     * rows out of the migration's `INSERT INTO "mistake_types"` statement —
     * a plain text parse, not a database round trip, so this test runs in
     * the fast unit suite alongside every other `config/` test.
     */
    function parseSeedRows(): { key: string; severity: string; weight: string }[] {
      const rowPattern = /\('[0-9a-f-]{36}', NULL, '([a-z_]+)', '[^']*', '([a-z]+)', ([0-9.]+),/g;
      const rows: { key: string; severity: string; weight: string }[] = [];
      for (const match of migrationSql.matchAll(rowPattern)) {
        const [, key, severity, weight] = match;
        if (key === undefined || severity === undefined || weight === undefined) continue;
        rows.push({ key, severity, weight });
      }
      return rows;
    }

    it('the migration seeds exactly nine rows', () => {
      expect(parseSeedRows()).toHaveLength(9);
    });

    it('every migration-seeded row matches src/config/mistakes.ts exactly', () => {
      const seedRows = parseSeedRows();
      const seedByKey = new Map(seedRows.map((r) => [r.key, r]));

      for (const type of CANONICAL_SYSTEM_MISTAKE_TYPES) {
        const seeded = seedByKey.get(type.key);
        expect(seeded, `migration is missing a seed row for key "${type.key}"`).toBeDefined();
        expect(seeded?.severity).toBe(type.severity);
        // The migration's numeric literal (e.g. "1.0000") and the config's
        // string (e.g. "1.0000") must match exactly, not merely numerically
        // equal — a silent format drift (e.g. "1.00" vs "1.0000") is exactly
        // what this test exists to catch.
        expect(seeded?.weight).toBe(type.defaultWeight);
      }

      // No extra seed rows beyond the nine canonical config entries.
      const configKeys = new Set(CANONICAL_SYSTEM_MISTAKE_TYPES.map((t) => t.key));
      for (const row of seedRows) {
        expect(configKeys.has(row.key), `migration seeds an unrecognized key "${row.key}"`).toBe(
          true,
        );
      }
    });
  });
});
