import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { DashboardFiltersControl } from './filters-control';

vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

const assign = vi.fn();

const MOMENTUM = '11111111-1111-4111-8111-111111111111';
const REVERSAL = '22222222-2222-4222-8222-222222222222';
const BREAKOUT_SETUP = '33333333-3333-4333-8333-333333333333';
const RETEST_SETUP = '44444444-4444-4444-8444-444444444444';
const FADE_SETUP = '55555555-5555-4555-8555-555555555555';
const MOMENTUM_V2 = '66666666-6666-4666-8666-666666666666';

const options: AnalyticsFilterOptions = {
  accounts: [],
  strategies: [
    { strategyId: MOMENTUM, label: 'Momentum', isArchived: false },
    { strategyId: REVERSAL, label: 'Reversal', isArchived: true },
  ],
  setups: [
    { setupId: BREAKOUT_SETUP, strategyId: MOMENTUM, label: 'Breakout', isArchived: false },
    { setupId: RETEST_SETUP, strategyId: MOMENTUM, label: 'Retest', isArchived: false },
    { setupId: FADE_SETUP, strategyId: REVERSAL, label: 'Fade', isArchived: false },
  ],
  strategyVersions: [
    {
      strategyVersionId: MOMENTUM_V2,
      strategyId: MOMENTUM,
      versionNumber: 2,
      strategyName: 'Momentum',
    },
  ],
};

function filters(overrides: Partial<DashboardFilterState> = {}): DashboardFilterState {
  return {
    datePreset: '90d',
    customDateRange: null,
    accountScope: { kind: 'active' },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    unitMode: 'r',
    dimensions: {
      symbol: null,
      side: null,
      session: null,
      timeframe: null,
      ruleAdherence: null,
      mistake: null,
      emotion: null,
    },
    ...overrides,
  };
}

function renderControl(state: DashboardFilterState = filters(), locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <DashboardFiltersControl filters={state} options={options} />
    </NextIntlClientProvider>,
  );
}

const trigger = () => screen.getByRole('button', { name: /^Filters\./ });

beforeEach(() => {
  assign.mockClear();
  Object.defineProperty(window, 'location', { writable: true, value: { assign } });
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('48rem'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
});

describe('trigger', () => {
  it('says how many filters are applied, and shows no badge when none are', () => {
    renderControl();
    expect(trigger()).toHaveAccessibleName('Filters. No filters applied');
    expect(trigger()).toHaveAttribute('data-filter-count', '0');
  });

  it('counts every applied dimension, including the advanced version override', () => {
    renderControl(
      filters({ strategyId: MOMENTUM, setupId: BREAKOUT_SETUP, strategyVersionId: MOMENTUM_V2 }),
    );
    expect(trigger()).toHaveAccessibleName('Filters. 3 filters applied');
    expect(trigger()).toHaveAttribute('data-filter-count', '3');
  });

  it('renders Thai copy', () => {
    renderControl(filters(), 'th');
    expect(screen.getByRole('button', { name: /ตัวกรอง/ })).toBeVisible();
  });
});

describe('Strategy to Setup dependency', () => {
  it('narrows the Setup list to the chosen Strategy', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());

    const setup = await screen.findByLabelText('Setup');
    expect(
      within(setup)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All setups', 'Breakout', 'Retest', 'Fade']);

    await user.selectOptions(screen.getByLabelText('Strategy'), MOMENTUM);
    expect(
      within(setup)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All setups', 'Breakout', 'Retest']);
  });

  it('clears an incompatible Setup and Version from the draft, not just from the list', async () => {
    const user = userEvent.setup();
    renderControl(
      filters({ strategyId: MOMENTUM, setupId: BREAKOUT_SETUP, strategyVersionId: MOMENTUM_V2 }),
    );
    await user.click(trigger());

    expect(await screen.findByLabelText('Setup')).toHaveValue(BREAKOUT_SETUP);
    await user.selectOptions(screen.getByLabelText('Strategy'), REVERSAL);
    expect(screen.getByLabelText('Setup')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    // No `setup` and no `version` survive the strategy change.
    expect(assign).toHaveBeenCalledWith(`/en/app?range=90d&unit=r&strategy=${REVERSAL}`);
  });

  it('marks archived options rather than hiding a filter that is genuinely applied', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    expect(await screen.findByRole('option', { name: 'Reversal · Archived' })).toBeInTheDocument();
  });
});

describe('draft and Apply', () => {
  it('changes nothing until Apply, then transitions exactly once', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());

    await user.selectOptions(await screen.findByLabelText('Strategy'), MOMENTUM);
    await user.selectOptions(screen.getByLabelText('Setup'), RETEST_SETUP);
    expect(assign).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      `/en/app?range=90d&unit=r&strategy=${MOMENTUM}&setup=${RETEST_SETUP}`,
    );
  });

  it('preserves the applied Date Range and Account through a filter change', async () => {
    const user = userEvent.setup();
    renderControl(
      filters({
        datePreset: 'custom',
        customDateRange: { from: '2026-07-10', to: '2026-08-12' },
        accountScope: { kind: 'all' },
      }),
    );
    await user.click(trigger());
    await user.selectOptions(await screen.findByLabelText('Strategy'), MOMENTUM);
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(assign).toHaveBeenCalledWith(
      `/en/app?range=custom&unit=r&from=2026-07-10&to=2026-08-12&account=all&strategy=${MOMENTUM}`,
    );
  });

  it('Clear empties the draft and still waits for Apply', async () => {
    const user = userEvent.setup();
    renderControl(filters({ strategyId: MOMENTUM, setupId: BREAKOUT_SETUP }));
    await user.click(trigger());

    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Strategy')).toHaveValue('');
    expect(screen.getByLabelText('Setup')).toHaveValue('');
    expect(assign).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/en/app?range=90d&unit=r');
  });

  it('discards the draft when the panel is dismissed', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.selectOptions(await screen.findByLabelText('Strategy'), MOMENTUM);
    await user.keyboard('{Escape}');
    expect(assign).not.toHaveBeenCalled();

    await user.click(trigger());
    expect(await screen.findByLabelText('Strategy')).toHaveValue('');
  });
});

describe('advanced Strategy Version', () => {
  it('reports a version override carried in by a link, and offers no editor for it', async () => {
    const user = userEvent.setup();
    renderControl(filters({ strategyId: MOMENTUM, strategyVersionId: MOMENTUM_V2 }));
    await user.click(trigger());
    expect(await screen.findByText(/strategy version override/i)).toBeVisible();
    expect(screen.queryByLabelText(/version/i)).not.toBeInTheDocument();
  });

  it('says nothing about versions when no override is applied', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await screen.findByLabelText('Strategy');
    expect(screen.queryByText(/strategy version override/i)).not.toBeInTheDocument();
  });
});

describe('Setup and Version must resolve to the same Strategy', () => {
  it('narrows Setups to a pinned Version strategy even when Strategy is omitted', async () => {
    const user = userEvent.setup();
    // A legitimate deep link: an advanced Version override with no Strategy.
    renderControl(filters({ strategyVersionId: MOMENTUM_V2 }));
    await user.click(trigger());

    const setup = await screen.findByLabelText('Setup');
    // Only Momentum's Setups are reachable; Reversal's "Fade" would build a
    // combination the DAL correctly rejects.
    expect(
      within(setup)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All setups', 'Breakout', 'Retest']);
  });
});
