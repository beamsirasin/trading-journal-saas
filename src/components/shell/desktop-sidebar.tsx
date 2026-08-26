'use client';

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

import { SIDEBAR_ELEMENT_ID } from './constants';
import { SidebarNav } from './sidebar-nav';

/**
 * Desktop navigation: one panel, two widths.
 *
 *   collapsed   | icons |                workspace
 *   expanded    | icons   labels |       workspace
 *
 * The icon column never moves: same x, same width, same glyph positions in
 * both states. Only the labels beside it are revealed or clipped, and the
 * workspace boundary follows. An earlier pass had a rail that stretched from
 * 72px to 240px — the whole panel morphed and the icons slid sideways, which
 * read as one shape-shifting box rather than a stable spine.
 *
 * ONE SURFACE. The icon column and the labels beside it are the same flat
 * colour — an earlier version painted the column a different shade, which made
 * the sidebar read as two panels bolted together instead of one component.
 *
 * HOW THE ICONS STAY PUT while the element around them changes width: every
 * nav row is a fixed two-column grid whose first column is exactly
 * `--shell-rail-width`, so an icon's position is decided by the grid and not
 * by the panel. The aside is what animates (rail width → rail + secondary),
 * and `overflow-clip` is what reveals or clips the second column.
 *
 * That clipping is load-bearing, not cosmetic: when collapsed, the label
 * cells are clipped OUT OF THE BOX, so there is no invisible 160px hit area
 * hanging over the workspace waiting to swallow clicks. The route stays one
 * link with one tab stop either way — see `SidebarNav`.
 *
 * NO HOVER PEEK. A previous pass expanded this on pointer proximity and
 * floated it over the content. Opening navigation is now a deliberate act:
 * the header toggle, nothing else. Brushing past the rail does nothing.
 *
 * Hidden outright below `lg` — a phone navigates through the drawer
 * (`MobileNav`); `hidden` also removes this from the accessibility tree, so
 * there is exactly one navigation landmark at every width.
 */
export function DesktopSidebar({ expanded }: { expanded: boolean }) {
  return (
    <aside
      id={SIDEBAR_ELEMENT_ID}
      data-state={expanded ? 'expanded' : 'rail'}
      className={cn(
        // One flat surface for the whole panel, icon column included.
        // `overflow-clip` clips the secondary panel away at the rail's
        // edge, and clips hit-testing with it, so the labels beyond 64px
        // cannot be seen OR clicked while the rail is closed.
        //
        // A `position: fixed` descendant still escapes it — that is what lets
        // a collapsed row's hover flyout reach past the rail. See
        // `CollapsedFlyout`.
        //
        // Unlike `hidden`, `clip` does not create a scroll container. A
        // 224px-wide row therefore cannot be dragged sideways inside the 64px
        // rail by `scrollIntoView`, imperative scrolling, or a horizontal
        // wheel gesture.
        'bg-sidebar border-sidebar-border fixed bottom-0 left-0 z-30 hidden flex-col overflow-clip border-r lg:flex',
        'transition-[width] duration-[var(--shell-motion-duration)] ease-[var(--shell-motion-easing)]',
        // How far the active pill reaches. Declared HERE rather than in the
        // row, because it is a fact about the panel's state and the rows
        // should not each have to know it.
        //
        // The pill spans the WHOLE row — icon cell and label cell — so this
        // inset is the only thing that changes between the two states. Open,
        // it holds 0.5rem clear of both panel edges. Closed, it stops 0.5rem
        // inside the rail's right edge, leaving a 3rem pill centred on the
        // same centre line the icon already sits on: the active surface
        // contracts around the glyph rather than being sliced off at the
        // clip edge.
        expanded
          ? 'w-[var(--shell-nav-open-width)] [--nav-pill-inset-right:0.5rem]'
          : 'w-[var(--shell-rail-width)] [--nav-pill-inset-right:calc(var(--shell-secondary-nav-width)+0.5rem)]',
      )}
      style={{ top: 'var(--shell-header-height)' } as CSSProperties}
    >
      {/*
        Laid out at the FULL open width regardless of how much is on screen,
        so nothing inside ever reflows, re-wraps or shifts as the panel opens.
        The rail is simply a narrower window onto the same layout.
      */}
      <div className="relative flex min-h-0 w-[var(--shell-nav-open-width)] flex-1 flex-col overflow-x-hidden overflow-y-auto py-3">
        {/*
          `collapsed` is what turns each row's clipped label into a hover/focus
          flyout. It is passed rather than read from a CSS var because the
          rows need it in JS: the flyout is mounted on demand, so that nothing
          of it — visible or invisible — exists over the workspace at rest.
        */}
        <SidebarNav variant="sidebar" collapsed={!expanded} />
      </div>
    </aside>
  );
}
