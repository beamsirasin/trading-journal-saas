import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradeCreateGate } from './trade-create-gate';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/server/actions/exit-plans', () => ({}));
/*
  The Saved Symbol library is server-backed. These tests are not about it, so
  its actions answer the way the server would for a single browser: saving
  puts a symbol first, once, and the list comes back.
*/
vi.mock('@/server/actions/saved-symbols', () => {
  let symbols: string[] = [];
  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  return {
    saveSymbolAction: async ({ symbol }: { symbol: string }) => {
      if (!symbols.some((item) => same(item, symbol))) symbols = [symbol.trim(), ...symbols];
      return { ok: true, symbols: [...symbols] };
    },
    removeSymbolAction: async ({ symbol }: { symbol: string }) => {
      symbols = symbols.filter((item) => !same(item, symbol));
      return { ok: true, symbols: [...symbols] };
    },
    importSavedSymbolsAction: async () => ({ ok: true, symbols: [...symbols] }),
  };
});
vi.mock('@/server/actions/trades', () => ({ createTradeAction: vi.fn() }));
vi.mock('@/server/actions/chart-attachment', () => ({ uploadChartAttachmentAction: vi.fn() }));

const account = { tradingAccountId: 'a', name: 'Main', accountMode: 'live', baseCurrency: 'USD' };
const strategy = {
  strategyId: 's',
  name: 'Breakout',
  currentVersionNumber: 1,
  setups: [
    {
      setupId: 'x',
      name: 'Retest',
      sortOrder: 0,
      conditionSetToken: 'a'.repeat(64),
      conditions: [],
    },
  ],
};
const emotionCatalog = [{ key: 'calm', label: 'Calm' }];

function renderGate(props: Omit<React.ComponentProps<typeof TradeCreateGate>, 'draftScope'>) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeCreateGate
        {...props}
        draftScope={{ ownerKey: 'test-owner', workspaceKey: 'test-workspace' }}
      />
    </NextIntlClientProvider>,
  );
}

describe('TradeCreateGate', () => {
  it('blocks direct creation in read-only mode and keeps a safe path back to history', () => {
    renderGate({
      options: {
        tradingAccounts: [account],
        strategies: [strategy],
        workspaceId: 'ws-1',
        chartUploadConfigured: false,
        savedSymbols: [],
        exitPlans: [],
        emotionCatalog,
      },
      timing: 'at_entry' as const,
      canWrite: false,
      writeBlockReason: 'read_only_workspace',
      timezone: 'Asia/Bangkok',
    });
    expect(screen.getByText('Trade creation is unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to trades' })).toHaveAttribute(
      'href',
      '/app/trades',
    );
    expect(screen.queryByRole('button', { name: /Create Trade/ })).not.toBeInTheDocument();
  });

  it('requires an active Trading Account', () => {
    renderGate({
      options: {
        tradingAccounts: [],
        strategies: [strategy],
        workspaceId: 'ws-1',
        chartUploadConfigured: false,
        savedSymbols: [],
        exitPlans: [],
        emotionCatalog,
      },
      timing: 'at_entry' as const,
      canWrite: true,
      writeBlockReason: null,
      timezone: 'Asia/Bangkok',
    });
    expect(screen.getByText('No active Trading Account')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/app/accounts');
  });

  it.each([
    ['no Strategy', []],
    ['a Strategy with no Setup', [{ ...strategy, setups: [] }]],
  ] as const)(
    'keeps New Trade available with %s because classification is optional',
    (_, strategies) => {
      renderGate({
        options: {
          tradingAccounts: [account],
          strategies,
          workspaceId: 'ws-1',
          chartUploadConfigured: false,
          savedSymbols: [],
          exitPlans: [],
          emotionCatalog,
        },
        timing: 'at_entry' as const,
        canWrite: true,
        writeBlockReason: null,
        timezone: 'Asia/Bangkok',
      });
      // A single Account is context on the task surface, not a decision.
      expect(document.querySelector('[data-account-context]')).toHaveTextContent('Main · USD');
      // Strategy is optional: Setup & Checklist asks it, behind no gate.
      expect(document.getElementById('entry-strategy')).not.toBeNull();
      // Save Open Trade is reachable from Plan & Risk on, whatever the Strategy.
      fireEvent.click(screen.getByRole('button', { name: 'Next: Plan & risk' }));
      expect(screen.getByRole('button', { name: 'Save open trade' })).toBeEnabled();
    },
  );
});
