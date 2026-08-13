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

  it('rejects backslash variants that URL parsing resolves off-origin', () => {
    expect(safeCallbackPath('/\\evil.example/en/app')).toBeNull();
    expect(safeCallbackPath('/\\\\evil.example/en/app')).toBeNull();
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

  // Phase 12B regression coverage: WHATWG URL parsing strips ASCII tab and
  // newline from the whole input before parsing begins, so a single leading
  // slash followed by a tab/newline and a second slash can canonicalize into
  // `//evil.example` — a protocol-relative URL — even though the raw
  // `candidate.startsWith('//')` check above never sees two adjacent
  // slashes. The sentinel-origin comparison (not the startsWith check alone)
  // is what actually catches this.
  it('rejects tab-injected protocol-relative smuggling', () => {
    expect(safeCallbackPath('/\t/evil.example')).toBeNull();
    expect(safeCallbackPath('/\t\t/evil.example')).toBeNull();
  });

  it('rejects newline-injected protocol-relative smuggling', () => {
    expect(safeCallbackPath('/\n/evil.example')).toBeNull();
    expect(safeCallbackPath('/\r/evil.example')).toBeNull();
  });

  // Percent-encoding is NOT decoded before the backslash/slash separator
  // check the WHATWG parser performs, so an encoded backslash or slash stays
  // literal path text rather than becoming a separator — these resolve
  // same-origin and are legitimately safe to accept, not a bypass.
  it('accepts percent-encoded backslash/slash as literal same-origin path text', () => {
    expect(safeCallbackPath('/%5Cevil.example')).toBe('/%5Cevil.example');
    expect(safeCallbackPath('/%2Fevil.example')).toBe('/%2Fevil.example');
  });

  it('rejects a candidate combining a leading slash with an embedded absolute URL scheme', () => {
    expect(safeCallbackPath('/\\/evil.example')).toBeNull();
    expect(safeCallbackPath('/\t\\evil.example')).toBeNull();
  });
});
