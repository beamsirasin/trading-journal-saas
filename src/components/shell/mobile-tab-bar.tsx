'use client';

import { Ellipsis, PenLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Link, usePathname } from '@/i18n/navigation';

import { SHELL_DESKTOP_MEDIA_QUERY } from './constants';
import { LOG_TRADE_HREF } from './log-trade-action';
import {
  isNavItemActive,
  MOBILE_BAR_KEYS,
  MOBILE_MORE_KEYS,
  navItem,
  type NavItem,
} from './nav-items';

/*
  THE BAR'S STATE COLOURS. The active tab spends the accent where the desktop
  sidebar does — on its icon — and adds it to the label too, because a phone
  tab has no pill behind it to carry the state. Rest is muted and brightens on
  hover; neither state leans on colour alone, since the active label is also
  heavier.
*/
const ACTIVE = 'text-primary-text';
const ACTIVE_ICON = 'text-[var(--shell-nav-active-icon)]';
const REST = 'text-muted-foreground hover:text-foreground';

/**
 * THE MOBILE BOTTOM BAR — the application's navigation below `lg`.
 *
 *   Dashboard | Trades | Add Trade | Analytics | More
 *
 * It replaces the drawer the header's hamburger used to open: the core loop —
 * record, review, understand — is one tap away from anywhere instead of two,
 * and nothing covers two thirds of the screen to get there. At `lg` and above
 * it is not rendered visibly at all (`lg:hidden`, which also removes it from
 * the accessibility tree), and the desktop sidebar is the navigation: exactly
 * one `Main` landmark at every width.
 *
 * THREE KINDS OF THING, three semantics:
 *
 * - Dashboard, Trades, Analytics are DESTINATIONS: real links, icon and a
 *   visible label, and the current one carries `aria-current="page"`.
 * - Add Trade is an ACTION. It opens the existing recording flow at
 *   `/app/trades/new`, whose first step already asks At Entry or After Trade,
 *   so there is no chooser here. It never takes `aria-current` or a selected
 *   state — the bar is hidden on that route anyway. It is the bar's focal
 *   point: a round accent button that rises above the tabs' icon line while
 *   its label stays on the tabs' label line (see `ADD_TRADE_BUTTON`).
 * - More is a BUTTON that opens a sheet of the secondary destinations
 *   (Accounts, Strategies). While one of those is the page, More is lit so
 *   the reader can see where they are — but it takes no `aria-current`, since
 *   the current page is the link inside the sheet, which carries it there.
 *
 * Positioned `fixed` at `z-40`: above the sticky page toolbars (`z-30`),
 * below every Radix overlay (`z-50`), so the More sheet, the Trade details
 * sheet and every dialog cover it. It is a surface of its own — the card
 * plane, rounded top corners and an upward `shadow-bar` — rather than a
 * toolbar drawn on the page. It carries the bottom safe-area inset itself;
 * the workspace reserves `--shell-bottom-bar-clearance` (the surface plus the
 * Add Trade button's rise) plus the inset beneath its content (`ShellFrame`)
 * so nothing ever sits under it.
 */
