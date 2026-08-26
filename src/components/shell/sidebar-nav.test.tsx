import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode, Ref } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { NAV_ITEMS } from './nav-items';
import { SidebarNav, type SidebarNavVariant } from './sidebar-nav';

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

function renderNav(variant: SidebarNavVariant = 'sidebar', onNavigate?: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarNav variant={variant} {...(onNavigate ? { onNavigate } : {})} />
    </NextIntlClientProvider>,
  );
}

/** The desktop rail with its secondary panel closed — the flyout's only home. */
function renderCollapsed() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SidebarNav variant="sidebar" collapsed />
    </NextIntlClientProvider>,
  );
}

const flyoutIn = (link: HTMLElement) => link.querySelector('[data-nav-flyout]');

beforeEach(() => {
  pathname = '/app';
});

describe('SidebarNav — structure', () => {
  it('exposes exactly one navigation landmark, whatever the variant', () => {
    renderNav('sidebar');
    expect(screen.getAllByRole('navigation', { name: 'Main' })).toHaveLength(1);
  });

  it('renders every configured route, and nothing else', () => {
    renderNav('sidebar');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);

    for (const item of NAV_ITEMS) {
      const label = en.appNav.items[item.key];
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href', item.href);
    }
  });

  it('carries product destinations only — no Settings, in either variant', () => {
    // Settings moved to the account menu. The sidebar and the drawer both
    // render NAV_ITEMS wholesale, so membership is the single thing that
    // decides whether a route appears in navigation at all.
    for (const variant of ['sidebar', 'drawer'] as const) {
      const { unmount } = renderNav(variant);
      const nav = screen.getByRole('navigation', { name: 'Main' });

      expect(
        within(nav).queryByRole('link', { name: en.appNav.items.settings }),
      ).not.toBeInTheDocument();
      // By href too, so a renamed label cannot let the route back in quietly.
      expect(nav.querySelector('a[href="/app/settings"]')).toBeNull();
      unmount();
    }
  });

  it('renders ONE list, not a primary band and a utility band', () => {
    // The second band existed only to hold Settings, separated by a flexible
    // spacer and a rule. With one kind of entry left there is nothing to
    // separate, and a lone rule pinned to the bottom of an empty column is
    // just a line.
    renderNav('sidebar');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const lists = within(nav).getAllByRole('list');

    expect(lists).toHaveLength(1);
    expect(within(lists[0]!).getAllByRole('listitem')).toHaveLength(NAV_ITEMS.length);
  });
});

