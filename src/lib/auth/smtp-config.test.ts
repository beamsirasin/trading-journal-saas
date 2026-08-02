import { describe, expect, it } from 'vitest';

import { resolveSmtpConfigFromEnv, type SmtpConfigEnv } from './smtp-config';

const FULL: SmtpConfigEnv = {
  EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: 1025,
  SMTP_SECURE: 'false',
  SMTP_USERNAME: undefined,
  SMTP_PASSWORD: undefined,
  EMAIL_FROM_ADDRESS: 'no-reply@trading-os.local',
  EMAIL_FROM_NAME: 'Trading OS',
};

describe('resolveSmtpConfigFromEnv', () => {
  it('resolves a complete, opted-in Mailpit-style config (no auth)', () => {
    const result = resolveSmtpConfigFromEnv(FULL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual({
        host: '127.0.0.1',
        port: 1025,
        secure: false,
        username: undefined,
        password: undefined,
        fromAddress: 'no-reply@trading-os.local',
        fromName: 'Trading OS',
      });
    }
  });

  it('rejects when EMAIL_PROVIDER is not exactly "smtp"', () => {
    expect(resolveSmtpConfigFromEnv({ ...FULL, EMAIL_PROVIDER: undefined })).toEqual({
      ok: false,
      reason: 'not-opted-in',
    });
    expect(resolveSmtpConfigFromEnv({ ...FULL, EMAIL_PROVIDER: 'sendgrid' })).toEqual({
      ok: false,
      reason: 'not-opted-in',
    });
  });

  it('rejects an incomplete configuration even when opted in', () => {
    expect(resolveSmtpConfigFromEnv({ ...FULL, SMTP_HOST: undefined })).toEqual({
      ok: false,
      reason: 'incomplete',
    });
    expect(resolveSmtpConfigFromEnv({ ...FULL, SMTP_PORT: undefined })).toEqual({
      ok: false,
      reason: 'incomplete',
    });
    expect(resolveSmtpConfigFromEnv({ ...FULL, EMAIL_FROM_ADDRESS: undefined })).toEqual({
      ok: false,
      reason: 'incomplete',
    });
  });

  it('rejects a mismatched username/password pair rather than guessing', () => {
    expect(resolveSmtpConfigFromEnv({ ...FULL, SMTP_USERNAME: 'only-username' })).toEqual({
      ok: false,
      reason: 'auth-mismatch',
    });
    expect(resolveSmtpConfigFromEnv({ ...FULL, SMTP_PASSWORD: 'only-password' })).toEqual({
      ok: false,
      reason: 'auth-mismatch',
    });
  });

  it('accepts a matched username/password pair', () => {
    const result = resolveSmtpConfigFromEnv({
      ...FULL,
      SMTP_USERNAME: 'mailbox',
      SMTP_PASSWORD: 'hunter2',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.username).toBe('mailbox');
      expect(result.config.password).toBe('hunter2');
    }
  });
});
