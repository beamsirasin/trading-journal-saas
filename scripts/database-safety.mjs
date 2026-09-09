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

import { createHash } from 'node:crypto';

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

/**
 * CANONICAL HOST — the pooled/direct distinction removed, everything else kept.
 *
 * Neon publishes two hostnames per compute endpoint that differ by exactly one
 * suffix on the first label:
 *
 *   direct  ep-quiet-brook-12345.<region>.aws.neon.tech
 *   pooled  ep-quiet-brook-12345-pooler.<region>.aws.neon.tech
 *
 * They are one database and must compare equal, because the documented setup
 * points the application at the pooled endpoint and migrations at the direct
 * one. Stripping that suffix is a canonicalization of a published naming
 * convention — no endpoint id, project id or region is hardcoded, so a
 * developer's brand-new personal branch canonicalizes correctly on the first
 * run.
 *
 * Every other part of the hostname survives. That is the whole point: two
 * DIFFERENT endpoints, or two different regions, or two different projects,
 * stay different identities even when the database inside them shares a name.
 */
function canonicalHost(hostname) {
  const lower = hostname.toLowerCase();
  if (LOOPBACK_HOSTS.includes(lower)) return 'loopback';
  const [first, ...rest] = lower.split('.');
  return [first.replace(/-pooler$/, ''), ...rest].join('.');
}

/**
 * THE TARGET'S IDENTITY: canonical host, port and database name.
 *
 * WHAT THIS REPLACED, AND WHY THE PREVIOUS VERSION WAS DANGEROUS. The
 * app-vs-migration consistency check compared the database NAME alone, because
 * comparing raw hostnames would have rejected Neon's pooled/direct pair. That
 * traded away host identity entirely to solve a one-suffix problem, and it let
 * the worst realistic misconfiguration through: `DATABASE_URL` on one Neon
 * branch and `DATABASE_MIGRATION_URL` on another, both holding a database called
 * `tradechemist`, would have been accepted as one target — DDL landing on a
 * branch the application never reads.
 *
 * THE PORT IS PART OF THE IDENTITY, defaulting to 5432 when absent. Two
 * PostgreSQL servers on `localhost:5432` and `localhost:5433` are genuinely
 * different databases — a Docker container beside a native install is an
 * ordinary developer setup — and collapsing them would be the same class of
 * error as collapsing two Neon branches. Neon's pooled and direct endpoints both
 * use 5432, so including the port costs that case nothing.
 *
 * Credentials and query parameters are excluded: a password rotation or an
 * `sslmode` change does not make it a different database, and an identity that
 * moved when a password did could not be written down in `.env.local` at all.
 */
export function normalizedDatabaseIdentity(value, variableName) {
  const { url, databaseName } = parsePostgresUrl(value, variableName);
  const port = url.port === '' ? '5432' : url.port;
  return `${canonicalHost(url.hostname)}:${port}/${databaseName.toLowerCase()}`;
}

/**
 * A SHORT, NON-SECRET FINGERPRINT OF A TARGET, for `.env.local` to pin.
 *
 * Hashed rather than stored verbatim so pasting one into a shared file, a chat
 * message or a CI log discloses no hostname. It is derived only from the
 * canonical identity above — never from a password — so it is stable across
 * credential rotation and reproducible on any machine holding the same URL.
 */
export function databaseTargetFingerprint(value, variableName) {
  const identity = normalizedDatabaseIdentity(value, variableName);
  return `db1_${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
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
    const migrationIdentity = normalizedDatabaseIdentity(migrationRaw, 'DATABASE_MIGRATION_URL');
    const appIdentity = normalizedDatabaseIdentity(appRaw, 'DATABASE_URL');
    if (migrationIdentity !== appIdentity) {
      throw new Error(
        `Refusing ${label}: DATABASE_URL and DATABASE_MIGRATION_URL address different databases.\n` +
          `Application target ${databaseTargetFingerprint(appRaw, 'DATABASE_URL')}, migration target ` +
          `${databaseTargetFingerprint(migrationRaw, 'DATABASE_MIGRATION_URL')}.\n` +
          'They must be one database — on Neon, the pooled and direct endpoints of the SAME branch.',
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

  /*
    THE PINNED TARGET — the check that survives a swapped URL.

    Everything above validates the SHAPE of the configuration. None of it
    notices the failure that actually happens: a developer pastes a different
    connection string over `DATABASE_URL` — to reproduce something, to check a
    report — and leaves `DATABASE_ENVIRONMENT=development` and the
    acknowledgement exactly where they were. Every declaration still says
    "development" because nobody edited the declarations.

    So the approved target is written down once, as a fingerprint, and compared.
    A swapped URL produces a different fingerprint and is refused, whatever the
    flags around it still claim.
  */
  const expected = required(env, 'DEVELOPER_DATABASE_TARGET_ID');
  const actual = databaseTargetFingerprint(raw, urlVariable);
  if (expected === null) {
    throw new Error(
      `Refusing ${label}: DEVELOPER_DATABASE_TARGET_ID is not set, so no database has been approved for ` +
        'developer writes.\n' +
        `The database currently configured has target id ${actual}.\n` +
        'Confirm that is your own development database — not a deployment branch — then set ' +
        `DEVELOPER_DATABASE_TARGET_ID=${actual} in .env.local.\n` +
        'See docs/migration-runbook.md — Database write safety.',
    );
  }
  if (expected !== actual) {
    throw new Error(
      `Refusing ${label}: configured database does not match the approved development write target.\n` +
        `Approved ${expected}, configured ${actual}.\n` +
        'Either the connection URL changed or the approved target is stale. Re-confirm which database this ' +
        'should be before updating DEVELOPER_DATABASE_TARGET_ID.',
    );
  }

  return {
    environment,
    databaseName,
    host: hostClass(url),
    variable: urlVariable,
    targetId: actual,
  };
}

/** A one-line, credential-free summary for a script to print before it writes. */
export function describeTarget({ environment, databaseName, host, targetId }) {
  const pinned = targetId === undefined ? '' : `, target ${targetId}`;
  return `database "${databaseName}" (${host}, declared ${environment}${pinned})`;
}
