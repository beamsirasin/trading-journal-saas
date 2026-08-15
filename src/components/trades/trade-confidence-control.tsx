'use client';

import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';

import { LAYOUT_SPRING } from '@/lib/motion';
import { CONFIDENCE_STEPS, confidenceLevelKey, type ConfidenceStep } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

/**
 * Confidence's five-step segmented selector (Founder-UAT Confidence
 * redesign — locked product decision, superseding the earlier continuous
 * 0–100 slider draft of this same uncommitted migration 0010). The five
 * allowed values (0/25/50/75/100) are the ONLY valid persisted values — this
 * control can never produce anything else, matching `trades_confidence_check`
 * and the Zod schemas exactly.
 *
 * Built on real native `<input type="radio">` elements, visually hidden and
 * wrapped in styled `<label>`s inside a `<fieldset>` — the same architecture
 * `src/components/ui/segmented-control.tsx` already establishes for this
 * design system, and for the same reason its own doc comment gives: a real
 * radio group already gives correct arrow-key navigation, native group
 * semantics, and "N of 5" announcements for free; reimplementing that with
 * `role="radiogroup"`/`role="radio"` and a hand-rolled roving tabindex is
 * more code and is usually subtly wrong. Home/End are not native radio-group
 * behavior, so those two are the only keys this component handles itself.
 * The visible top-row `Label` is purely typographic — the group's REAL
 * accessible name comes from the `<fieldset>`'s `sr-only` `<legend>`.
 */
export function TradeConfidenceControl({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const t = useTranslations('trades');
  const groupName = useId();
  const prefersReducedMotion = usePrefersReducedMotion();
  const radioRefs = useRef<Partial<Record<ConfidenceStep, HTMLInputElement | null>>>({});

  function levelLabel(step: ConfidenceStep): string {
    return t(`create.confidence.level.${confidenceLevelKey(step)}`);
  }

  function selectStep(step: ConfidenceStep) {
    onChange(step);
    radioRefs.current[step]?.focus();
  }

  /**
   * ArrowLeft/ArrowRight move between the five discrete steps — handled
   * explicitly here rather than left to the browser's native radio-group
   * arrow-key behavior, so this is deterministic (never wraps, clamps at
   * both ends) and independently testable without depending on a real
   * browser's keyboard-navigation implementation. Home/End are never native
   * radio-group behavior at all, so those always needed an explicit handler.
   */
  function moveBySteps(delta: 1 | -1) {
    const currentIndex = value === null ? null : CONFIDENCE_STEPS.indexOf(value as ConfidenceStep);
    const nextIndex =
      currentIndex === null
        ? delta > 0
          ? 0
          : CONFIDENCE_STEPS.length - 1
        : Math.min(CONFIDENCE_STEPS.length - 1, Math.max(0, currentIndex + delta));
    const nextStep = CONFIDENCE_STEPS[nextIndex];
    if (nextStep !== undefined) selectStep(nextStep);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFieldSetElement>) {
    if (event.key === 'Home') {
      event.preventDefault();
      selectStep(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectStep(100);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveBySteps(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveBySteps(-1);
    }
  }

  const valueText =
    value === null ? t('common.notSet') : `${value}% · ${levelLabel(value as ConfidenceStep)}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* Purely typographic — the group's real accessible name comes from the fieldset's legend below, since a <label> cannot meaningfully target a <fieldset>. */}
        <Label>
          {label} <span className="text-muted-foreground font-normal">{t('common.optional')}</span>
        </Label>
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'text-sm font-semibold',
              value === null && 'text-muted-foreground font-medium',
            )}
          >
            {valueText}
          </span>
          {value === null ? null : (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t('create.confidence.clear')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none"
            >
              <X aria-hidden="true" size={14} />
            </button>
          )}
        </div>
      </div>

      <fieldset id={id} onKeyDown={handleKeyDown} className="min-w-0">
        <legend className="sr-only">{label}</legend>
        <div className="bg-muted border-border flex w-full gap-1 rounded-xl border p-1 shadow-inner">
          {CONFIDENCE_STEPS.map((step) => {
            const checked = value === step;
            const inputId = `${groupName}-${step}`;

            return (
              <div key={step} className="relative min-w-0 flex-1">
                <input
                  ref={(el) => {
                    radioRefs.current[step] = el;
                  }}
                  type="radio"
                  id={inputId}
                  name={groupName}
                  value={step}
                  checked={checked}
                  onChange={() => selectStep(step)}
                  aria-label={`${step}% · ${levelLabel(step)}`}
                  className="peer sr-only"
                />
                <label
                  htmlFor={inputId}
                  className={cn(
                    'relative flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg text-sm font-medium transition-colors duration-150 select-none',
                    'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1',
                    checked
                      ? 'text-primary-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {checked ? (
                    prefersReducedMotion ? (
                      <span
                        aria-hidden="true"
                        className="bg-primary shadow-control absolute inset-0 rounded-lg"
                      />
                    ) : (
                      <motion.span
                        layoutId={`${groupName}-indicator`}
                        aria-hidden="true"
                        transition={LAYOUT_SPRING}
                        className="bg-primary shadow-control absolute inset-0 rounded-lg"
                      />
                    )
                  ) : null}
                  <span className="relative">{step}%</span>
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <p className="text-muted-foreground text-xs">{t('create.confidence.hint')}</p>
    </div>
  );
}
