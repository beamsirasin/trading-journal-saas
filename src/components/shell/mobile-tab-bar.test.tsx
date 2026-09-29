import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { MobileTabBar } from './mobile-tab-bar';
import {
  isMobileBarHidden,
  isNavItemActive,
  isWithinRoute,
  MOBILE_BAR_KEYS,
  MOBILE_MORE_KEYS,
  NAV_ITEMS,
  navItem,
} from './nav-items';

let pathname = '/app';

function MockLink({
  href,
  children,
  ref,
  ...rest
}: { href: string; children?: ReactNode; ref?: Ref<HTMLAnchorElement> } & Record<string, unknown>) {
  return (
    <a ref={ref} href={href} {...rest}>
      {children}
    </a>
  );
}

vi.mock('@/i18n/navigation', () => ({
  Link: MockLink,
  usePathname: () => pathname,
}));

/** A controllable `matchMedia`, so the breakpoint crossing can be driven. */
let mediaListeners: ((event: MediaQueryListEvent) => void)[] = [];
beforeEach(() => {
  pathname = '/app';
  mediaListeners = [];
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        mediaListeners.push(listener);
      },
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
        mediaListeners = mediaListeners.filter((existing) => existing !== listener);
      },
      dispatchEvent: vi.fn(),
    }),
  });
});
afterEach(() => {
  mediaListeners = [];
});

function renderBar(locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <MobileTabBar />
    </NextIntlClientProvider>,
  );
}

const bar = () => screen.getByRole('navigation', { name: 'Main' });
const tab = (name: string) => within(bar()).getByRole('link', { name });
const more = () => within(bar()).getByRole('button', { name: 'More' });

describe('route matching', () => {
  it('matches whole segments, never a substring', () => {
    expect(isWithinRoute('/app/accounts', '/app/accounts')).toBe(true);
    expect(isWithinRoute('/app/accounts/new', '/app/accounts')).toBe(true);
    expect(isWithinRoute('/app/accounts/abc/edit', '/app/accounts')).toBe(true);
    expect(isWithinRoute('/app/accountsx', '/app/accounts')).toBe(false);
    expect(isWithinRoute('/app/trade', '/app/trades')).toBe(false);
  });

  it('matches the Dashboard exactly, and every other destination by its subtree', () => {
    const dashboard = navItem('overview');
    expect(isNavItemActive(dashboard, '/app')).toBe(true);
    expect(isNavItemActive(dashboard, '/app/trades')).toBe(false);
    expect(isNavItemActive(navItem('accounts'), '/app/accounts/new')).toBe(true);
    expect(isNavItemActive(navItem('strategies'), '/app/strategies')).toBe(true);
    expect(isNavItemActive(navItem('analytics'), '/app/analytics')).toBe(true);
  });

  it('hides the bar on focused workflows and everything below them, and nowhere else', () => {
    for (const route of [
      '/app/trades/new',
      '/app/trades/close',
      '/app/trades/after-trade',
      '/app/onboarding',
      '/app/checkout',
    ]) {
      expect(isMobileBarHidden(route), route).toBe(true);
    }
    for (const route of [
      '/app',
      '/app/trades',
      '/app/analytics',
      '/app/accounts',
      '/app/accounts/new',
      '/app/strategies',
      '/app/settings',
      '/app/plan',
      '/app/billing',
      '/app/trades-archive',
    ]) {
      expect(isMobileBarHidden(route), route).toBe(false);
    }
  });

  it('places every navigation destination exactly once: in the bar or behind More', () => {
    const placed = [...MOBILE_BAR_KEYS, ...MOBILE_MORE_KEYS].sort();
    expect(placed).toEqual(NAV_ITEMS.map((item) => item.key).sort());
  });
});

