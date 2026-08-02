import { describe, expect, it } from 'vitest';

import { safeCallbackPath } from './callback-url';

describe('safeCallbackPath', () => {
  it('accepts a relative path', () => {
    expect(safeCallbackPath('/en/app/trades')).toBe('/en/app/trades');
  });

  it('accepts a relative path with a query string', () => {
    expect(safeCallbackPath('/en/app?range=90d')).toBe('/en/app?range=90d');
  });

  it('rejects an absolute URL', () => {
    expect(safeCallbackPath('https://evil.example/en/app')).toBeNull();
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeCallbackPath('//evil.example/en/app')).toBeNull();
  });

  it('accepts a relative path whose query value happens to contain a scheme', () => {
    // The path itself resolves same-origin regardless of what its query
    // string contains — only what the path itself STARTS with matters.
    expect(safeCallbackPath('/redirect?to=https://evil.example')).toBe(
      '/redirect?to=https://evil.example',
    );
  });

  it('rejects a path claiming to be an absolute URL', () => {
    expect(safeCallbackPath('https://evil.example')).toBeNull();
  });

  it('rejects a bare path missing the leading slash', () => {
    expect(safeCallbackPath('en/app')).toBeNull();
  });

  it('rejects null, undefined and empty string', () => {
    expect(safeCallbackPath(null)).toBeNull();
    expect(safeCallbackPath(undefined)).toBeNull();
    expect(safeCallbackPath('')).toBeNull();
  });
});
