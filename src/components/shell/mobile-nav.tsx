'use client';

import { Menu } from 'lucide-react';
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
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle asChild>
            <Brand href="/app" onClick={() => setOpen(false)} />
          </SheetTitle>
          <SheetDescription className="sr-only">
            Application sections. Every section is a preview built from demo data.
          </SheetDescription>
        </SheetHeader>
        <div className="p-3">
          <SidebarNav onNavigate={() => setOpen(false)} showDescriptions />
        </div>
      </SheetContent>
    </Sheet>
  );
}
