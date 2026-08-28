'use client';

import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from './dropdown-menu';

export interface MenuSegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /**
   * Fuller wording for assistive tech, where the visible label is abbreviated
   * for width. Must CONTAIN the visible label (WCAG 2.5.3) — a speech-input
   * user says what they can see.
   */
  readonly description?: string;
}

/**
 * A labelled preference row inside a dropdown menu, with its choices laid out
 * as an inline segmented control.
 *
 *   ┌───────────────────────────────────┐
 *   │ ᴀ  Language        [English][ไทย] │
 *   └───────────────────────────────────┘
 *
 * WHY THIS REPLACED A SUBMENU. Language and theme used to be two
 * `DropdownMenuSub`s. A submenu states its current value on the trigger, so
 * the menu answered "what am I set to?" without being opened — but CHANGING
 * either took a second surface, a second hover intent and a second dismissal,
 * for a choice between a handful of fixed values. Laid out inline, the row
 * states the current value AND accepts the change in one place, which is
 * strictly less work for exactly the same information.
 *
 * ONE CALLER NOW. Theme used this too, while it had three values. It has two,
 * and a binary does not want a picker — it moved to a toggle
 * (`ThemeToggle`'s `menu` variant). What is left here is a control for a set
 * you genuinely choose FROM, which is exactly what language is.
 *
 * WHY IT IS A REAL RADIO GROUP AND NOT BUTTONS. `DropdownMenuRadioGroup`
 * gives a labelled `role="group"` whose children are `menuitemradio` with
 * `aria-checked`, so the current value is announced as a selection out of a
 * set — "English, 1 of 2" — rather than as three unrelated controls. (Inside
 * a menu the wrapper is a `group` rather than a `radiogroup`; the RADIO
 * semantics live on the items, which is the ARIA menu pattern.) It also
 * inherits the menu's own roving focus, which is what keeps the segments
 * reachable from the keyboard: a plain `<button>` in here would be skipped,
 * because a menu closes on Tab rather than moving through its content.
 *
 * WHY SELECTING DOES NOT CLOSE THE MENU. `onSelect` is prevented by default
 * (`closeOnSelect`), because these are settings rather than destinations —
 * the user should see the theme change against the surface they are looking
 * at, and be able to correct it immediately if it was not what they meant.
 *
 * WHY IT IS NOT `SegmentedControl`. That one is a `fieldset` of native radio
 * inputs — the right primitive for a page or a form, and the wrong one
 * inside a menu, where the surrounding roving-focus model owns the keyboard.
 * The two are the same IDEA at different densities: this row is deliberately
 * the compact one, so an account menu does not grow to the width of a page
 * control.
 */
export function MenuSegmentedRow<T extends string>({
  label,
  Icon,
  options,
  value,
  onValueChange,
  closeOnSelect = false,
}: {
  readonly label: string;
  /** Drawn beside the label, matching the icon column the menu's link rows use. */
  readonly Icon: LucideIcon;
  readonly options: readonly MenuSegmentedOption<T>[];
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly closeOnSelect?: boolean;
}) {
  return (
    // The ROW is what has to clear this shell's 44px rule; the segments inside
    // it are smaller, and are measured against WCAG 2.5.8's 24x24 instead. The
    // hook is here rather than on the track because the track is not the thing
    // a thumb aims at — see `app-shell.spec.ts`.
    <div data-preference-row="" className="flex min-h-11 items-center gap-2 rounded-sm px-2 py-1.5">
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      {/*
        `aria-hidden`, because the group below already carries this exact text
        as its accessible name. Left exposed it would be read twice — once as
        a stray label, once as the group — which is the usual cost of pairing
        visible text with an `aria-label` rather than pointing at it.
      */}
      <span className="text-foreground shrink-0 text-sm" aria-hidden="true">
        {label}
      </span>

      <DropdownMenuRadioGroup
        aria-label={label}
        value={value}
        onValueChange={(next) => onValueChange(next as T)}
        // A hairline track, not a boxed control. The border and the fill were
        // doing the same job twice at a size where only one of them reads.
        className="bg-background ml-auto flex shrink-0 items-center rounded-md p-0.5"
      >
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              indicator="none"
              // Settings, not destinations — see the note above.
              {...(closeOnSelect ? {} : { onSelect: (event) => event.preventDefault() })}
              {...(option.description === undefined ? {} : { 'aria-label': option.description })}
              className={cn(
                // 1.75rem (28px) per segment. This was 40px, sized so the
                // TRACK alone would clear 44px — which made a two-line
                // preference block as tall as four menu items and gave an
                // account popover the weight of a settings page. The 44px rule
                // is met by the ROW that contains this, which is what a thumb
                // actually lands on; the segment itself only has to clear WCAG
                // 2.5.8's 24x24, and does.
                'min-h-7 justify-center rounded-[0.25rem] px-2 py-0 text-xs font-medium',
                'whitespace-nowrap transition-colors',
                selected
                  ? // Selection uses the neutral raised surface; blue remains
                    // reserved for links, indicators and focus rings.
                    'bg-surface-raised text-foreground focus:bg-surface-raised focus:text-foreground'
                  : 'text-muted-foreground focus:bg-accent focus:text-accent-foreground',
              )}
            >
              {option.label}
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
    </div>
  );
}
