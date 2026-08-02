import { describe, expect, it } from 'vitest';

import { clientEnvSchema, formatEnvError, requireEnv, serverEnvSchema } from './env.schema';

describe('clientEnvSchema', () => {
  it('accepts an absent app url while it is still optional', () => {
    expect(clientEnvSchema.safeParse({}).success).toBe(true);
  });

  it('treats an empty string as absent rather than as an invalid url', () => {
    // `.env` files routinely contain `KEY=` for "not set". Failing on that
    // would make an unconfigured optional integration break the boot.
    const result = clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_APP_URL).toBeUndefined();
    }
  });

  it('rejects a malformed url', () => {
    expect(clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: 'not-a-url' }).success).toBe(false);
  });

  it('accepts a valid url', () => {
    expect(
      clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }).success,
    ).toBe(true);
  });

  it('never validates SMTP or email-provider variables — they must stay server-only', () => {
    const result = clientEnvSchema.safeParse({
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PASSWORD: 'hunter2',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Zod strips unknown keys by default — proves these names simply are
      // not part of the client-exposed shape, not merely unused here.
      expect(result.data).toEqual({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
      expect(result.data).not.toHaveProperty('SMTP_PASSWORD');
    }
  });
});

describe('serverEnvSchema', () => {
  it('defaults NODE_ENV to development', () => {
    const result = serverEnvSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
    }
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(serverEnvSchema.safeParse({ NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('leaves not-yet-required integrations optional, so builds still pass', () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'production' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DATABASE_URL).toBeUndefined();
      expect(result.data.BETTER_AUTH_SECRET).toBeUndefined();
    }
  });

  it('accepts a full configuration', () => {
    const result = serverEnvSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      DATABASE_MIGRATION_URL: 'postgresql://user:pass@host:5432/db',
      BETTER_AUTH_SECRET: 'a-secret',
      BETTER_AUTH_URL: 'https://example.com',
      BETTER_AUTH_TRUSTED_ORIGINS: 'https://preview.example.com,https://staging.example.com',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    expect(result.success).toBe(true);
  });

  it('validates every SMTP/email-provider variable and coerces SMTP_PORT to a number', () => {
    const result = serverEnvSchema.safeParse({
      NODE_ENV: 'development',
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1025',
      SMTP_SECURE: 'false',
      SMTP_USERNAME: 'mailbox',
      SMTP_PASSWORD: 'hunter2',
      EMAIL_FROM_ADDRESS: 'no-reply@trading-os.local',
      EMAIL_FROM_NAME: 'Trading OS',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.EMAIL_PROVIDER).toBe('smtp');
      expect(result.data.SMTP_HOST).toBe('127.0.0.1');
      expect(result.data.SMTP_PORT).toBe(1025);
      expect(typeof result.data.SMTP_PORT).toBe('number');
      expect(result.data.SMTP_SECURE).toBe('false');
      expect(result.data.SMTP_USERNAME).toBe('mailbox');
      expect(result.data.SMTP_PASSWORD).toBe('hunter2');
      expect(result.data.EMAIL_FROM_ADDRESS).toBe('no-reply@trading-os.local');
      expect(result.data.EMAIL_FROM_NAME).toBe('Trading OS');
    }
  });

  it('leaves an unrecognized EMAIL_PROVIDER value parseable rather than crashing env validation', () => {
    // src/lib/auth/email.ts's own comment explains why: a typo'd dev-only
    // convenience variable must fall back to the diagnostic adapter, not
    // take down getServerEnv() for every request in the app.
    const result = serverEnvSchema.safeParse({ EMAIL_PROVIDER: 'not-a-real-provider' });
    expect(result.success).toBe(true);
  });

  it('ignores unrelated variables rather than failing on them', () => {
    // process.env carries hundreds of OS variables; an exhaustive schema
    // would reject every environment it runs in.
    const result = serverEnvSchema.safeParse({ PATH: '/usr/bin', HOME: '/root' });
    expect(result.success).toBe(true);
  });
});

describe('formatEnvError', () => {
  it('names each offending variable so the failure is actionable', () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = formatEnvError(result.error);
      expect(message).toContain('NODE_ENV');
      expect(message).toContain('.env.example');
    }
  });

  it('never echoes the offending value, because it may be a secret', () => {
    const secret = 'super-secret-value-that-must-not-leak';
    const result = serverEnvSchema.safeParse({ NODE_ENV: secret });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatEnvError(result.error)).not.toContain(secret);
    }
  });
});

describe('requireEnv', () => {
  it('returns a configured value', () => {
    expect(requireEnv('DATABASE_URL', 'postgresql://localhost/db')).toBe(
      'postgresql://localhost/db',
    );
  });

  it('throws a helpful error when unset', () => {
    expect(() => requireEnv('DATABASE_URL', undefined)).toThrow(/DATABASE_URL/);
    expect(() => requireEnv('DATABASE_URL', undefined)).toThrow(/\.env\.example/);
  });

  it('treats an empty string as unset', () => {
    expect(() => requireEnv('DATABASE_URL', '')).toThrow(/DATABASE_URL/);
  });
});
