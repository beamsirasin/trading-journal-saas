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
      expect(result.data.AUTH_SECRET).toBeUndefined();
    }
  });

  it('accepts a full configuration', () => {
    const result = serverEnvSchema.safeParse({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
      DATABASE_URL_UNPOOLED: 'postgresql://user:pass@host:5432/db',
      AUTH_SECRET: 'a-secret',
      AUTH_URL: 'https://example.com',
      AUTH_GOOGLE_ID: 'id',
      AUTH_GOOGLE_SECRET: 'secret',
    });
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
