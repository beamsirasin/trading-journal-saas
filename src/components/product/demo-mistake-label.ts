import { useTranslations } from 'next-intl';

const MISTAKE_KEY_BY_FIXTURE_LABEL = {
  'Moved stop': 'movedStop',
  'Exited early': 'exitedEarly',
  'Ignored exit rule': 'ignoredExitRule',
  Oversized: 'oversized',
  'Revenge trade': 'revengeTrade',
  'Chased entry': 'chasedEntry',
} as const;

/**
 * Translates fixed mistake-taxonomy labels while leaving unknown user data
 * untouched. Symbols, strategy names and account nicknames remain fixture
 * content; these six labels are product vocabulary and must follow locale.
 */
export function useDemoMistakeLabel() {
  const t = useTranslations('mistakeLabels');

  return (label: string): string => {
    const key = MISTAKE_KEY_BY_FIXTURE_LABEL[label as keyof typeof MISTAKE_KEY_BY_FIXTURE_LABEL];
    return key === undefined ? label : t(key);
  };
}
