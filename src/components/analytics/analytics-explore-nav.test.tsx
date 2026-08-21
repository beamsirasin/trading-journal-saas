import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function renderNav(search = '') {
  currentSearch = search;
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AnalyticsExploreNav />
    </NextIntlClientProvider>,
  );
}

describe('AnalyticsExploreNav', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

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
    renderNav('view=behavior');
    expect(screen.getByRole('link', { name: 'Behavior' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: 'Results' })).not.toHaveAttribute('aria-current');
  });

  it('scrolls to the matching anchor for a valid ?view=', () => {
    document.body.innerHTML = '<h2 id="analytics-setup-quality-heading">Edge Explore</h2>';
    renderNav('view=edge');
    expect(
      document.getElementById('analytics-setup-quality-heading')?.scrollIntoView,
    ).toHaveBeenCalled();
  });

  it('never crashes and never scrolls for an invalid ?view=', () => {
    document.body.innerHTML = '<h2 id="analytics-setup-quality-heading">Edge Explore</h2>';
    expect(() => renderNav('view=not-a-real-view')).not.toThrow();
    expect(
      document.getElementById('analytics-setup-quality-heading')?.scrollIntoView,
    ).not.toHaveBeenCalled();
  });
});
