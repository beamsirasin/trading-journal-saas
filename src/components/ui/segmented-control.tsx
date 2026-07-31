'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

import { LAYOUT_SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Fuller wording for assistive tech, e.g. "Last 30 days" for "30 days". */
  readonly description?: string;
}

interface SegmentedControlProps<T extends string> {
  readonly legend: string;
  readonly options: readonly SegmentedOption<T>[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly className?: string;
}

/**
 * A filter control built on native radio inputs.
 *
 * The radios are visually hidden rather than replaced by buttons with ARIA:
 * a real radio group already gives arrow-key navigation, group semantics, and
 * correct "2 of 3" announcements. Reimplementing that with `role="radiogroup"`
 * and a roving tabindex is more code and is usually subtly wrong.
 *
 * Motion is the same shared-`layoutId` pattern as the sidebar indicator — the
 * pill travels between segments so the change of state is legible rather than
 * a hard cut. Reduced motion swaps it for a static pill, matching the
 * Phase 00b convention.
 */
export function SegmentedControl<T extends string>({
  legend,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<T>) {
  const name = useId();
  const layoutId = `segmented-${name}`;
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="bg-muted border-border inline-flex flex-wrap gap-1 rounded-lg border p-1">
        {options.map((option) => {
          const checked = option.value === value;
          const id = `${name}-${option.value}`;

          return (
            <div key={option.value} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onValueChange(option.value)}
                className="peer sr-only"
                {...(option.description === undefined ? {} : { 'aria-label': option.description })}
              />
              <label
                htmlFor={id}
                className={cn(
                  'relative flex min-h-11 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium',
                  'transition-colors select-none',
                  // The ring is driven by the hidden input's focus state, so
                  // keyboard users see focus on the thing they are operating.
                  'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {checked ? (
                  prefersReducedMotion ? (
                    <span
                      data-segment-indicator="static"
                      aria-hidden="true"
                      className="bg-card border-border shadow-control absolute inset-0 rounded-md border"
                    />
                  ) : (
                    <motion.span
                      data-segment-indicator="animated"
                      layoutId={layoutId}
                      aria-hidden="true"
                      transition={LAYOUT_SPRING}
                      className="bg-card border-border shadow-control absolute inset-0 rounded-md border"
                    />
                  )
                ) : null}
                <span className="relative whitespace-nowrap">{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
