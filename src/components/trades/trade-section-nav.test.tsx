import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StatusKind } from '@/lib/status/status-kind';

import en from '../../../messages/en.json';
import { TradeSectionNav } from './trade-section-nav';

let currentSearch = '';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/app/trades',
}));

const ALL_COMPLETE: Record<'actual' | 'system' | 'strategy' | 'entry' | 'review', StatusKind> = {
  actual: 'complete',
  system: 'needs_attention',
  strategy: 'partial',
  entry: 'not_recorded',
  review: 'not_recorded_at_entry',
};

function renderNav(search = '') {
  currentSearch = search;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeSectionNav tradeId="018f0000-0000-7000-8000-000000000001" statuses={ALL_COMPLETE} />
    </NextIntlClientProvider>,
  );
}

describe('TradeSectionNav', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders all five sections with their short labels', () => {
    renderNav();
    expect(screen.getByRole('link', { name: /Actual/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /System/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Strategy & Setup/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Entry Snapshot/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toBeInTheDocument();
  });

  it('renders each section’s status badge, never colour-only', () => {
    renderNav();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('Partially recorded')).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText('Not recorded at entry')).toBeInTheDocument();
  });

  it('builds hrefs that preserve existing query params and set the target section', () => {
    renderNav('month=2026-08&date=2026-08-21');
    const link = screen.getByRole('link', { name: /System/ });
    const href = link.getAttribute('href') ?? '';
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('month')).toBe('2026-08');
    expect(params.get('date')).toBe('2026-08-21');
    expect(params.get('trade')).toBe('018f0000-0000-7000-8000-000000000001');
    expect(params.get('section')).toBe('system');
  });

  it('marks the active section via aria-current and leaves others unmarked', () => {
    renderNav('section=system');
    expect(screen.getByRole('link', { name: /System/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: /Actual/ })).not.toHaveAttribute('aria-current');
  });

  it('scrolls the matching section into view for a valid ?section= value', () => {
    document.body.innerHTML = '<h3 id="trade-system">System Result</h3>';
    renderNav('section=system');
    expect(document.getElementById('trade-system')?.scrollIntoView).toHaveBeenCalled();
  });

  it('never crashes and never scrolls for an invalid ?section= value', () => {
    document.body.innerHTML = '<h3 id="trade-system">System Result</h3>';
    expect(() => renderNav('section=not-a-real-section')).not.toThrow();
    expect(document.getElementById('trade-system')?.scrollIntoView).not.toHaveBeenCalled();
  });

  it('leaves nothing active when no ?section= is present', () => {
    renderNav();
    for (const name of ['Actual', 'System', 'Strategy & Setup', 'Entry Snapshot', 'Review']) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });
});
