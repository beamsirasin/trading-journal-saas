import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { TradesTable } from './trades-table';
import type { TradesWorkspaceRow } from './workspace-row';

const push = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    scroll: _scroll,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    scroll?: boolean;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/app/trades',
  useRouter: () => ({ push }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('range=30d&view=log'),
}));

function row(overrides: Partial<TradesWorkspaceRow> = {}): TradesWorkspaceRow {
  return {
    tradeId: '018f0000-0000-7000-8000-000000000001',
    occurredAt: '2026-08-24T07:32:00.000Z',
    occurredAtDisplay: '24 Aug 2026',
    symbol: 'XAUUSD',
    direction: 'long',
    tradingAccountName: 'Main account',
    tradingAccountBaseCurrency: 'USD',
    strategyName: 'Elliott Wave',
    setupName: 'Wave 3',
    strategyVersionNumber: 2,
    status: 'closed',
    systemStatus: 'resolved',
    plannedR: '3.0000',
    actualR: '2.2000',
    systemR: '3.0000',
    netPnlMinor: '22000',
    traderOutcome: 'win',
    systemOutcome: 'win',
    hasReviewNotes: true,
    closedBps: 10_000,
    remainingBps: 0,
    realizedRToDate: null,
    setupConditionMetCount: null,
    setupConditionTotalCount: null,
    tradingAccountIsArchived: false,
    strategyIsArchived: false,
    setupIsArchived: false,
    ...overrides,
  };
}

function renderTable(
  trades: readonly TradesWorkspaceRow[] = [row()],
  selectedTradeId: string | null = null,
  locale: 'en' | 'th' = 'en',
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'th' ? th : en}>
      <TradesTable trades={trades} selectedTradeId={selectedTradeId} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  window.sessionStorage.clear();
});

describe('TradesTable — the default columns', () => {
  it('offers exactly the nine workspace columns, in order', () => {
    renderTable();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Date',
      'Symbol',
      'Result',
      'P&L',
      'R',
      'Planned RR',
      'Strategy',
      'Setup',
      'Review',
    ]);
  });

  it('answers the workspace questions from one row', () => {
    renderTable();
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[0]).toBe('24 Aug 2026');
    expect(cells[1]).toContain('XAUUSD');
    expect(cells[2]).toBe('WIN');
    // Code style, not a symbol: under an "All accounts" scope the rows can
    // legitimately be in different currencies, and "$" would be ambiguous
    // across them. The single-currency AGGREGATE above the table is the one
    // place a symbol is safe.
    expect(cells[3]).toBe('+220.00 USD');
    expect(cells[4]).toBe('+2.20R');
    expect(cells[5]).toBe('1 : 3.00');
    expect(cells[6]).toBe('Elliott Wave');
    expect(cells[7]).toBe('Wave 3');
    expect(cells[8]).toBe('Reviewed');
  });

  it('uses real table semantics rather than a grid of divs', () => {
    const { container } = renderTable();
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
    // Wide financial data scrolls inside its own region, never the page.
    expect(screen.getByRole('region', { name: 'Trades' }).className).toContain('overflow-x-auto');
  });
});

describe('TradesTable — never a fabricated figure', () => {
  it('prints an em dash, not a zero, where nothing was recorded', () => {
    renderTable([
      row({
        status: 'open',
        traderOutcome: null,
        actualR: null,
        netPnlMinor: null,
        plannedR: null,
        strategyName: null,
        setupName: null,
        closedBps: 0,
        realizedRToDate: null,
      }),
    ]);
    const cells = screen.getAllByRole('cell').map((cell) => cell.textContent);
    expect(cells[2]).toBe('OPEN');
    expect(cells[3]).toBe('—');
    expect(cells[4]).toBe('—');
    expect(cells[5]).toBe('—');
    expect(cells[6]).toBe('—');
  });

  it('marks a partially closed position as realized so far, not settled', () => {
    renderTable([
      row({
        status: 'open',
        traderOutcome: null,
        actualR: null,
        closedBps: 5_000,
        remainingBps: 5_000,
        realizedRToDate: '1.2000',
      }),
    ]);
    const rCell = screen.getAllByRole('cell')[4];
    expect(rCell?.textContent).toContain('+1.20R');
    expect(rCell?.textContent).toContain('so far');
  });

  it('says NO RESULT for a closed Trade whose outcome was never classified', () => {
    renderTable([row({ traderOutcome: null })]);
    expect(screen.getAllByRole('cell')[2]?.textContent).toBe('NO RESULT');
  });
});

