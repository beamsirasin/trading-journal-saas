/**
 * DATABASE WRITE SAFETY — which database is a developer allowed to write to?
 *
 * WHY HOST HEURISTICS ARE NOT THE ANSWER. The obvious guard is "refuse remote
 * hosts", and it is wrong in both directions here. A personal Neon branch is a
 * remote host and is a completely legitimate development database — the repo's
 * own `docker-compose.yml` says so. Meanwhile a loopback URL proves nothing if
 * the rest of the configuration contradicts it (an SSH tunnel to a deployment
 * database is `localhost`). Hostnames describe where a database is, never what
 * it is FOR.
 *
 * SO THE ENVIRONMENT IS DECLARED, NOT DETECTED. `.env.local` states
 * `DATABASE_ENVIRONMENT`, and a developer-initiated write additionally requires
 * an acknowledgement naming what it is agreeing to. Both are absent by default,
 * so a machine that has never been configured refuses every risky command rather
 * than guessing from a hostname — the same fail-closed shape
 * `test-database-safety.mjs` already uses for disposable test databases, whose
 * parsing this module now owns and shares.
 *
 * THE PRODUCTION ACKNOWLEDGEMENT IS A DIFFERENT STRING ON PURPOSE. A developer
 * acknowledgement pasted into a deployment environment must not silently
 * authorize production writes, and vice versa: they are different decisions made
 * by different people at different times, so they cannot be the same token. No
 * deployment pipeline exists yet — this is the extensibility point for one, not
 * an implementation of it.
 *
 * NOTHING HERE EVER LOGS A URL. Connection strings carry passwords. Every
 * message this module produces names variables, an environment category, a host
 * class and at most a database name.
 */

/** Set in `.env.local` to authorize developer-initiated writes. */
export const DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT =
  'I_UNDERSTAND_THIS_DATABASE_ACCEPTS_DEVELOPER_WRITES';

/**
 * Reserved for a future, reviewed deployment step. Deliberately NOT accepted in
 * place of the developer acknowledgement, and deliberately not wired to any
 * command in this repository yet.
 */
export const PRODUCTION_DATABASE_WRITE_ACKNOWLEDGEMENT =
  'I_UNDERSTAND_THIS_WRITES_TO_THE_PRODUCTION_DATABASE';

/**
 * `development` — a personal branch or a local container. Developer-writable.
 * `preview`     — per-branch deployment data. Managed by the deployment, never
 *                 written to from a laptop.
 * `production`  — real user data. Requires its own acknowledgement.
 */
