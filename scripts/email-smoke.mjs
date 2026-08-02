#!/usr/bin/env node
/**
 * Development-only SMTP smoke test — `pnpm email:smoke`.
 *
 * Sends ONE harmless message through the configured SMTP transport (Mailpit
 * in the documented local setup) to a fixed, deliberately non-routable
 * recipient — `.invalid` is reserved by RFC 2606 to never resolve to a real
 * domain — so a developer can confirm true end-to-end delivery without
 * touching a real user's inbox or the application's own email templates.
 *
 * Never runs in production (refuses immediately, before reading any SMTP
 * value), and is never imported by any application module — the only way to
 * invoke it is `node scripts/email-smoke.mjs` / `pnpm email:smoke`, so it
 * cannot run during `next build`, `next dev`, or any request.
 *
 * Reports success or a SANITIZED failure only: never the host, never
 * credentials, never the fixed recipient or sender address, never the full
 * error object or its message.
 */
// `@next/env` is CommonJS; plain Node's ESM loader does not synthesize a
// named export for it, so this goes through the default export explicitly.
import nextEnv from '@next/env';
import nodemailer from 'nodemailer';

import {
  refuseInProduction,
  resolveSmtpConfig,
  sanitizeErrorCode,
} from './email-smtp-probe-helpers.mjs';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());
refuseInProduction('email:smoke');

const result = resolveSmtpConfig(process.env);
if (!result.ok) {
  console.error(
    `[email:smoke] SMTP is not configured (${result.reason}). See docs/email-delivery-setup.md.`,
  );
  process.exit(1);
}

/** RFC 2606 reserved TLD — guaranteed to never be a real, deliverable domain. */
const FIXED_SMOKE_RECIPIENT = 'email-smoke-test@trading-os.invalid';

const transport = nodemailer.createTransport({
  host: result.config.host,
  port: result.config.port,
  secure: result.config.secure,
  auth: result.config.auth,
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
  console.log(
    '[email:smoke] SUCCESS — smoke message sent. Check the Mailpit inbox at http://127.0.0.1:8025.',
  );
  process.exitCode = 0;
} catch (error) {
  console.error(
    `[email:smoke] FAILED (${sanitizeErrorCode(error)}). See docs/email-delivery-setup.md.`,
  );
  process.exitCode = 1;
} finally {
  transport.close();
}
