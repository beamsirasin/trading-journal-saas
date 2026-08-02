import 'server-only';

import nodemailer from 'nodemailer';

import { getServerEnv } from '@/config/env.server';

import { logDispatchStage, sanitizeErrorCode } from './dispatch-log';
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  type RenderedEmail,
  type SupportedEmailLocale,
} from './email-templates';
import { resolveSmtpConfigFromEnv, type SmtpAdapterConfig } from './smtp-config';

/**
 * The one seam every outbound auth email goes through.
 *
 * A real transactional provider is still not configured for production this
 * phase (no Resend key — see docs/email-delivery-setup.md). Development now
 * has a local SMTP option (Mailpit) so the verification/reset flow can
 * actually be exercised; this is the boundary that swaps in a real provider
 * later without touching `src/lib/auth/server.ts`, which only ever calls
 * `sendVerificationEmail`/`sendPasswordResetEmail` on whatever
 * `getEmailAdapter()` returns.
 *
 * Selection is by `NODE_ENV`, never by anything a client could influence:
 * `test` gets an in-memory adapter assertions can inspect, `production`
 * always gets an adapter that fails loudly rather than pretending to send
 * (SMTP env vars, even if present, are never consulted in production), and
 * `development` gets a local SMTP adapter only when `EMAIL_PROVIDER=smtp` is
 * explicitly set AND the rest of the SMTP config is complete, or otherwise
 * the same non-delivering diagnostic as before. None exposes recipient data
 * or verification/reset credentials in logs or HTTP responses.
 */
export interface EmailDeliveryAdapter {
  sendVerificationEmail(params: {
    to: string;
    url: string;
    locale?: SupportedEmailLocale;
  }): Promise<void>;
  sendPasswordResetEmail(params: {
    to: string;
    url: string;
    locale?: SupportedEmailLocale;
  }): Promise<void>;
}

/**
 * Development only. Reports that delivery is unavailable without logging the
 * recipient or bearer URL. This is a diagnostic, not a delivery mechanism.
 */
export class ConsoleEmailAdapter implements EmailDeliveryAdapter {
  async sendVerificationEmail(_params: { to: string; url: string }): Promise<void> {
    console.warn('[email:dev] Verification email not delivered: configure a local email provider.');
  }

  async sendPasswordResetEmail(_params: { to: string; url: string }): Promise<void> {
    console.warn(
      '[email:dev] Password-reset email not delivered: configure a local email provider.',
    );
  }
}

interface CapturedEmail {
  kind: 'verification' | 'password-reset';
  to: string;
  url: string;
}

/**
 * Test only. Captures every call in memory so a test can assert a link was
 * "sent" and extract the token from it, without a real provider or a
 * network call. `reset()` clears state between tests.
 */
export class TestEmailAdapter implements EmailDeliveryAdapter {
  readonly sent: CapturedEmail[] = [];

  async sendVerificationEmail({ to, url }: { to: string; url: string }): Promise<void> {
    this.sent.push({ kind: 'verification', to, url });
  }

  async sendPasswordResetEmail({ to, url }: { to: string; url: string }): Promise<void> {
    this.sent.push({ kind: 'password-reset', to, url });
  }

  reset(): void {
    this.sent.length = 0;
  }
}

/**
 * Production. No real provider is wired up yet, so this fails closed: it
 * throws rather than silently discarding the email or, worse, returning
 * success to the caller when nothing was actually delivered. A registration
 * or password-reset flow that reaches this surfaces a genuine 500 with a
 * sanitized message — better than a user believing an email is on its way
 * when it never will be.
 *
 * The moment a real provider is configured (a later phase), this class's
 * body is what changes — the call sites in `src/lib/auth/server.ts` do not.
 * `getEmailAdapter()` selects this by `NODE_ENV` alone, so a stray SMTP
 * environment variable set on a production deployment can never route
 * production traffic to the development adapter below.
 */
export class ProductionEmailAdapter implements EmailDeliveryAdapter {
  async sendVerificationEmail(): Promise<void> {
    throw new Error(
      'No email delivery provider is configured. Verification email was not sent. ' +
        'See docs/email-delivery-setup.md.',
    );
  }

  async sendPasswordResetEmail(): Promise<void> {
    throw new Error(
      'No email delivery provider is configured. Password-reset email was not sent. ' +
        'See docs/email-delivery-setup.md.',
    );
  }
}