export const DATABASE_ENVIRONMENTS = ['development', 'preview', 'production'];

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function parsePostgresUrl(value, variableName) {
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

export function normalizedDatabaseIdentity(value, variableName) {
  const { url, databaseName } = parsePostgresUrl(value, variableName);
  const hostname = LOOPBACK_HOSTS.includes(url.hostname.toLowerCase())
    ? 'loopback'
    : url.hostname.toLowerCase();
  const port = url.port === '' ? '5432' : url.port;

  // Credentials and query parameters can differ while still addressing the
  // same database. They are deliberately excluded from the comparison.
  return `${hostname}:${port}/${databaseName.toLowerCase()}`;
}

/** `loopback` or `remote` — never the hostname itself. */
export function hostClass(url) {
  return LOOPBACK_HOSTS.includes(url.hostname.toLowerCase()) ? 'loopback' : 'remote';
}

function required(env, variableName) {
  const value = env[variableName];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/**
 * REFUSES UNLESS THE TARGET DATABASE HAS BEEN DECLARED WRITABLE BY A DEVELOPER.
 *
 * `operation` appears in the failure text so a refusal says what was refused —
 * "schema migration", "visual-dashboard seed", "platform-admin grant" — rather
 * than a generic denial the reader has to trace back to a command.
 *
 * Returns a small, loggable description on success. It contains no credentials.
 */
export function requireDeveloperDatabaseWrite(env = process.env, { operation, variableName } = {}) {
  const label = operation ?? 'this database write';
  const urlVariable = variableName ?? 'DATABASE_URL';

  const declared = required(env, 'DATABASE_ENVIRONMENT');
  if (declared === null) {
    throw new Error(
      `Refusing ${label}: DATABASE_ENVIRONMENT is not set, so the target database's purpose is unknown.\n` +
        `Set DATABASE_ENVIRONMENT to one of ${DATABASE_ENVIRONMENTS.join(', ')} in .env.local, and for a ` +
        `development database also set DEVELOPER_DATABASE_WRITE_ACK=${DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT}.\n` +
        'See docs/migration-runbook.md — Database write safety.',
    );
  }

  const environment = declared.toLowerCase();
  if (!DATABASE_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `Refusing ${label}: DATABASE_ENVIRONMENT="${environment}" is not a recognized environment ` +
        `(expected one of ${DATABASE_ENVIRONMENTS.join(', ')}).`,
    );
  }

  if (environment === 'production') {
    throw new Error(
      `Refusing ${label}: detected environment "production".\n` +
        'Developer-initiated writes to production are never authorized by DEVELOPER_DATABASE_WRITE_ACK — ' +
        'that acknowledgement is for development databases only.\n' +
        'A production schema migration is a separate, reviewed deployment step and is not runnable from ' +
        'this repository today.',
    );
  }

  if (environment === 'preview') {
    throw new Error(
      `Refusing ${label}: detected environment "preview".\n` +
        'Preview databases belong to their deployment and are not written to from a developer machine. ' +
        'Point DATABASE_ENVIRONMENT and the connection URLs at your own development branch instead.',
    );
  }

  if (required(env, 'DEVELOPER_DATABASE_WRITE_ACK') !== DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT) {
    throw new Error(
      `Refusing ${label}: detected environment "development", but DEVELOPER_DATABASE_WRITE_ACK is missing or does not match.\n` +
        `Set DEVELOPER_DATABASE_WRITE_ACK=${DEVELOPER_DATABASE_WRITE_ACKNOWLEDGEMENT} in .env.local to confirm ` +
        'this database is yours to write to.',
    );
  }

  const raw = required(env, urlVariable) ?? required(env, 'DATABASE_URL');
  if (raw === null) {
    throw new Error(`Refusing ${label}: neither ${urlVariable} nor DATABASE_URL is set.`);
  }
  // Throws on a malformed URL — a target that cannot be parsed can never be
  // shown to be safe.
  const { url, databaseName } = parsePostgresUrl(raw, urlVariable);

  /*
    CONTRADICTIONS BEAT DECLARATIONS.

    A declaration is a promise about configuration, and configuration can
    disagree with itself. Two disagreements are worth refusing over, and neither
    is a host heuristic:

      - the app database and the migration database name DIFFERENT databases,
        which means DDL would land somewhere the application never reads. Only
        the NAME is compared: Neon's pooled and direct endpoints are different
        hostnames for one database, and requiring identical hosts would break
        the documented setup.

      - the development database IS the disposable test database, whose whole
        contract is that anything may destroy it at any moment.
  */
  const migrationRaw = required(env, 'DATABASE_MIGRATION_URL');
  const appRaw = required(env, 'DATABASE_URL');
  if (migrationRaw !== null && appRaw !== null) {
    const migrationName = parsePostgresUrl(migrationRaw, 'DATABASE_MIGRATION_URL').databaseName;
    const appName = parsePostgresUrl(appRaw, 'DATABASE_URL').databaseName;
    if (migrationName.toLowerCase() !== appName.toLowerCase()) {
      throw new Error(
        `Refusing ${label}: DATABASE_URL and DATABASE_MIGRATION_URL name different databases ` +
          `("${appName}" and "${migrationName}"). They must address one database — on Neon that is the ` +
          'pooled and direct endpoint of the same branch.',
      );
    }
  }

  const testRaw = required(env, 'TEST_DATABASE_URL');
  if (testRaw !== null) {
    const testIdentity = normalizedDatabaseIdentity(testRaw, 'TEST_DATABASE_URL');
    if (normalizedDatabaseIdentity(raw, urlVariable) === testIdentity) {
      throw new Error(
        `Refusing ${label}: ${urlVariable} resolves to the same database as TEST_DATABASE_URL, which the ` +
          'test suite is entitled to destroy.',
      );
    }
  }

  return { environment, databaseName, host: hostClass(url), variable: urlVariable };
}

/** A one-line, credential-free summary for a script to print before it writes. */
export function describeTarget({ environment, databaseName, host }) {
  return `database "${databaseName}" (${host}, declared ${environment})`;
}
