import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Container } from '@/components/shell/container';

/**
 * THE DASHBOARD'S OWN CONTROL SURFACE — a band of the product shell, not a
 * card floating on the page.
 *
 * WHY IT IS FULL-BLEED AND NOT INSIDE THE PAGE CONTAINER. A sticky element
 * inset by the page gutters leaves two vertical strips of scrolling content
 * visible either side of it, so analytical cards slide past the bar's edges
 * as the reader scrolls. Spanning the workspace and putting the CONTENT in a
 * `Container` instead gives one honest horizontal rule under the bar while
 * keeping the title and controls in exact register with the cards below.
 *
 * WHY THE BORDER IS ALWAYS THERE. A bar that grows a border or a shadow the
 * moment it detaches needs a scroll listener, and every such implementation
 * shifts its own content by a pixel at the transition. A permanent hairline
 * plus an opaque page-coloured fill costs nothing, engages with zero
 * JavaScript, and never reflows. CLAUDE.md §8's "restrained" is the point:
 * there is no elevation here, only a surface boundary.
 *
 * WHY `top` SWITCHES AT `lg`. It tracks the global header's own height
 * tokens, which change at exactly that breakpoint (`ShellFrame`). Any other
 * breakpoint would leave a gap or an overlap between the two bars.
 *
 * A SERVER COMPONENT. Sticky positioning is CSS; the interactive controls
 * arrive as a slot and bring their own client boundary. The `<h1>` therefore
 * paints in the first byte of HTML, before the controls or the analytics
 * resolve — the page identifies itself immediately even on a cold load.
 */
export function DashboardToolbar({
  title,
  controls,
  className,
}: {
  title: string;
  /** The three controls, or their skeleton while the workspace options resolve. */
  controls: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-dashboard-toolbar=""
      className={cn(
        'bg-background border-border sticky z-30 w-full border-b',
        'top-[var(--shell-header-height-mobile)] lg:top-[var(--shell-header-height)]',
        className,
      )}
    >
      <Container width="canvas">
        {/*
          Two rows below `md`, one above it. The mobile row order is the
          priority order the reader needs — identity, then the control that
          moves every figure on the page.
        */}
        <div className="flex min-w-0 flex-col gap-2 py-3 md:h-16 md:flex-row md:items-center md:justify-between md:gap-4 md:py-0">
          <h1 className="text-foreground min-w-0 truncate text-base font-semibold tracking-tight md:text-lg">
            {title}
          </h1>
          <div className="flex min-w-0 items-center gap-2">{controls}</div>
        </div>
      </Container>
    </div>
  );
}

/**
 * Reserves the controls' exact geometry while the workspace's Account and
 * Strategy options resolve.
 *
 * Three blocks at the real 44px control height, not one wide bar: a skeleton
 * that collapsed into three buttons on arrival would move the sticky bar's
 * own height, and a bar that resizes under a reader who has already started
 * scrolling is worse than no skeleton at all.
 */
export function DashboardToolbarControlsSkeleton() {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-1 animate-pulse items-center gap-2">
      <div className="border-border bg-card h-11 min-w-0 flex-1 rounded-lg border md:w-40 md:flex-none" />
      <div className="border-border bg-card h-11 w-[4.5rem] rounded-lg border sm:w-28" />
      <div className="border-border bg-card h-11 w-[4.5rem] rounded-lg border sm:w-36" />
    </div>
  );
}
