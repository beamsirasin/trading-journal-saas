'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsHydrated } from '@/hooks/use-is-hydrated';

const OPTIONS = [
  { value: 'light', labelKey: 'light', Icon: Sun },
  { value: 'dark', labelKey: 'dark', Icon: Moon },
  { value: 'system', labelKey: 'system', Icon: Monitor },
] as const;

/**
 * Theme selector.
 *
 * Three explicit options rather than a two-state switch, because "system" is
 * a distinct choice from "light" — a switch cannot express "follow my OS",
 * and silently dropping that regresses anyone who schedules dark mode by time
 * of day.
 *
 * Renders an inert placeholder until hydrated: the resolved theme depends on
 * localStorage and an OS media query, neither of which exists during SSR, so
 * rendering the real icon would guarantee a hydration mismatch. The
 * placeholder keeps identical dimensions so nothing shifts when it swaps.
 */
export function ThemeToggle() {
  const t = useTranslations('settings.appearance');
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-11"
        aria-label={t('toggleLabel')}
        disabled
        // Hidden from assistive tech while inert, so it is not announced as a
        // broken control during the brief pre-hydration window.
        aria-hidden="true"
      >
        <Sun className="size-4" />
      </Button>
    );
  }

  const ActiveIcon = resolvedTheme === 'dark' ? Moon : Sun;
  const themeLabel = t((theme ?? 'system') as 'light' | 'dark' | 'system');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={t('toggleLabelWithTheme', { theme: themeLabel })}
        >
          <ActiveIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map(({ value, labelKey, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            aria-current={theme === value}
            className="gap-2"
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{t(labelKey)}</span>
            {theme === value ? (
              <span className="text-muted-foreground ml-auto text-xs" aria-hidden="true">
                ✓
              </span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
