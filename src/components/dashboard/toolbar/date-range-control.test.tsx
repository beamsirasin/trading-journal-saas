import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { DashboardDateRangeControl } from './date-range-control';

/**
 * `getPathname` is the locale prefixer the Dashboard state navigation uses.
 * Mocking it (rather than `window.location` alone) keeps the assertion on the
 * ABSTRACTION: these tests prove the picker hands a canonical href to
 * `useDashboardStateNavigation` exactly once, which is the property that has
 * to survive the eventual soft-navigation transport swap.
 */
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
}));

const assign = vi.fn();

/** A fixed "today" so every expected date in this file is stable. */
const TODAY = '2026-08-29';

function setViewport(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('48rem') ? isDesktop : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

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
      <DashboardDateRangeControl
        filters={state}
        todayDate={TODAY}
        dateLocale={locale === 'en' ? 'en-GB' : 'th'}
      />
    </NextIntlClientProvider>,
  );
}

function trigger() {
  return screen.getByRole('button', { name: /Date range:/ });
}

beforeEach(() => {
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { assign },
  });
  setViewport(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applied range label', () => {
  it('names each canonical preset in the reader locale, never a raw URL value', () => {
    const cases = [
      ['today', 'Today'],
      ['week', 'This week'],
      ['month', 'This month'],
      ['30d', 'Last 30 days'],
      ['90d', 'Last 90 days'],
      ['quarter', 'This quarter'],
      ['ytd', 'YTD'],
      ['all', 'All time'],
    ] as const;
    for (const [preset, label] of cases) {
      const { unmount } = renderControl(filters({ datePreset: preset }));
      expect(trigger()).toHaveTextContent(label);
      expect(trigger()).not.toHaveTextContent(preset === 'today' ? 'range=' : 'range=');
      unmount();
    }
  });

  it('reconstructs a custom label from the applied URL dates alone', () => {
    renderControl(
      filters({ datePreset: 'custom', customDateRange: { from: '2026-07-10', to: '2026-08-12' } }),
    );
    // Locale-aware, and the shared year is stated once.
    expect(trigger()).toHaveTextContent('10 Jul');
    expect(trigger()).toHaveTextContent('12 Aug 2026');
  });

  it('renders Thai copy', () => {
    renderControl(filters({ datePreset: '30d' }), 'th');
    expect(screen.getByRole('button', { name: /ช่วงเวลา:/ })).toHaveTextContent('30 วันล่าสุด');
  });
});