describe('MobileTabBar — structure', () => {
  it('is the Main navigation landmark, hidden at lg and above, fixed above page toolbars', () => {
    renderBar();
    expect(bar()).toHaveClass('lg:hidden', 'fixed', 'bottom-0', 'z-40');
    // The safe-area allowance is on the bar itself.
    expect(bar().className).toContain('pb-[env(safe-area-inset-bottom)]');
  });

  it('reads Dashboard | Trades | Add Trade | Analytics | More, in that order', () => {
    renderBar();
    const items = within(bar()).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Dashboard',
      'Trades',
      'Add Trade',
      'Analytics',
      'More',
    ]);
  });

  it('links each destination with an icon and a visible label', () => {
    renderBar();
    for (const [name, href] of [
      ['Dashboard', '/app'],
      ['Trades', '/app/trades'],
      ['Analytics', '/app/analytics'],
    ] as const) {
      const link = tab(name);
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveTextContent(name);
      expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('keeps every target at least 44x44', () => {
    renderBar();
    for (const control of [
      tab('Dashboard'),
      tab('Trades'),
      tab('Add Trade'),
      tab('Analytics'),
      more(),
    ]) {
      expect(control).toHaveClass('min-h-11', 'min-w-11');
    }
  });
});

describe('MobileTabBar — the current page', () => {
  it.each([
    ['/app', 'Dashboard'],
    ['/app/trades', 'Trades'],
    ['/app/analytics', 'Analytics'],
  ])('on %s marks %s, and only it, as the current page', (route, name) => {
    pathname = route;
    renderBar();
    const current = within(bar())
      .getAllByRole('link')
      .filter((link) => link.hasAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(name);
    expect(current[0]).toHaveAttribute('aria-current', 'page');
    expect(current[0]!.className).toContain('text-primary-text');
    expect(more()).not.toHaveAttribute('data-more-active');
  });

  it.each(['/app/accounts', '/app/accounts/new', '/app/accounts/acc-1/edit', '/app/strategies'])(
    'on %s lights More, without claiming aria-current for it',
    (route) => {
      pathname = route;
      renderBar();
      expect(more()).toHaveAttribute('data-more-active');
      expect(more().className).toContain('text-primary-text');
      expect(more()).not.toHaveAttribute('aria-current');
      expect(within(bar()).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
    },
  );

  it.each(['/app/settings', '/app/plan', '/app/billing'])(
    'on %s marks nothing: an account page is not a bar destination',
    (route) => {
      pathname = route;
      renderBar();
      expect(within(bar()).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
      expect(more()).not.toHaveAttribute('data-more-active');
    },
  );
});

describe('MobileTabBar — Add Trade', () => {
  it('is an action into the existing recording flow, named in full', () => {
    renderBar();
    const log = tab('Add Trade');
    // The first step of /app/trades/new already asks At Entry or After Trade.
    expect(log).toHaveAttribute('href', '/app/trades/new');
    expect(log).toHaveAttribute('data-log-trade-action', 'bar');
    // The visible word begins the accessible name (WCAG 2.5.3).
    expect(log).toHaveTextContent('Add Trade');
  });

  it.each(['/app', '/app/trades', '/app/trades/new', '/app/analytics'])(
    'never claims to be the current page (on %s)',
    (route) => {
      pathname = route;
      renderBar();
      expect(tab('Add Trade')).not.toHaveAttribute('aria-current');
    },
  );

  it('is a round accent button that rises from the icon line, its label on the tabs’ label line', () => {
    renderBar();
    const button = tab('Add Trade').querySelector('span[aria-hidden]')!;
    // 48px, grown upward by the 24px icon slot it replaces, so its label stays
    // on the tabs' label line — in the flow, never lifted out of it.
    expect(button).toHaveClass('bg-primary', 'size-12', '-mt-6', 'rounded-full');
    expect(tab('Add Trade').className).not.toMatch(/translate-y|absolute/);
  });
});

describe('MobileTabBar — More', () => {
  it('is a button that opens a sheet of the secondary destinations only', async () => {
    const user = userEvent.setup();
    renderBar();
    // Held from before opening: a modal sheet hides everything outside it
    // from assistive technology, the bar included, until it closes.
    const trigger = more();
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const links = within(sheet).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/app/accounts',
      '/app/strategies',
    ]);
    // Account and app preferences stay in the avatar menu.
    for (const name of [/settings/i, /plan/i, /language/i, /theme/i, /log out/i]) {
      expect(within(sheet).queryByRole('link', { name })).toBeNull();
      expect(within(sheet).queryByRole('button', { name })).toBeNull();
    }
  });

  it('closes on Escape and returns focus to More', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(more());
    await screen.findByRole('dialog', { name: 'More' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(more()).toHaveFocus();
  });

  it('closes when a destination is chosen', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(more());
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    await user.click(within(sheet).getByRole('link', { name: /Strategies/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('marks the current destination inside the sheet', async () => {
    pathname = '/app/accounts/new';
    const user = userEvent.setup();
    renderBar();
    await user.click(more());
    const sheet = await screen.findByRole('dialog', { name: 'More' });
    expect(within(sheet).getByRole('link', { name: /Accounts/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sheet).getByRole('link', { name: /Strategies/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('closes if the viewport grows past lg while it is open', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(more());
    await screen.findByRole('dialog', { name: 'More' });
    act(() => {
      for (const listener of [...mediaListeners]) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('MobileTabBar — Thai', () => {
  it('uses the Thai labels, and the Thai name for Add Trade', () => {
    renderBar('th');
    const nav = screen.getByRole('navigation', { name: th.nav.mainNav });
    expect(
      within(nav)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      th.appNav.items.overview,
      th.appNav.items.trades,
      th.appNav.mobile.log,
      th.appNav.items.analytics,
      th.appNav.mobile.more,
    ]);
    const log = within(nav).getByRole('link', { name: th.appNav.logTrade });
    // The visible word begins the accessible name here too.
    expect(th.appNav.logTrade.startsWith(th.appNav.mobile.log)).toBe(true);
    expect(log).toHaveTextContent(th.appNav.mobile.log);
  });
});
