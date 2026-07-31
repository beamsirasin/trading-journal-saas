import { describe, expect, it } from 'vitest';

import { clientEnvSchema, formatEnvError, serverEnvSchema } from './env';

describe('clientEnvSchema', () => {
  it('accepts an absent app url (optional during Phase 00)', () => {
    const result = clientEnvSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('treats an empty string as absent rather than as an invalid url', () => {
    const result = clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_APP_URL).toBeUndefined();
    }
  });

  it('rejects a malformed url', () => {
    const result = clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid url', () => {
    const result = clientEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
    expect(result.success).toBe(true);
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
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'staging' });
    expect(result.success).toBe(false);
  });

  it('leaves not-yet-required variables optional', () => {
    const result = serverEnvSchema.safeParse({ NODE_ENV: 'production' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DATABASE_URL).toBeUndefined();
    }
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
});
