import { describe, expect, it } from 'vitest';

import { resolveSiteUrl } from './site-url';

describe('resolveSiteUrl', () => {
  it('uses the documented portable application URL on a VPS', () => {
    expect(
      resolveSiteUrl({
        NEXT_PUBLIC_APP_URL: 'https://journal.example.com',
        VERCEL_URL: 'preview.example.vercel.app',
      }).href,
    ).toBe('https://journal.example.com/');
  });

  it('uses the current Vercel deployment only as an unconfigured fallback', () => {
    expect(resolveSiteUrl({ VERCEL_URL: 'phase-01.example.vercel.app' }).href).toBe(
      'https://phase-01.example.vercel.app/',
    );
  });

  it('accepts an already-qualified Vercel fallback', () => {
    expect(resolveSiteUrl({ VERCEL_URL: 'https://preview.example.com' }).href).toBe(
      'https://preview.example.com/',
    );
  });

  it('keeps local builds configuration-free', () => {
    expect(resolveSiteUrl({}).href).toBe('http://localhost:3000/');
  });
});
