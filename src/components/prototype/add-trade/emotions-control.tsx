'use client';

import { Check } from 'lucide-react';

import { CANONICAL_SYSTEM_EMOTION_TYPES, type EmotionKey } from '@/config/emotions';
import { cn } from '@/lib/utils';

/**
 * EMOTIONS — the product's OWN catalog, in the product's own groups.
 *
 * THIS FILE ONCE INVENTED A TAXONOMY. An earlier prototype pass listed
 * "Confident", "Patient", "Anxious", "Rushed", "Impatient", "Overconfident" —
 * plausible words, none of them in the product. The real catalog is the ten
 * `is_system` emotions in `src/config/emotions.ts`, and the real groups are the
 * four the recording form already renders. Both are imported/mirrored here
 * rather than retyped, so a prototype screenshot can never show a vocabulary the
 * product does not have.
 *
 * THE DISTINCTION THIS CONTROL EXISTS TO PROTECT. `null` means the trader never
 * said. `[]` means the trader explicitly said "none of these". Those are
 * different facts about a journal, and the current production form collapses
 * them: merely visiting the Context tab submits an empty emotion selection, so
 * the product ends up holding "I felt nothing" for every trade whose author only
 * glanced at the section. Analytics built on that cannot tell an answered
 * population from a browsed one.
 *
 * So "None of these" is a real, separate, mutually-exclusive choice, and the
 * caption states which of the three states is current in words. Deselecting
 * every chip returns to untouched — it does not silently become "none".
 *
 * NO SCORING AND NO ADVICE. The chips carry no valence colour and the group
 * headings are neutral descriptions, not verdicts. "Fearful" is not a mistake,
 * and a journal that grades a feeling stops being a place people write honestly.
 */

/**
 * Mirrors `EMOTION_GROUPS` in `trade-recording-form.tsx`. Copied rather than
 * imported because that constant is private to the production form; if it is
 * ever exported, this should read it instead of restating it.
 */
const EMOTION_GROUPS: readonly { key: string; label: string; emotions: readonly EmotionKey[] }[] = [
  { key: 'inControl', label: 'In control', emotions: ['calm', 'focused'] },
  { key: 'pushedIn', label: 'Pushed in', emotions: ['fomo', 'greedy', 'excited', 'revenge'] },
  { key: 'heldBack', label: 'Held back', emotions: ['fearful', 'hesitant'] },
  { key: 'depleted', label: 'Depleted', emotions: ['tired', 'frustrated'] },
];

const EMOTION_LABEL = new Map<string, string>(
  CANONICAL_SYSTEM_EMOTION_TYPES.map((emotion) => [emotion.key, emotion.label]),
);

export function emotionLabel(key: string): string {
  return EMOTION_LABEL.get(key) ?? key;
}

export function EmotionsControl({
  value,
  onChange,
}: {
  /** `null` = never answered. `[]` = the explicit "None of these". */
  value: readonly string[] | null;
  onChange: (value: readonly string[] | null) => void;
}) {
  const isNone = value !== null && value.length === 0;

  function toggle(key: EmotionKey, selected: boolean) {
    const current = value === null || isNone ? [] : [...value];
    const next = selected ? current.filter((item) => item !== key) : [...current, key];
    // Clearing the last chip returns to UNTOUCHED, not to "none".
    onChange(next.length === 0 ? null : next);
  }

  return (
    <fieldset className="min-w-0">
      <legend className="text-foreground text-sm font-medium">How did you feel at entry?</legend>

      <div className="mt-3 flex min-w-0 flex-col gap-4">
        {EMOTION_GROUPS.map((group) => (
          <div key={group.key} className="min-w-0">
            <p className="text-subtle-foreground text-label mb-2 uppercase">{group.label}</p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.emotions.map((key) => {
                const selected = value !== null && value.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(key, selected)}
                    className={cn(
                      'focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-2',
                      'transition-colors',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground font-medium'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {selected ? (
                      <Check className="text-primary size-3.5" aria-hidden="true" />
                    ) : null}
                    {emotionLabel(key)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-border mt-4 border-t pt-3">
        <button
          type="button"
          aria-pressed={isNone}
          onClick={() => onChange(isNone ? null : [])}
          className={cn(
            'focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md border px-3.5 text-sm outline-none focus-visible:ring-2',
            isNone
              ? 'border-primary bg-primary/10 text-foreground font-medium'
              : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {isNone ? <Check className="text-primary size-4" aria-hidden="true" /> : null}
          None of these
        </button>
      </div>

      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {value === null
          ? 'Not recorded. Opening this section does not record an answer.'
          : isNone
            ? 'Recorded: no emotion from this list applied.'
            : `Recorded: ${value.map(emotionLabel).join(', ')}.`}
      </p>
    </fieldset>
  );
}
