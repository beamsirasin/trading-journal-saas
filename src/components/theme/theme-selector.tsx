'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useId } from 'react';

import { cn } from '@/lib/utils';
import { useIsHydrated } from '@/hooks/use-is-hydrated';

const OPTIONS: readonly { value: string; label: string; hint: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', hint: 'Always light', Icon: Sun },
  { value: 'dark', label: 'Dark', hint: 'Always dark', Icon: Moon },
  { value: 'system', label: 'System', hint: 'Follow this device', Icon: Monitor },
];

/**
 * Theme selection as a settings form control.
 *
 * The header toggle is for changing theme quickly; this is for seeing what
 * the current setting IS, which a single icon button cannot express. Both
 * write the same next-themes value, so they can never disagree.
 *
 * Three radios, not a switch: "System" is a distinct choice from "Light", and
 * a two-state control cannot represent "follow my OS" — dropping it regresses
 * anyone who schedules dark mode by time of day (ADR 0005).
 *
 * Renders inert until hydrated. The resolved theme depends on `localStorage`
 * and a media query, neither of which exists during SSR, so rendering a
 * checked state on the server would guarantee a hydration mismatch. The
 * placeholder keeps identical dimensions so nothing shifts when it swaps.
 */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const isHydrated = useIsHydrated();
  const name = useId();

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-foreground mb-1 text-sm font-medium">Theme</legend>

      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ value, label, hint, Icon }) => {
          const id = `${name}-${value}`;
          const checked = isHydrated && theme === value;

          return (
            <div key={value} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={value}
                checked={checked}
                disabled={!isHydrated}
                onChange={() => setTheme(value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors',
                  'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  'peer-disabled:cursor-progress peer-disabled:opacity-60',
                  checked
                    ? 'border-primary bg-accent'
                    : 'border-border bg-card hover:border-muted-foreground/40',
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon className="text-muted-foreground size-4" aria-hidden="true" />
                  <span className="text-foreground text-sm font-medium">{label}</span>
                </span>
                <span className="text-muted-foreground text-xs">{hint}</span>
              </label>
            </div>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Saved in this browser. Without an explicit choice, your device preference is used; with no
        device preference, the interface stays dark.
      </p>
    </fieldset>
  );
}