describe('TradesTable — opening a Trade', () => {
  it('links the Symbol at the Trade, carrying the applied scope', () => {
    renderTable();
    const link = screen.getByRole('link', { name: 'XAUUSD' });
    expect(link).toHaveAttribute(
      'href',
      '/app/trades?range=30d&view=log&trade=018f0000-0000-7000-8000-000000000001',
    );
  });

  it('opens Trade Details when the row itself is clicked', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('cell', { name: '24 Aug 2026' }));
    expect(push).toHaveBeenCalledWith(
      '/app/trades?range=30d&view=log&trade=018f0000-0000-7000-8000-000000000001',
      { scroll: false },
    );
  });

  it('defers to an interactive cell rather than swallowing its own links', async () => {
    const user = userEvent.setup();
    renderTable([row({ hasReviewNotes: false })]);
    await user.click(screen.getByRole('link', { name: 'Needs review' }));
    // The row handler must not have fired a second, competing navigation.
    expect(push).not.toHaveBeenCalled();
  });

  it('remembers the row so focus can return to it after the sheet closes', async () => {
    const user = userEvent.setup();
    renderTable();
    await user.click(screen.getByRole('link', { name: 'XAUUSD' }));
    expect(window.sessionStorage.getItem('tradechemist:trades:focus-return')).toBe(
      '018f0000-0000-7000-8000-000000000001',
    );
  });

  it('marks the open Trade as current for assistive technology', () => {
    renderTable([row()], '018f0000-0000-7000-8000-000000000001');
    expect(screen.getByRole('link', { name: 'XAUUSD' })).toHaveAttribute('aria-current', 'true');
  });
});

describe('TradesTable — the Review column', () => {
  const cases = [
    { overrides: { status: 'planned' as const }, label: 'Needs details', tab: 'execution' },
    { overrides: { systemStatus: 'pending' as const }, label: 'Needs system result', tab: 'plan' },
    { overrides: { strategyName: null }, label: 'Unclassified', tab: 'plan' },
    { overrides: { hasReviewNotes: false }, label: 'Needs review', tab: 'review' },
  ];

  for (const { overrides, label, tab } of cases) {
    it(`links "${label}" to the ${tab} tab that can clear it`, () => {
      renderTable([row(overrides)]);
      const link = screen.getByRole('link', { name: label });
      expect(link.getAttribute('href')).toContain(`tab=${tab}`);
      expect(link.getAttribute('href')).toContain('trade=018f0000-0000-7000-8000-000000000001');
      // The scope survives the deep link.
      expect(link.getAttribute('href')).toContain('range=30d');
    });
  }

  it('does not dress a settled Trade as an action', () => {
    renderTable();
    expect(screen.queryByRole('link', { name: 'Reviewed' })).not.toBeInTheDocument();
    const reviewCell = screen.getAllByRole('cell')[8];
    expect(within(reviewCell as HTMLElement).getByText('Reviewed')).toBeInTheDocument();
  });
});

describe('TradesTable — communication that does not depend on colour', () => {
  it('states every result in words as well as in colour', () => {
    renderTable([row({ traderOutcome: 'loss', actualR: '-1.0000', netPnlMinor: '-10000' })]);
    expect(screen.getByText('LOSS')).toBeInTheDocument();
  });

  it('translates the whole row', () => {
    renderTable([row()], null, 'th');
    expect(screen.getByText('ชนะ')).toBeInTheDocument();
    expect(screen.getByText('ทบทวนแล้ว')).toBeInTheDocument();
  });
});
