'use client';

import { motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { LAYOUT_SPRING } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';
import { Link, usePathname } from '@/i18n/navigation';

import { NAV_ITEMS, type NavItem } from './nav-items';

/**
 * How the same navigation is presented in each of the two places it appears.
 * The list itself never changes — only its density does.
 *
 * `sidebar` — desktop. A fixed TWO-CELL GRID: an icon cell exactly one
 *             rail-width wide, then a label cell one secondary-panel-width
 *             wide. The row is one link spanning both cells, and its
 *             active/hover surface spans both too — one pill behind icon and
 *             label, never a fill that starts where the rail ends. When the
 *             panel is closed the aside clips the second cell away entirely,
 *             so no invisible hit area is left hanging over the workspace.
 * `drawer`  — mobile. Deliberately the LARGER of the two: a phone shows less
 *             at once, so the little it does show can afford to be bigger,
 *             and every row is a thumb target rather than a pointer target.
 *             Shrinking desktop type to fit a narrow screen is the mistake
 *             this variant exists to avoid. There is no rail on mobile, so
 *             this variant keeps its simpler icon-then-label row.
 */
export type SidebarNavVariant = 'sidebar' | 'drawer';

interface SidebarNavProps {
  variant?: SidebarNavVariant;
  /**
   * Desktop only: the secondary panel is closed, so labels are clipped and
   * each row reveals its own on hover/focus instead. The drawer ignores this.
   */
  collapsed?: boolean;
  /** Called after navigation, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}

/**
 * The one place Motion is used for navigation, and the justification:
 *
 * A shared `layoutId` makes the active indicator travel from the old item to
 * the new one. That movement communicates the relationship between the two
 * — you came from there, you are now here — which a hard cut cannot. It is
 * comprehension, not decoration.
 *
 * Reduced motion is handled by the SSR-safe preference hook, which swaps the
 * animated indicator for a static one so no layout spring is scheduled.
 *
 * Active matching is EXACT, not `startsWith`. With a prefix match `/app`
 * would light up on `/app/trades` and two items would claim to be the current
 * page, which `aria-current="page"` must never do.
 *
 * `usePathname` is the locale-aware wrapper from `@/i18n/navigation`, which
 * strips the `/en` or `/th` prefix before comparing — without that, this
 * match would silently fail in every non-default locale.
 *
 * ONE navigation landmark, ONE band. There used to be a second "utility"
 * band pinned to the bottom edge, holding Settings alone and separated by a
 * spacer and a rule — the shell's way of saying "these are places you work,
 * that is where you configure the product". Settings has moved to the account
 * menu, so the distinction no longer has two sides to draw, and the spacer,
 * the rule and the second list went with it. What is left is exactly the
 * product destinations, in one list, in one landmark.
 */
export function SidebarNav({
  variant = 'sidebar',
  collapsed = false,
  onNavigate,
}: SidebarNavProps) {
  const tNav = useTranslations('nav');

  return (
    <nav aria-label={tNav('mainNav')} className="flex min-h-0 flex-1 flex-col">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavRow
            key={item.href}
            item={item}
            variant={variant}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </nav>
  );
}

/**
 * The ACTIVE row, in two colours rather than one.
 *
 * These used to be a single constant: icon and label shared one accent, on a
 * pill that was itself a heavy wash of `--primary`. Three blue things,
 * stacked. The row now spends its accent where it buys the most and costs the
 * least — the ICON, the smallest mark in the row and the one the eye reaches
 * first — while the label is plain and bright, and the pill underneath both
 * is a neutral step up from the surface. Blue reads as emphasis again instead
 * of as a background.
 *
 * Both tokens are per-theme and measured against the pill they sit on — see
 * the note beside `--shell-nav-active-surface` in `globals.css`. The icon is
 * deliberately not `--primary`: on a dark pill that value is too dim to clear
 * the 3:1 a non-text mark needs.
 *
 * INACTIVE rows are untouched and stay neutral: `--muted-foreground` at rest,
 * `--foreground` on hover.
 */
const ACTIVE_LABEL = 'text-[var(--shell-nav-active-foreground)]';
const ACTIVE_ICON = 'text-[var(--shell-nav-active-icon)]';

function NavRow({
  item,
  variant,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  variant: SidebarNavVariant;
  collapsed: boolean;
  // Explicitly `| undefined` rather than only `?`: under
  // `exactOptionalPropertyTypes` this is forwarded from an optional prop, so
  // the absent case really does arrive as the value `undefined`.
  onNavigate?: (() => void) | undefined;
}) {
  const t = useTranslations('appNav');
  const pathname = usePathname();
  const prefersReducedMotion = usePrefersReducedMotion();

  const { href, key, Icon } = item;
  const isActive = pathname === href;
  const label = t(`items.${key}`);
  const isDrawer = variant === 'drawer';

  // Where the flyout should be painted, in VIEWPORT coordinates, or null when
  // it is not showing. Measured from the row on reveal rather than derived
  // from an index, because the two nav bands are separated by a flexible
  // spacer and the list can scroll — there is no arithmetic that gets this
  // right, only the row's own box.
  const rowRef = useRef<HTMLAnchorElement>(null);
  const [flyoutAt, setFlyoutAt] = useState<{ top: number; left: number } | null>(null);
  const revealsFlyout = !isDrawer && collapsed;

  const reveal = useCallback(() => {
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) setFlyoutAt({ top: rect.top, left: rect.left });
  }, []);
  const hide = useCallback(() => setFlyoutAt(null), []);

  // A fixed element is frozen to the viewport, so anything that moves the row
  // underneath it — scrolling the nav, resizing, or the panel being opened
  // while a row is hovered — would leave the flyout stranded. Retract it
  // instead of trying to follow: the pointer is about to be somewhere else
  // anyway, and a stale flyout over the workspace is the one outcome worth
  // ruling out.
  //
  // Nothing here clears the coordinate when the panel OPENS: the render below
  // is already gated on `revealsFlyout`, so a stale coordinate cannot paint
  // anything, and clearing it from an effect would be a state write on a
  // render pass that did not need one.
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
      <li>
        <Link
          href={href}
          // Spread rather than `onClick={onNavigate}` — exactOptionalPropertyTypes
          // distinguishes an absent prop from one explicitly set to undefined.
          {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
          aria-current={isActive ? 'page' : undefined}
          className={cn(
            // No `outline-none` here: the base layer's `:focus-visible` outline
            // IS this link's focus indicator, and suppressing it would leave
            // keyboard users with nothing.
            'group/nav relative flex min-h-[3.25rem] items-center gap-3 rounded-lg px-3 text-base transition-colors',
            isActive
              ? `${ACTIVE_LABEL} font-semibold`
              : 'text-muted-foreground hover:text-foreground font-medium',
          )}
        >
          <Pill active={isActive} variant={variant} prefersReducedMotion={prefersReducedMotion} />
          <Icon
            className={cn(
              'relative size-5 shrink-0 transition-colors',
              isActive ? ACTIVE_ICON : 'text-muted-foreground group-hover/nav:text-foreground',
            )}
            aria-hidden="true"
          />
          <span className="relative shrink-0 whitespace-nowrap">{label}</span>
        </Link>
      </li>
    );
  }

  return (
    <li>
      {/*
        ONE link, TWO cells. The grid columns are the rail width and the
        secondary panel width exactly, so the icon lands on the rail's centre
        line and the label lands on the panel — and neither moves by a pixel
        when the panel opens, because the columns are fixed and only the
        clipping changes.

        One anchor means one tab stop, one accessible name, and one entry in
        the accessibility tree per route. The two cells exist to place things,
        not to divide them: the active surface is painted once, at row level,
        underneath both.
      */}
      <Link
        ref={rowRef}
        href={href}
        {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
        aria-current={isActive ? 'page' : undefined}
        // NO `title`. It used to carry the label for the collapsed rail, and
        // the browser rendered it as a native tooltip — a plain white box, on
        // the OS's own delay, in the OS's own typography, with none of the
        // shell's visual language and no way to style it. The flyout below
        // replaces it outright. Removing it costs nothing accessible: the
        // real label is still in the row's second cell, merely clipped, so it
        // remains the link's accessible name either way.
        {...(revealsFlyout
          ? {
              onPointerEnter: reveal,
              onPointerLeave: hide,
              // Focus is a first-class trigger, not an afterthought — a
              // keyboard user tabbing the collapsed rail gets exactly the
              // treatment a pointer user gets.
              onFocus: reveal,
              onBlur: hide,
            }
          : {})}
        className={cn(
          'group/nav relative grid h-11 grid-cols-[var(--shell-rail-width)_var(--shell-secondary-nav-width)] items-center text-[0.9375rem] transition-colors',
          isActive
            ? `${ACTIVE_LABEL} font-semibold`
            : 'text-muted-foreground hover:text-foreground font-medium',
        )}
      >
        {/*
          The active/hover surface, at ROW level — behind BOTH cells, so the
          icon and the label share ONE pill. It used to live inside the label
          cell, which meant the fill began at the rail's inner edge and left
          the route glyph sitting outside its own selection: the current item
          read as two disconnected pieces rather than one row.
        */}
        <Pill active={isActive} variant={variant} prefersReducedMotion={prefersReducedMotion} />

        {/* Icon cell — sits over the rail's spine, above the pill. */}
        <span className="relative flex h-full items-center justify-center">
          <Icon
            className={cn(
              'relative size-[1.15rem] shrink-0 transition-colors',
              isActive ? ACTIVE_ICON : 'text-muted-foreground group-hover/nav:text-foreground',
            )}
            aria-hidden="true"
          />
        </span>

        {/*
          Label cell — sits over the secondary panel. `truncate` rather than
          wrap: a route that outgrows the panel should clip, not push the row
          to two lines and break the rhythm of the list.
        */}
        <span className="relative flex h-full items-center pr-3">
          <span className="relative truncate">{label}</span>
        </span>

        {revealsFlyout && flyoutAt !== null ? (
          <CollapsedFlyout at={flyoutAt} label={label} Icon={Icon} active={isActive} />
        ) : null}
      </Link>
    </li>
  );
}

/**
 * The collapsed rail's hover/focus flyout: the row's own label, revealed to
 * the RIGHT of the 64px rail and floating over the workspace.
 *
 * WHY IT IS `position: fixed`. The rail clips twice — `overflow-clip` on the
 * aside, and `overflow-y-auto` on the scrolling list inside it. The second is
 * the hard one: CSS forbids `overflow-x: visible` alongside a scrolling
 * y-axis, so NOTHING laid out inside that list can spill past 64px, at any
 * z-index. A fixed element escapes both, because its containing block is the
 * viewport rather than either clipper. That holds only while no ancestor
 * creates a containing block for fixed descendants — no `transform`,
 * `filter`, `will-change` or `contain` anywhere from `<body>` down to the
 * row. There is none today; adding one to the shell would silently trap this
 * back inside the rail.
 *
 * WHY IT IS A CHILD OF THE LINK rather than a portal. Hit-testing follows the
 * DOM, not the layout box, so a fixed child still counts as part of its
 * anchor: moving the pointer off the rail and onto the flyout never leaves
 * the row, so it does not flicker shut, and the label is clickable and
 * navigates like the rest of the row. A portal would need its own hover
 * bookkeeping and a bridge to survive the gap.
 *
 * WHY IT DOES NOT LEAVE A HIT AREA BEHIND. It is unmounted, not hidden, the
 * moment the pointer leaves or focus moves on. There is no
 * `pointer-events: none` overlay parked over the workspace and no invisible
 * 160px column — when the rail is at rest, nothing of this row exists past
 * 64px.
 *
 * WHY THE ICON DOES NOT MOVE. The flyout is laid out at its final size on the
 * first frame and only its CLIP animates, so the copy of the icon it carries
 * is painted exactly over the rail icon beneath it from the outset. The two
 * are in register because the flyout's icon column is the rail width less its
 * own 0.5rem insets, which centres on the same line the grid already puts the
 * real icon on.
 */
function CollapsedFlyout({
  at,
  label,
  Icon,
  active,
}: {
  at: { top: number; left: number };
  label: string;
  Icon: NavItem['Icon'];
  active: boolean;
}) {
  return (
    <span
      data-nav-flyout=""
      data-active={active ? '' : undefined}
      // The label is a VISUAL duplicate of the row's clipped label cell. Left
      // exposed it would be read twice, so the accessible name comes from the
      // real cell and this copy is hidden. `aria-hidden` on a clickable span
      // is fine here: it is not focusable, and the anchor around it is what
      // carries the role, the name and the tab stop.
      aria-hidden="true"
      style={{
        // Matches the pill's own inset so the flyout is the pill, continued:
        // 0.5rem in from the sidebar edge, 0.25rem in from the row's top.
        top: `calc(${at.top}px + 0.25rem)`,
        left: `calc(${at.left}px + 0.5rem)`,
      }}
      className={cn(
        // Above the sidebar (z-30) and the workspace, below the header (z-40)
        // — the header is chrome that outranks a transient hover surface.
        'fixed z-30 hidden lg:grid',
        'grid-cols-[calc(var(--shell-rail-width)-1rem)_auto] items-center',
        // Same height, radius and type as the row it grows out of.
        'h-9 rounded-lg pr-3 text-[0.9375rem]',
        // OPAQUE, because it floats over the workspace. The tint layer below
        // then reproduces the in-rail pill exactly on top of it, so the
        // flyout's colour is the pill's colour by construction rather than by
        // a hand-matched constant that could drift.
        'bg-sidebar shadow-popover',
        'animate-[nav-flyout-reveal_var(--motion-menu-enter-duration)_var(--motion-ease-standard)]',
        active ? `${ACTIVE_LABEL} font-semibold` : 'text-foreground font-medium',
      )}
    >
      <span
        className={cn(
          'absolute inset-0 rounded-lg',
          active ? 'bg-[var(--shell-nav-active-surface)]' : 'bg-accent/70',
        )}
      />
      <span className="relative flex items-center justify-center">
        <Icon className="size-[1.15rem] shrink-0" />
      </span>
      <span className="relative whitespace-nowrap">{label}</span>
    </span>
  );
}

/**
 * The active/hover background.
 *
 * A PILL, and deliberately no left indicator bar: the reference marks the
 * current route with a filled pill and a coloured icon, and an edge marker on
 * top of that is one cue too many. The pill still satisfies the requirement
 * that selection survive greyscale — a filled shape against an unfilled one
 * is a luminance difference, not a hue difference — and the icon's colour and
 * the label's weight reinforce it.
 *
 * It spans the WHOLE row in both variants — icon cell and label cell alike.
 * An earlier pass scoped the desktop pill to the label cell so the fill would
 * stop at the rail's inner edge; that left the route icon stranded outside
 * its own selected surface, and the active item read as two broken pieces
 * instead of one row.
 *
 * Hover and focus reuse this exact geometry at a lower intensity, so nothing
 * shifts or resizes as a row goes from resting to hovered to current — only
 * the fill's strength changes.
 */
function Pill({
  active,
  variant,
  prefersReducedMotion,
}: {
  active: boolean;
  variant: SidebarNavVariant;
  prefersReducedMotion: boolean | null;
}) {
  // GEOMETRY. The row is 2.75rem tall, so `inset-y-1` leaves a 2.25rem (36px)
  // pill; `left-2` is the matching 0.5rem horizontal inset, and `rounded-lg`
  // (8px) is the radius that reads as a pill at that height without tipping
  // into a capsule.
  //
  // How far right it reaches depends on whether the secondary panel is open,
  // which only the aside knows — hence `--nav-pill-inset-right`, set per
  // state there. Open, the pill holds 0.5rem clear of the panel's right edge
  // and runs under icon and label as one continuous shape. Closed, it stops
  // 0.5rem inside the rail, contracting to a 3rem pill centred on the icon
  // rather than being sliced off at the clip edge. Either way the icon is
  // INSIDE the surface, and the icon itself never moves — the grid columns
  // are fixed, so only the pill's right edge travels.
  const shape =
    variant === 'drawer'
      ? 'absolute inset-0 rounded-lg'
      : 'absolute inset-y-1 left-2 right-[var(--nav-pill-inset-right,0.5rem)] rounded-lg';

  if (!active) {
    // Hover/focus reuse `shape` VERBATIM — same inset, height and radius as
    // the active pill — so the whole row lights up, icon included, and
    // nothing moves or resizes as a row goes resting -> hovered -> current.
    // Collapsed, it inherits the same contracted geometry: the hover pill
    // shrinks around the icon exactly as the active one does.
    //
    // SUBTLER THAN ACTIVE, measured rather than eyeballed. Against the
    // sidebar's own luminance, this tint moves 54% as far as the active pill
    // does in dark and 45% in light — present enough to read as "clickable",
    // never enough to be mistaken for the current route, which additionally
    // carries an accent icon and label the hover state never borrows.
    //
    // Rendered as a SIBLING rather than a `hover:bg-*` on the link itself, so
    // it cannot paint over the active indicator during the layout spring,
    // which briefly overlaps two rows.
    return (
      <span
        className={cn(
          shape,
          'transition-colors',
          // Focus gets the tint as well as the base layer's outline, so a
          // keyboard user sees the row they are on and not merely a ring
          // around it.
          'group-hover/nav:bg-accent/70 group-focus-visible/nav:bg-accent/70',
        )}
        aria-hidden="true"
      />
    );
  }

  if (prefersReducedMotion) {
    return (
      <span
        data-active-indicator="static"
        className={cn(shape, 'bg-[var(--shell-nav-active-surface)]')}
        aria-hidden="true"
      />
    );
  }

  return (
    <motion.span
      data-active-indicator="animated"
      // Scoped per variant: the desktop sidebar stays mounted while the mobile
      // drawer is open, so a single shared id would leave Motion with two live
      // claimants on the same layout animation.
      layoutId={`sidebar-active-indicator-${variant}`}
      className={cn(shape, 'bg-[var(--shell-nav-active-surface)]')}
      transition={LAYOUT_SPRING}
      aria-hidden="true"
    />
  );
}
