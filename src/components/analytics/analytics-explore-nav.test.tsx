import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { AnalyticsExploreNav } from './analytics-explore-nav';

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
  usePathname: () => '/app/analytics',
}));

function renderNav(search = '', view: 'overview' | 'results' | 'edge' | 'behavior' = 'overview') {
  currentSearch = search;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AnalyticsExploreNav view={view} />
    </NextIntlClientProvider>,
  );
}

describe('AnalyticsExploreNav', () => {
  it('renders all four views', () => {
    renderNav();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Results' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edge' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Behavior' })).toBeInTheDocument();
  });

  it('preserves existing filter query params in each view link', () => {
    renderNav('range=30d&account=all');
    const link = screen.getByRole('link', { name: 'Edge' });
    const params = new URLSearchParams(link.getAttribute('href')?.split('?')[1]);
    expect(params.get('range')).toBe('30d');
    expect(params.get('account')).toBe('all');
    expect(params.get('view')).toBe('edge');
  });

  it('marks the active view via aria-current', () => {
    renderNav('view=overview', 'behavior');
    expect(screen.getByRole('link', { name: 'Behavior' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Results' })).not.toHaveAttribute('aria-current');
  });

  it('uses the canonical Overview state independently of stale query text', () => {
    renderNav('view=not-a-real-view', 'overview');
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
});
