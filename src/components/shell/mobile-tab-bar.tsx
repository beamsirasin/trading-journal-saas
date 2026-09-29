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
 *   Dashboard | Trades | Log | Analytics | More
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
 * - Log is an ACTION. It opens the existing recording flow at
 *   `/app/trades/new`, whose first step already asks At Entry or After Trade,
 *   so there is no chooser here. It never takes `aria-current` or a selected
 *   state — the bar is hidden on that route anyway — and its accessible name
 *   is the full "Log a trade", which begins with the visible "Log". It is
 *   marked by a compact accent capsule on the SAME baseline as the tabs, not
 *   a raised floating button.
 * - More is a BUTTON that opens a sheet of the secondary destinations
 *   (Accounts, Strategies). While one of those is the page, More is lit so
 *   the reader can see where they are — but it takes no `aria-current`, since
 *   the current page is the link inside the sheet, which carries it there.
 *
 * Positioned `fixed` at `z-40`: above the sticky page toolbars (`z-30`),
 * below every Radix overlay (`z-50`), so the More sheet, the Trade details
 * sheet and every dialog cover it. It carries the bottom safe-area inset
 * itself; the workspace reserves the same height plus inset beneath its
 * content (`ShellFrame`) so nothing ever sits under it.
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
    // is 1px shorter), so the bar is exactly the height the workspace reserves.
    <nav
      aria-label={tNav('mainNav')}
      data-mobile-tab-bar=""
      className={cn(
        'bg-background/95 border-border fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur lg:hidden',
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
            className={cn(TAB, 'text-foreground group/log')}
          >
            <span
              aria-hidden="true"
              className={cn(
                'bg-primary text-primary-foreground flex h-7 w-11 items-center justify-center rounded-full',
                'group-hover/log:bg-primary-hover group-active/log:bg-primary-active',
                'transition-colors duration-150 motion-reduce:transition-none',
              )}
            >
              <PenLine className="size-4" />
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
                  <Ellipsis className={cn('size-5 transition-colors', moreActive && ACTIVE_ICON)} />
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
  ONE TAB'S GEOMETRY, shared by links, the action and More so all five sit on
  one baseline: the full cell, at least 44x44, icon over a one-line label.
  `pb-2.5` biases the group upward inside the full-height cell, so the labels
  clear the bottom edge while the whole cell stays the tap target.
  No `outline-none` — the base layer's `:focus-visible` outline is the focus
  indicator, and it is independent of the active state.
*/
const TAB =
  'flex h-full min-h-11 w-full min-w-11 flex-col items-center justify-center gap-1 rounded-lg px-0.5 pb-2.5 transition-colors motion-reduce:transition-none';
/*
  ONE ICON SLOT, the height of Log's capsule (`h-7`), shared by every tab: the
  20px icons centre in it and the capsule fills it, so all five labels sit on
  one baseline without a Log-specific offset.
*/
const ICON_SLOT = 'flex h-7 items-center justify-center';
const LABEL = 'max-w-full truncate text-[0.6875rem] leading-none whitespace-nowrap';

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
        <Icon className={cn('size-5 transition-colors', active && ACTIVE_ICON)} />
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
