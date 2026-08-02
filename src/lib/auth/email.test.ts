import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EmailDeliveryAdapter } from './email';

vi.mock('server-only', () => ({}));

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn().mockResolvedValue(undefined);
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: createTransportMock },
}));

const {
  ConsoleEmailAdapter,
  ProductionEmailAdapter,
  TestEmailAdapter,
  SmtpEmailAdapter,
  getEmailAdapter,
  resetEmailAdapterCache,
} = await import('./email');
const { resetServerEnvCache } = await import('@/config/env.server');

const SMTP_ENV_KEYS = [
  'EMAIL_PROVIDER',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'EMAIL_FROM_ADDRESS',
  'EMAIL_FROM_NAME',
] as const;

// Next.js's own type augmentation declares `NODE_ENV` read-only on
// `NodeJS.ProcessEnv` — go through a narrower, writable view rather than
// fighting that augmentation with a broad `any` (mirrors
// src/config/migration-env.test.ts's `setNodeEnv`).
const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string): void {
  (process.env as { NODE_ENV?: string }).NODE_ENV = value;
}

function resetEnv(): void {
  setNodeEnv(originalNodeEnv);
  for (const key of SMTP_ENV_KEYS) delete process.env[key];
  resetServerEnvCache();
  resetEmailAdapterCache();
}

describe('ConsoleEmailAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never writes recipient addresses or bearer links to development logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const adapter = new ConsoleEmailAdapter();
    const email = 'private@example.test';
    const url = 'http://localhost/verify?token=verification-secret';

    await adapter.sendVerificationEmail({ to: email, url });
    await adapter.sendPasswordResetEmail({ to: email, url });

    const output = warn.mock.calls.flat().join(' ');
    expect(output).not.toContain(email);
    expect(output).not.toContain(url);
    expect(output).not.toContain('verification-secret');
  });
});

describe('ProductionEmailAdapter', () => {
  it('fails closed for both verification and password-reset sends', async () => {
    const adapter: EmailDeliveryAdapter = new ProductionEmailAdapter();
    await expect(
      adapter.sendVerificationEmail({ to: 'a@example.test', url: 'https://x/y' }),
    ).rejects.toThrow(/No email delivery provider/);
    await expect(
      adapter.sendPasswordResetEmail({ to: 'a@example.test', url: 'https://x/y' }),
    ).rejects.toThrow(/No email delivery provider/);
  });
});

describe('getEmailAdapter selection', () => {
  afterEach(() => {
    resetEnv();
    sendMailMock.mockClear();
    createTransportMock.mockClear();
  });

  it('uses the deterministic in-memory adapter in test, and never opens a real network connection', () => {
    setNodeEnv('test');
    resetServerEnvCache();
    resetEmailAdapterCache();
    expect(getEmailAdapter()).toBeInstanceOf(TestEmailAdapter);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('stays fail-closed in production even when EMAIL_PROVIDER/SMTP env vars are fully configured', async () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@trading-os.local';
    setNodeEnv('production');
    resetServerEnvCache();
    resetEmailAdapterCache();

    const adapter = getEmailAdapter();
    expect(adapter).toBeInstanceOf(ProductionEmailAdapter);
    await expect(
      adapter.sendVerificationEmail({ to: 'a@example.test', url: 'https://x/y' }),
    ).rejects.toThrow(/No email delivery provider/);
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('falls back to the non-delivering diagnostic adapter in development when SMTP is unconfigured', () => {
    setNodeEnv('development');
    resetServerEnvCache();
    resetEmailAdapterCache();
    expect(getEmailAdapter()).toBeInstanceOf(ConsoleEmailAdapter);
  });

  it('falls back to the diagnostic adapter when only one of SMTP_USERNAME/SMTP_PASSWORD is set', () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@trading-os.local';
    process.env.SMTP_USERNAME = 'only-username';
    setNodeEnv('development');
    resetServerEnvCache();
    resetEmailAdapterCache();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getEmailAdapter()).toBeInstanceOf(ConsoleEmailAdapter);
    warn.mockRestore();
  });

  it('falls back to the diagnostic adapter when EMAIL_PROVIDER is unset, even though host/port/from are fully configured', () => {
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@trading-os.local';
    setNodeEnv('development');
    resetServerEnvCache();
    resetEmailAdapterCache();

    expect(getEmailAdapter()).toBeInstanceOf(ConsoleEmailAdapter);
  });

  it('falls back to the diagnostic adapter when EMAIL_PROVIDER is set to something other than smtp', () => {
    process.env.EMAIL_PROVIDER = 'not-a-real-provider';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@trading-os.local';
    setNodeEnv('development');
    resetServerEnvCache();
    resetEmailAdapterCache();

    expect(getEmailAdapter()).toBeInstanceOf(ConsoleEmailAdapter);
  });

  it('selects the SMTP adapter in development only once EMAIL_PROVIDER=smtp and host/port/from-address are all configured', () => {
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@trading-os.local';
    setNodeEnv('development');
    resetServerEnvCache();
    resetEmailAdapterCache();

    expect(getEmailAdapter()).toBeInstanceOf(SmtpEmailAdapter);
  });

  it('reports the selected adapter type, and the specific fallback reason, to the dev-only dispatch log', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@trading-os.local';
    setNodeEnv('development');
    resetServerEnvCache();
    resetEmailAdapterCache();
    getEmailAdapter();

    const line = info.mock.calls[0]?.[0];
    expect(line).toContain('email.adapter.selected');
    expect(line).toContain('ConsoleEmailAdapter');
    expect(line).toContain('not-opted-in');

    info.mockRestore();
  });
});

