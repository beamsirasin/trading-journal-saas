import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import th from '../../messages/th.json';
import { CANONICAL_SYSTEM_EMOTION_TYPES, EMOTION_KEYS, isCanonicalEmotionKey } from './emotions';

describe('canonical Emotion taxonomy', () => {
  it('has exactly the ten frozen unique keys in stable order', () => {
    expect(EMOTION_KEYS).toEqual([
      'calm',
      'focused',
      'fearful',
      'fomo',
      'greedy',
      'hesitant',
      'revenge',
      'excited',
      'tired',
      'frustrated',
    ]);
    expect(new Set(EMOTION_KEYS).size).toBe(10);
    expect(CANONICAL_SYSTEM_EMOTION_TYPES.map((emotion) => emotion.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(isCanonicalEmotionKey('calm')).toBe(true);
    expect(isCanonicalEmotionKey('invented')).toBe(false);
  });

  it('stays exactly aligned with migration 0012 seed key, label, and order values', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'drizzle/0012_emotions_and_review.sql'),
      'utf8',
    );
    for (const emotion of CANONICAL_SYSTEM_EMOTION_TYPES) {
      expect(sql).toContain(
        `NULL, '${emotion.key}', '${emotion.label}', true, false, ${emotion.sortOrder})`,
      );
    }
    expect(sql.match(/\('[0-9a-f-]{36}', NULL,/g)).toHaveLength(10);
  });

  it('has non-empty EN and TH display labels for every canonical key', () => {
    for (const key of EMOTION_KEYS) {
      expect(en.trades.emotions[key]).toEqual(expect.any(String));
      expect(th.trades.emotions[key]).toEqual(expect.any(String));
      expect(th.trades.emotions[key]).not.toBe(en.trades.emotions[key]);
    }
  });
});
