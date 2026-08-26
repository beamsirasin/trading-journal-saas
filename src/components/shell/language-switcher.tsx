'use client';

import { ChevronDown, Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MenuSegmentedRow } from '@/components/ui/menu-segmented-row';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing, type AppLocale } from '@/i18n/routing';

const LOCALE_KEYS = { en: 'en', th: 'th' } as const satisfies Record<AppLocale, string>;

/**
 * Language selector.
 *
 * No hydration-placeholder trick, unlike `ThemeToggle`: the active locale
 * comes from the URL segment next-intl already resolved on the server, not
 * from `localStorage` or a media query, so it is identical on the server
 * render and the first client render — nothing to guess before hydration.
 *
 * Switching locale replaces the route rather than navigating to a new one:
 * `usePathname`/`useRouter` here are the locale-aware wrappers from
 * `@/i18n/navigation`, so `pathname` is already locale-free and passing
 * `{ locale }` to `router.replace` is what actually changes the URL prefix.
 * Query parameters are read separately and re-appended, because the locale
 * router's `pathname` argument does not carry them.
 *
 * Text only — "ไทย" / "English" — never a flag. A flag names a country, not
 * a language, and Thai is spoken well beyond Thailand's borders (and a
 * language selector is not the place to litigate which flag represents
 * "English").
 *
 * Three presentations, same options:
 *
 * `icon` — a 44px icon button for a dense header row, named by `aria-label`
 *          because there is no room for visible text. Still used by the
 *          PUBLIC marketing header, which has no account menu to put this in.
 * `row`  — a full-width labelled row for a settings surface, where the
 *          control has to say what it is. Its accessible name comes from its
 *          own visible text ("Language English") rather than an `aria-label`:
 *          when a control has a visible label, the accessible name must
 *          contain it (WCAG 2.5.3), or speech-input users cannot say what
 *          they see.
 * `menu` — an INLINE SEGMENTED ROW inside the account menu, which is where
 *          this lives in the authenticated shell at every width. Renders no
 *          trigger of its own: it is a radio group that must be composed
 *          inside a `DropdownMenu`, and it inherits that menu's roving-focus
 *          keyboard model. It used to be a `DropdownMenuSub` — the value was
 *          visible without opening anything, but changing it cost a second
 *          surface for a choice between exactly two options. Two options fit
 *          side by side; a submenu for them was one surface too many. See
 *          `MenuSegmentedRow`.
 */
export function LanguageSwitcher({ variant = 'icon' }: { variant?: 'icon' | 'row' | 'menu' }) {
  const t = useTranslations('languageSwitcher');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function selectLocale(next: AppLocale) {
    if (next === locale) return;
    const query = searchParams.toString();
    const href = query ? (`${pathname}?${query}` as typeof pathname) : pathname;
    startTransition(() => {
      router.replace(href, { locale: next });
    });
  }

  if (variant === 'menu') {
    return (
      <MenuSegmentedRow
        label={t('label')}
        Icon={Languages}
        value={locale as AppLocale}
        onValueChange={selectLocale}
        // Same order as `routing.locales`, so the segments match the one
        // declared list of supported locales rather than a second opinion
        // about which language comes first.
        options={routing.locales.map((option) => ({
          value: option,
          label: t(LOCALE_KEYS[option]),
        }))}
      />
    );
  }

  const options = routing.locales.map((option) => (
    <DropdownMenuItem
      key={option}
      onSelect={() => selectLocale(option)}
      aria-current={option === locale}
      className="gap-2"
    >
      <span>{t(LOCALE_KEYS[option])}</span>
      {option === locale ? (
        <span className="text-muted-foreground ml-auto text-xs" aria-hidden="true">
          ✓
        </span>
      ) : null}
    </DropdownMenuItem>
  ));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'row' ? (
          <Button
            variant="ghost"
            className="min-h-12 w-full justify-between gap-3 px-3 font-normal"
            disabled={isPending}
          >
            <span className="flex min-w-0 items-center gap-3">
              <Languages className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
              <span className="text-foreground truncate text-base font-medium">{t('label')}</span>
            </span>
            <span className="text-muted-foreground flex shrink-0 items-center gap-1">
              <span className="text-sm">{t(LOCALE_KEYS[locale as AppLocale])}</span>
              <ChevronDown className="size-4" aria-hidden="true" />
            </span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={`${t('label')}: ${t(LOCALE_KEYS[locale as AppLocale])}`}
            disabled={isPending}
          >
            <Languages className="size-4" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        {options}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
