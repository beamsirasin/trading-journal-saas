import { describe, expect, it } from 'vitest';

import { localizedAlternates, localizedOpenGraph, localizedPathname } from './metadata';

describe('localized metadata', () => {
  it('builds locale-prefixed root and child URLs without a detection redirect', () => {
    expect(localizedPathname('en', '/')).toBe('/en');
    expect(localizedPathname('th', '/pricing')).toBe('/th/pricing');
  });

  it('keeps canonical and hreflang entries on the same route', () => {
    expect(localizedAlternates('th', '/app/trades')).toEqual({
      canonical: '/th/app/trades',
      languages: {
        en: '/en/app/trades',
        th: '/th/app/trades',
      },
    });
  });

  it('uses Open Graph language_TERRITORY locale values', () => {
    expect(localizedOpenGraph('th', '/pricing')).toEqual({
      url: '/th/pricing',
      locale: 'th_TH',
      alternateLocale: ['en_US'],
    });
  });
});