export function MobileTabBar() {
  const t = useTranslations('appNav');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const [dashboard, trades, analytics] = MOBILE_BAR_KEYS.map(navItem) as [
    NavItem,
    NavItem,
    NavItem,
  ];
  const secondary = MOBILE_MORE_KEYS.map(navItem);
  const moreActive = secondary.some((item) => isNavItemActive(item, pathname));

  /*
    A portalled sheet outlives its trigger across the breakpoint: rotate a
    tablet past `lg` with More open and the bar disappears while its modal
    sheet stays, trapping focus beside a perfectly good sidebar. Close it on
    the crossing; the sheet cannot be opened above `lg`, where its trigger is
    hidden.
  */
  useEffect(() => {
    if (!moreOpen) return;
    const desktop = window.matchMedia(SHELL_DESKTOP_MEDIA_QUERY);
    function handleChange(event: MediaQueryListEvent) {
      if (event.matches) setMoreOpen(false);
    }
    desktop.addEventListener('change', handleChange);
    return () => desktop.removeEventListener('change', handleChange);
  }, [moreOpen]);

  return (
    // The bar's top hairline sits INSIDE --shell-bottom-bar-height (the list
    // is 1px shorter), so the surface is exactly that height.
    <nav
      aria-label={tNav('mainNav')}
      data-mobile-tab-bar=""
      className={cn(
        'bg-card border-border/60 shadow-bar fixed inset-x-0 bottom-0 z-40 rounded-t-3xl border-t lg:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="mx-auto grid h-[calc(var(--shell-bottom-bar-height)-1px)] max-w-xl grid-cols-5 px-1">
        <li className="min-w-0">
          <TabLink item={dashboard} active={isNavItemActive(dashboard, pathname)} />
        </li>
        <li className="min-w-0">
          <TabLink item={trades} active={isNavItemActive(trades, pathname)} />
        </li>
        <li className="min-w-0">
          <Link
            href={LOG_TRADE_HREF}
            aria-label={t('logTrade')}
            data-log-trade-action="bar"
            className={cn(TAB, 'text-foreground group/add')}
          >
            <span aria-hidden="true" className={ADD_TRADE_BUTTON}>
              <PenLine className="size-[1.375rem]" />
            </span>
            <span aria-hidden="true" className={cn(LABEL, 'font-semibold')}>
              {t('mobile.log')}
            </span>
          </Link>
        </li>
        <li className="min-w-0">
          <TabLink item={analytics} active={isNavItemActive(analytics, pathname)} />
        </li>
        <li className="min-w-0">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                data-more-active={moreActive ? '' : undefined}
                className={cn(TAB, moreActive ? ACTIVE : REST)}
              >
                <span aria-hidden="true" className={ICON_SLOT}>
                  <Ellipsis className={cn('size-6 transition-colors', moreActive && ACTIVE_ICON)} />
                </span>
                <span className={cn(LABEL, moreActive ? 'font-semibold' : 'font-medium')}>
                  {t('mobile.more')}
                </span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              closeLabel={tCommon('close')}
              className="gap-0 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="px-5 pt-5 pr-14 pb-2">
                <SheetTitle className="text-lg tracking-tight">{t('mobile.moreTitle')}</SheetTitle>
                <SheetDescription className="sr-only">
                  {t('mobile.moreDescription')}
                </SheetDescription>
              </SheetHeader>
              <ul className="flex flex-col gap-1 px-3 pb-2">
                {secondary.map((item) => (
                  <li key={item.key}>
                    <MoreLink
                      item={item}
                      active={isNavItemActive(item, pathname)}
                      onNavigate={() => setMoreOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            </SheetContent>
          </Sheet>
        </li>
      </ul>
    </nav>
  );
}

/*
  ONE TAB'S GEOMETRY, shared by links, the action and More so all five labels
  sit on one line: the full cell (at least 44x44) is the tap target, and the
  icon over a one-line label hangs from `pt-3`, leaving the generous room
  below the labels. No `outline-none` — the base layer's `:focus-visible`
  outline is the focus indicator, and it is independent of the active state.
*/
const TAB =
  'flex h-full min-h-11 w-full min-w-11 flex-col items-center justify-start gap-1 rounded-2xl px-0.5 pt-3 transition-colors motion-reduce:transition-none';
/* ONE ICON SLOT, shared by the four tabs: a 24px icon on the icon line. */
const ICON_SLOT = 'flex size-6 items-center justify-center';
/*
  THE ADD TRADE BUTTON grows UPWARD from the icon slot's bottom edge: 48px
  tall with `-mt-6` (48 − 24), so its label lands on the tabs' label line and
  the button rises 12px above the tabs' icon line — and 11px above the bar's
  top edge, which `--shell-bottom-bar-action-rise` reserves beneath the page.
  The `ring-card` collar joins it to the surface where it crosses the edge.
*/
const ADD_TRADE_BUTTON = cn(
  'bg-primary text-primary-foreground ring-card shadow-control -mt-6 flex size-12 shrink-0 items-center justify-center rounded-full ring-4',
  'group-hover/add:bg-primary-hover group-active/add:bg-primary-active',
  'transition-colors duration-150 motion-reduce:transition-none',
);
/*
  12px labels; below 360px wide (a 320px phone's 62px cells) they step down to
  11px so the active "Dashboard" — the widest, and semibold — still fits.
*/
const LABEL =
  'max-w-full truncate text-xs leading-4 whitespace-nowrap max-[359px]:text-[0.6875rem]';

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const t = useTranslations('appNav');
  const { href, key, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      data-tab={key}
      className={cn(TAB, active ? ACTIVE : REST)}
    >
      <span aria-hidden="true" className={ICON_SLOT}>
        <Icon className={cn('size-6 transition-colors', active && ACTIVE_ICON)} />
      </span>
      <span className={cn(LABEL, active ? 'font-semibold' : 'font-medium')}>
        {t(`items.${key}`)}
      </span>
    </Link>
  );
}

/** A secondary destination in the More sheet: a full-width row, with its one-line description. */
function MoreLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const t = useTranslations('appNav');
  const { href, key, Icon } = item;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 transition-colors motion-reduce:transition-none',
        active ? 'bg-primary/6 dark:bg-primary/10' : 'hover:bg-accent',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg',
          active ? ACTIVE_ICON : 'text-muted-foreground',
        )}
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            'text-[0.9375rem] leading-snug',
            active ? 'text-foreground font-semibold' : 'text-foreground font-medium',
          )}
        >
          {t(`items.${key}`)}
        </span>
        <span className="text-muted-foreground text-[0.8125rem] leading-snug">
          {t(`descriptions.${key}`)}
        </span>
      </span>
    </Link>
  );
}
