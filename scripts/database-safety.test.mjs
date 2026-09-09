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
  databaseTargetFingerprint,
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
/* Fictional endpoints in Neon's published hostname shape. No real project,
   branch or region appears here, and none is hardcoded in the module. */
const DEV_DIRECT = `postgresql://dev_user:${SECRET}@ep-quiet-brook-11111.eu-west-2.aws.neon.tech/tradechemist`;
const DEV_POOLED = `postgresql://dev_user:${SECRET}@ep-quiet-brook-11111-pooler.eu-west-2.aws.neon.tech/tradechemist`;
/* A DIFFERENT branch that happens to hold a database with the SAME name — the
   configuration the previous name-only comparison accepted. */
const OTHER_BRANCH = `postgresql://dev_user:${SECRET}@ep-still-water-99999.eu-west-2.aws.neon.tech/tradechemist`;
const LOCAL_URL = 'postgresql://trading_os:pw@localhost:5432/trading_os';

const DEV_TARGET = databaseTargetFingerprint(DEV_POOLED, 'DATABASE_URL');

/** A correctly configured personal development branch, pinned. */
function devEnv(overrides = {}) {
  return {
    DATABASE_ENVIRONMENT: 'development',
    DEVELOPER_DATABASE_WRITE_ACK: DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT,
    DEVELOPER_DATABASE_TARGET_ID: DEV_TARGET,
    DATABASE_URL: DEV_POOLED,
    ...overrides,
  };
}

