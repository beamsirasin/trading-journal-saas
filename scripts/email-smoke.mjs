#!/usr/bin/env node
/**
 * Development-only SMTP smoke test — `pnpm email:smoke`.
 *
 * Resolves SMTP configuration through the exact same environment schema and
 * `resolveSmtpConfigFromEnv` rule `getEmailAdapter()` uses (see
 * `email-smtp-probe-helpers.mjs` for why those are imported directly rather
 * than restated — this is what keeps this command from silently drifting
 * from what Better Auth actually does), then sends ONE harmless message to a
 * fixed, deliberately non-routable recipient — `.invalid` is reserved by RFC
 * 2606 to never resolve to a real domain — so a developer can confirm true
 * end-to-end delivery without touching a real user's inbox, a real
 * verification token, or the application's own email templates.
 *
 * Never runs in production (refuses immediately, before reading any SMTP
 * value), and is never imported by any application module — the only way to
 * invoke it is `node scripts/email-smoke.mjs` / `pnpm email:smoke`, so it
 * cannot run during `next build`, `next dev`, or any request.
 *
 * Output is machine-checkable and never contains the host, credentials, the
 * fixed recipient/sender address, or the full error object/message:
 *
 *   EMAIL_ADAPTER smtp
 *   EMAIL_SMOKE_OK
 *
 * or, when SMTP is not fully configured:
 *
 *   EMAIL_ADAPTER console
 *   EMAIL_SMOKE_REFUSED <reason>
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
refuseInProduction('email:smoke');

let result;
try {
  ({ result } = resolveValidatedSmtpConfig(process.env));
} catch (error) {
  console.log('EMAIL_ADAPTER console');
  console.error(`EMAIL_SMOKE_REFUSED invalid-environment`);
  console.error(`[email:smoke] ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}

if (!result.ok) {
  console.log('EMAIL_ADAPTER console');
  console.log(`EMAIL_SMOKE_REFUSED ${result.reason}`);
  process.exit(1);
}

console.log('EMAIL_ADAPTER smtp');

/** RFC 2606 reserved TLD — guaranteed to never be a real, deliverable domain. No verification token involved. */
const FIXED_SMOKE_RECIPIENT = 'email-smoke-test@trading-os.invalid';

// Mirrors src/lib/auth/email.ts's SmtpEmailAdapter transport/message shape
// exactly (see email-smtp-probe-helpers.mjs for why that class itself isn't
// imported directly) — same host/port/secure/auth options, same `from`
// shape, `to` never mixed with `from`.
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
  await transport.sendMail({
    from:
      result.config.fromName !== undefined
        ? { name: result.config.fromName, address: result.config.fromAddress }
        : result.config.fromAddress,
    to: FIXED_SMOKE_RECIPIENT,
    subject: '[email:smoke] Trading OS SMTP smoke test',
    text: 'This is a harmless development smoke-test message sent by `pnpm email:smoke`. If you can read this in Mailpit, local SMTP delivery works end to end.',
  });
  console.log('EMAIL_SMOKE_OK');
  process.exitCode = 0;
} catch (error) {
  console.error(`EMAIL_SMOKE_FAILED ${sanitizeErrorCode(error)}`);
  process.exitCode = 1;
} finally {
  transport.close();
}
