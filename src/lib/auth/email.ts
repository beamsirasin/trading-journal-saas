import 'server-only';

/**
 * The one seam every outbound auth email goes through.
 *
 * No transactional email provider is configured this phase (no Resend key,
 * no SMTP credentials — see docs/email-delivery-setup.md). Rather than skip
 * the interface until one exists, this is the boundary a real provider drops
 * behind later without touching `src/lib/auth/server.ts`, which only ever
 * calls `sendVerificationEmail`/`sendPasswordResetEmail` on whatever
 * `getEmailAdapter()` returns.
 *
 * Selection is by `NODE_ENV`, never by anything a client could influence:
 * `test` gets an in-memory adapter assertions can inspect, `production` gets
 * an adapter that fails loudly rather than pretending to send, and anything
 * else (development) gets a console-only adapter. None of these ever expose
 * a verification or reset token in an HTTP response — only in a server-side
 * log line that a developer reads directly off their own machine.
 */
export interface EmailDeliveryAdapter {
  sendVerificationEmail(params: { to: string; url: string }): Promise<void>;
  sendPasswordResetEmail(params: { to: string; url: string }): Promise<void>;
}

/**
 * Development only. Logs the link server-side so a developer can click it —
 * never returned in an API response, never written where a browser could see
 * it. This is a convenience for local development, not a delivery mechanism.
 */
export class ConsoleEmailAdapter implements EmailDeliveryAdapter {
  async sendVerificationEmail({ to, url }: { to: string; url: string }): Promise<void> {
    console.log(`[email:dev] Verification link for ${to}: ${url}`);
  }

  async sendPasswordResetEmail({ to, url }: { to: string; url: string }): Promise<void> {
    console.log(`[email:dev] Password reset link for ${to}: ${url}`);
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

let adapter: EmailDeliveryAdapter | undefined;

/** Lazy singleton, mirroring `getDb()`/`getServerEnv()` — chosen once, on first real use. */
export function getEmailAdapter(): EmailDeliveryAdapter {
  if (adapter !== undefined) {
    return adapter;
  }

  if (process.env.NODE_ENV === 'production') {
    adapter = new ProductionEmailAdapter();
  } else if (process.env.NODE_ENV === 'test') {
    adapter = new TestEmailAdapter();
  } else {
    adapter = new ConsoleEmailAdapter();
  }

  return adapter;
}

/** Test seam: forces a fresh adapter selection, for a test that changes `NODE_ENV` or wants a clean `TestEmailAdapter`. */
export function resetEmailAdapterCache(): void {
  adapter = undefined;
}
