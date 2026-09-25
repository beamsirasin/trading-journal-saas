'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { ChoiceTone } from './trade-at-entry-controls';

/**
 * A SINGLE-CHOICE EDITOR'S ANSWERS, EACH ONE A COMMIT.
 *
 * Step 1's rule: where an editor asks one question with one answer, choosing
 * the answer IS the whole interaction — it is written to the draft and the
 * sheet closes on the same tap, as the Symbol picker already does. There is no
 * Done, because there is nothing left to confirm. The caller closes; this list
 * only says what was chosen.
 *
 * WHY BUTTONS, NOT RADIOS. A radio group moves its selection on the arrow
 * keys, and a selection here closes the sheet — so arrowing from Long towards
 * Short would commit Short and throw the trader out mid-look. Each answer is a
 * button instead: Tab walks them, Enter or Space chooses, and `aria-pressed`
 * says which is the current answer.
 *
 * THE FEEDBACK RIDES OUT WITH THE SHEET. The draft changes before the sheet
 * starts closing, and the overlay keeps its content on screen through its exit
 * transition, so the leaving sheet shows the new answer selected — tinted,
 * checked and heavier — while it goes. Nothing waits on a timer, and nothing
 * ignores a tap while it does.
 *
 * NEVER ONLY A COLOUR. The selected answer carries a check and a heavier
 * label as well as its tint, and `aria-pressed` for anyone who cannot see
 * either; its name stays the plain answer. Long and Short keep the restrained
 * positive and negative wash `ChoiceGroup` uses (DESIGN.md §9.4), untoned
 * answers the neutral one.
 */
export function TradeChoiceList<T extends string>({
  label,
  value,
  options,
  onChoose,
  columns = 1,
  error,
  errorId,
}: {
  /** The group's accessible name; the sheet's title already shows it. */
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; tone?: ChoiceTone }[];
  onChoose: (value: T) => void;
  columns?: 1 | 2;
  error?: string | undefined;
  errorId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={error === undefined ? undefined : errorId}
      className={cn('grid min-w-0 gap-2', columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}
    >
      {options.map((option) => {
        const chosen = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen}
            data-choice={option.value}
            onClick={() => onChoose(option.value)}
            className={cn(
              'flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-md border px-4 text-left transition-colors duration-(--motion-feedback-duration) motion-reduce:transition-none',
              'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none',
              chosen
                ? option.tone === 'positive'
                  ? 'border-positive/45 bg-positive/8'
                  : option.tone === 'negative'
                    ? 'border-negative/45 bg-negative/8'
                    : 'border-foreground/60 bg-accent'
                : cn(
                    'bg-background hover:bg-accent',
                    error === undefined ? 'border-control-border' : 'border-destructive',
                  ),
            )}
          >
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-base',
                chosen ? 'font-semibold' : 'font-medium',
                chosen && option.tone === 'positive'
                  ? 'text-positive'
                  : chosen && option.tone === 'negative'
                    ? 'text-negative'
                    : 'text-foreground',
              )}
            >
              {option.label}
            </span>
            {/*
              The check settles in rather than blinking on: a short scale and
              fade on the feedback token. Reduced motion keeps the fade and
              drops the scale.
            */}
            <Check
              aria-hidden="true"
              className={cn(
                'size-4 shrink-0 transition-[opacity,scale] duration-(--motion-feedback-duration) ease-(--motion-ease-standard) motion-reduce:scale-100',
                chosen ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
                option.tone === 'positive'
                  ? 'text-positive'
                  : option.tone === 'negative'
                    ? 'text-negative'
                    : 'text-primary-text',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
