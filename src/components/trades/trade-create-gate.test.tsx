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

function renderGate(props: React.ComponentProps<typeof TradeCreateGate>) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeCreateGate {...props} />
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
        emotionCatalog,
      },
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
        emotionCatalog,
      },
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
          emotionCatalog,
        },
        canWrite: true,
        writeBlockReason: null,
        timezone: 'Asia/Bangkok',
      });
      expect(screen.getByLabelText('Trading Account')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Setup' }));
      expect(screen.getByLabelText('Strategy')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Open Trade' })).toBeVisible();
    },
  );
});
