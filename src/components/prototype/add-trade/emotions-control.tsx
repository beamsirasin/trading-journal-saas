'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PROTOTYPE_EMOTIONS } from '../fixtures';

/**
 * EMOTIONS — a multi-select where OPENING the section is not an answer.
 *
 * THE DISTINCTION THIS CONTROL EXISTS TO PROTECT. `null` means the trader never
 * said. `[]` means the trader explicitly said "none of these". Those are
 * different facts about a journal, and the current form collapses them: merely
 * visiting the Context tab submits an empty emotion selection, so the product
 * ends up holding "I felt nothing" for every trade whose author only glanced at
 * the section. Analytics built on that cannot tell an answered population from
 * a browsed one.
 *
 * So "None of these" is a real, separate, mutually-exclusive choice, and the
 * caption states which of the three states is current in words. Deselecting
 * every chip returns to untouched — it does not silently become "none".
 *
 * NO SCORING AND NO ADVICE. The chips carry no valence colour and the control
 * offers no interpretation. "Anxious" is not a mistake, and a journal that
 * grades a feeling stops being a place people write honestly.
 */
export function EmotionsControl({
  value,
  onChange,
}: {
  /** `null` = never answered. `[]` = the explicit "None of these". */
  value: readonly string[] | null;
  onChange: (value: readonly string[] | null) => void;
}) {
  const isNone = value !== null && value.length === 0;

  return (
    <fieldset className="min-w-0">
      <legend className="text-foreground text-sm font-medium">How did you feel at entry?</legend>

      <div className="mt-3 flex min-w-0 flex-wrap gap-2">
        {PROTOTYPE_EMOTIONS.map((emotion) => {
          const selected = value !== null && value.includes(emotion);
          return (
            <button
              key={emotion}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                const current = value === null || isNone ? [] : [...value];
                const next = selected
                  ? current.filter((item) => item !== emotion)
                  : [...current, emotion];
                // Clearing the last chip returns to UNTOUCHED, not to "none".
                onChange(next.length === 0 ? null : next);
              }}
              className={cn(
                'focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-2',
                'transition-colors',
                selected
                  ? 'border-primary bg-primary/10 text-foreground font-medium'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {selected ? <Check className="text-primary size-3.5" aria-hidden="true" /> : null}
              {emotion}
            </button>
          );
        })}
      </div>

      <div className="border-border mt-3 border-t pt-3">
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
            : `Recorded: ${value.join(', ')}.`}
      </p>
    </fieldset>
  );
}
