'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useId } from 'react';

import { cn } from '@/lib/utils';
import { useIsHydrated } from '@/hooks/use-is-hydrated';

const OPTIONS: readonly {
  value: string;
  labelKey: 'light' | 'dark' | 'system';
  hintKey: 'lightHint' | 'darkHint' | 'systemHint';
  Icon: LucideIcon;
}[] = [
  { value: 'light', labelKey: 'light', hintKey: 'lightHint', Icon: Sun },
  { value: 'dark', labelKey: 'dark', hintKey: 'darkHint', Icon: Moon },
  { value: 'system', labelKey: 'system', hintKey: 'systemHint', Icon: Monitor },
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
  const t = useTranslations('settings.appearance');
  const { theme, setTheme } = useTheme();
  const isHydrated = useIsHydrated();
  const name = useId();

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-foreground mb-1 text-sm font-medium">{t('theme')}</legend>

      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ value, labelKey, hintKey, Icon }) => {
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
                  <span className="text-foreground text-sm font-medium">{t(labelKey)}</span>
                </span>
                <span className="text-muted-foreground text-xs">{t(hintKey)}</span>
              </label>
            </div>
          );
        })}
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">{t('note')}</p>
    </fieldset>
  );
}
