/**
 * WHAT THE WRITE GUARD MUST REFUSE.
 *
 * Every case here is a way a developer machine could end up writing to a
 * database nobody meant to write to: an unconfigured laptop, a copied
 * acknowledgement pasted into the wrong environment, a `.env.local` whose
 * migration URL drifted onto a different database, a URL that does not parse.
 * The guard is fail-closed, so the interesting assertions are the refusals.
 *
 * NO LIVE DATABASE IS TOUCHED. Every case is a synthetic environment object.
 */
import { describe, expect, it } from 'vitest';

import {
  describeTarget,
  DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT,
  normalizedDatabaseIdentity,
  parsePostgresUrl,
  PRODUCTION_DATABASE_WRITE_ACKNOWLEDGEMENT,
  requireDeveloperDatabaseWrite,
} from './database-safety.mjs';
import {
  TEST_DATABASE_ACKNOWLEDGEMENT,
  validateTestDatabaseEnvironment,
} from './test-database-safety.mjs';

const SECRET = 'sup3rs3cr3t-password';
const DEV_URL = `postgresql://dev_user:${SECRET}@ep-personal-branch.aws.neon.tech/tradechemist_dev`;
const DEV_DIRECT = `postgresql://dev_user:${SECRET}@ep-personal-branch-pooler.aws.neon.tech/tradechemist_dev`;
const LOCAL_URL = 'postgresql://trading_os:pw@localhost:5432/trading_os';

/** A correctly configured personal development branch. */
function devEnv(overrides = {}) {
  return {
    DATABASE_ENVIRONMENT: 'development',
    DEVELOPER_DATABASE_WRITE_ACK: DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT,
    DATABASE_URL: DEV_URL,
    ...overrides,
  };
}

describe('an unconfigured machine writes to nothing', () => {
  it('refuses when no environment is declared', () => {
    expect(() => requireDeveloperDatabaseWrite({ DATABASE_URL: DEV_URL })).toThrow(
      /DATABASE_ENVIRONMENT is not set/,
    );
  });

  it('refuses an environment name it does not recognize', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_ENVIRONMENT: 'staging' })),
    ).toThrow(/not a recognized environment/);
  });

  it('refuses a declared development database with no acknowledgement', () => {
    const env = devEnv();
    delete env.DEVELOPER_DATABASE_WRITE_ACK;
    expect(() => requireDeveloperDatabaseWrite(env)).toThrow(
      /DEVELOPER_DATABASE_WRITE_ACK is missing/,
    );
  });

  it('refuses an acknowledgement that is merely close', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DEVELOPER_DATABASE_WRITE_ACK: 'yes' })),
    ).toThrow(/does not match/);
  });

  it('admits a correctly declared development database', () => {
    const target = requireDeveloperDatabaseWrite(devEnv());
    expect(target).toEqual({
      environment: 'development',
      databaseName: 'tradechemist_dev',
      host: 'remote',
      variable: 'DATABASE_URL',
    });
  });

  it('treats a personal Neon branch as perfectly legitimate', () => {
    // The guard must never reduce to "remote host = forbidden": the repo's own
    // docs offer a personal Neon branch as a first-class development option.
    expect(requireDeveloperDatabaseWrite(devEnv()).host).toBe('remote');
    expect(requireDeveloperDatabaseWrite(devEnv({ DATABASE_URL: LOCAL_URL })).host).toBe(
      'loopback',
    );
  });
});

describe('a development acknowledgement never reaches production', () => {
  it('refuses production even when the developer acknowledgement is present', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_ENVIRONMENT: 'production' })),
    ).toThrow(/detected environment "production"/);
  });

  it('refuses production even when the production acknowledgement is present', () => {
    // The extensibility point exists; no command in this repository may use it.
    expect(() =>
      requireDeveloperDatabaseWrite(
        devEnv({
          DATABASE_ENVIRONMENT: 'production',
          PRODUCTION_DATABASE_WRITE_ACK: PRODUCTION_DATABASE_WRITE_ACKNOWLEDGEMENT,
        }),
      ),
    ).toThrow(/separate, reviewed deployment step/);
  });

  it('refuses preview, which belongs to its deployment', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_ENVIRONMENT: 'preview' })),
    ).toThrow(/detected environment "preview"/);
  });

  it('does not let a loopback host override a production declaration', () => {
    // A tunnel to a deployment database is `localhost`. The declaration wins.
    expect(() =>
      requireDeveloperDatabaseWrite(
        devEnv({ DATABASE_ENVIRONMENT: 'production', DATABASE_URL: LOCAL_URL }),
      ),
    ).toThrow(/detected environment "production"/);
  });

  it('keeps the two acknowledgements distinct', () => {
    expect(DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT).not.toBe(
      PRODUCTION_DATABASE_WRITE_ACKNOWLEDGEMENT,
    );
  });
});

