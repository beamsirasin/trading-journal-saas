'use client';

import { Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Brand } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-80 max-w-[85vw] p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle asChild>
            <Brand href="/" />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Site navigation and account links.
          </SheetDescription>
        </SheetHeader>

        <nav aria-label="Site" className="flex flex-col gap-1 p-3">
          {MARKETING_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={close}
              className="text-foreground hover:bg-accent flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors"
            >
              {item.label}
            </Link>
          ))}

          <div className="border-border mt-3 flex flex-col gap-2 border-t pt-4">
            <Button asChild variant="outline" className="min-h-11 w-full">
              <Link href="/login" onClick={close}>
                Log in
              </Link>
            </Button>
            <Button asChild className="min-h-11 w-full">
              <Link href="/register" onClick={close}>
                Start free trial
              </Link>
            </Button>
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
