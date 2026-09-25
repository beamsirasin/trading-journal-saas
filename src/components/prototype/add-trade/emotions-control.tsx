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
 * product does not have. Neither the catalog nor the grouping is touched by this
 * pass; only their arrangement is.
 *
 * FOUR STACKED SECTIONS BECAME TWO COLUMNS. Each group was a full-width block
 * with its own heading and its own row of chips, so on a desktop the control was
 * roughly 280px of mostly empty horizontal space — four isolated bands for ten
 * short words. Two columns above 560px halve that and let the four group names
 * be read as one set rather than as four sections to work through. On a phone
 * they stay stacked, because one column of wrapping chips is what a phone has
 * room for.
 *
 * THE DISTINCTION THIS CONTROL EXISTS TO PROTECT. `null` means the trader never
 * said. `[]` means the trader explicitly said "none of these". Those are
 * different facts about a journal, and the production form collapses them:
 * merely visiting the Context tab submits an empty emotion selection, so the
 * product ends up holding "I felt nothing" for every trade whose author only
 * glanced at the section. Analytics built on that cannot tell an answered
 * population from a browsed one.
 *
 * WHAT THE SECOND PASS REMOVED. The caption reading "Recorded: Calm, Focused."
 * The selected chips are filled, bordered and check-marked; restating them in a
 * sentence underneath said nothing the reader could not see, and it was the only
 * part of the control that grew as more was selected. The `null` caption stays,
 * alone, because "nothing is selected" and "the trader said none of these" look
 * identical until one of them is named — and the "None of these" control is the
 * thing that names the other.
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
      {/*
        NOT A SECOND "How did you feel at entry?". That is the question the whole
        editor is titled with, and repeating it verbatim as this control's legend
        made the phone screen ask the same thing twice within 600px. The legend
        names what THIS control contributes to that answer, and stays a real
        legend so the fieldset keeps its accessible name.
      */}
      <legend className="text-foreground text-sm font-medium">Which of these applied?</legend>

      <div className="mt-3 grid min-w-0 gap-x-6 gap-y-4 min-[560px]:grid-cols-2">
        {EMOTION_GROUPS.map((group) => (
          <div key={group.key} className="min-w-0">
            <p className="text-subtle-foreground text-label mb-1.5 uppercase">{group.label}</p>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {group.emotions.map((key) => {
                const selected = value !== null && value.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(key, selected)}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm',
                      'focus-visible:ring-ring relative transition-colors outline-none focus-visible:ring-2',
                      // 40px of ink, 44px of target — the chips are dense by
                      // design and the hit area does not have to be.
                      'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground font-medium'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {selected ? (
                      <Check className="text-primary-text size-3.5" aria-hidden="true" />
                    ) : null}
                    {emotionLabel(key)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/*
        QUIETER THAN A GROUP, AND STILL A REAL ANSWER. It was a bordered control
        below a full-width rule, which made an edge case look like a fifth
        category. It is one small dashed chip on the same row as the resting
        caption now — findable, mutually exclusive, and visibly not one of the
        ten.
      */}
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-pressed={isNone}
          onClick={() => onChange(isNone ? null : [])}
          className={cn(
            'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs',
            'focus-visible:ring-ring relative transition-colors outline-none focus-visible:ring-2',
            'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
            isNone
              ? 'border-primary bg-primary/10 text-foreground font-medium'
              : 'border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground border-dashed',
          )}
        >
          {isNone ? <Check className="text-primary-text size-3.5" aria-hidden="true" /> : null}
          None of these
        </button>

        {value === null ? (
          <span className="text-muted-foreground text-xs">Not recorded</span>
        ) : null}
      </div>
    </fieldset>
  );
}
