'use client';

import { PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { Link } from '@/i18n/navigation';

import { CollapsedFlyout, type SidebarNavVariant } from './sidebar-nav';

/** The route this action opens: the recording-mode choice, then the form. */
export const LOG_TRADE_HREF = '/app/trades/new';

/**
 * LOG A TRADE — the shell's one primary action.
 *
 * WHY IT SITS ABOVE THE NAVIGATION AND NOT IN IT. Logging a trade is the thing
 * a trader does most, and it is an ACTION rather than a destination: it does
 * not describe a place in the product the way Dashboard and Trades do, and it
 * must never look like a sixth section. So it lives above the list, outside
 * the navigation landmark, wearing the product's primary surface instead of a
 * navigation row's neutral one. It carries no `aria-current` and takes no
 * selected state, even on the page it opens — an action that dresses itself as
 * the current page teaches the reader to mistrust the states beside it.
 *
 * WHY IT BORROWS THE ROW'S GRID EXACTLY. On desktop this is the same two-cell
 * grid every nav row uses — an icon cell one rail-width wide, then a label
 * cell one secondary-panel-width wide. Reusing it, rather than laying out a
 * button, is the whole reason the plus lands precisely on the rail's existing
 * icon centre line and stays there when the panel opens: the columns are
 * fixed, so nothing about the sidebar's geometry or width changes because this
 * was added.
 *
 * WHY THE SURFACE IS A PILL AND NOT A BUTTON ELEMENT. The pill reads
 * `--nav-pill-inset-right`, the variable the aside already sets per state, so
 * collapsing contracts the primary surface around the icon exactly as it
 * contracts a nav row's — one mechanism, one behaviour, no second idea of what
 * "collapsed" means. A `<Button>` with its own padding would have put the icon
 * somewhere else entirely.
 *
 * There is no `outline-none` anywhere here: the base layer's `:focus-visible`
 * outline is this link's focus indicator, exactly as it is for the rows below.
 */
export function LogTradeAction({
  variant = 'sidebar',
  collapsed = false,
  onNavigate,
}: {
  variant?: SidebarNavVariant;
  /** Desktop only: the label cell is clipped, so hover and focus reveal it instead. */
  collapsed?: boolean;
  /** Called after navigation, so the mobile drawer can close itself. */
  onNavigate?: (() => void) | undefined;
}) {
  const t = useTranslations('appNav');
  const label = t('logTrade');
  const isDrawer = variant === 'drawer';

  // Measured from the control on reveal, in viewport coordinates — the same
  // approach and the same reasons as `NavRow`'s: the rail scrolls, so no
  // arithmetic gets this right, only the element's own box.
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [flyoutAt, setFlyoutAt] = useState<{ top: number; left: number } | null>(null);
  const revealsFlyout = !isDrawer && collapsed;

  const reveal = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setFlyoutAt({ top: rect.top, left: rect.left });
  }, []);
  const hide = useCallback(() => setFlyoutAt(null), []);

  // A fixed element is frozen to the viewport, so scrolling or resizing under
  // it would strand it over the workspace. Retract rather than follow.
  useEffect(() => {
    if (!revealsFlyout || flyoutAt === null) return;
    window.addEventListener('scroll', hide, { capture: true, passive: true });
    window.addEventListener('resize', hide, { passive: true });
    return () => {
      window.removeEventListener('scroll', hide, { capture: true });
      window.removeEventListener('resize', hide);
    };
  }, [revealsFlyout, flyoutAt, hide]);

  if (isDrawer) {
    return (
      <Link
        href={LOG_TRADE_HREF}
        data-log-trade-action="drawer"
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        className={cn(
          // The drawer row's own geometry — same height, radius and gutters as
          // a navigation row, so the action sits in the list's rhythm rather
          // than interrupting it. Full width, because a phone row is a thumb
          // target.
          'bg-primary text-primary-foreground flex min-h-[3.25rem] items-center gap-3 rounded-lg px-3 text-base font-semibold',
          'hover:bg-primary/90 active:scale-[0.99]',
          'transition-[background-color,transform] duration-150 ease-(--motion-ease-standard)',
          'motion-reduce:transition-none motion-reduce:active:scale-100',
        )}
      >
        <PenLine className="size-5 shrink-0" aria-hidden="true" />
        <span className="shrink-0 whitespace-nowrap">{label}</span>
      </Link>
    );
  }

  return (
    <Link
      ref={anchorRef}
      href={LOG_TRADE_HREF}
      data-log-trade-action="sidebar"
      {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
      {...(revealsFlyout
        ? {
            onPointerEnter: reveal,
            onPointerLeave: hide,
            // Focus is a first-class trigger, so a keyboard user tabbing the
            // collapsed rail gets what a pointer user gets.
            onFocus: reveal,
            onBlur: hide,
          }
        : {})}
      className={cn(
        'group/logtrade relative grid h-11 grid-cols-[var(--shell-rail-width)_var(--shell-secondary-nav-width)] items-center',
        'text-primary-foreground text-[0.9375rem] font-semibold',
      )}
    >
      {/*
        The primary surface, at row level and behind both cells — the nav
        pill's exact geometry, in the product's accent. `--nav-pill-inset-right`
        is set by the aside per state, so this contracts to a 3rem pill centred
        on the icon when the rail closes, precisely as a nav row's does.
      */}
      <span
        aria-hidden="true"
        className={cn(
          'bg-primary absolute inset-y-1 right-[var(--nav-pill-inset-right,0.5rem)] left-2 rounded-lg',
          'group-hover/logtrade:bg-primary/90 group-active/logtrade:scale-[0.99]',
          'transition-[background-color,transform] duration-150 ease-(--motion-ease-standard)',
          'motion-reduce:transition-none motion-reduce:group-active/logtrade:scale-100',
        )}
      />

      {/* Icon cell — over the rail's spine, on the same centre line as every route glyph. */}
      <span className="relative flex h-full items-center justify-center">
        <PenLine className="size-[1.15rem] shrink-0" aria-hidden="true" />
      </span>

      {/*
        Label cell — over the secondary panel, and clipped by the aside when
        the rail is closed. Clipped, not removed: it stays the link's
        accessible name at both widths, which is why the collapsed control is
        never an unnamed icon.
      */}
      <span className="relative flex h-full items-center pr-3">
        <span className="relative truncate">{label}</span>
      </span>

      {revealsFlyout && flyoutAt !== null ? (
        <CollapsedFlyout at={flyoutAt} label={label} Icon={PenLine} active={false} tone="primary" />
      ) : null}
    </Link>
  );
}
