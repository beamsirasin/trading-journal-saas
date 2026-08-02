import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadEnvConfig, resetEnv } from '@next/env';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveMigrationUrl } from './migration-env';

describe('resolveMigrationUrl', () => {
  it('prefers DATABASE_MIGRATION_URL when both are set', () => {
    const result = resolveMigrationUrl({
      DATABASE_MIGRATION_URL: 'postgresql://direct-example/db',
      DATABASE_URL: 'postgresql://pooled-example/db',
    });
    expect(result).toEqual({
      source: 'DATABASE_MIGRATION_URL',
      url: 'postgresql://direct-example/db',
    });
  });

  it('falls back to DATABASE_URL when DATABASE_MIGRATION_URL is unset', () => {
    const result = resolveMigrationUrl({ DATABASE_URL: 'postgresql://pooled-example/db' });
    expect(result).toEqual({ source: 'DATABASE_URL', url: 'postgresql://pooled-example/db' });
  });

  it('treats an empty-string DATABASE_MIGRATION_URL as unset', () => {
    const result = resolveMigrationUrl({
      DATABASE_MIGRATION_URL: '',
      DATABASE_URL: 'postgresql://pooled-example/db',
    });
    expect(result.source).toBe('DATABASE_URL');
  });

  it('throws a clear, actionable error when neither variable is set', () => {
    expect(() => resolveMigrationUrl({})).toThrow(
      /DATABASE_URL.*DATABASE_MIGRATION_URL.*docs\/migration-runbook\.md/s,
    );
  });
});

// Next.js's own type augmentation declares `NODE_ENV` read-only on
// `NodeJS.ProcessEnv` (it is normally set once, by the runtime, before user
// code runs) — this test needs to change it temporarily, so it goes through
// a narrower, writable view rather than fighting that augmentation with a
// broad `any`.
function setNodeEnv(value: string | undefined): void {
  const env = process.env as { NODE_ENV?: string };
  if (value === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = value;
  }
}

describe('drizzle.config.ts environment loading (regression)', () => {
  let fixtureDir: string | undefined;
  let originalNodeEnv: string | undefined;

  afterEach(() => {
    // @next/env snapshots process.env the first time it runs in a process
    // and replays that snapshot here — nothing this test writes into
    // process.env survives into any other test.
    resetEnv();
    setNodeEnv(originalNodeEnv);
    if (fixtureDir !== undefined) {
      rmSync(fixtureDir, { recursive: true, force: true });
      fixtureDir = undefined;
    }
  });

  it('loads DATABASE_MIGRATION_URL/DATABASE_URL from a .env.local-equivalent fixture, the same mechanism next dev/next build use', () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'drizzle-env-fixture-'));
    // Obviously-fake, structurally-shaped values in an isolated temp
    // directory — never the developer's real .env.local, never a real
    // credential, never printed by this test.
    writeFileSync(
      join(fixtureDir, '.env.local'),
      [
        'DATABASE_URL=postgresql://fixture-user:fixture-pass@fixture-pooled-host/fixture_db',
        'DATABASE_MIGRATION_URL=postgresql://fixture-user:fixture-pass@fixture-direct-host/fixture_db',
      ].join('\n'),
    );

    // loadEnvConfig excludes `.env.local` specifically when NODE_ENV==='test'
    // (Vitest's own default) — temporarily stepping outside 'test' here is
    // what makes this test actually exercise the `.env.local` path rather
    // than silently loading nothing and passing for the wrong reason.
    originalNodeEnv = process.env.NODE_ENV;
    setNodeEnv('development');

    // forceReload: true — @next/env caches its parsed result per process;
    // without this, a `loadEnvConfig` call anywhere else in the same
    // worker could make this assert against a stale cache instead of this
    // fixture.
    loadEnvConfig(fixtureDir, true, undefined, true);

    const resolved = resolveMigrationUrl(process.env);
    expect(resolved.source).toBe('DATABASE_MIGRATION_URL');
    expect(resolved.url).toBe(
      'postgresql://fixture-user:fixture-pass@fixture-direct-host/fixture_db',
    );
  });
});
