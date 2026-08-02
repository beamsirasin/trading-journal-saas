export const TEST_DATABASE_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE';

function parsePostgresUrl(value, variableName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${variableName} must use the postgres:// or postgresql:// scheme.`);
  }

  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (databaseName === '') {
    throw new Error(`${variableName} must name a database.`);
  }

  return { url, databaseName };
}

function normalizedDatabaseIdentity(value, variableName) {
  const { url, databaseName } = parsePostgresUrl(value, variableName);
  const hostname = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    ? 'loopback'
    : url.hostname.toLowerCase();
  const port = url.port === '' ? '5432' : url.port;

  // Credentials and query parameters can differ while still addressing the
  // same database. They are deliberately excluded from the comparison.
  return `${hostname}:${port}/${databaseName.toLowerCase()}`;
}

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