describe('SmtpEmailAdapter', () => {
  afterEach(() => {
    sendMailMock.mockClear();
    createTransportMock.mockClear();
  });

  const baseConfig = {
    host: '127.0.0.1',
    port: 1025,
    secure: false,
    username: undefined,
    password: undefined,
    fromAddress: 'no-reply@trading-os.local',
    fromName: 'Trading OS',
  };

  it('never makes a real network call — nodemailer is fully mocked', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    await adapter.sendVerificationEmail({
      to: 'user@example.test',
      url: 'https://app.test/verify?token=abc',
    });
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it('passes the Better Auth verification URL into the SMTP message', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    const url = 'https://app.test/verify?token=verification-secret-abc';
    await adapter.sendVerificationEmail({ to: 'user@example.test', url });

    const call = sendMailMock.mock.calls[0]?.[0];
    expect(call.to).toBe('user@example.test');
    expect(call.text).toContain(url);
    expect(call.html).toContain('verification-secret-abc');
  });

  it('passes the Better Auth password-reset URL into the SMTP message', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    const url = 'https://app.test/reset-password?token=reset-secret-xyz';
    await adapter.sendPasswordResetEmail({ to: 'user@example.test', url });

    const call = sendMailMock.mock.calls[0]?.[0];
    expect(call.to).toBe('user@example.test');
    expect(call.text).toContain(url);
    expect(call.html).toContain('reset-secret-xyz');
  });

  it('renders Thai copy when the request locale is th, and defaults to English otherwise', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    await adapter.sendVerificationEmail({
      to: 'user@example.test',
      url: 'https://app.test/verify?token=abc',
      locale: 'th',
    });
    const thaiCall = sendMailMock.mock.calls[0]?.[0];
    expect(thaiCall.subject).toContain('ยืนยัน');

    await adapter.sendVerificationEmail({
      to: 'user@example.test',
      url: 'https://app.test/verify?token=abc',
    });
    const defaultCall = sendMailMock.mock.calls[1]?.[0];
    expect(defaultCall.subject).toBe('Verify your email — Trading OS');
  });

  it('configures SMTP auth only when both username and password are present (Mailpit needs neither)', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    await adapter.sendVerificationEmail({
      to: 'user@example.test',
      url: 'https://app.test/verify?token=abc',
    });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', port: 1025, secure: false, auth: undefined }),
    );

    createTransportMock.mockClear();
    const authedAdapter = new SmtpEmailAdapter({
      ...baseConfig,
      username: 'mailbox',
      password: 'hunter2',
    });
    await authedAdapter.sendVerificationEmail({
      to: 'user@example.test',
      url: 'https://app.test/verify?token=abc',
    });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { user: 'mailbox', pass: 'hunter2' } }),
    );
  });

  it('never logs the raw verification/reset URL, token, or recipient — including the dev-only dispatch stages', async () => {
    setNodeEnv('development');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const adapter = new SmtpEmailAdapter(baseConfig);
    const email = 'private-recipient@example.test';
    const url = 'https://app.test/verify?token=must-not-be-logged-anywhere';
    await adapter.sendVerificationEmail({ to: email, url });

    const allOutput = [
      ...logSpy.mock.calls,
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
      ...infoSpy.mock.calls,
    ]
      .flat()
      .join(' ');
    expect(allOutput).not.toContain('must-not-be-logged-anywhere');
    expect(allOutput).not.toContain(url);
    expect(allOutput).not.toContain(email);
    // Proves the dispatch-log instrumentation actually fired during this
    // call rather than the assertions above passing vacuously on empty spies.
    expect(infoSpy).toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    infoSpy.mockRestore();
    setNodeEnv(originalNodeEnv);
  });

  it('rejects a malformed sender address at construction', () => {
    expect(() => new SmtpEmailAdapter({ ...baseConfig, fromAddress: 'not-an-email' })).toThrow(
      /sender address/,
    );
  });

  it('rejects a sender address carrying a header-injection payload', () => {
    expect(
      () =>
        new SmtpEmailAdapter({
          ...baseConfig,
          fromAddress: 'no-reply@trading-os.local\r\nBcc: attacker@evil.test',
        }),
    ).toThrow(/sender address/);
  });

  it('rejects a sender display name carrying control characters', () => {
    expect(
      () =>
        new SmtpEmailAdapter({ ...baseConfig, fromName: 'Trading OS\r\nBcc: attacker@evil.test' }),
    ).toThrow(/sender name/);
  });

  it('rejects a recipient address carrying a header-injection payload, without sending', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    await expect(
      adapter.sendVerificationEmail({
        to: 'user@example.test\r\nBcc: attacker@evil.test',
        url: 'https://app.test/verify?token=abc',
      }),
    ).rejects.toThrow(/recipient address/);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('rejects a recipient address with multiple comma-separated targets', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    await expect(
      adapter.sendVerificationEmail({
        to: 'user@example.test, attacker@evil.test',
        url: 'https://app.test/verify?token=abc',
      }),
    ).rejects.toThrow(/recipient address/);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  /**
   * Regression test for the exact failure class this investigation was
   * chasing: the sender (`EMAIL_FROM_ADDRESS`, here `no-reply@trading-os.local`)
   * must never appear as the recipient, regardless of which user address is
   * passed in, and the recipient must never leak into the `from` field either.
   */
  it('always sends "to" the passed recipient and "from" the configured sender — the two never substitute for each other', async () => {
    const adapter = new SmtpEmailAdapter(baseConfig);
    const registeredUserEmail = 'real-registered-user@example.test';

    await adapter.sendVerificationEmail({
      to: registeredUserEmail,
      url: 'https://app.test/verify?token=abc',
    });

    const call = sendMailMock.mock.calls[0]?.[0];
    expect(call.to).toBe(registeredUserEmail);
    expect(call.to).not.toBe(baseConfig.fromAddress);
    expect(call.from).toEqual({ name: baseConfig.fromName, address: baseConfig.fromAddress });
  });

  it('propagates an SMTP send failure rather than swallowing it — resend must see a real rejection, not a false success', async () => {
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' }),
    );
    const adapter = new SmtpEmailAdapter(baseConfig);

    await expect(
      adapter.sendVerificationEmail({
        to: 'user@example.test',
        url: 'https://app.test/verify?token=abc',
      }),
    ).rejects.toThrow('connect refused');
  });

  it('logs a sanitized failure stage in development when SMTP send fails, never the raw error', async () => {
    setNodeEnv('development');
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('ECONNREFUSED 127.0.0.1:1025'), { code: 'ECONNREFUSED' }),
    );

    const adapter = new SmtpEmailAdapter(baseConfig);
    await expect(
      adapter.sendVerificationEmail({
        to: 'user@example.test',
        url: 'https://app.test/verify?token=abc',
      }),
    ).rejects.toThrow();

    const lines = info.mock.calls.map((call) => call[0]).join(' ');
    expect(lines).toContain('smtp.send.failed');
    expect(lines).toContain('ECONNREFUSED');
    expect(lines).not.toContain('127.0.0.1');
    expect(lines).not.toContain('user@example.test');

    info.mockRestore();
    setNodeEnv(originalNodeEnv);
  });
});
