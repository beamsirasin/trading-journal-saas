import { render, screen } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../../../../../messages/en.json';
import NewTradePage from './page';

/**
 * THE ROUTE'S FRAME, WHICH IS THE THING THAT MOVED.
 *
 * The recording mode used to be named in three places: an `<h1>` reading "Log
 * a trade", a subtitle, and a card inside the form. Two of those are gone and
 * the mode is now the heading itself — which means no component test can see
 * it any more, because `TradeRecordingForm` does not render it. This is the
 * only place that can.
 *
 * Both children are stubbed deliberately: what is under test is the frame the
 * route chooses and what it puts in the heading, not the form or the choice
 * cards, both of which have their own tests.
 */
vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async (namespace: string | { namespace: string }) =>
    createTranslator({
      locale: 'en',
      messages: en,
      namespace: (typeof namespace === 'string' ? namespace : namespace.namespace) as never,
    }),
}));
vi.mock('@/server/auth/dal', () => ({
  getActiveTradingAccount: async () => ({ id: 'account-1' }),
  getCurrentUserPreferences: async () => ({ locale: 'en', theme: 'dark', timezone: 'UTC' }),
  getWorkspaceEntitlement: async () => null,
}));
vi.mock('@/server/dal/trades', () => ({
  getTradeCreateOptions: async () => ({ tradingAccounts: [], strategies: [], emotions: [] }),
}));
vi.mock('@/components/trades/trade-create-gate', () => ({
  TradeCreateGate: () => <div data-testid="create-gate" />,
}));
vi.mock('@/components/trades/trade-recording-mode-selection', () => ({
  TradeRecordingModeSelection: () => <div data-testid="mode-selection" />,
}));

async function renderPage(timing?: string) {
  const ui = await NewTradePage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve(timing === undefined ? {} : { timing }),
  });
  // `WizardShell` is a client component and reads its own strings, so the
  // tree needs the provider the app layout gives it in production.
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('NewTradePage', () => {
  it('asks the question on step one', async () => {
    await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'When are you recording this trade?' }),
    ).toBeVisible();
    expect(screen.getByTestId('mode-selection')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 1 of 2');
  });

  it.each([
    ['at_entry', 'At Entry'],
    ['after_trade', 'After Trade'],
  ])('names the recording mode in the heading on step two: %s', async (timing, heading) => {
    await renderPage(timing);

    // The heading is the mode, not the flow. "Log a trade" is the eyebrow
    // above it and must not be the `<h1>` as well.
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Log a trade' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);

    // Same frame as step one, one step further along — the progress bar is
    // what makes the two steps read as one flow.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Step 2 of 2');
    expect(screen.getByTestId('create-gate')).toBeVisible();

    // The boxed "Back to Trades" action the form step used to carry is gone;
    // the shell's two quiet exits replace it.
    expect(screen.queryByRole('button', { name: 'Back to Trades' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Trades' })).toHaveAttribute(
      'href',
      '/en/app/trades',
    );
    expect(screen.getByRole('link', { name: 'Close' })).toHaveAttribute('href', '/en/app/trades');
  });

  it('falls back to the choice when the timing in the URL is not one we know', async () => {
    await renderPage('sometime');
    expect(
      screen.getByRole('heading', { level: 1, name: 'When are you recording this trade?' }),
    ).toBeVisible();
  });
});
