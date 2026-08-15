export const CANONICAL_SYSTEM_EMOTION_TYPES = [
  { key: 'calm', label: 'Calm', sortOrder: 0 },
  { key: 'focused', label: 'Focused', sortOrder: 1 },
  { key: 'fearful', label: 'Fearful', sortOrder: 2 },
  { key: 'fomo', label: 'FOMO', sortOrder: 3 },
  { key: 'greedy', label: 'Greedy', sortOrder: 4 },
  { key: 'hesitant', label: 'Hesitant', sortOrder: 5 },
  { key: 'revenge', label: 'Revenge', sortOrder: 6 },
  { key: 'excited', label: 'Excited', sortOrder: 7 },
  { key: 'tired', label: 'Tired', sortOrder: 8 },
  { key: 'frustrated', label: 'Frustrated', sortOrder: 9 },
] as const;

export type EmotionKey = (typeof CANONICAL_SYSTEM_EMOTION_TYPES)[number]['key'];

export const EMOTION_KEYS = CANONICAL_SYSTEM_EMOTION_TYPES.map((emotion) => emotion.key) as [
  EmotionKey,
  ...EmotionKey[],
];

export function isCanonicalEmotionKey(value: unknown): value is EmotionKey {
  return typeof value === 'string' && (EMOTION_KEYS as readonly string[]).includes(value);
}
