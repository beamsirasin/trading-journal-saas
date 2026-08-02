import type { ServerEnv } from '@/config/env.schema';

/**
 * Pure SMTP-config resolution, deliberately split out of `src/lib/auth/email.ts`
 * (which imports `server-only`) so a standalone Node script — `scripts/email-verify.mjs`,
 * `scripts/email-smoke.mjs` — can resolve the exact same configuration the running
 * app would use without importing a module that throws outside the Next.js/RSC
 * runtime. Mirrors `src/config/migration-env.ts`'s split for the same reason.
 */
export interface SmtpAdapterConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly username: string | undefined;
  readonly password: string | undefined;
  readonly fromAddress: string;
  readonly fromName: string | undefined;
}

export type SmtpConfigEnv = Pick<
  ServerEnv,
  | 'EMAIL_PROVIDER'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USERNAME'
  | 'SMTP_PASSWORD'
  | 'EMAIL_FROM_ADDRESS'
  | 'EMAIL_FROM_NAME'
>;

export type SmtpConfigResult =
  | { readonly ok: true; readonly config: SmtpAdapterConfig }
  | { readonly ok: false; readonly reason: 'not-opted-in' | 'incomplete' | 'auth-mismatch' };

/**
 * `EMAIL_PROVIDER=smtp` is the explicit opt-in — the adapter never activates
 * on the presence of `SMTP_HOST` etc. alone, so a stale value left over from
 * earlier local testing can never silently start sending mail. Username/password
 * must be set together or not at all; one without the other is treated as
 * unconfigured (Mailpit's unauthenticated default only makes sense with both
 * absent), never as "configured but broken".
 */
export function resolveSmtpConfigFromEnv(env: SmtpConfigEnv): SmtpConfigResult {
  if (env.EMAIL_PROVIDER !== 'smtp') {
    return { ok: false, reason: 'not-opted-in' };
  }
  if (
    env.SMTP_HOST === undefined ||
    env.SMTP_PORT === undefined ||
    env.EMAIL_FROM_ADDRESS === undefined
  ) {
    return { ok: false, reason: 'incomplete' };
  }
  if ((env.SMTP_USERNAME === undefined) !== (env.SMTP_PASSWORD === undefined)) {
    return { ok: false, reason: 'auth-mismatch' };
  }

  return {
    ok: true,
    config: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE === 'true',
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
      fromAddress: env.EMAIL_FROM_ADDRESS,
      fromName: env.EMAIL_FROM_NAME,
    },
  };
}
