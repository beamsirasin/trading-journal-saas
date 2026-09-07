'use client';

import { useId } from 'react';

import { cn } from '@/lib/utils';

import { CONFIDENCE_LABEL, CONFIDENCE_STEPS } from '../presentation';

/**
 * CONFIDENCE — five ordinary radio choices.
 *
 * WHAT THIS REPLACES, AND WHY BOTH EARLIER ANSWERS WERE WRONG. The production
 * control is a slider: the stored values are 0/25/50/75/100 and the MEANING is
 * five named levels, so a draggable knob invites a reader to place it "about
 * 60%" and read the result back as a probability the product does not claim.
 * This repository also has direct evidence of what that control costs — the
 * knob's position was written by three code paths, a redesign silenced one, and
 * the remaining two threw it off the track on a phone rotation for a further two
 * weeks (CLAUDE.md §10).
 *
 * The prototype's first answer replaced it with a connected rail carrying
 * cumulative fill, a taller selected stop, a selected dot and a caption reading
 * "Recorded as High." That fixed the arithmetic problem and introduced a
 * comprehension one: it is a control nobody has seen before. A beginner meeting
 * it has to work out that the bars are a scale, that the fill means "and
 * everything below", and that the tall one is their answer — three inferences to
 * make a five-way choice that a radio group makes in zero.
 *
 * SO IT IS A RADIO GROUP THAT LOOKS LIKE A RADIO GROUP. Five options, a real
 * dot in a real circle, the label beside it. Ordering is carried by the reading
 * order — Very low to Very high, left to right on a desktop and top to bottom on
 * a phone — which is where a reader already expects to find it, rather than by a
 * fill gradient they have to decode. Nothing is invented and nothing needs a
 * caption to explain it.
 *
 * VERTICAL BELOW 560px, and not because the row "gets cramped" — because five
 * labels including "Very high" in a 320px row cannot be read at all, and
 * shrinking type to fit them is how a control becomes technically present and
 * practically unusable.
 *
 * NULL IS A FIRST-CLASS STATE. Nothing is preselected — Neutral is a recorded
 * answer meaning 50, not the absence of one — and Clear appears only once there
 * is something to clear.
 */
export function ConfidenceControl({
  value,
  onChange,
  label = 'Confidence in this trade',
  note,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label?: string;
  /** A standing qualifier, e.g. "Recalled after the trade". */
  note?: string;
}) {
  const name = useId();

  return (
    <fieldset className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <legend className="text-foreground text-sm font-medium">{label}</legend>
        {/*
          CLEAR EXISTS ONLY WHEN IT CAN DO SOMETHING. It was rendered
          permanently and disabled, which is a control whose resting state is
          "unavailable" — and on the untouched form, the only control in the
          group that looked interactive was the one that was not.
        */}
        {value === null ? null : (
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn(
              'text-muted-foreground hover:text-foreground focus-visible:ring-ring relative rounded-sm text-xs',
              'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
              'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
            )}
          >
            Clear
          </button>
        )}
      </div>

      {note === undefined ? null : <p className="text-subtle-foreground mt-0.5 text-xs">{note}</p>}

      <div className="mt-2.5 grid min-w-0 gap-1.5 min-[560px]:grid-cols-5">
        {CONFIDENCE_STEPS.map((step) => {
          const id = `${name}-${step}`;
          const checked = value === step;
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
                  'flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
                  'min-[560px]:flex-col min-[560px]:justify-center min-[560px]:gap-1.5 min-[560px]:px-2 min-[560px]:py-2.5 min-[560px]:text-center',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  checked
                    ? 'border-primary bg-primary/10 text-foreground font-medium'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                {/* A real dot in a real circle. Selection is never colour alone,
                    and never a shape a reader has to learn. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    checked ? 'border-primary' : 'border-input',
                  )}
                >
                  {checked ? <span className="bg-primary size-2 rounded-full" /> : null}
                </span>
                <span className="min-w-0 leading-tight break-words">{CONFIDENCE_LABEL[step]}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
