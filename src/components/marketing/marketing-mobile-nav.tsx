'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Brand } from '@/components/shell/brand';
import { LanguageSwitcher } from '@/components/shell/language-switcher';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Link } from '@/i18n/navigation';

import { MARKETING_NAV } from './nav';

/**
 * Public-site navigation drawer.
 *
 * Reuses the same Sheet primitive as the application shell, which is what
 * gives focus trapping, focus restoration and Escape handling for free — the
 * Phase 00b decision to use a real dialog primitive rather than a toggled div
 * pays for itself again here.
 *
 * Closing on navigation is explicit. Anchor links inside the drawer do not
 * unmount it (the page does not change), so without this the drawer would sit
 * over the section it just scrolled to.
 */
export function MarketingMobileNav() {
  const t = useTranslations('nav');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          aria-label={t('openMenu')}
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-80 max-w-[85vw] p-0" closeLabel={tCommon('close')}>
        <SheetHeader className="border-b p-4">
          <SheetTitle asChild>
            <Brand href="/" onClick={close} />
          </SheetTitle>
          <SheetDescription className="sr-only">{t('siteNavDescription')}</SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-muted-foreground text-xs">{t('siteNav')}</span>
          <LanguageSwitcher />
        </div>

        <nav aria-label={t('siteNav')} className="flex flex-col gap-1 p-3">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              {...(item.prefetch === false ? { prefetch: false } : {})}
              onClick={close}
              className="text-foreground hover:bg-accent flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors"
            >
              {t(item.labelKey)}
            </Link>
          ))}

          <div className="border-border mt-3 flex flex-col gap-2 border-t pt-4">
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link href="/login" onClick={close}>
                {t('login')}
              </Link>
            </Button>
            <Button asChild className="min-h-11 w-full">
              <Link href="/register" onClick={close}>
                {t('register')}
              </Link>
            </Button>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
