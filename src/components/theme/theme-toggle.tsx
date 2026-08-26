'use client';

import { Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';

import { cn } from '@/lib/utils';
import { DEFAULT_THEME } from '@/components/theme/theme-contract';
import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useIsHydrated } from '@/hooks/use-is-hydrated';

type Theme = 'light' | 'dark';

/**
 * Theme control — TWO STATES.
 *
 * There is no "System" any more. It was a real third choice while it existed
 * (a switch cannot express "follow my OS"), but the product has removed the
 * mode outright: theme is Light or Dark, chosen explicitly, defaulting to
 * Dark. See `ThemeProvider`, which also migrates a legacy stored `system`.
 *
 * With two states the right control is a TOGGLE, not a picker. A three-way
 * segmented track was the correct shape for three values and the wrong one for
 * two — it spent a settings-form's worth of width restating a binary, and made
 * an account popover read like a preferences page.
 *
 * Renders an inert placeholder until hydrated: the resolved theme depends on
 * localStorage, which does not exist during SSR, so rendering the real icon
 * would guarantee a hydration mismatch. Every placeholder keeps its hydrated
 * counterpart's box so nothing shifts when it swaps.
 *
 * Three presentations, same two values:
 *
 * `icon` — a 44px icon button for a dense header row, named by `aria-label`
 *          because there is no room for visible text. Used by the PUBLIC
 *          marketing header, which has no account menu to put this in.
 * `row`  — a full-width labelled row for a settings surface, where the control
 *          has to say what it is. Its accessible name contains its visible
 *          label (WCAG 2.5.3), so a speech-input user can say what they see.
 * `menu` — a single row inside the account menu, which is where this lives in
 *          the authenticated shell at every width. It IS the menu item rather
 *          than a control nested inside one: a menu owns its own roving focus
 *          and closes on Tab, so anything focusable in there that is not a
 *          menu item is unreachable from the keyboard.
 */
export function ThemeToggle({ variant = 'icon' }: { variant?: 'icon' | 'row' | 'menu' }) {
  const t = useTranslations('settings.appearance');
  const { theme, setTheme } = useTheme();
  const isHydrated = useIsHydrated();
  const isRow = variant === 'row';
  const isMenu = variant === 'menu';

  // `theme` is the stored choice and the only one there is — with `enableSystem`
  // off, `resolvedTheme` can no longer differ from it, so the two-value read is
  // exact rather than a narrowing guess. Anything unrecognised (a legacy value
  // in a tab open across the migration) resolves to the product default.
  const current: Theme = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : DEFAULT_THEME;
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  const CurrentIcon = current === 'dark' ? Moon : Sun;
  const currentLabel = t(current);

  if (!isHydrated) {
    if (isMenu) {
      // The account menu's content only mounts when it is opened, so in
      // practice this is not reached — but it is reachable in principle, and a
      // row that vanished before hydration would be worse than an inert one.
      return (
        <div className="flex min-h-11 items-center gap-2 rounded-sm px-2 py-1.5" aria-hidden="true">
          <Moon className="text-muted-foreground size-4 shrink-0" />
          <span className="text-foreground shrink-0 text-sm">{t('theme')}</span>
          <span className="bg-muted border-border ml-auto h-6 w-11 shrink-0 rounded-full border" />
        </div>
      );
    }

    return isRow ? (
      // Same box as the hydrated row, so a settings page does not reflow when
      // the value appears. The value itself is deliberately absent rather than
      // guessed — showing "Light" and correcting it is worse than a beat of
      // nothing.
      <Button
        variant="ghost"
        className="min-h-12 w-full justify-between gap-3 px-3 font-normal"
        disabled
        aria-hidden="true"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Moon className="text-muted-foreground size-5 shrink-0" />
          <span className="text-foreground truncate text-base font-medium">{t('theme')}</span>
        </span>
      </Button>
    ) : (
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
        <Moon className="size-4" />
      </Button>
    );
  }

  /**
   * The accessible name, in every variant.
   *
   * It names the ACTION and states the CURRENT value — "Change theme,
   * currently Dark" — which is what a toggle has to say when it does not
   * change its own label. The visible label is "Theme", contained in that
   * string, so WCAG 2.5.3 holds.
   */
  const accessibleName = t('toggleLabelWithTheme', { theme: currentLabel });
  const toggle = () => setTheme(next);

  if (isMenu) {
    return (
      <DropdownMenuItem
        className="gap-2"
        aria-label={accessibleName}
        // Settings, not a destination: the menu stays open so the user sees
        // the theme change against the surface they are already looking at,
        // and can put it straight back if it was not what they meant.
        onSelect={(event) => {
          event.preventDefault();
          toggle();
        }}
      >
        <CurrentIcon className="size-4" aria-hidden="true" />
        <span>{t('theme')}</span>
        {/*
          A track and a knob, sized to a menu row rather than to a form. It is
          decorative — the row itself is the control, and it carries the name,
          the role and the tab stop — so all of this is hidden from assistive
          tech and the state is announced through `aria-label` instead.
        */}
        <span aria-hidden="true" className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-muted-foreground text-xs">{currentLabel}</span>
          <span
            className={cn(
              'border-border bg-muted relative flex h-6 w-11 items-center rounded-full border',
              'transition-colors',
            )}
          >
            <span
              className={cn(
                'bg-primary absolute flex size-4 items-center justify-center rounded-full',
                'transition-[left] duration-[var(--motion-feedback-duration)]',
                current === 'dark' ? 'left-[1.375rem]' : 'left-1',
              )}
            >
              <CurrentIcon className="text-primary-foreground size-2.5" />
            </span>
          </span>
        </span>
      </DropdownMenuItem>
    );
  }

  return isRow ? (
    <Button
      variant="ghost"
      className="min-h-12 w-full justify-between gap-3 px-3 font-normal"
      aria-label={accessibleName}
      onClick={toggle}
    >
      <span className="flex min-w-0 items-center gap-3">
        <CurrentIcon className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
        <span className="text-foreground truncate text-base font-medium">{t('theme')}</span>
      </span>
      <span className="text-muted-foreground shrink-0 text-sm">{currentLabel}</span>
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="icon"
      className="size-11"
      aria-label={accessibleName}
      onClick={toggle}
    >
      <CurrentIcon className="size-4" />
    </Button>
  );
}
