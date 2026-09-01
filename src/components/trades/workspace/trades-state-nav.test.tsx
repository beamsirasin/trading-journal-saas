import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TradesStateFilter } from '@/lib/trades/state-filter';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { TradesStateNav } from './trades-state-nav';

let currentSearch = 'range=30d&account=all&strategy=strategy-1&setup=setup-1&unit=r';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/app/trades',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderNav(state: TradesStateFilter = 'all', locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'th' ? th : en}>
      <TradesStateNav state={state} />
    </NextIntlClientProvider>,
  );
}

function hrefFor(name: string): URLSearchParams {
  const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
  return new URLSearchParams(href.slice(href.indexOf('?') + 1));
}

describe('TradesStateNav — what replaced the Calendar / Trade Log switcher', () => {
  it('offers All, Open and Closed Trades, in that order', () => {
    renderNav();
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'All Trades',
      'Open Trades',
      'Closed Trades',
    ]);
  });

  it('offers no Calendar and no Trade Log mode', () => {
    renderNav();
    expect(screen.queryByRole('link', { name: 'Calendar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Trade Log' })).not.toBeInTheDocument();
  });

  it('keeps the labels unabbreviated at every width', () => {
    // The icon is what steps aside below `sm`, never the word a reader is
    // choosing between.
    renderNav();
    for (const label of ['All Trades', 'Open Trades', 'Closed Trades']) {
      expect(screen.getByRole('link', { name: label })).toBeVisible();
    }
    const icons = document.querySelectorAll('svg');
    for (const icon of icons) expect(icon.getAttribute('class')).toContain('hidden');
    for (const icon of icons) expect(icon.getAttribute('class')).toContain('sm:inline-block');
  });

  it('contains its own overflow rather than pushing the page sideways', () => {
    const { container } = renderNav();
    expect(container.firstElementChild?.className).toContain('overflow-x-auto');
  });
});

describe('TradesStateNav — accessibility', () => {
  it('marks the active state programmatically, not by fill alone', () => {
    renderNav('open');
    expect(screen.getByRole('link', { name: 'Open Trades' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'All Trades' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Closed Trades' })).not.toHaveAttribute('aria-current');
  });

  it('names the group and keeps every state keyboard-reachable and focusable', () => {
    renderNav();
    expect(screen.getByRole('navigation', { name: 'Trade population' })).toBeInTheDocument();
    for (const link of screen.getAllByRole('link')) {
      // Real links: keyboard operation and focus visibility come from the
      // browser, and every state has a visible focus ring.
      expect(link).toHaveAttribute('href');
      expect(link.className).toContain('focus-visible:ring-2');
    }
  });

  it('translates', () => {
    renderNav('closed', 'th');
    expect(screen.getByRole('link', { name: 'ออเดอร์ที่ปิดแล้ว' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('TradesStateNav — what each state preserves and what it resets', () => {
  it('preserves the Account, the Date Range and the other Filters', () => {
    currentSearch = 'range=30d&account=all&strategy=strategy-1&setup=setup-1&unit=r';
    renderNav();
    for (const label of ['All Trades', 'Open Trades', 'Closed Trades']) {
      const params = hrefFor(label);
      expect(params.get('range')).toBe('30d');
      expect(params.get('account')).toBe('all');
      expect(params.get('strategy')).toBe('strategy-1');
      expect(params.get('setup')).toBe('setup-1');
      expect(params.get('unit')).toBe('r');
    }
  });

  it('writes the population, and spells the default by omitting the key', () => {
    currentSearch = 'state=open';
    renderNav('open');
    expect(hrefFor('Closed Trades').get('state')).toBe('closed');
    expect(hrefFor('All Trades').get('state')).toBeNull();
  });

  it('resets the pager to the first page rather than stranding an invalid one', () => {
    currentSearch = 'range=30d&cursor=abc&trail=one,two';
    renderNav();
    const params = hrefFor('Open Trades');
    expect(params.get('cursor')).toBeNull();
    expect(params.get('trail')).toBeNull();
    // The range survives the reset.
    expect(params.get('range')).toBe('30d');
  });

  it('closes the Details sheet, which may hold a Trade outside the new population', () => {
    currentSearch = 'trade=trade-1&tab=review&section=actual';
    renderNav();
    const params = hrefFor('Closed Trades');
    expect(params.get('trade')).toBeNull();
    expect(params.get('tab')).toBeNull();
    expect(params.get('section')).toBeNull();
  });

  it('clears the Needs Attention bucket, so no impossible combination is one click away', () => {
    // `state=closed` with the `open` bucket can never match a Trade. Choosing a
    // population is a new question, not a refinement of a Dashboard drill-down.
    currentSearch = 'attention=open';
    renderNav();
    expect(hrefFor('Closed Trades').get('attention')).toBeNull();
    expect(hrefFor('Open Trades').get('attention')).toBeNull();
  });

  it('reduces to the bare route when nothing else is applied', () => {
    currentSearch = 'state=closed';
    renderNav('closed');
    expect(screen.getByRole('link', { name: 'All Trades' })).toHaveAttribute('href', '/app/trades');
  });
});
