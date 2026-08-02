/**
 * Shared helpers for the two standalone SMTP probe scripts
 * (`email-verify.mjs`, `email-smoke.mjs`).
 *
 * The environment-parsing schema (`src/config/env.schema.ts`) and the
 * SMTP-config resolution rule (`src/lib/auth/smtp-config.ts`) are imported
 * directly — not restated in plain JS — so these scripts genuinely run the
 * SAME resolver the running app calls from `getEmailAdapter()`, closing the
 * "standalone script uses a different environment-loading path than the
 * application" gap. Both source files are plain TypeScript with no
 * `server-only` import and no non-erasable syntax (no parameter properties,
 * no enums), so Node's built-in TypeScript support (stable, unflagged, since
 * Node 23.6 — this project's `.nvmrc` pins Node 24) loads them without a
 * build step or experimental flag.
 *
 * `src/lib/auth/email.ts` itself (the actual `SmtpEmailAdapter`/
 * `getEmailAdapter()`) is NOT imported here: it starts with `import
 * 'server-only'`, which resolves to a throwing stub outside Next.js's
 * `react-server` module-resolution condition, and its constructor uses a
 * TypeScript parameter property, which Node's type-stripping (by design)
 * does not support since it changes runtime behavior rather than only
 * erasing types. Reaching into that module from a bare `node` process would
 * require an experimental `--experimental-transform-types` flag plus a
 * custom loader for the `@/*` path alias — fragile, version-sensitive
 * machinery this dev-only probe should not depend on. The Nodemailer
 * transport construction below therefore mirrors `SmtpEmailAdapter`
 * verbatim (transport options, `from`/`to` shape) rather than importing it;
 * that mirroring is covered by `src/lib/auth/email.test.ts`, which asserts
 * the real class's behavior directly.
 */
import { parseEnvOrThrow, serverEnvSchema } from '../src/config/env.schema.ts';
import { resolveSmtpConfigFromEnv } from '../src/lib/auth/smtp-config.ts';

/**
 * Runs the exact same validated-environment parse `getServerEnv()` runs
 * (minus its module-level cache, irrelevant for a one-shot script), then the
 * exact same `resolveSmtpConfigFromEnv` the application's `getEmailAdapter()`
 * calls — same function, same shape of input, not a restatement.
 */
export function resolveValidatedSmtpConfig(rawEnv) {
  const env = parseEnvOrThrow(serverEnvSchema, rawEnv);
  return { env, result: resolveSmtpConfigFromEnv(env) };
}

const SAFE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,31}$/;

/** Never returns a raw error message — only a short whitelisted code, or "UNKNOWN". Mirrors src/lib/auth/dispatch-log.ts's sanitizeErrorCode (not imported directly for the same server-only reason as above). */
export function sanitizeErrorCode(error) {
  if (
    error &&
    typeof error === 'object' &&
    typeof error.code === 'string' &&
    SAFE_CODE_PATTERN.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error && SAFE_CODE_PATTERN.test(error.name)) {
    return error.name;
  }
  return 'UNKNOWN';
}

/** Both probe scripts must refuse outright in production — a local SMTP probe has no business running against a real deployment. */
export function refuseInProduction(scriptName) {
  if (process.env.NODE_ENV === 'production') {
    console.error(`[${scriptName}] refusing to run with NODE_ENV=production.`);
    process.exit(1);
  }
}