describe('configuration that contradicts itself', () => {
  it('refuses when the app and migration URLs name different databases', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(
        devEnv({
          DATABASE_MIGRATION_URL: `postgresql://u:${SECRET}@ep-other.aws.neon.tech/tradechemist`,
        }),
      ),
    ).toThrow(/name different databases/);
  });

  it('accepts Neon pooled and direct endpoints of one database', () => {
    // Different hostnames, same database — the documented Neon setup. Comparing
    // hosts instead of database names would break it.
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_MIGRATION_URL: DEV_DIRECT })),
    ).not.toThrow();
  });

  it('refuses when the development database IS the disposable test database', () => {
    expect(() => requireDeveloperDatabaseWrite(devEnv({ TEST_DATABASE_URL: DEV_URL }))).toThrow(
      /same database as TEST_DATABASE_URL/,
    );
  });

  it('refuses a malformed URL rather than assuming it is safe', () => {
    expect(() => requireDeveloperDatabaseWrite(devEnv({ DATABASE_URL: 'not-a-url' }))).toThrow(
      /must be a valid PostgreSQL URL/,
    );
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_URL: 'mysql://u:p@host/db' })),
    ).toThrow(/postgres:\/\/ or postgresql:\/\/ scheme/);
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_URL: 'postgresql://u:p@host' })),
    ).toThrow(/must name a database/);
  });

  it('refuses when no connection URL is configured at all', () => {
    const env = devEnv();
    delete env.DATABASE_URL;
    expect(() => requireDeveloperDatabaseWrite(env)).toThrow(
      /neither DATABASE_URL nor DATABASE_URL is set/,
    );
  });
});

describe('nothing leaks a credential', () => {
  it('keeps the password out of every refusal and every success line', () => {
    const cases = [
      { DATABASE_URL: DEV_URL },
      devEnv({ DATABASE_ENVIRONMENT: 'production' }),
      devEnv({ DATABASE_ENVIRONMENT: 'preview' }),
      devEnv({ DEVELOPER_DATABASE_WRITE_ACK: 'wrong' }),
      devEnv({ TEST_DATABASE_URL: DEV_URL }),
      devEnv({ DATABASE_MIGRATION_URL: `postgresql://u:${SECRET}@h.example/other_db` }),
    ];
    for (const env of cases) {
      let message = '';
      try {
        requireDeveloperDatabaseWrite(env);
      } catch (error) {
        message = String(error.message);
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain('postgresql://');
      expect(message).not.toContain('neon.tech');
    }

    const summary = describeTarget(requireDeveloperDatabaseWrite(devEnv()));
    expect(summary).not.toContain(SECRET);
    expect(summary).not.toContain('neon.tech');
    expect(summary).toBe('database "tradechemist_dev" (remote, declared development)');
  });
});

describe('the operation is named in the refusal', () => {
  it('says what was refused, not merely that something was', () => {
    expect(() => requireDeveloperDatabaseWrite({}, { operation: 'drizzle-kit migrate' })).toThrow(
      /Refusing drizzle-kit migrate/,
    );
    expect(() =>
      requireDeveloperDatabaseWrite({}, { operation: 'the visual-dashboard fixture seed' }),
    ).toThrow(/Refusing the visual-dashboard fixture seed/);
  });

  it('reports the migration variable when that is what is being guarded', () => {
    const target = requireDeveloperDatabaseWrite(devEnv({ DATABASE_MIGRATION_URL: DEV_DIRECT }), {
      variableName: 'DATABASE_MIGRATION_URL',
    });
    expect(target.variable).toBe('DATABASE_MIGRATION_URL');
    expect(target.databaseName).toBe('tradechemist_dev');
  });
});

describe('test-database safety is unchanged by the generalization', () => {
  const testEnv = {
    TEST_DATABASE_URL: 'postgresql://u:p@localhost:5432/trading_os_integration_test',
    TEST_DATABASE_ACK: TEST_DATABASE_ACKNOWLEDGEMENT,
  };

  it('accepts a disposable test database', () => {
    expect(validateTestDatabaseEnvironment(testEnv)).toEqual({
      testUrl: testEnv.TEST_DATABASE_URL,
      hostname: 'localhost',
    });
  });

  it('still refuses a missing URL, a non-disposable name and a missing acknowledgement', () => {
    expect(() => validateTestDatabaseEnvironment({})).toThrow(/TEST_DATABASE_URL is not set/);
    expect(() =>
      validateTestDatabaseEnvironment({ ...testEnv, TEST_DATABASE_URL: LOCAL_URL }),
    ).toThrow(/test or e2e segment/);
    const noAck = { ...testEnv };
    delete noAck.TEST_DATABASE_ACK;
    expect(() => validateTestDatabaseEnvironment(noAck)).toThrow(/TEST_DATABASE_ACK/);
  });

  it('still refuses when the test database is the app or migration database', () => {
    for (const variable of ['DATABASE_URL', 'DATABASE_MIGRATION_URL']) {
      expect(() =>
        validateTestDatabaseEnvironment({ ...testEnv, [variable]: testEnv.TEST_DATABASE_URL }),
      ).toThrow(new RegExp(`same database as ${variable}`));
    }
  });

  it('is not affected by the developer-write variables', () => {
    // The two guards answer different questions and must not interfere.
    expect(() =>
      validateTestDatabaseEnvironment({
        ...testEnv,
        DATABASE_ENVIRONMENT: 'production',
        DEVELOPER_DATABASE_WRITE_ACK: DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT,
      }),
    ).not.toThrow();
  });
});

describe('shared parsing primitives', () => {
  it('normalizes loopback spellings to one identity', () => {
    const ids = ['localhost', '127.0.0.1', '[::1]'].map((host) =>
      normalizedDatabaseIdentity(`postgresql://u:p@${host}:5432/db`, 'X'),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('ignores credentials and query parameters when comparing databases', () => {
    expect(normalizedDatabaseIdentity('postgresql://a:1@h.example/db?sslmode=require', 'X')).toBe(
      normalizedDatabaseIdentity('postgresql://b:2@h.example:5432/db', 'X'),
    );
  });

  it('decodes an escaped database name', () => {
    expect(parsePostgresUrl('postgresql://u:p@h.example/my%20db', 'X').databaseName).toBe('my db');
  });
});
