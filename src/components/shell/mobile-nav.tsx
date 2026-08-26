'use client';

import { Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

import { SidebarNav } from './sidebar-nav';

/**
 * Mobile navigation drawer.
 *
 * The mobile face of the SAME surface the desktop sidebar is, and it moves
 * like it: `motion="shell"` puts the panel and its backdrop on the shell's
 * duration and easing (see globals.css) instead of the generic dialog motion,
 * and starts both below the global header. Crossing the breakpoint should
 * change how much fits on screen, not which product the user is in.
 *
 * What differs from desktop is deliberate and is the responsive decision
 * itself: the sidebar reflows the workspace beside it, whereas the drawer is
 * a temporary layer OVER a workspace that does not move. Squeezing a phone's
 * content sideways to make room for navigation would leave neither usable.
 *
 * The Sheet handles focus trapping, focus restoration on close, Escape, the
 * backdrop click, and locking background scroll — which is the reason for
 * using a real dialog primitive rather than toggling a div. Closing on
 * navigation is explicit: without it the drawer stays open over the page the
 * user just asked for.
 *
 * IT IS THE HEADER'S SURFACE, not the page's. The drawer hangs directly off
 * the global header and shares an edge with it the whole time it is open, so
 * `data-shell-chrome` puts it on the header's own deep palette in BOTH
 * themes — in light mode especially, a pale panel dropping out of a deep
 * navy bar read as two unrelated components bolted together. The scope
 * rebinds `--sidebar` and the nav accent tokens (globals.css), so `SidebarNav`
 * renders correctly here without being told which face it is on, and the
 * DESKTOP sidebar keeps its own light surface, untouched. See the
 * `[data-shell-chrome]` note in globals.css.
 *
 * Route rows use the `drawer` variant: bigger type and bigger targets than
 * the desktop sidebar, not smaller. Descriptions are deliberately gone — six
 * two-line rows read as a settings list, whereas six large single-line rows
 * read as navigation, and navigation is the only job this surface has.
 */
export function MobileNav() {
  const t = useTranslations('nav');
  const tAppNav = useTranslations('appNav');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
  }

  /**
   * Was this dismissal caused by a press on the header trigger itself?
   *
   * The drawer is modal, so Radix's dismissable layer treats every pointer
   * press outside the panel as a dismissal — including a press on the very
   * button that is supposed to toggle it. Left alone, that button would be
   * dismissed-then-clicked and the drawer would close and immediately reopen.
   * Suppressing the outside-dismiss for presses that land on the trigger
   * hands the decision to the trigger's own toggle, which is the one place
   * the open state should be decided. Every OTHER outside press still
   * dismisses exactly as before.
   */
  function isTriggerPress(target: EventTarget | null): boolean {
    return target instanceof Node && (triggerRef.current?.contains(target) ?? false);
  }

  /**
   * Close if the viewport grows past the desktop breakpoint while the drawer
   * is open.
   *
   * The drawer is a portalled dialog, so it does not disappear on its own
   * when its `lg:hidden` trigger does — the user would be left with a modal
   * overlay, a focus trap, and locked page scroll, but no visible way out
   * except Escape, next to a perfectly good sidebar that is now also on
   * screen. Rotating a tablet is enough to reach that state.
   *
   * The query MUST match the `lg` breakpoint the trigger and sidebar use;
   * they are two expressions of one decision about where mobile ends.
   *
   * Only the crossing is handled, never the current value: the drawer cannot
   * already be open above `lg`, because the only thing that opens it is a
   * trigger that is `lg:hidden` (and therefore not clickable or focusable)
   * at those widths. Checking `matches` on mount as well would be a
   * synchronous setState in an effect — a cascading render to defend against
   * a state the markup makes unreachable.
   */
  useEffect(() => {
    if (!open) return;

    const desktop = window.matchMedia('(min-width: 64rem)');

    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) setOpen(false);
    }

    desktop.addEventListener('change', handleChange);
    return () => desktop.removeEventListener('change', handleChange);
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/*
        ONE CONTROL, BOTH DIRECTIONS.

        `SheetTrigger` has always TOGGLED rather than merely opened — Radix's
        trigger calls `onOpenToggle` — and it is also what registers the
        trigger for `aria-expanded`, `aria-controls`, and focus restoration
        when the dialog unmounts. None of that should be hand-rolled. What
        stopped the toggle from working was the two lines below it, not the
        trigger:

          1. Radix parks `pointer-events: none` on the body while a modal is
             up, so the press never reached this button at all. It went to the
             dismissable layer instead, which closed the drawer — and then the
             next press reopened it, so the control appeared to work by
             accident while actually being operated as "click outside".
             `pointer-events-auto` opts this ONE control back in. That is
             legitimate here and nowhere else in the header: the drawer's
             backdrop deliberately starts BELOW the header, so this button is
             visibly un-dimmed and un-covered, and a visible, uncovered
             control that does nothing when pressed is the worst option on
             offer.

          2. With the press reaching the button, the dismissable layer would
             ALSO fire — close, then toggle back open. `isTriggerPress` below
             suppresses the outside-dismiss for presses that land here, so
             exactly one thing decides the state.

        The drawer's own X used to do the closing, which meant the bar the
        user pressed to get here could not take them back. Now it can.

        It stays a HAMBURGER in both states rather than morphing into an X.
        The header is the one part of this product that never moves; a glyph
        that swaps under the user's finger is exactly the kind of movement it
        promises not to make, and `aria-expanded` already carries the state
        for anyone who needs it stated.
      */}
      <SheetTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className="pointer-events-auto size-11 lg:hidden"
          // The one thing that changes between states. The GLYPH does not.
          aria-label={open ? tCommon('close') : t('openMenu')}
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        motion="shell"
        // THE HEADER'S PALETTE, on mobile only — this component is the only
        // place `SidebarNav` is rendered below `lg`. See the note above.
        data-shell-chrome
        className={cn(
          'bg-sidebar border-sidebar-border gap-0 p-0',
          // WIDTH. 15rem (240px) is the ceiling, and on a narrow phone the
          // viewport takes over: 5rem of the page always stays visible to the
          // right of the panel, dimmed but there.
          //
          //   320px -> 240px panel,  80px of page
          //   390px -> 240px panel, 150px of page
          //   430px -> 240px panel, 190px of page
          //   440px -> 240px panel, 200px of page
          //
          // That remaining strip is the whole point. It is what tells the user
          // this is a layer OVER their workspace rather than a new screen, and
          // it is where they will aim to dismiss it. Each pass has narrowed
          // this: `85%`/20rem gave a 390px phone a 332px panel that read as
          // the page itself; 18rem still took three-quarters of the screen for
          // five short words. At 240px the drawer is unmistakably a panel, and
          // more than a third of the workspace stays in view behind it.
          //
          // The floor is the LABELS, not a token. Minus the 0.75rem gutters
          // this leaves 216px of row, against a longest Thai label
          // ("การวิเคราะห์") that measures well inside it — so nothing wraps or
          // truncates in either locale, which is what stopped this going
          // narrower still.
          'w-[min(15rem,calc(100vw-5rem))] max-w-none sm:max-w-none',
        )}
        closeLabel={tCommon('close')}
        // No X. The header's hamburger is the close control now — see the
        // trigger note above — and the primitive's own button would sit in
        // the corner directly on top of the first navigation row anyway.
        showCloseButton={false}
        // A press on the header trigger belongs to the trigger, not to the
        // dismissable layer. Everything else outside still dismisses.
        onPointerDownOutside={(event) => {
          if (isTriggerPress(event.target)) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isTriggerPress(event.target)) event.preventDefault();
        }}
      >
        {/*
          The dialog's accessible name and description.

          Both visually hidden, and no visible header row at all any more.
          The wordmark is deliberately not repeated here: the drawer opens
          BELOW the global header, which carries the TradeChemist mark at
          every width and stays visible the whole time this is open, so a
          second wordmark would be the same brand twice, stacked, a few pixels
          apart. With the X gone too, the row that used to hold it would have
          been an empty bar with a rule under it.
        */}
        <SheetTitle className="sr-only">{tAppNav('drawerTitle')}</SheetTitle>
        <SheetDescription className="sr-only">{tAppNav('drawerDescription')}</SheetDescription>

        {/*
          Routes, and only routes.

          This used to end in a preferences band carrying language and theme,
          because below `lg` the drawer was the only place either could be
          reached. It is not any more: both moved into the account menu, which
          is in the header at every width — so a phone and a desktop now reach
          their preferences the same way, and this surface has exactly one job
          again. Settings left for the same menu, for the same reason.
        */}
        <div className="pb-safe flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
          <SidebarNav variant="drawer" onNavigate={close} />

          {/*
            A CLOSE CONTROL THAT IS NOT AN X.

            Removing the visible button removed a VISIBLE affordance, not the
            behaviour: Escape, the backdrop and the header's own hamburger all
            still dismiss. But two of those are invisible and the third is
            outside the dialog, which Radix hides from assistive technology
            for as long as the modal is up — so a screen reader user inside
            this drawer would have had Escape and nothing else to find.

            This is the same pattern as `SkipLink`: hidden until focused, then
            a real, visible, labelled button. Sighted pointer users never see
            it; anyone tabbing through gets an explicit way out, announced in
            its own words. It sits LAST so it does not stand between the user
            and the navigation they opened this for.
          */}
          {/*
            A PLAIN BUTTON, not the `Button` component. `Button` carries
            `min-h-11 min-w-11`, and a min-width beats `sr-only`'s `width:1px`
            — which would leave a 44x44 absolutely-positioned box parked over
            the first navigation row: invisible, but there. The whole point of
            this control is that it occupies nothing until it is focused.
          */}
          <SheetClose asChild>
            <button
              type="button"
              className={cn(
                'sr-only rounded-md text-sm font-medium',
                'focus-visible:not-sr-only focus-visible:mt-2 focus-visible:flex focus-visible:min-h-11',
                'focus-visible:w-full focus-visible:items-center focus-visible:justify-center',
                'focus-visible:bg-accent focus-visible:text-accent-foreground',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
              )}
            >
              {tCommon('close')}
            </button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
