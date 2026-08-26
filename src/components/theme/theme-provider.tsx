'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

import { DEFAULT_THEME, THEME_STORAGE_KEY, THEMES } from './theme-contract';

/**
 * Theme precedence — TWO STATES, NO "SYSTEM".
 *
 *   1. an explicitly saved choice -> localStorage, applied as .light/.dark
 *   2. the product default        -> dark, from `defaultTheme` and from
 *                                    `:root` in globals.css
 *
 * `enableSystem` is off and there is no `prefers-color-scheme` block in
 * globals.css any more. The OS does not participate in this decision at any
 * layer: not in the provider, not in the stylesheet, not in the control. That
 * is a deliberate product change — a trading tool that is dark by default and
 * lets you say otherwise, rather than one that quietly follows a setting made
 * for a different application.
 *
 * THIS COMPONENT RENDERS NO SCRIPT OF ITS OWN, and must not be given one.
 * It briefly did, to migrate a legacy stored `system`, and that was wrong
 * twice over: a `<script>` element created by a client render never executes
 * its content, and React 19 says so out loud — "Encountered a script tag while
 * rendering React component". The migration now lives in `ThemeBootstrap`, a
 * SERVER component that both root layouts render as the first child of
 * `<body>` — ahead of this provider, and therefore ahead of next-themes' own
 * inline script further down the same document.
 *
 * next-themes injects that script itself, and it is what prevents a flash of
 * the wrong theme: it sets the class on `<html>` before first paint. That only
 * works because both root layouts set `suppressHydrationWarning` on `<html>` —
 * the script mutates the element before React hydrates, and without it React
 * reports a mismatch it cannot reconcile.
 *
 * `disableTransitionOnChange` suppresses colour transitions during a switch;
 * without it every themed surface cross-fades at once, which reads as a bug.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME}
      enableSystem={false}
      themes={[...THEMES]}
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
