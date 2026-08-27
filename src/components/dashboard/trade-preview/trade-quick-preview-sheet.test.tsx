import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TradeQuickPreviewModel } from '@/lib/dashboard/trade-preview';

import en from '../../../../messages/en.json';
import { TradeQuickPreviewSheet } from './trade-quick-preview-sheet';

const navigateDashboardState = vi.fn();

vi.mock('@/components/dashboard/dashboard-state-link', () => ({
  DashboardStateLink: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={`/en${href}`} {...rest}>
      {children}
    </a>
  ),
  useDashboardStateNavigation: () => navigateDashboardState,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function model(overrides: Partial<TradeQuickPreviewModel> = {}): TradeQuickPreviewModel {
  return {
    tradeId: 'trade-1',
    symbol: 'XAUUSD',
    direction: 'long',
    status: 'closed',
    systemStatus: 'resolved',
    tradingAccountName: 'Primary',
    tradingAccountBaseCurrency: 'USD',
    actualR: '2.0000',
    systemR: '3.0000',
    executionGapR: '-1.0000',
    enteredAt: '2026-03-05T02:00:00.000Z',
    exitedAt: '2026-03-05T06:00:00.000Z',
    systemExitedAt: '2026-03-05T07:00:00.000Z',
    timeframe: null,
    session: null,
    strategyName: null,
    strategyVersionNumber: null,
    setupName: null,
    plannedR: null,
    ruleChecks: [],
    mistakes: [],
    emotions: [],
    exits: [],
    closedBps: 10000,
    remainingBps: 0,
    tradingviewUrl: null,
    hasChartAttachment: false,
    notes: null,
    reviewNotes: null,
    confirmationNotes: null,
    tabs: ['overview'],
    ...overrides,
  };
}

function renderSheet(trade: TradeQuickPreviewModel) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeQuickPreviewSheet
        trade={trade}
        closeHref="/app?range=30d&month=2026-03&day=2026-03-05"
        timezone="Asia/Bangkok"
        dateLocale="en-GB"
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  navigateDashboardState.mockClear();
});

describe('Quick Preview sheet semantics', () => {
  it('is a labelled dialog naming the Trade', () => {
    renderSheet(model());
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/XAUUSD/);
  });

  /**
   * §18 — closing the Trade returns to the DAY, not to a bare Dashboard, so
   * the Day Review behind it stays open.
   */
  it('closes back to the Day Review that opened it', async () => {
    const user = userEvent.setup();
    renderSheet(model());
    await user.keyboard('{Escape}');
    expect(navigateDashboardState).toHaveBeenCalledWith(
      '/app?range=30d&month=2026-03&day=2026-03-05',
    );
  });

  it('offers a link into the Journal rather than editing in place', () => {
    renderSheet(model());
    expect(document.body.querySelector('[data-trade-preview-open-journal]')).toHaveAttribute(
      'href',
      '/app/trades?trade=trade-1',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});

describe('Quick Preview Overview', () => {
  /** §17 — the three attribution figures lead. */
  it('leads with Actual R, System R and the Execution Gap', () => {
    renderSheet(model());
    const results = document.body.querySelector('[data-trade-preview-results]') as HTMLElement;
    expect(within(results).getByText('Actual R')).toBeInTheDocument();
    expect(within(results).getByText('System R')).toBeInTheDocument();
    expect(within(results).getByText('Execution Gap')).toBeInTheDocument();
    expect(results).toHaveTextContent('+2.00R');
    expect(results).toHaveTextContent('+3.00R');
    expect(results).toHaveTextContent('-1.00R');
  });

  it('shows a dash rather than a fabricated Gap while a side is incomplete', () => {
    renderSheet(model({ systemStatus: 'pending', systemR: null, executionGapR: null }));
    const results = document.body.querySelector('[data-trade-preview-results]') as HTMLElement;
    expect(results).not.toHaveTextContent('0.00R');
    expect(results.textContent).toContain('—');
  });

  it('carries the Trade identity and context after the figures', () => {
    renderSheet(model());
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getAllByText('Primary').length).toBeGreaterThan(0);
    expect(screen.getByText('System exit')).toBeInTheDocument();
  });
});

describe('Quick Preview tabs', () => {
  it('renders no tablist when a Trade only supports the Overview', () => {
    renderSheet(model());
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('exposes one tab per supported section and selects Overview first', () => {
    renderSheet(model({ tabs: ['overview', 'strategy', 'notes'], reviewNotes: 'Chased it.' }));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Strategy', 'Notes']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  /** §26 — tabs must be keyboard-operable. */
  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    renderSheet(model({ tabs: ['overview', 'notes'], reviewNotes: 'Chased it.' }));
    const [overview] = screen.getAllByRole('tab');
    overview?.focus();
    await user.keyboard('{ArrowRight}');
    const notes = screen.getAllByRole('tab')[1];
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Chased it.')).toBeInTheDocument();
  });

  it('shows the selected panel content when a tab is clicked', async () => {
    const user = userEvent.setup();
    renderSheet(
      model({
        tabs: ['overview', 'strategy'],
        strategyName: 'Momentum',
        strategyVersionNumber: 3,
        setupName: 'London Retest',
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Strategy' }));
    expect(screen.getByText('Momentum (v3)')).toBeInTheDocument();
    expect(screen.getByText('London Retest')).toBeInTheDocument();
  });
});

describe('Quick Preview execution legs', () => {
  /**
   * §16/§21 — the Calendar and the Day Review count POSITIONS, one row per
   * Trade. The legs of a partially closed position live here, where scaling
   * out is the actual subject.
   */
  it('lists every exit leg of a partially closed position', async () => {
    const user = userEvent.setup();
    renderSheet(
      model({
        tabs: ['overview', 'executions'],
        closedBps: 6000,
        remainingBps: 4000,
        exits: [
          {
            exitId: 'exit-1',
            sequence: 1,
            closedBps: 4000,
            exitPrice: '2410.5',
            realizedPnlMinor: '12000',
            exitReason: 'target',
            exitedAt: '2026-03-05T05:00:00.000Z',
          },
          {
            exitId: 'exit-2',
            sequence: 2,
            closedBps: 2000,
            exitPrice: '2415.0',
            realizedPnlMinor: '5000',
            exitReason: null,
            exitedAt: '2026-03-05T06:00:00.000Z',
          },
        ],
      }),
    );
    await user.click(screen.getByRole('tab', { name: 'Executions' }));
    expect(document.body.querySelector('[data-trade-preview-exits]')).toHaveAttribute(
      'data-trade-preview-exits',
      '2',
    );
    expect(screen.getByText('Exit 1')).toBeInTheDocument();
    expect(screen.getByText('Exit 2')).toBeInTheDocument();
    expect(screen.getByText(/Closed 60.00% · remaining 40.00%/)).toBeInTheDocument();
  });
});
