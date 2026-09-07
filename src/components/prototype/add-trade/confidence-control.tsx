'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

import { CONFIDENCE_LABEL, CONFIDENCE_STEPS } from '../presentation';

/**
 * CONFIDENCE — five discrete states, drawn as a scale rather than as a slider.
 *
 * WHY NOT A SLIDER. The stored values are 0/25/50/75/100 and the MEANING is
 * five named levels, not a percentage. A track with a draggable knob invites a
 * reader to place the handle "about 60%" and to read the result back as a
 * probability, which is a claim the product does not make and cannot support.
 * This repository also has direct evidence about the cost of that control: the
 * knob's position was written by three different code paths, a redesign
 * silenced one of them, and the remaining two threw the knob off the track on a
 * phone rotation for a further two weeks (CLAUDE.md §10). Discrete meaning gets
 * a discrete control.
 *
 * WHY NOT FIVE PLAIN RADIO BUTTONS EITHER. Confidence is ORDERED, and five
 * unconnected circles lose that: the reader has to read all five labels to
 * discover which end is which. So the five options sit on one connected rail,
 * in order, with the selected segment and everything below it filled — the
 * ordering is visible at a glance, while the geometry stays five fixed cells
 * that a pointer either is or is not inside. There is nothing continuous to
 * land between.
 *
 * IT IS A REAL RADIO GROUP UNDERNEATH. Native inputs, visually hidden, so arrow
 * keys, group semantics and "3 of 5" announcements come from the platform
 * rather than from a hand-rolled `role="radiogroup"` and a roving tabindex.
 *
 * NULL IS A FIRST-CLASS STATE. Nothing is preselected — Neutral is a recorded
 * answer meaning 50, not the absence of one — and Clear returns to it. The
 * caption says "Not recorded" rather than leaving an unfilled rail to be
 * interpreted as "very low".
 */
export function ConfidenceControl({
  value,
  onChange,
  label = 'How confident were you at entry?',
  hint,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  hint?: string;
}) {
  const name = useId();
  const activeIndex =
    value === null ? -1 : CONFIDENCE_STEPS.indexOf(value as 0 | 25 | 50 | 75 | 100);

  return (
    <fieldset className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <legend className="text-foreground text-sm font-medium">{label}</legend>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={value === null}
          className={cn(
            'focus-visible:ring-ring relative rounded-sm text-xs underline-offset-4 outline-none focus-visible:ring-2',
            // Same hit-area extension as the journal's follow-up: 16px of ink,
            // 44px of target, no effect on the header row's height.
            'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
            value === null
              ? 'text-subtle-foreground cursor-default'
              : 'text-muted-foreground hover:text-foreground hover:underline',
          )}
        >
          Clear
        </button>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-5 gap-1">
        {CONFIDENCE_STEPS.map((step, index) => {
          const id = `${name}-${step}`;
          const checked = value === step;
          const filled = activeIndex >= 0 && index <= activeIndex;

          return (
            <div key={step} className="min-w-0">
              <input
                type="radio"
                id={id}
                name={name}
                checked={checked}
                onChange={() => onChange(step)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex min-h-16 cursor-pointer flex-col items-center justify-end gap-2 rounded-md px-1 pb-2 text-center',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  checked ? 'bg-primary/10' : 'hover:bg-accent',
                )}
              >
                {/* The rail. A filled step below the selection is what makes the
                    ORDER visible; the selected step is taller and carries the
                    accent, so it is identifiable without relying on the fill
                    colour alone. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-full rounded-full transition-[height,background-color] duration-150',
                    'motion-reduce:transition-none',
                    checked ? 'bg-primary h-3' : filled ? 'bg-primary/40 h-1.5' : 'bg-border h-1.5',
                  )}
                />
                <span
                  className={cn(
                    'min-w-0 text-xs leading-tight break-words',
                    checked ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )}
                >
                  {CONFIDENCE_LABEL[step]}
                </span>
              </label>
            </div>
          );
        })}
      </div>

      <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {value === null ? 'Not recorded.' : `Recorded as ${CONFIDENCE_LABEL[value]}.`}
        {hint === undefined ? '' : ` ${hint}`}
      </p>
    </fieldset>
  );
}
