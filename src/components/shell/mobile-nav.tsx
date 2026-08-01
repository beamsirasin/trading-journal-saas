'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

import { Brand } from './brand';
import { LanguageSwitcher } from './language-switcher';
import { SidebarNav } from './sidebar-nav';

/**
 * Mobile navigation drawer.
 *
 * The Sheet handles focus trapping, focus restoration on close, and Escape —
 * which is the reason for using a real dialog primitive rather than toggling
 * a div. Closing on navigation is explicit: without it the drawer stays open
 * over the page the user just asked for.
 */
export function MobileNav() {
  const t = useTranslations('nav');
  const tAppNav = useTranslations('appNav');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);

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
      <SheetContent side="left" className="w-72 p-0" closeLabel={tCommon('close')}>
        <SheetHeader className="border-b p-4">
          <SheetTitle asChild>
            <Brand href="/app" onClick={() => setOpen(false)} />
          </SheetTitle>
          <SheetDescription className="sr-only">{tAppNav('drawerDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <span className="text-muted-foreground text-xs">{t('mainNav')}</span>
          <LanguageSwitcher />
        </div>
        <div className="p-3">
          <SidebarNav onNavigate={() => setOpen(false)} showDescriptions />
        </div>
      </SheetContent>
    </Sheet>
  );
}
