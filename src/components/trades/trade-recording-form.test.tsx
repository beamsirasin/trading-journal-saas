import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { TradeRecordingForm } from './trade-recording-form';

const TEST_DRAFT_SCOPE = { ownerKey: 'test-owner', workspaceKey: 'test-workspace' };

const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/server/actions/exit-plans', () => ({}));
vi.mock('@/server/actions/trades', () => ({
  createTradeAction: vi.fn(),
  createCompletedTradeAction: vi.fn(),
}));

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  exitPlans: [],
  emotionCatalog: [{ key: 'calm', label: 'Calm' }],
  tradingAccounts: [
    {
      tradingAccountId: '018f0000-0000-7000-8000-000000000001',
      name: 'Main USD',
      accountMode: 'live',
      baseCurrency: 'USD',
    },
  ],
  strategies: [],
} as const satisfies TradeCreateOptions;

/*
  THE RECORDING MODE IS AN INPUT. It was chosen on the previous step and
  travels in the URL, so these render in a mode rather than clicking into one.
  The behaviour of each lifecycle's form is covered by its own test file; this
  one covers the boundary between them.
*/
function renderForm(locale: 'en' | 'th' = 'en', timing: RecordingTiming = 'at_entry') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <TradeRecordingForm
        options={options}
        timing={timing}
        timezone="Asia/Bangkok"
        draftScope={TEST_DRAFT_SCOPE}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  pushMock.mockReset();
  window.localStorage.clear();
});

describe('TradeRecordingForm — the production mode boundary', () => {
  it('renders exactly one linear form per lifecycle', () => {
    const { container, unmount } = renderForm('en', 'at_entry');
    expect(container.querySelector('[data-at-entry-linear-form]')).not.toBeNull();
    expect(container.querySelector('[data-after-trade-linear-form]')).toBeNull();
    unmount();

    const afterTrade = renderForm('en', 'after_trade');
    expect(afterTrade.container.querySelector('[data-after-trade-linear-form]')).not.toBeNull();
    expect(afterTrade.container.querySelector('[data-at-entry-linear-form]')).toBeNull();
  });

  it('states the recording mode instead of offering to switch it mid-form', () => {
    const { container, unmount } = renderForm();
    expect(container.querySelector('[data-recording-mode="at_entry"]')).not.toBeNull();
    expect(screen.getByText(/At entry: the position is still open/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'After Trade' })).not.toBeInTheDocument();

    unmount();
    const afterTrade = renderForm('en', 'after_trade');
    expect(
      afterTrade.container.querySelector('[data-recording-mode="after_trade"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Record a trade that has already finished/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'At Entry' })).not.toBeInTheDocument();
  });

  it('offers one way back to the choice, straight through while the form is empty', () => {
    renderForm();
    expect(screen.getByRole('link', { name: 'Change' })).toHaveAttribute('href', '/app/trades/new');
  });

  it('changes mode as plain navigation that keeps the draft, never a discard warning', () => {
    // Contract §23: changing recording mode is routine navigation. The draft
    // survives, so there is nothing to warn about and nothing to confirm.
    renderForm();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
    const change = screen.getByRole('link', { name: 'Change' });
    expect(change).toHaveAttribute('href', '/app/trades/new');
    fireEvent.click(change);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('translates the mode statement', () => {
    renderForm('th');
    expect(screen.getByText(/ตอนเข้า: สถานะยังเปิดอยู่/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'เปลี่ยน' })).toBeVisible();
  });
});
