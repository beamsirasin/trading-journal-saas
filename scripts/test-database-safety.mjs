/**
 * TEST-DATABASE SAFETY — unchanged behaviour, shared parsing.
 *
 * The URL parsing and identity normalization this file introduced now live in
 * `database-safety.mjs`, because the developer-write guard needs exactly the
 * same two functions and a second copy would be two definitions of "the same
 * database" that could drift apart. Nothing about the rules below moved: this
 * module still owns what makes a test database disposable, and its exported
 * contract is byte-for-byte what its ten e2e callers already rely on.
 */
import { normalizedDatabaseIdentity, parsePostgresUrl } from './database-safety.mjs';

export const TEST_DATABASE_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE';

export function validateTestDatabaseEnvironment(env = process.env) {
  const testUrl = env.TEST_DATABASE_URL;
  if (testUrl === undefined || testUrl.trim() === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Tests refuse to fall back to DATABASE_URL; see docs/migration-runbook.md.',
    );
  }

  const { url, databaseName } = parsePostgresUrl(testUrl, 'TEST_DATABASE_URL');
  if (!/(?:^|[_-])(test|e2e)(?:[_-]|$)/i.test(databaseName)) {
    throw new Error(
      'TEST_DATABASE_URL must name an unmistakably disposable database containing a test or e2e segment.',
    );
  }

  if (env.TEST_DATABASE_ACK !== TEST_DATABASE_ACKNOWLEDGEMENT) {
    throw new Error(
      `Set TEST_DATABASE_ACK=${TEST_DATABASE_ACKNOWLEDGEMENT} to confirm this database is disposable.`,
    );
  }

  const testIdentity = normalizedDatabaseIdentity(testUrl, 'TEST_DATABASE_URL');
  for (const variableName of ['DATABASE_URL', 'DATABASE_MIGRATION_URL']) {
    const candidate = env[variableName];
    if (
      candidate !== undefined &&
      candidate.trim() !== '' &&
      normalizedDatabaseIdentity(candidate, variableName) === testIdentity
    ) {
      throw new Error(
        `TEST_DATABASE_URL resolves to the same database as ${variableName}. Refusing destructive test access.`,
      );
    }
  }

  return { testUrl, hostname: url.hostname };
}
