import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assignTradeClassificationAction } from '@/server/actions/trades';
import type { TradeCreateStrategyOption, TradeDetail } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import { AssignClassificationDialog } from './trade-classification-actions';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server/actions/trades', () => ({
  assignTradeClassificationAction: vi.fn(),
}));

const tradeId = '018f0000-0000-7000-8000-000000000001';

const strategies = [
  {
    strategyId: 'strategy-1',
    name: 'Breakout Strategy',
    currentVersionNumber: 2,
    setups: [
      {
        setupId: 'setup-1a',
        name: 'Range Break',
        sortOrder: 0,
        conditionSetToken: 't1',
        conditions: [],
      },
      {
        setupId: 'setup-1b',
        name: 'Trend Continuation',
        sortOrder: 1,
        conditionSetToken: 't2',
        conditions: [],
      },
    ],
  },
  {
    strategyId: 'strategy-2',
    name: 'Mean Reversion Strategy',
    currentVersionNumber: 1,
    setups: [
      {
        setupId: 'setup-2a',
        name: 'Fade Extreme',
        sortOrder: 0,
        conditionSetToken: 't3',
        conditions: [],
      },
    ],
  },
] as unknown as readonly TradeCreateStrategyOption[];

function renderWithMessages(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('AssignClassificationDialog (Phase 14C late classification)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assignTradeClassificationAction).mockResolvedValue({
      ok: true,
      data: { tradeId, strategyId: 'strategy-1', setupId: null },
    });
  });

  it('offers "Add Strategy" for an unclassified Trade, keeps Setup disabled until a Strategy is chosen, and omits setupId when none is picked', async () => {
    const user = userEvent.setup();
    const trade = { tradeId, strategyId: null, setupId: null } as TradeDetail;
    renderWithMessages(<AssignClassificationDialog trade={trade} strategies={strategies} />);

    await user.click(screen.getByRole('button', { name: 'Add Strategy' }));
    expect(screen.getByText('Classify this Trade')).toBeInTheDocument();

    const setupSelect = screen.getByLabelText('Setup') as HTMLSelectElement;
    expect(setupSelect).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Strategy'), 'strategy-1');
    expect(setupSelect).toBeEnabled();
    expect(Array.from(setupSelect.options).map((o) => o.value)).toEqual([
      '',
      'setup-1a',
      'setup-1b',
    ]);

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(assignTradeClassificationAction).toHaveBeenCalledWith({
        tradeId,
        strategyId: 'strategy-1',
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('includes setupId when a Setup is also chosen alongside the Strategy in the same submission', async () => {
    const user = userEvent.setup();
    const trade = { tradeId, strategyId: null, setupId: null } as TradeDetail;
    renderWithMessages(<AssignClassificationDialog trade={trade} strategies={strategies} />);

    await user.click(screen.getByRole('button', { name: 'Add Strategy' }));
    await user.selectOptions(screen.getByLabelText('Strategy'), 'strategy-1');
    await user.selectOptions(screen.getByLabelText('Setup'), 'setup-1b');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(assignTradeClassificationAction).toHaveBeenCalledWith({
        tradeId,
        strategyId: 'strategy-1',
        setupId: 'setup-1b',
      }),
    );
  });

  it('switching the chosen Strategy clears any already-selected Setup so a foreign Setup can never be submitted', async () => {
    const user = userEvent.setup();
    const trade = { tradeId, strategyId: null, setupId: null } as TradeDetail;
    renderWithMessages(<AssignClassificationDialog trade={trade} strategies={strategies} />);

    await user.click(screen.getByRole('button', { name: 'Add Strategy' }));
    await user.selectOptions(screen.getByLabelText('Strategy'), 'strategy-1');
    await user.selectOptions(screen.getByLabelText('Setup'), 'setup-1b');
    await user.selectOptions(screen.getByLabelText('Strategy'), 'strategy-2');

    const setupSelect = screen.getByLabelText('Setup') as HTMLSelectElement;
    expect(setupSelect.value).toBe('');
    expect(Array.from(setupSelect.options).map((o) => o.value)).toEqual(['', 'setup-2a']);
  });

  it('offers only "Add Setup" for a Strategy-only Trade — no Strategy picker, only that Strategy’s own Setups', async () => {
    const user = userEvent.setup();
    const trade = { tradeId, strategyId: 'strategy-1', setupId: null } as TradeDetail;
    renderWithMessages(<AssignClassificationDialog trade={trade} strategies={strategies} />);

    await user.click(screen.getByRole('button', { name: 'Add Setup' }));
    expect(screen.getByText('Add a Setup')).toBeInTheDocument();
    expect(screen.queryByLabelText('Strategy')).not.toBeInTheDocument();

    const setupSelect = screen.getByLabelText('Setup') as HTMLSelectElement;
    expect(setupSelect).toBeEnabled();
    expect(Array.from(setupSelect.options).map((o) => o.value)).toEqual([
      '',
      'setup-1a',
      'setup-1b',
    ]);

    await user.selectOptions(setupSelect, 'setup-1a');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(assignTradeClassificationAction).toHaveBeenCalledWith({
        tradeId,
        setupId: 'setup-1a',
      }),
    );
  });

  it('shows friendly error copy and never closes the dialog when the server rejects the request', async () => {
    vi.mocked(assignTradeClassificationAction).mockResolvedValue({
      ok: false,
      error: { code: 'invalid_classification_request' },
    });
    const user = userEvent.setup();
    const trade = { tradeId, strategyId: null, setupId: null } as TradeDetail;
    renderWithMessages(<AssignClassificationDialog trade={trade} strategies={strategies} />);

    await user.click(screen.getByRole('button', { name: 'Add Strategy' }));
    await user.selectOptions(screen.getByLabelText('Strategy'), 'strategy-1');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "This Trade's classification can't be changed that way. Reload the page and try again.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Classify this Trade')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
