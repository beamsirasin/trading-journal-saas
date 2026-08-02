import { describe, expect, it } from 'vitest';

import {
  resolveAuthBaseUrl,
  resolveTrustedOrigins,
  shouldUseSecureCookies,
} from './runtime-config';

describe('auth runtime configuration', () => {
  it('requires an explicit HTTPS base URL in production', () => {
    expect(() => resolveAuthBaseUrl(undefined, 'production')).toThrow(/BETTER_AUTH_URL/);
    expect(() => resolveAuthBaseUrl('http://app.example.com', 'production')).toThrow(/HTTPS/);
    expect(resolveAuthBaseUrl('https://app.example.com', 'production')).toBe(
      'https://app.example.com',
    );
  });

  it('allows loopback HTTP for local production-mode e2e servers', () => {
    expect(resolveAuthBaseUrl('http://127.0.0.1:3100', 'production')).toBe('http://127.0.0.1:3100');
    expect(shouldUseSecureCookies('http://127.0.0.1:3100')).toBe(false);
  });

  it('rejects wildcard, credential-bearing, and path-bearing trusted origins', () => {
    expect(() => resolveTrustedOrigins('https://*.example.com', 'production')).toThrow(/wildcard/);
    expect(() => resolveTrustedOrigins('https://user:pass@example.com', 'production')).toThrow(
      /origin/,
    );
    expect(() => resolveTrustedOrigins('https://example.com/path', 'production')).toThrow(/origin/);
  });

  it('normalizes exact HTTPS trusted origins and rejects production HTTP', () => {
    expect(
      resolveTrustedOrigins(' https://app.example.com,https://preview.example.com ', 'production'),
    ).toEqual(['https://app.example.com', 'https://preview.example.com']);
    expect(() => resolveTrustedOrigins('http://preview.example.com', 'production')).toThrow(
      /HTTPS/,
    );
  });
});
