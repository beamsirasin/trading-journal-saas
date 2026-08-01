'use client';

import { Languages } from 'lucide-react';
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
 */
export function LanguageSwitcher() {
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label={`${t('label')}: ${t(LOCALE_KEYS[locale as AppLocale])}`}
          disabled={isPending}
        >
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        {routing.locales.map((option) => (
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
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
