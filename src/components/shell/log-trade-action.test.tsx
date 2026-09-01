import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { DesktopSidebar } from './desktop-sidebar';
import { LogTradeAction } from './log-trade-action';
import { NAV_ITEMS } from './nav-items';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/app',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderAction(
  props: Parameters<typeof LogTradeAction>[0] = {},
  locale: 'en' | 'th' = 'en',
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <LogTradeAction {...props} />
    </NextIntlClientProvider>,
  );
}

function renderSidebar(expanded: boolean, locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <DesktopSidebar expanded={expanded} />
    </NextIntlClientProvider>,
  );
}

describe('Log a trade — the shell action', () => {
  it('is named Log a trade, in journaling language', () => {
    renderAction();
    const action = screen.getByRole('link', { name: 'Log a trade' });
    expect(action).toBeVisible();
    // Not "Add Trade", and not an import of any kind.
    expect(screen.queryByText(/add trade/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/import/i)).not.toBeInTheDocument();
  });

  it('links to the existing recording route', () => {
    renderAction();
    expect(screen.getByRole('link', { name: 'Log a trade' })).toHaveAttribute(
      'href',
      '/app/trades/new',
    );
  });

  it('is a real link, so keyboard activation and focus come from the browser', () => {
    renderAction();
    const action = screen.getByRole('link', { name: 'Log a trade' });
    expect(action.tagName).toBe('A');
    // No `outline-none` anywhere: the base layer's focus-visible outline is
    // this control's focus indicator, exactly as it is for the rows below it.
    expect(action.className).not.toContain('outline-none');
  });

  it('takes no current-page state, because it is an action and not a destination', () => {
    renderAction();
    expect(screen.getByRole('link', { name: 'Log a trade' })).not.toHaveAttribute('aria-current');
  });

  it('translates', () => {
    renderAction({}, 'th');
    expect(screen.getByRole('link', { name: 'บันทึกออเดอร์' })).toBeVisible();
  });
});

describe('Log a trade — expanded rail', () => {
  it('renders above the navigation, outside the navigation landmark', () => {
    renderSidebar(true);
    const action = screen.getByRole('link', { name: 'Log a trade' });
    const nav = screen.getByRole('navigation', { name: 'Main' });

    // An action, not a sixth section.
    expect(nav.contains(action)).toBe(false);
    expect(within(nav).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);
    // And it comes first in reading and tab order.
    expect(action.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("wears the product's primary surface, with no new colour of its own", () => {
    const { container } = renderSidebar(true);
    const pill = container.querySelector('[data-log-trade-action="sidebar"] span[aria-hidden]');
    expect(pill?.className).toContain('bg-primary');
    expect(pill?.className).toContain('rounded-lg');
  });

  it('shows the visible label beside the icon', () => {
    renderSidebar(true);
    const action = screen.getByRole('link', { name: 'Log a trade' });
    expect(within(action).getByText('Log a trade')).toBeInTheDocument();
  });
});

describe('Log a trade — collapsed rail', () => {
  it('keeps an accessible name without a visible label', () => {
    // The label cell is clipped by the aside, not removed, so it remains the
    // link's accessible name — the collapsed control is never an unnamed icon.
    renderSidebar(false);
    expect(screen.getByRole('link', { name: 'Log a trade' })).toBeInTheDocument();
  });

  it("borrows the navigation rows' own grid, so the icon cannot drift off the rail", () => {
    const { container } = renderSidebar(false);
    const action = container.querySelector('[data-log-trade-action="sidebar"]');
    const navRow = screen.getByRole('link', { name: 'Dashboard' });

    // Identical column template: an icon cell exactly one rail-width wide.
    // This is what puts the plus on the established icon centre line.
    const columns = 'grid-cols-[var(--shell-rail-width)_var(--shell-secondary-nav-width)]';
    expect(action?.className).toContain(columns);
    expect(navRow.className).toContain(columns);
    // Same row height as a route, so the rail's rhythm is unchanged.
    expect(action?.className).toContain('h-11');
    expect(navRow.className).toContain('h-11');
  });

  it('leaves the sidebar geometry exactly as it was', () => {
    const { container: collapsed } = renderSidebar(false);
    const rail = collapsed.querySelector('aside');
    expect(rail?.className).toContain('w-[var(--shell-rail-width)]');
    expect(rail?.getAttribute('data-state')).toBe('rail');

    const { container: open } = renderSidebar(true);
    const panel = open.querySelector('aside');
    expect(panel?.className).toContain('w-[var(--shell-nav-open-width)]');
    expect(panel?.getAttribute('data-state')).toBe('expanded');
  });

  it("contracts its surface around the icon through the rail's own variable", () => {
    const { container } = renderSidebar(false);
    const pill = container.querySelector('[data-log-trade-action="sidebar"] span[aria-hidden]');
    // The same mechanism the nav pill uses — one idea of what collapsed means.
    expect(pill?.className).toContain('right-[var(--nav-pill-inset-right,0.5rem)]');
  });
});

describe('Log a trade — motion', () => {
  it('is restrained and drops out under prefers-reduced-motion', () => {
    const { container } = renderSidebar(true);
    const action = container.querySelector('[data-log-trade-action="sidebar"]');
    const pill = action?.querySelector('span[aria-hidden]');

    expect(pill?.className).toContain('duration-150');
    expect(pill?.className).toContain('group-active/logtrade:scale-[0.99]');
    expect(pill?.className).toContain('motion-reduce:transition-none');
    expect(pill?.className).toContain('motion-reduce:group-active/logtrade:scale-100');
  });
});

describe('Log a trade — drawer variant', () => {
  it('is a full-width thumb target matching the drawer rows', () => {
    renderAction({ variant: 'drawer' });
    const action = screen.getByRole('link', { name: 'Log a trade' });
    expect(action.className).toContain('min-h-[3.25rem]');
    expect(action.className).toContain('bg-primary');
  });

  it('closes the drawer through the navigation callback the rows already use', () => {
    const onNavigate = vi.fn();
    renderAction({ variant: 'drawer', onNavigate });
    screen.getByRole('link', { name: 'Log a trade' }).click();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe('the navigation beside it is unchanged', () => {
  it('still marks the current route, and only the current route', () => {
    renderSidebar(true);
    // `usePathname` is mocked at `/app`.
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['Trades', 'Accounts', 'Strategies', 'Analytics']) {
      expect(screen.getByRole('link', { name })).not.toHaveAttribute('aria-current');
    }
  });
});
