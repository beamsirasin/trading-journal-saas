/**
 * Shared helpers for the two standalone SMTP probe scripts
 * (`email-verify.mjs`, `email-smoke.mjs`). Both run under plain Node, which
 * cannot import TypeScript source directly, so the SMTP-config rule is
 * restated here in plain JS rather than imported from
 * `src/lib/auth/smtp-config.ts`. Keep the two in sync — that TS module (and
 * its test file, `src/lib/auth/smtp-config.test.ts`) is the authoritative
 * definition of the rule; this is a thin, obviously-equivalent restatement
 * for a dev CLI tool, not a second source of truth for application behavior.
 */

/** @returns {{ ok: true, config: { host: string, port: number, secure: boolean, auth?: { user: string, pass: string } } } | { ok: false, reason: 'not-opted-in' | 'incomplete' | 'auth-mismatch' }} */
export function resolveSmtpConfig(env) {
  if (env.EMAIL_PROVIDER !== 'smtp') {
    return { ok: false, reason: 'not-opted-in' };
  }

  const host = env.SMTP_HOST === undefined || env.SMTP_HOST === '' ? undefined : env.SMTP_HOST;
  const port =
    env.SMTP_PORT === undefined || env.SMTP_PORT === '' ? undefined : Number(env.SMTP_PORT);
  const fromAddress =
    env.EMAIL_FROM_ADDRESS === undefined || env.EMAIL_FROM_ADDRESS === ''
      ? undefined
      : env.EMAIL_FROM_ADDRESS;

  if (host === undefined || port === undefined || Number.isNaN(port) || fromAddress === undefined) {
    return { ok: false, reason: 'incomplete' };
  }

  const hasUsername = env.SMTP_USERNAME !== undefined && env.SMTP_USERNAME !== '';
  const hasPassword = env.SMTP_PASSWORD !== undefined && env.SMTP_PASSWORD !== '';
  if (hasUsername !== hasPassword) {
    return { ok: false, reason: 'auth-mismatch' };
  }

  return {
    ok: true,
    config: {
      host,
      port,
      secure: env.SMTP_SECURE === 'true',
      fromAddress,
      fromName: env.EMAIL_FROM_NAME,
      auth: hasUsername ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD } : undefined,
    },
  };
}

const SAFE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]{1,31}$/;

/** Never returns a raw error message — only a short whitelisted code, or "UNKNOWN". */
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
