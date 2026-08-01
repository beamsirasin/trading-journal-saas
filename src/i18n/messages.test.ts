import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import th from '../../messages/th.json';
import { routing } from './routing';

type MessageTree = { [key: string]: string | readonly string[] | MessageTree };

/**
 * Leaf paths only — an object node is a namespace, not a translatable value.
 * Both locales use inline ICU (`{count, plural, one {...} other {...}}`) for
 * pluralisation rather than a keyed plural shape, so a language that grammar
 * requires no plural form for (Thai) still has exactly the same key at the
 * same path, just a plain string instead of an ICU plural — key structure
 * never diverges for that reason, which is what makes strict equality below
 * correct rather than merely convenient.
 */
function leafPaths(tree: MessageTree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return leafPaths(value as MessageTree, path);
    }
    return [path];
  });
}

function leafValue(tree: MessageTree, path: string): unknown {
  return path.split('.').reduce<unknown>((node, segment) => {
    if (node !== null && typeof node === 'object' && segment in node) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, tree);
}

const CATALOGS: Record<string, MessageTree> = { en: en as MessageTree, th: th as MessageTree };

describe('message catalog parity', () => {
  it('declares a catalog for every routed locale', () => {
    for (const locale of routing.locales) {
      expect(CATALOGS[locale]).toBeDefined();
    }
  });

  it('has an identical key set in every locale', () => {
    const [first, ...rest] = routing.locales;
    if (first === undefined) return;
    const reference = leafPaths(CATALOGS[first] as MessageTree).sort();

    for (const locale of rest) {
      const keys = leafPaths(CATALOGS[locale] as MessageTree).sort();
      const missing = reference.filter((key) => !keys.includes(key));
      const extra = keys.filter((key) => !reference.includes(key));

      expect({ locale, missing }).toEqual({ locale, missing: [] });
      expect({ locale, extra }).toEqual({ locale, extra: [] });
    }
  });

  it('has no empty leaf value in any locale', () => {
    for (const locale of routing.locales) {
      const empties = leafPaths(CATALOGS[locale] as MessageTree).filter((path) => {
        const value = leafValue(CATALOGS[locale] as MessageTree, path);
        if (Array.isArray(value)) {
          return value.length === 0 || value.some((item) => item === '');
        }
        return value === '';
      });

      expect({ locale, empties }).toEqual({ locale, empties: [] });
    }
  });

  it('only interpolates variables that both locales declare for a shared key', () => {
    const reference = leafPaths(CATALOGS.en as MessageTree);
    const placeholderPattern = /\{(\w+)/g;
    const placeholders = (value: string) =>
      [...new Set(Array.from(value.matchAll(placeholderPattern), (m) => m[1]))].sort();

    for (const path of reference) {
      const enValue = leafValue(CATALOGS.en as MessageTree, path);
      const thValue = leafValue(CATALOGS.th as MessageTree, path);

      if (typeof enValue === 'string' && typeof thValue === 'string') {
        expect({ path, th: placeholders(thValue) }).toEqual({ path, th: placeholders(enValue) });
        continue;
      }

      if (Array.isArray(enValue) && Array.isArray(thValue)) {
        expect({ path, thLength: thValue.length }).toEqual({ path, thLength: enValue.length });
        enValue.forEach((item, index) => {
          const thItem = thValue[index];
          if (typeof item !== 'string' || typeof thItem !== 'string') return;
          expect({ path, index, th: placeholders(thItem) }).toEqual({
            path,
            index,
            th: placeholders(item),
          });
        });
      }
    }
  });
});
