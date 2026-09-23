'use client';

import { ChevronRight, type LucideIcon } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { cn } from '@/lib/utils';

import { FieldError } from './trade-at-entry-controls';

/**
 * A LAUNCHER ROW FOR A LATER STEP — the same row Step 1 reads with.
 *
 * It shows the recorded answer, or a neutral word when there is none, and
 * opens the one editor that records it. It deliberately repeats Step 1's
 * `ConceptRow` language — the surface ladder, the icon inset, the value as the
 * row's largest text — instead of sharing that component, because Step 1 is a
 * protected baseline (UX Rules §20.9) and moving its row would change it. The
 * two can be unified the next time Step 1 is legitimately opened.
 *
 * THE ICON IS AN ANCHOR, NOT A STATUS: neutral until answered, then the
 * accent. The value text always says the answer first. Decorative.
 *
 * A DISABLED ROW SAYS WHY in its own value line, never by colour alone.
 *
 * `support` IS A SECOND OBSERVATION, NOT A VERDICT ON THE FIRST. It carries a
 * neighbouring answer the row is the natural home for — Plan & Risk's Actual
 * Risk beside Risk at Entry — and it states only what was actually recorded. A
 * row never fills it by inferring one answer from another: an unanswered
 * observation has no support line at all (Add Trade contract §2, §8).
 */
export function TradeLauncherRow({
  id,
  rowRef,
  label,
  marker = null,
  value,
  support = null,
  supportWraps = false,
  placeholder,
  error,
  editLabel,
  icon: Icon,
  answered,
  disabled = false,
  onOpen,
  buttonData = {},
}: {
  id: string;
  rowRef?: RefObject<HTMLButtonElement | null>;
  label: string;
  marker?: ReactNode;
  /** What is recorded, or null when nothing is. */
  value: string | null;
  /** A second recorded answer read under the value, or null when there is none. */
  support?: string | null;
  /**
   * Let a support line that must be read whole wrap instead of truncating —
   * Setup & Checklist's inherited Exit Plan names a plan the trader may be
   * about to change. Off by default, so every other row keeps its one line.
   */
  supportWraps?: boolean;
  /** The neutral word for nothing recorded — never a negative (UX Rules §4.3). */
  placeholder: string;
  error?: string | undefined;
  editLabel: string;
  icon: LucideIcon;
  /** Tints the icon anchor once the concept holds an answer. */
  answered: boolean;
  disabled?: boolean;
  onOpen: () => void;
  /** `data-*` attributes for the button itself, so a test can read the answer. */
  buttonData?: Record<`data-${string}`, string | undefined>;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <button
        type="button"
        id={id}
        ref={rowRef}
        {...buttonData}
        aria-label={editLabel}
        aria-haspopup="dialog"
        aria-describedby={error === undefined ? undefined : errorId}
        data-invalid={error === undefined ? undefined : 'true'}
        disabled={disabled}
        onClick={onOpen}
        className={cn(
          'shadow-card bg-card hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-3 rounded-lg border text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
          'min-h-[4.75rem] px-4 py-3 lg:min-h-[5.25rem] lg:gap-2 lg:px-5',
          'lg:bg-muted/50 lg:hover:bg-muted lg:shadow-none',
          'disabled:hover:bg-card lg:disabled:hover:bg-muted/50 disabled:cursor-not-allowed',
          error === undefined ? 'border-transparent' : 'border-destructive',
        )}
      >
        <span
          aria-hidden="true"
          data-launcher-icon={answered ? 'accent' : 'neutral'}
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md transition-colors motion-reduce:transition-none lg:size-9',
            answered ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground lg:bg-card',
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-muted-foreground text-[0.8125rem] leading-5 font-medium">
              {label}
            </span>
            {marker}
          </span>
          <span
            className={cn(
              'mt-0.5 block truncate text-[1.0625rem] leading-6 lg:text-lg',
              value === null ? 'text-subtle-foreground' : 'text-foreground font-semibold',
            )}
          >
            {value ?? placeholder}
          </span>
          {support === null ? null : (
            <span
              data-launcher-support=""
              className={cn(
                'text-muted-foreground mt-0.5 block text-[0.8125rem] leading-5',
                supportWraps ? 'break-words' : 'truncate',
              )}
            >
              {support}
            </span>
          )}
        </span>
        {disabled ? null : (
          <ChevronRight className="text-subtle-foreground size-5 shrink-0" aria-hidden="true" />
        )}
      </button>
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}