describe('SidebarNav — active route', () => {
  it('marks exactly one item as the current page', () => {
    pathname = '/app/trades';
    renderNav('sidebar');

    const current = screen
      .getByRole('navigation', { name: 'Main' })
      .querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/app/trades');
  });

  it('matches exactly, so a parent route does not light up on a child', () => {
    // `/app` is a prefix of every other route. With a `startsWith` match, two
    // items would claim `aria-current="page"` at once.
    pathname = '/app/analytics';
    renderNav('sidebar');

    expect(screen.getByRole('link', { name: en.appNav.items.overview })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByRole('link', { name: en.appNav.items.analytics })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('marks the last route current when it is open', () => {
    pathname = '/app/analytics';
    renderNav('sidebar');

    const current = screen
      .getByRole('navigation', { name: 'Main' })
      .querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute('href', '/app/analytics');
  });

  it('claims no current page on a route that is not in the navigation', () => {
    pathname = '/app/trades/new';
    renderNav('sidebar');

    expect(
      screen.getByRole('navigation', { name: 'Main' }).querySelectorAll('[aria-current="page"]'),
    ).toHaveLength(0);
  });

  it('signals the current route by more than colour', () => {
    // WCAG: selection must survive greyscale.
    //
    // The cue is a filled PILL that inactive rows do not have at all —
    // presence versus absence of a fill is a luminance difference, legible
    // without hue — reinforced by the label's weight. There is deliberately
    // no separate edge indicator: the reference marks the current route with
    // a pill and a coloured icon, and a bar on top of that is one cue too
    // many.
    pathname = '/app/trades';
    renderNav('sidebar');

    const active = screen.getByRole('link', { name: en.appNav.items.trades });
    const inactive = screen.getByRole('link', { name: en.appNav.items.accounts });

    expect(active.querySelector('[data-active-indicator]')).not.toBeNull();
    expect(inactive.querySelector('[data-active-indicator]')).toBeNull();
    // Weight, not just fill — the second non-hue cue.
    expect(active.className).toMatch(/font-semibold/);
    expect(inactive.className).not.toMatch(/font-semibold/);
  });

  it('renders each desktop route as ONE link across two cells', () => {
    // The two-layer look is presentation. Semantically there is exactly one
    // anchor per route, so there is one tab stop and one accessible name —
    // never a duplicate pair of icon and label links to the same page.
    pathname = '/app/trades';
    renderNav('sidebar');

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(nav.querySelectorAll('a')).toHaveLength(NAV_ITEMS.length);

    const trades = screen.getByRole('link', { name: en.appNav.items.trades });
    expect(trades).toHaveAttribute('href', '/app/trades');
    // The grid columns are the rail and the secondary panel, exactly — which
    // is what puts the icon on the rail's centre line and keeps it there.
    expect(trades.className).toContain(
      'grid-cols-[var(--shell-rail-width)_var(--shell-secondary-nav-width)]',
    );
  });

  it('paints the active surface across the whole row, icon included', () => {
    // The regression this guards: the pill used to be rendered inside the
    // LABEL cell, so the fill began at the rail's inner edge and the route
    // icon sat outside its own selection — the active item read as two
    // disconnected pieces. The indicator must be a direct child of the link,
    // i.e. a sibling of both cells rather than a descendant of one.
    pathname = '/app/trades';
    renderNav('sidebar');

    const active = screen.getByRole('link', { name: en.appNav.items.trades });
    const indicator = active.querySelector('[data-active-indicator]');
    expect(indicator).not.toBeNull();
    expect(indicator!.parentElement).toBe(active);
  });

  it('insets the expanded pill from both sidebar edges at pill height and radius', () => {
    // ~8px horizontal inset, 36px tall on a 44px row, 8px radius. The right
    // edge defers to `--nav-pill-inset-right`, which the aside sets per state
    // so the same row contracts to a compact pill around the icon when the
    // panel is closed.
    pathname = '/app/trades';
    renderNav('sidebar');

    const indicator = screen
      .getByRole('link', { name: en.appNav.items.trades })
      .querySelector('[data-active-indicator]');

    expect(indicator).toHaveClass('inset-y-1', 'left-2', 'rounded-lg');
    expect(indicator!.className).toContain('right-[var(--nav-pill-inset-right,0.5rem)]');
  });

  it('gives hover and focus the same row geometry as the active pill', () => {
    // Lower intensity, identical shape — nothing resizes or shifts as a row
    // goes resting -> hovered -> current.
    pathname = '/app/trades';
    renderNav('sidebar');

    const inactive = screen.getByRole('link', { name: en.appNav.items.accounts });
    const surface = inactive.querySelector('span[aria-hidden="true"]');
    expect(surface).not.toBeNull();
    expect(surface!.parentElement).toBe(inactive);
    expect(surface).toHaveClass('inset-y-1', 'left-2', 'rounded-lg');
    expect(surface!.className).toContain('group-hover/nav:bg-accent/70');
    expect(surface!.className).toContain('group-focus-visible/nav:bg-accent/70');
  });

  it('accents the active ICON, and leaves its label a plain bright neutral', () => {
    // The change this locks in: icon and label used to share one accent, on a
    // pill that was itself a heavy wash of blue — three blue things stacked.
    // Blue is now spent on the ICON alone, the smallest mark in the row; the
    // label is a high-contrast neutral and the pill under both is neutral too.
    // Drift back to a single shared token is the regression.
    for (const variant of ['sidebar', 'drawer'] as const) {
      pathname = '/app/trades';
      const { unmount } = renderNav(variant);

      const active = screen.getByRole('link', { name: en.appNav.items.trades });
      const icon = active.querySelector('svg');

      expect(active.className).toContain('text-[var(--shell-nav-active-foreground)]');
      expect(icon?.getAttribute('class')).toContain('text-[var(--shell-nav-active-icon)]');
      // TWO tokens, and they must stay different. If the icon ever resolved to
      // the label's token again, the row would be back to one flat accent.
      expect(icon?.getAttribute('class')).not.toContain(
        'text-[var(--shell-nav-active-foreground)]',
      );
      // Not --primary either: on a dark pill that value is too dim to clear
      // the 3:1 a non-text mark needs, which is why the icon has its own token.
      expect(active.className).not.toMatch(/text-primary/);
      expect(icon?.getAttribute('class')).not.toMatch(/text-primary/);

      unmount();
    }
  });

  it('leaves the active row its own font size, unmerged by the accent class', () => {
    // `text-[var(--x)]` is ambiguous with a font-size utility. If tailwind-merge
    // ever reclassified it, the active row would silently lose `text-[0.9375rem]`
    // and render at a different size from its neighbours.
    pathname = '/app/trades';
    renderNav('sidebar');

    expect(screen.getByRole('link', { name: en.appNav.items.trades }).className).toContain(
      'text-[0.9375rem]',
    );
  });

  it('keeps inactive rows neutral', () => {
    // The accent is the current route's alone. An inactive row is muted at
    // rest and rises only to plain foreground on hover.
    pathname = '/app/trades';
    renderNav('sidebar');

    const inactive = screen.getByRole('link', { name: en.appNav.items.accounts });
    expect(inactive.className).not.toContain('shell-nav-active-foreground');
    expect(inactive.className).toContain('text-muted-foreground');
    expect(inactive.querySelector('svg')?.getAttribute('class')).toContain('text-muted-foreground');
  });

  it('claims no current page while Settings is open, since it is not in the nav', () => {
    // Settings still has a route and is still reachable — from the account
    // menu — but nothing in this list should light up for it.
    pathname = '/app/settings';
    renderNav('sidebar');

    expect(screen.queryByRole('link', { current: 'page' })).not.toBeInTheDocument();
  });

  it('gives every route the same hover row', () => {
    pathname = '/app';
    renderNav('sidebar');

    const accounts = screen.getByRole('link', { name: en.appNav.items.accounts });
    const surface = accounts.querySelector('span[aria-hidden="true"]');
    expect(surface!.parentElement).toBe(accounts);
    expect(surface).toHaveClass('inset-y-1', 'left-2', 'rounded-lg');
    expect(surface!.className).toContain('group-hover/nav:bg-accent/70');
  });

  it('paints the active pill from a NEUTRAL surface token, not a blue tint', () => {
    // The most visible part of this pass. A pill that goes back to --primary
    // at any alpha puts the accent on an AREA again, which is the thing that
    // made the shell read as a generic blue admin template.
    pathname = '/app/trades';
    renderNav('sidebar');

    const pill = screen
      .getByRole('link', { name: en.appNav.items.trades })
      .querySelector('[data-active-indicator]');

    expect(pill?.getAttribute('class')).toContain('bg-[var(--shell-nav-active-surface)]');
    expect(pill?.getAttribute('class')).not.toMatch(/nav-active-tint/);
    expect(pill?.getAttribute('class')).not.toMatch(/bg-primary/);
  });

  it('renders one active indicator per rendered navigation, not one per item', () => {
    pathname = '/app';
    renderNav('sidebar');
    expect(document.querySelectorAll('[data-active-indicator]')).toHaveLength(1);
  });
});

describe('SidebarNav — labels', () => {
  /**
   * There is no icon-only state any more. The desktop sidebar hides entirely
   * rather than narrowing to a rail, so every row always carries its label and
   * no variant needs a tooltip or a substitute `aria-label` to name itself.
   */
  it('always shows a visible label beside every icon, in both variants', () => {
    for (const variant of ['sidebar', 'drawer'] as const) {
      const { unmount } = renderNav(variant);

      for (const item of NAV_ITEMS) {
        const link = screen.getByRole('link', { name: en.appNav.items[item.key] });
        expect(link).toHaveTextContent(en.appNav.items[item.key]);
        expect(link).toHaveAttribute('href', item.href);
        // The visible text IS the accessible name — nothing duplicates it.
        expect(link).not.toHaveAttribute('aria-label');
      }

      unmount();
    }
  });
});

describe('SidebarNav — navigation callback', () => {
  it('notifies the drawer after a route is chosen', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderNav('drawer', onNavigate);

    await user.click(screen.getByRole('link', { name: en.appNav.items.analytics }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('does not require the callback outside the drawer', async () => {
    const user = userEvent.setup();
    renderNav('sidebar');
    // No `onClick` is attached at all in this variant; clicking must not throw.
    await user.click(screen.getByRole('link', { name: en.appNav.items.accounts }));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});

describe('SidebarNav — collapsed rail flyout', () => {
  it('carries no native title, so the browser renders no tooltip', async () => {
    // The regression: `title` on the row made the OS draw a plain tooltip —
    // unstyled, on its own delay, outside the shell's visual language. The
    // flyout replaces it, and the attribute must not creep back.
    for (const collapsed of [true, false]) {
      const { unmount } = collapsed ? renderCollapsed() : renderNav('sidebar');
      for (const item of NAV_ITEMS) {
        expect(screen.getByRole('link', { name: en.appNav.items[item.key] })).not.toHaveAttribute(
          'title',
        );
      }
      unmount();
    }
  });

  it('reveals a flyout carrying BOTH the icon and the label on hover', async () => {
    const user = userEvent.setup();
    renderCollapsed();

    const accounts = screen.getByRole('link', { name: en.appNav.items.accounts });
    expect(flyoutIn(accounts)).toBeNull();

    await user.hover(accounts);

    const flyout = flyoutIn(accounts);
    expect(flyout).not.toBeNull();
    expect(flyout).toHaveTextContent(en.appNav.items.accounts);
    expect(flyout!.querySelector('svg')).not.toBeNull();
  });

  it('unmounts the flyout on pointer leave, leaving no hit area behind', async () => {
    // Not hidden — REMOVED. A `display:none` or transparent flyout parked
    // over the workspace is exactly the invisible overlay this must not have.
    const user = userEvent.setup();
    renderCollapsed();

    const accounts = screen.getByRole('link', { name: en.appNav.items.accounts });
    await user.hover(accounts);
    expect(flyoutIn(accounts)).not.toBeNull();

    await user.unhover(accounts);
    expect(flyoutIn(accounts)).toBeNull();
    expect(document.querySelectorAll('[data-nav-flyout]')).toHaveLength(0);
  });

  it('gives keyboard focus the same readable treatment as hover', async () => {
    // Real DOM focus, not a synthetic event: `onFocus` is wired to focusin,
    // and this is the path a tabbing keyboard user actually takes.
    renderCollapsed();
    const trades = screen.getByRole('link', { name: en.appNav.items.trades });

    await act(async () => {
      trades.focus();
    });
    expect(flyoutIn(trades)).toHaveTextContent(en.appNav.items.trades);

    await act(async () => {
      trades.blur();
    });
    expect(flyoutIn(trades)).toBeNull();
  });

  it('keeps the flyout out of the accessible name', async () => {
    // It duplicates the row's clipped label cell. Exposed, the link would be
    // announced "Accounts Accounts".
    const user = userEvent.setup();
    renderCollapsed();

    const accounts = screen.getByRole('link', { name: en.appNav.items.accounts });
    await user.hover(accounts);

    expect(flyoutIn(accounts)).toHaveAttribute('aria-hidden', 'true');
    // Still resolvable by its single, unduplicated name.
    expect(screen.getByRole('link', { name: en.appNav.items.accounts })).toBe(accounts);
  });

  it('reuses the nav pill language: same height, radius and type', async () => {
    const user = userEvent.setup();
    renderCollapsed();

    const accounts = screen.getByRole('link', { name: en.appNav.items.accounts });
    await user.hover(accounts);
    const flyout = flyoutIn(accounts)!;

    // h-9 (2.25rem) is the pill's height: the row's h-11 less inset-y-1.
    expect(flyout).toHaveClass('h-9', 'rounded-lg', 'text-[0.9375rem]');
    // Icon column = rail width less the flyout's own insets, which is what
    // lands its icon on the same centre line as the row's.
    expect(flyout.className).toContain('grid-cols-[calc(var(--shell-rail-width)-1rem)_auto]');
    // Opaque, because it floats over the workspace.
    expect(flyout.className).toContain('bg-sidebar');
  });

  it('keeps the hover flyout subtler than the active one', async () => {
    const user = userEvent.setup();
    pathname = '/app/trades';
    renderCollapsed();

    const active = screen.getByRole('link', { name: en.appNav.items.trades });
    const inactive = screen.getByRole('link', { name: en.appNav.items.accounts });

    await user.hover(inactive);
    const hoverTint = flyoutIn(inactive)!.querySelector('span')!;
    expect(hoverTint.className).toContain('bg-accent/70');
    await user.unhover(inactive);

    await user.hover(active);
    const activeFlyout = flyoutIn(active)!;
    expect(activeFlyout.querySelector('span')!.className).toContain(
      'bg-[var(--shell-nav-active-surface)]',
    );
    // The flyout is the in-rail row continued, so it speaks the same two-token
    // language: a neutral label on a neutral surface, blue kept for the icon.
    expect(activeFlyout.className).toContain('text-[var(--shell-nav-active-foreground)]');
  });

  it('covers every route in the list, with no route left tooltip-less', async () => {
    const user = userEvent.setup();
    renderCollapsed();

    for (const item of NAV_ITEMS) {
      const row = screen.getByRole('link', { name: en.appNav.items[item.key] });
      await user.hover(row);
      expect(flyoutIn(row)).toHaveTextContent(en.appNav.items[item.key]);
      await user.unhover(row);
    }
  });

  it('never reveals a flyout when the panel is open', async () => {
    // Expanded, the label is already on screen. A flyout would duplicate it.
    const user = userEvent.setup();
    renderNav('sidebar');

    for (const item of NAV_ITEMS) {
      await user.hover(screen.getByRole('link', { name: en.appNav.items[item.key] }));
    }
    expect(document.querySelectorAll('[data-nav-flyout]')).toHaveLength(0);
  });

  it('never reveals a flyout in the mobile drawer', async () => {
    const user = userEvent.setup();
    renderNav('drawer');

    for (const item of NAV_ITEMS) {
      await user.hover(screen.getByRole('link', { name: en.appNav.items[item.key] }));
    }
    expect(document.querySelectorAll('[data-nav-flyout]')).toHaveLength(0);
  });
});
