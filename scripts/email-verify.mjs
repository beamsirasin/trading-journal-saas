#!/usr/bin/env node
/**
 * Development-only SMTP connectivity probe — `pnpm email:verify`.
 *
 * Loads the same validated SMTP configuration the running app would use and
 * calls Nodemailer's `transporter.verify()` against it — a pure
 * connectivity/auth check against the SMTP server (Mailpit in the
 * documented local setup). No message is sent; use `pnpm email:smoke` for
 * that.
 *
 * Never runs in production (refuses immediately, before reading any SMTP
 * value), and is never imported by any application module — the only way to
 * invoke it is `node scripts/email-verify.mjs` / `pnpm email:verify`, so it
 * cannot run during `next build`, `next dev`, or any request.
 *
 * Reports success or a SANITIZED failure only: never the host, never
 * credentials, never recipient data (there is no recipient here), never the
 * full error object or its message.
 */
// `@next/env` is CommonJS; plain Node's ESM loader (unlike drizzle-kit's own
// bundler, which is how drizzle.config.ts gets away with a named import)
// does not synthesize a named export for it, so this goes through the
// default export explicitly.
import nextEnv from '@next/env';
import nodemailer from 'nodemailer';

import {
  refuseInProduction,
  resolveSmtpConfig,
  sanitizeErrorCode,
} from './email-smtp-probe-helpers.mjs';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());
refuseInProduction('email:verify');

const result = resolveSmtpConfig(process.env);
if (!result.ok) {
  console.error(
    `[email:verify] SMTP is not configured (${result.reason}). See docs/email-delivery-setup.md.`,
  );
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: result.config.host,
  port: result.config.port,
  secure: result.config.secure,
  auth: result.config.auth,
});

try {
  await transport.verify();
  console.log('[email:verify] SUCCESS — SMTP configuration verified.');
  process.exitCode = 0;
} catch (error) {
  console.error(
    `[email:verify] FAILED (${sanitizeErrorCode(error)}). See docs/email-delivery-setup.md.`,
  );
  process.exitCode = 1;
} finally {
  transport.close();
}
