#!/usr/bin/env node
/**
 * Development-only SMTP connectivity probe — `pnpm email:verify`.
 *
 * Resolves SMTP configuration through the exact same environment schema and
 * `resolveSmtpConfigFromEnv` rule `getEmailAdapter()` uses (see
 * `email-smtp-probe-helpers.mjs` for why those are imported directly rather
 * than restated), then calls Nodemailer's `transporter.verify()` — a pure
 * connectivity/auth check. No message is sent; use `pnpm email:smoke` for
 * that.
 *
 * Never runs in production (refuses immediately, before reading any SMTP
 * value), and is never imported by any application module — the only way to
 * invoke it is `node scripts/email-verify.mjs` / `pnpm email:verify`, so it
 * cannot run during `next build`, `next dev`, or any request.
 *
 * Reports the selected adapter type and success or a SANITIZED failure only:
 * never the host, never credentials, never recipient data (there is no
 * recipient here), never the full error object or its message.
 */
// `@next/env` is CommonJS; plain Node's ESM loader does not synthesize a
// named export for it, so this goes through the default export explicitly.
import nextEnv from '@next/env';
import nodemailer from 'nodemailer';

import {
  refuseInProduction,
  resolveValidatedSmtpConfig,
  sanitizeErrorCode,
} from './email-smtp-probe-helpers.mjs';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());
refuseInProduction('email:verify');

let result;
try {
  ({ result } = resolveValidatedSmtpConfig(process.env));
} catch (error) {
  // parseEnvOrThrow's message names only variable NAMES and reasons, never
  // configured values (src/config/env.schema.ts's own guarantee) — safe to
  // surface directly.
  console.error(`[email:verify] EMAIL_ADAPTER console`);
  console.error(
    `[email:verify] environment validation failed: ${error instanceof Error ? error.message : 'unknown error'}`,
  );
  process.exit(1);
}

if (!result.ok) {
  console.log('EMAIL_ADAPTER console');
  console.error(
    `[email:verify] SMTP is not configured (${result.reason}). See docs/email-delivery-setup.md.`,
  );
  process.exit(1);
}

console.log('EMAIL_ADAPTER smtp');

const transport = nodemailer.createTransport({
  host: result.config.host,
  port: result.config.port,
  secure: result.config.secure,
  auth:
    result.config.username !== undefined && result.config.password !== undefined
      ? { user: result.config.username, pass: result.config.password }
      : undefined,
});

try {
  await transport.verify();
  console.log('EMAIL_VERIFY_OK');
  process.exitCode = 0;
} catch (error) {
  console.error(`EMAIL_VERIFY_FAILED ${sanitizeErrorCode(error)}`);
  process.exitCode = 1;
} finally {
  transport.close();
}