const CONTROL_CHARACTERS = /[\r\n\0]/;
/** Deliberately conservative: rejects the whitespace/quote/angle-bracket characters an SMTP header-injection or multi-recipient payload needs, not just CR/LF. */
const SIMPLE_EMAIL_PATTERN = /^[^\s@<>()[\]:;,"\\]+@[^\s@<>()[\]:;,"\\]+\.[^\s@<>()[\]:;,"\\]+$/;

/** Defense in depth ahead of Nodemailer: rejects header-injection payloads and malformed addresses outright rather than passing them to the transport. */
function assertSafeEmailAddress(value: string, field: string): string {
  if (
    CONTROL_CHARACTERS.test(value) ||
    value.trim() !== value ||
    !SIMPLE_EMAIL_PATTERN.test(value)
  ) {
    throw new Error(`Refusing to send: ${field} is not a well-formed email address.`);
  }
  return value;
}

/** For the From display name, which is not itself an email address but still becomes a header value. */
function assertSafeHeaderValue(value: string, field: string): string {
  if (CONTROL_CHARACTERS.test(value)) {
    throw new Error(`Refusing to send: ${field} contains invalid control characters.`);
  }
  return value;
}

/**
 * Development only, and only once fully configured (see `resolveSmtpConfigFromEnv`
 * in `./smtp-config`). Built for a local, unauthenticated, non-TLS sink such
 * as Mailpit — never selected in `test` (deterministic `TestEmailAdapter`) or
 * `production` (fail-closed `ProductionEmailAdapter`) regardless of these env
 * vars. The recipient (`to`) always comes from the caller's `to` parameter —
 * which `src/lib/auth/server.ts` always sets to Better Auth's own `user.email`
 * — and `config.fromAddress`/`fromName` are used ONLY in the `from` field
 * below; the two never merge or substitute for each other.
 */
export class SmtpEmailAdapter implements EmailDeliveryAdapter {
  private transport: ReturnType<typeof nodemailer.createTransport> | undefined;

  constructor(private readonly config: SmtpAdapterConfig) {
    assertSafeEmailAddress(config.fromAddress, 'sender address');
    if (config.fromName !== undefined) {
      assertSafeHeaderValue(config.fromName, 'sender name');
    }
  }

  async sendVerificationEmail({
    to,
    url,
    locale,
  }: {
    to: string;
    url: string;
    locale?: SupportedEmailLocale;
  }): Promise<void> {
    await this.deliver(to, buildVerificationEmail(url, locale ?? 'en'));
  }

  async sendPasswordResetEmail({
    to,
    url,
    locale,
  }: {
    to: string;
    url: string;
    locale?: SupportedEmailLocale;
  }): Promise<void> {
    await this.deliver(to, buildPasswordResetEmail(url, locale ?? 'en'));
  }

  private getTransport(): ReturnType<typeof nodemailer.createTransport> {
    if (this.transport === undefined) {
      this.transport = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth:
          this.config.username !== undefined && this.config.password !== undefined
            ? { user: this.config.username, pass: this.config.password }
            : undefined,
      });
      logDispatchStage('smtp.transport.created');
    }
    return this.transport;
  }

  private async deliver(to: string, content: RenderedEmail): Promise<void> {
    const recipient = assertSafeEmailAddress(to, 'recipient address');
    const transport = this.getTransport();
    logDispatchStage('smtp.send.started');
    try {
      await transport.sendMail({
        // `from` is the ONLY place `config.fromAddress`/`fromName` appear —
        // never as `to`, never merged with the recipient.
        from:
          this.config.fromName !== undefined
            ? { name: this.config.fromName, address: this.config.fromAddress }
            : this.config.fromAddress,
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
      logDispatchStage('smtp.send.succeeded');
    } catch (error) {
      logDispatchStage('smtp.send.failed', sanitizeErrorCode(error));
      throw error;
    }
  }
}

function buildDevelopmentAdapter(): { adapter: EmailDeliveryAdapter; detail: string } {
  const result = resolveSmtpConfigFromEnv(getServerEnv());
  if (result.ok) {
    return { adapter: new SmtpEmailAdapter(result.config), detail: 'SmtpEmailAdapter' };
  }
  // Distinguishes, in dev-only logs, "never opted in", "partially
  // configured", and "opted in with a broken username/password pairing" —
  // all three fall back to the same non-delivering diagnostic adapter, but
  // they are different operator mistakes worth telling apart when debugging.
  return { adapter: new ConsoleEmailAdapter(), detail: `ConsoleEmailAdapter(${result.reason})` };
}

let adapter: EmailDeliveryAdapter | undefined;

/** Lazy singleton, mirroring `getDb()`/`getServerEnv()` — chosen once, on first real use. */
export function getEmailAdapter(): EmailDeliveryAdapter {
  if (adapter !== undefined) {
    return adapter;
  }

  if (process.env.NODE_ENV === 'production') {
    adapter = new ProductionEmailAdapter();
    logDispatchStage('email.adapter.selected', 'ProductionEmailAdapter');
  } else if (process.env.NODE_ENV === 'test') {
    adapter = new TestEmailAdapter();
    logDispatchStage('email.adapter.selected', 'TestEmailAdapter');
  } else {
    const selection = buildDevelopmentAdapter();
    adapter = selection.adapter;
    logDispatchStage('email.adapter.selected', selection.detail);
  }

  return adapter;
}

/** Test seam: forces a fresh adapter selection, for a test that changes `NODE_ENV` or wants a clean `TestEmailAdapter`. */
export function resetEmailAdapterCache(): void {
  adapter = undefined;
}
