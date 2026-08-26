/**
 * The theme contract, in the one module both sides of the boundary can import.
 *
 * Deliberately carries NO `'use client'` directive. The pre-paint bootstrap
 * (`ThemeBootstrap`) is a SERVER component and the provider
 * (`ThemeProvider`) is a client one; a shared constant that lived in either of
 * them would drag that file's environment along with it. Values only — no
 * React, no browser API touched at module scope.
 */

/** The one place the `localStorage` key is written. */
export const THEME_STORAGE_KEY = 'trading-os-theme';

/** Every theme the product offers. There is deliberately no `system`. */
export const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

/** What a visitor gets before they have ever chosen. */
export const DEFAULT_THEME: Theme = 'dark';

/**
 * Rewrites a legacy or unrecognised stored theme to the product default,
 * BEFORE next-themes reads storage.
 *
 * WHY IT MUST BE A BLOCKING SCRIPT. The product used to offer a System mode.
 * Anyone who chose it has the literal string `system` in `localStorage`, and
 * next-themes with `enableSystem={false}` does not know what to do with a
 * value outside its theme list: it applies the stored value as a class, so
 * those users would get `<html class="system">`, match no palette at all, and
 * fall through to whatever `:root` says — with no control on the page able to
 * explain or undo it. This runs first and turns the value into a real one, so
 * next-themes only ever sees `light` or `dark`.
 *
 * A `useEffect` could not do this job: it runs after hydration, which is
 * already several frames after the wrong class was painted.
 *
 * WHY IT MIGRATES TO DARK RATHER THAN TO THE OS PREFERENCE. "System" resolved
 * against `prefers-color-scheme`, so honouring that would preserve what those
 * users were SEEING. It would also silently re-create the mode that was
 * removed — a light-OS user would land in light and have no idea why, and the
 * next OS change would move their app again with no setting to point at. The
 * product now has exactly one default, and this puts them on it.
 *
 * An explicit `light` or `dark` is never touched, and a visitor who has chosen
 * NOTHING is left with nothing: writing a value here would freeze today's
 * default into their browser and make the next change of default require a
 * second migration.
 *
 * Emitted by `ThemeBootstrap`. It is a constant with no interpolation of
 * anything user-supplied — the two embedded values are the module constants
 * directly above, JSON-encoded.
 */
export const LEGACY_SYSTEM_MIGRATION = `(function(){try{var k=${JSON.stringify(
  THEME_STORAGE_KEY,
)};var v=localStorage.getItem(k);if(v!==null&&v!==${JSON.stringify(
  THEMES[0],
)}&&v!==${JSON.stringify(THEMES[1])}){localStorage.setItem(k,${JSON.stringify(
  DEFAULT_THEME,
)})}}catch(e){}})()`;