describe('an unconfigured machine writes to nothing', () => {
  it('refuses when no environment is declared', () => {
    expect(() => requireDeveloperDatabaseWrite({ DATABASE_URL: DEV_POOLED })).toThrow(
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
      databaseName: 'tradechemist',
      host: 'remote',
      variable: 'DATABASE_URL',
      targetId: DEV_TARGET,
    });
  });

  it('treats a personal Neon branch as perfectly legitimate', () => {
    // The guard must never reduce to "remote host = forbidden": the repo's own
    // docs offer a personal Neon branch as a first-class development option.
    expect(requireDeveloperDatabaseWrite(devEnv()).host).toBe('remote');
    const local = devEnv({
      DATABASE_URL: LOCAL_URL,
      DEVELOPER_DATABASE_TARGET_ID: databaseTargetFingerprint(LOCAL_URL, 'DATABASE_URL'),
    });
    expect(requireDeveloperDatabaseWrite(local).host).toBe('loopback');
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
    ).toThrow(/address different databases/);
  });

  it('accepts Neon pooled and direct endpoints of one database', () => {
    // Different hostnames, same database — the documented Neon setup. Comparing
    // hosts instead of database names would break it.
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_MIGRATION_URL: DEV_DIRECT })),
    ).not.toThrow();
  });

  it('refuses when the development database IS the disposable test database', () => {
    expect(() => requireDeveloperDatabaseWrite(devEnv({ TEST_DATABASE_URL: DEV_POOLED }))).toThrow(
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
      { DATABASE_URL: DEV_POOLED },
      devEnv({ DATABASE_ENVIRONMENT: 'production' }),
      devEnv({ DATABASE_ENVIRONMENT: 'preview' }),
      devEnv({ DEVELOPER_DATABASE_WRITE_ACK: 'wrong' }),
      devEnv({ TEST_DATABASE_URL: DEV_POOLED }),
      devEnv({ DATABASE_MIGRATION_URL: `postgresql://u:${SECRET}@h.example/other_db` }),
      devEnv({ DEVELOPER_DATABASE_TARGET_ID: 'db1_deadbeefdeadbeef' }),
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
    expect(summary).toBe(
      `database "tradechemist" (remote, declared development, target ${DEV_TARGET})`,
    );
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
    expect(target.databaseName).toBe('tradechemist');
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

/**
 * TARGET IDENTITY — the hole the first version of this guard left open.
 *
 * The app/migration consistency check compared database NAMES only, so
 * `DATABASE_URL` on one Neon branch and `DATABASE_MIGRATION_URL` on another,
 * both holding a database called `tradechemist`, passed as one target. These
 * cases pin the canonicalization that closed it.
 */
describe('canonical target identity', () => {
  const id = (url) => normalizedDatabaseIdentity(url, 'X');

  it('A — pooled and direct endpoints of one Neon compute are the SAME target', () => {
    expect(id(DEV_POOLED)).toBe(id(DEV_DIRECT));
    expect(databaseTargetFingerprint(DEV_POOLED, 'X')).toBe(
      databaseTargetFingerprint(DEV_DIRECT, 'X'),
    );
  });

  it('B — different Neon endpoints holding the same database name are DIFFERENT', () => {
    expect(id(DEV_POOLED)).not.toBe(id(OTHER_BRANCH));
    // The exact configuration the name-only comparison used to accept.
    expect(parsePostgresUrl(DEV_POOLED, 'X').databaseName).toBe(
      parsePostgresUrl(OTHER_BRANCH, 'X').databaseName,
    );
  });

  it('B2 — the same endpoint id in a different region is a different target', () => {
    const other = DEV_DIRECT.replace('eu-west-2', 'us-east-1');
    expect(id(DEV_DIRECT)).not.toBe(id(other));
  });

  it('C — the same endpoint with a different database name is DIFFERENT', () => {
    expect(id(DEV_DIRECT)).not.toBe(id(DEV_DIRECT.replace('/tradechemist', '/tradechemist_two')));
  });

  it('D — a different port on localhost is a DIFFERENT target', () => {
    /*
      THE SAFEST READING, AND DELIBERATE. A Docker container on 5432 beside a
      native install on 5433 is an ordinary developer machine, and they are two
      unrelated databases. Collapsing them would repeat the very mistake this
      change fixes, one scope smaller. Neon's pooled and direct endpoints both
      use 5432, so nothing about case A pays for this.
    */
    expect(id(LOCAL_URL)).not.toBe(id(LOCAL_URL.replace(':5432', ':5433')));
    // An omitted port still means 5432, so those two DO match.
    expect(id('postgresql://u:p@localhost/db')).toBe(id('postgresql://u:p@localhost:5432/db'));
  });

  it('E — a malformed URL fails closed rather than producing an identity', () => {
    expect(() => id('not-a-url')).toThrow(/must be a valid PostgreSQL URL/);
    expect(() => databaseTargetFingerprint('mysql://u:p@h/db', 'X')).toThrow(/scheme/);
  });

  it('only strips the pooler suffix, never a hostname that merely contains it', () => {
    // `-pooler` is stripped from the END of the FIRST label and nowhere else.
    expect(id('postgresql://u:p@pooler-host.example/db')).toBe('pooler-host.example:5432/db');
    expect(id('postgresql://u:p@ep-a.pooler.example/db')).toBe('ep-a.pooler.example:5432/db');
  });

  it('is stable across credential rotation and query parameters', () => {
    const rotated = DEV_POOLED.replace(SECRET, 'a-brand-new-password');
    expect(databaseTargetFingerprint(rotated, 'X')).toBe(
      databaseTargetFingerprint(DEV_POOLED, 'X'),
    );
    expect(databaseTargetFingerprint(`${DEV_POOLED}?sslmode=require`, 'X')).toBe(
      databaseTargetFingerprint(DEV_POOLED, 'X'),
    );
  });

  it('discloses no hostname in the fingerprint itself', () => {
    const print = databaseTargetFingerprint(DEV_POOLED, 'X');
    expect(print).toMatch(/^db1_[0-9a-f]{16}$/);
    expect(print).not.toContain('neon');
    expect(print).not.toContain('quiet-brook');
  });
});

describe('the approved developer target must be pinned', () => {
  it('refuses a mismatched app/migration pair even when both names match', () => {
    // The regression this whole change exists for.
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_MIGRATION_URL: OTHER_BRANCH })),
    ).toThrow(/address different databases/);
  });

  it('accepts the documented Neon pooled + direct pairing', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_MIGRATION_URL: DEV_DIRECT })),
    ).not.toThrow();
  });

  it('refuses when no target has been approved, and says which one is configured', () => {
    const env = devEnv();
    delete env.DEVELOPER_DATABASE_TARGET_ID;
    let message = '';
    try {
      requireDeveloperDatabaseWrite(env);
    } catch (error) {
      message = String(error.message);
    }
    expect(message).toMatch(/DEVELOPER_DATABASE_TARGET_ID is not set/);
    // The refusal is also the discovery path: it prints the id to approve.
    expect(message).toContain(DEV_TARGET);
    expect(message).not.toContain(SECRET);
  });

  it('refuses a swapped URL while every declaration still says development', () => {
    /*
      THE FAILURE THIS PROTECTS AGAINST. A developer pastes another connection
      string over DATABASE_URL to check something and leaves DATABASE_ENVIRONMENT
      and the acknowledgement untouched — because nobody edits a flag they are
      not thinking about. Every earlier check still passes; only the pin notices.
    */
    const swapped = devEnv({ DATABASE_URL: OTHER_BRANCH });
    expect(swapped.DATABASE_ENVIRONMENT).toBe('development');
    expect(swapped.DEVELOPER_DATABASE_WRITE_ACK).toBe(DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT);
    expect(() => requireDeveloperDatabaseWrite(swapped)).toThrow(
      /does not match the approved development write target/,
    );
  });

  it('accepts the approved target reached through its other endpoint', () => {
    // Pinned via the pooled URL, configured with the direct one — one database.
    expect(() => requireDeveloperDatabaseWrite(devEnv({ DATABASE_URL: DEV_DIRECT }))).not.toThrow();
  });

  it('cannot be satisfied for a production database however it is pinned', () => {
    expect(() =>
      requireDeveloperDatabaseWrite(
        devEnv({
          DATABASE_ENVIRONMENT: 'production',
          DEVELOPER_DATABASE_TARGET_ID: DEV_TARGET,
        }),
      ),
    ).toThrow(/detected environment "production"/);
  });

  it('cannot approve a database the test suite may destroy', () => {
    expect(() => requireDeveloperDatabaseWrite(devEnv({ TEST_DATABASE_URL: DEV_DIRECT }))).toThrow(
      /same database as TEST_DATABASE_URL/,
    );
  });

  it('reveals no credential when the target does not match', () => {
    let message = '';
    try {
      requireDeveloperDatabaseWrite(devEnv({ DATABASE_URL: OTHER_BRANCH }));
    } catch (error) {
      message = String(error.message);
    }
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('postgresql://');
    expect(message).not.toContain('neon.tech');
    expect(message).not.toContain('still-water');
  });
});