describe('draft editing performs no dashboard transition', () => {
  it('selects a preset into the draft without navigating', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());

    await user.click(await screen.findByRole('button', { name: 'Last 30 days' }));
    expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // The applied label has NOT moved, and nothing has navigated.
    expect(trigger()).toHaveTextContent('Last 90 days');
    expect(assign).not.toHaveBeenCalled();
  });

  it('builds a custom range across two calendar clicks without navigating', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());

    await user.click(await screen.findByRole('button', { name: /10 Jul 2026/ }));
    expect(screen.getByText('Select an end date')).toBeVisible();
    expect(assign).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /20 Jul 2026/ }));
    expect(screen.getByRole('button', { name: /10 Jul 2026, range start/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /20 Jul 2026, range end/ })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('orders an earlier second click rather than rejecting it', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /20 Jul 2026/ }));
    await user.click(screen.getByRole('button', { name: /10 Jul 2026/ }));
    expect(screen.getByRole('button', { name: /10 Jul 2026, range start/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /20 Jul 2026, range end/ })).toBeInTheDocument();
  });

  it('pages the months without navigating, keeping the pair adjacent', async () => {
    const user = userEvent.setup();
    const { container } = renderControl();
    await user.click(trigger());
    await waitFor(() => expect(container.ownerDocument.body).toBeTruthy());

    const months = () =>
      Array.from(document.querySelectorAll('[data-range-month]')).map((node) =>
        node.getAttribute('data-range-month'),
      );
    expect(months()).toEqual(['2026-07', '2026-08']);

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(months()).toEqual(['2026-06', '2026-07']);

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(months()).toEqual(['2026-08', '2026-09']);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('Apply', () => {
  it('commits a preset exactly once, through the canonical serializer', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'Last 30 days' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/en/app?range=30d&unit=r');
  });

  it('commits a custom range as inclusive local dates', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /10 Jul 2026/ }));
    await user.click(screen.getByRole('button', { name: /20 Jul 2026/ }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      '/en/app?range=custom&unit=r&from=2026-07-10&to=2026-07-20',
    );
  });

  it('carries every other applied dimension through untouched', async () => {
    const user = userEvent.setup();
    renderControl(
      filters({
        accountScope: { kind: 'all' },
        strategyId: '11111111-1111-4111-8111-111111111111',
        setupId: '22222222-2222-4222-8222-222222222222',
        unitMode: 'money',
      }),
    );
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'YTD' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(assign).toHaveBeenCalledWith(
      '/en/app?range=ytd&unit=money&account=all&strategy=11111111-1111-4111-8111-111111111111&setup=22222222-2222-4222-8222-222222222222',
    );
  });

  it('is disabled — and commits nothing — while a custom range has no end date', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: /10 Jul 2026/ }));

    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    await user.click(apply);
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('Clear', () => {
  it('sets the draft to All and still requires Apply', async () => {
    const user = userEvent.setup();
    renderControl(
      filters({ datePreset: 'custom', customDateRange: { from: '2026-07-10', to: '2026-08-12' } }),
    );
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // No transition yet — the frozen contract's whole point.
    expect(assign).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/en/app?range=all&unit=r');
  });
});

describe('dismissal discards the draft', () => {
  it('re-seeds from applied state when reopened after Escape', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    await user.click(await screen.findByRole('button', { name: 'Today' }));
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    });
    expect(assign).not.toHaveBeenCalled();

    await user.click(trigger());
    expect(await screen.findByRole('button', { name: 'Last 90 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('accessibility and truthfulness', () => {
  it('names every date cell with its full date and its selection state', async () => {
    const user = userEvent.setup();
    renderControl(
      filters({ datePreset: 'custom', customDateRange: { from: '2026-08-10', to: '2026-08-12' } }),
    );
    await user.click(trigger());
    expect(await screen.findByRole('button', { name: '10 Aug 2026, range start' })).toBeVisible();
    expect(screen.getByRole('button', { name: '11 Aug 2026, in selected range' })).toBeVisible();
    expect(screen.getByRole('button', { name: '12 Aug 2026, range end' })).toBeVisible();
  });

  it('marks today, and refuses dates after it', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    expect(await screen.findByRole('button', { name: '29 Aug 2026, today' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /30 Aug 2026, unavailable/ })).toBeDisabled();
  });

  it('does not use aria-current for a draft the dashboard has not adopted', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());
    const preset = await screen.findByRole('button', { name: 'Last 30 days' });
    await user.click(preset);
    expect(preset).toHaveAttribute('aria-pressed', 'true');
    expect(preset).not.toHaveAttribute('aria-current');
  });
});

describe('mobile surface', () => {
  beforeEach(() => setViewport(false));

  it('opens a dialog sheet rather than the desktop popover, with the same draft rules', async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(trigger());

    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Date range')).toBeVisible();
    // Two months, stacked — never one shrunken month.
    expect(sheet.querySelectorAll('[data-range-month]')).toHaveLength(2);
    expect(within(sheet).getByRole('button', { name: 'Clear' })).toBeVisible();
    expect(within(sheet).getByRole('button', { name: 'Apply' })).toBeVisible();

    await user.click(within(sheet).getByRole('button', { name: 'This quarter' }));
    expect(assign).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/en/app?range=quarter&unit=r');
  });
});
