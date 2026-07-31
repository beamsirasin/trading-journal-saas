'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

/**
 * Theme precedence (docs/design-system.md §3):
 *
 *   1. an explicitly saved choice   -> localStorage, applied as .light/.dark
 *   2. the OS preference            -> `enableSystem` resolves it
 *   3. the documented fallback      -> dark, from `:root` in globals.css
 *
 * next-themes injects a blocking script that sets the class BEFORE first
 * paint, which is what prevents a flash of the wrong theme. That only works
 * because the root layout sets `suppressHydrationWarning` on <html> — the
 * script mutates the element before React hydrates, and without it React
 * reports a mismatch it cannot reconcile.
 *
 * `disableTransitionOnChange` suppresses colour transitions during a switch;
 * without it every themed surface cross-fades at once, which reads as a bug.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="trading-os-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
