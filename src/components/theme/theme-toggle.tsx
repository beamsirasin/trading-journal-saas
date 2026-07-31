'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
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
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
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
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isHydrated = useIsHydrated();

  if (!isHydrated) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Change theme"
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Change theme, currently ${theme}`}>
          <ActiveIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            aria-current={theme === value}
            className="gap-2"
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{label}</span>
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
