import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

const SECTIONS: Record<'actual' | 'system' | 'strategy' | 'entry' | 'review', ReactNode> = {
  actual: <p>Actual body</p>,
  system: <p>System body</p>,
  strategy: <p>Strategy body</p>,
  entry: <p>Entry body</p>,
  review: <p>Review body</p>,
};

function renderNav(search = '') {
  currentSearch = search;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeSectionNav
        tradeId="018f0000-0000-7000-8000-000000000001"
        statuses={ALL_COMPLETE}
        sections={SECTIONS}
      />
    </NextIntlClientProvider>,
  );
}

describe('TradeSectionNav', () => {
  it('renders all five section nav items with their short labels', () => {
    renderNav();
    expect(screen.getByRole('link', { name: /Actual/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /System/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Strategy & Setup/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Entry Snapshot/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review/ })).toBeInTheDocument();
  });

  it('shows only the default (Actual) section body when no ?section= is present — one thing at a time', () => {
    renderNav();
    expect(screen.getByText('Actual body')).toBeInTheDocument();
    expect(screen.queryByText('System body')).not.toBeInTheDocument();
    expect(screen.queryByText('Strategy body')).not.toBeInTheDocument();
    expect(screen.queryByText('Entry body')).not.toBeInTheDocument();
    expect(screen.queryByText('Review body')).not.toBeInTheDocument();
  });

  it('shows only the requested section body for a valid ?section=', () => {
    renderNav('section=system');
    expect(screen.getByText('System body')).toBeInTheDocument();
    expect(screen.queryByText('Actual body')).not.toBeInTheDocument();
  });

  it('falls back to the default section for an invalid ?section=, never crashing', () => {
    expect(() => renderNav('section=not-a-real-section')).not.toThrow();
    expect(screen.getByText('Actual body')).toBeInTheDocument();
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

  it('marks Actual as active by default when no ?section= is present', () => {
    renderNav();
    expect(screen.getByRole('link', { name: /Actual/ })).toHaveAttribute('aria-current', 'true');
  });

  it("renders each section's status badge, never colour-only", () => {
    renderNav();
    expect(screen.getByText('Closed')).toBeInTheDocument(); // actual: complete -> "Closed"
    expect(screen.getByText('Pending')).toBeInTheDocument(); // system: needs_attention -> "Pending"
    expect(screen.getByText('Strategy assigned')).toBeInTheDocument(); // strategy: partial
    expect(screen.getByText('Not recorded')).toBeInTheDocument(); // entry: not_recorded (shared default)
    expect(screen.getByText('Not recorded at entry')).toBeInTheDocument(); // review: shared default
  });
});
