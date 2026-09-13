'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';

import { CONFIDENCE_LEVELS, type ConfidenceStep } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';

/**
 * CONFIDENCE — five named choices, stored exactly as before.
 *
 * WHY NOT A SLIDER. The stored values are the five steps 0/25/50/75/100 and the
 * meaning is five named levels (`CONFIDENCE_LEVELS`). A draggable knob invites
 * "about 60%", which the product does not record, and its pixel position was a
 * long-running source of defects. A radio group states the real contract: one of
 * five answers, or none.
 *
 * NOTHING ABOUT THE DATA CHANGED. Each option writes the same `ConfidenceStep`
 * the slider wrote (`trades_confidence_check` allows exactly these values), so
 * every stored confidence reads back into exactly one option.
 *
 * NULL IS A REAL STATE. Nothing is preselected — Neutral is an answer meaning 50,
 * not the absence of one — and Clear appears only once there is something to
 * clear. Vertical below 560px, where five labels in one row cannot be read.
 */
export function TradeConfidenceChoice({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  value: ConfidenceStep | null;
  onChange: (value: ConfidenceStep | null) => void;
}) {
  const t = useTranslations('trades');
  const name = useId();
  const hintId = `${id}-hint`;

  return (
    <fieldset
      id={id}
      data-slot="confidence-choice"
      className="min-w-0"
      aria-describedby={hint === undefined ? undefined : hintId}
    >
      <legend className="text-foreground text-sm font-medium">{label}</legend>
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          {hint}
        </p>
      )}

      <div className="mt-2.5 grid min-w-0 gap-1.5 min-[560px]:grid-cols-5">
        {CONFIDENCE_LEVELS.map((level) => {
          const inputId = `${name}-${level.value}`;
          const checked = value === level.value;
          return (
            <div key={level.value} className="min-w-0">
              <input
                type="radio"
                id={inputId}
                name={name}
                value={level.value}
                checked={checked}
                onChange={() => onChange(level.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={inputId}
                data-slot="confidence-option"
                data-step={level.value}
                className={cn(
                  'flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
                  'min-[560px]:flex-col min-[560px]:justify-center min-[560px]:gap-1.5 min-[560px]:px-2 min-[560px]:py-2.5 min-[560px]:text-center',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 motion-reduce:transition-none',
                  checked
                    ? 'border-primary bg-primary/10 text-foreground font-medium'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                {/* A dot in a circle: selection is never colour alone. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-full border',
                    checked ? 'border-primary' : 'border-input',
                  )}
                >
                  {checked ? <span className="bg-primary size-2 rounded-full" /> : null}
                </span>
                <span className="min-w-0 leading-tight break-words">
                  {t(`create.confidence.level.${level.key}`)}
                </span>
              </label>
            </div>
          );
        })}
      </div>

      {value === null ? null : (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            'text-muted-foreground hover:text-foreground focus-visible:ring-ring relative mt-2 rounded-sm text-xs',
            'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
            'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
          )}
        >
          {t('create.confidence.clear')}
        </button>
      )}
    </fieldset>
  );
}
