import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnalyticsUrlSelection } from '@/lib/analytics/url-filters';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';

import en from '../../../messages/en.json';
import { AnalyticsFilters } from './analytics-filters';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const options: AnalyticsFilterOptions = {
  accounts: [
    { tradingAccountId: 'account-a', name: 'Primary', isArchived: false },
    { tradingAccountId: 'account-old', name: 'Archive', isArchived: true },
  ],
  strategies: [
    { strategyId: 'strategy-a', label: 'Momentum', isArchived: false },
    { strategyId: 'strategy-b', label: 'Mean Reversion', isArchived: true },
  ],
  setups: [
    { setupId: 'setup-a', strategyId: 'strategy-a', label: 'Retest', isArchived: false },
    { setupId: 'setup-b', strategyId: 'strategy-b', label: 'Fade', isArchived: true },
  ],
  strategyVersions: [
    {
      strategyVersionId: 'version-a',
      strategyId: 'strategy-a',
      versionNumber: 1,
      strategyName: 'Momentum v1',
    },
    {
      strategyVersionId: 'version-b',
      strategyId: 'strategy-b',
      versionNumber: 2,
      strategyName: 'Mean Reversion v2',
    },
  ],
};

const selection: AnalyticsUrlSelection = {
  range: '90d',
  from: null,
  to: null,
  account: 'all',
  strategy: 'strategy-a',
  setup: 'setup-a',
  version: 'version-a',
};

function renderFilters(current: AnalyticsUrlSelection = selection) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AnalyticsFilters options={options} selection={current} view="overview" />
    </NextIntlClientProvider>,
  );
}

describe('AnalyticsFilters', () => {
  beforeEach(() => navigation.replace.mockReset());

  it('exposes only approved URL filters with archived historical options', () => {
    renderFilters();
    expect(screen.getByLabelText('Account')).toHaveValue('all');
    expect(screen.getByLabelText('Strategy')).toHaveValue('strategy-a');
    expect(screen.getByLabelText('Setup')).toHaveValue('setup-a');
    expect(screen.getByLabelText('Strategy Version')).toHaveValue('version-a');
    expect(screen.getByRole('option', { name: 'Archive · Archived' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Mean Reversion · Archived' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/symbol|direction/i)).not.toBeInTheDocument();
  });

  it('changes Strategy while retaining Account and clearing dependent Setup and Version', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Strategy'), { target: { value: 'strategy-b' } });
    expect(navigation.replace).toHaveBeenCalledWith(
      '/app/analytics?view=overview&range=90d&account=all&strategy=strategy-b',
    );
  });

  it('changes Account without clearing Strategy, Setup, or Version', () => {
    renderFilters();
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'account-old' } });
    expect(navigation.replace).toHaveBeenCalledWith(
      '/app/analytics?view=overview&range=90d&account=account-old&strategy=strategy-a&setup=setup-a&version=version-a',
    );
  });

  it('updates date range in the URL and exposes a canonical reset link', () => {
    renderFilters();
    expect(screen.getByRole('button', { name: '90D' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    expect(navigation.replace).toHaveBeenCalledWith(
      '/app/analytics?view=overview&range=30d&account=all&strategy=strategy-a&setup=setup-a&version=version-a',
    );
    expect(screen.getByRole('link', { name: /Reset filters/ })).toHaveAttribute(
      'href',
      '/app/analytics?view=overview',
    );
  });

  it('preserves custom dates across identity edits and removes them when a preset is selected', () => {
    renderFilters({
      ...selection,
      range: 'custom',
      from: '2026-07-10',
      to: '2026-08-12',
    });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'account-old' } });
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/app/analytics?view=overview&range=custom&from=2026-07-10&to=2026-08-12&account=account-old&strategy=strategy-a&setup=setup-a&version=version-a',
    );
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    expect(navigation.replace).toHaveBeenLastCalledWith(
      '/app/analytics?view=overview&range=30d&account=all&strategy=strategy-a&setup=setup-a&version=version-a',
    );
  });

  it('shows all Setup identities without Strategy and limits Versions by selected Setup', () => {
    renderFilters({ ...selection, strategy: null, version: null });
    expect(screen.getByRole('option', { name: 'Retest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Fade · Archived' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Momentum v1 · v1' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Mean Reversion v2 · v2' }),
    ).not.toBeInTheDocument();
  });
});
