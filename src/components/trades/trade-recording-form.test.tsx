import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { TradeRecordingForm } from './trade-recording-form';

const createTradeActionMock = vi.fn();
const createCompletedTradeActionMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/server/actions/trades', () => ({
  createTradeAction: (...args: unknown[]) => createTradeActionMock(...args),
  createCompletedTradeAction: (...args: unknown[]) => createCompletedTradeActionMock(...args),
}));

const options = {
  workspaceId: '018f0000-0000-7000-8000-0000000000ff',
  chartUploadConfigured: false,
  emotionCatalog: [
    { key: 'calm', label: 'Calm' },
    { key: 'focused', label: 'Focused' },
  ],
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
  THE RECORDING MODE IS AN INPUT NOW.

  It used to be local state behind an in-form toggle, so a test switched modes
  by clicking "After Trade". The choice is its own step and travels in the URL,
  so the form receives it — which is why these render in a mode rather than
  clicking into one.
*/
function renderForm(locale: 'en' | 'th' = 'en', timing: RecordingTiming = 'at_entry') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : th}>
      <TradeRecordingForm options={options} timing={timing} timezone="Asia/Bangkok" />
    </NextIntlClientProvider>,
  );
}

function renderAfterTrade(locale: 'en' | 'th' = 'en') {
  return renderForm(locale, 'after_trade');
}

/** The same form with a different emotion catalog, to exercise the grouping. */
function renderWithEmotions(emotionCatalog: readonly { key: string; label: string }[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeRecordingForm
        options={{ ...options, emotionCatalog }}
        timing="at_entry"
        timezone="Asia/Bangkok"
      />
    </NextIntlClientProvider>,
  );
}

/** The emotion groups actually drawn, in the order they appear. */
function emotionGroupKeys(): (string | null)[] {
  return Array.from(document.querySelectorAll('[data-emotion-group]')).map((group) =>
    group.getAttribute('data-emotion-group'),
  );
}

/**
 * CHOOSE A BASIS. DO NOT INHERIT ONE.
 *
 * Nine tests below used to reach straight for `Entry` / `Actual Entry` and
 * worked only because the form happened to open in Price. That made the
 * form's default a silent premise of every one of them: a test named "Price
 * Actual" was not testing Price, it was testing whatever the default was. Say
 * it out loud instead, so that changing the default changes the default and
 * nothing else.
 *
 * CLICK BEFORE TYPING. `changePlanBasis`/`changeActualBasis` clear the fields
 * they own on EVERY click — including a click on the segment that is already
 * selected, because `Segmented` calls `onChange` unconditionally. Calling this
 * after filling a field silently empties it.
 */
function chooseBasis(groupName: 'Plan by' | 'Actual result by', basis: 'Price' | 'Money') {
  fireEvent.click(
    within(screen.getByRole('group', { name: groupName })).getByRole('button', { name: basis }),
  );
}

function fillIdentityAndPricePlan() {
  fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });
  fireEvent.click(screen.getByRole('button', { name: 'Long' }));
  chooseBasis('Plan by', 'Price');
  fireEvent.change(screen.getByLabelText('Entry'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Stop Loss'), { target: { value: '90' } });
}

function chooseAfterTrade() {
  fillIdentityAndPricePlan();
  fireEvent.change(screen.getByLabelText('Exited At'), {
    target: { value: '2026-08-23T12:00' },
  });
  fireEvent.change(screen.getByLabelText('Entered At'), {
    target: { value: '2026-08-23T10:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Result' }));
}

beforeEach(() => {
  createTradeActionMock.mockReset();
  createCompletedTradeActionMock.mockReset();
  pushMock.mockReset();
});

describe('TradeRecordingForm — Phase 15G.5D recording UX', () => {
  it('defaults to At Entry and renders only one short panel at a time with the CTA always reachable', () => {
    renderForm();

    // The mode was chosen on the previous step, so the form states it rather
    // than asking again. The mode's NAME is now the page heading, which the
    // route owns; what this component states is what the mode means.
    expect(screen.getByText(/Record the trade before the outcome is known/)).toBeVisible();
    expect(
      screen.queryByRole('heading', { name: 'When are you recording this trade?' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Symbol')).toBeVisible();
    expect(screen.queryByText('Actual Result')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Trade' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Setup · optional' }));
    expect(screen.getByLabelText(/^Strategy/)).toBeVisible();
    expect(screen.queryByLabelText('Symbol')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Trade' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Context · optional' }));
    expect(screen.getByText('Confidence', { selector: 'label' })).toBeVisible();
    expect(screen.queryByLabelText(/^Strategy/)).not.toBeInTheDocument();
  });

  it('keeps System Plan and Actual Result basis independent in After Trade', () => {
    renderAfterTrade();
    chooseAfterTrade();

    expect(screen.getByText('Actual Result')).toBeVisible();
    // The Plan is Price (chosen in `fillIdentityAndPricePlan`). The Actual is
    // chosen here, separately, and the point of the test is that moving one
    // does not move the other.
    chooseBasis('Actual result by', 'Price');
    expect(screen.getByRole('button', { name: 'Price' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actual result by' })).getByRole('button', {
        name: 'Money',
      }),
    );
    expect(screen.getByLabelText('Initial Risk')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'The trade' }));
    expect(screen.getByLabelText('Entry')).toHaveValue('100');
    expect(screen.getByLabelText('Stop Loss')).toHaveValue('90');
  });

  it('opens an At Entry Trade in one canonical action without normal-layer Actual overrides', async () => {
    createTradeActionMock.mockResolvedValue({
      ok: true,
      data: { tradeId: '018f0000-0000-7000-8000-000000000099', alreadyCreated: false },
    });
    renderForm();
    fillIdentityAndPricePlan();
    fireEvent.click(screen.getByRole('button', { name: 'Open Trade' }));

    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    const payload = createTradeActionMock.mock.calls[0]![0];
    expect(payload).toMatchObject({
      recordingTiming: 'at_entry',
      systemPlanBasis: 'price',
      plannedEntry: '100',
      plannedStop: '90',
    });
    expect(payload).not.toHaveProperty('actualResultMode');
    expect(payload).not.toHaveProperty('actualEntry');
    expect(createCompletedTradeActionMock).not.toHaveBeenCalled();
    expect(pushMock).toHaveBeenCalledWith('/app/trades?trade=018f0000-0000-7000-8000-000000000099');
  });

  it('saves a simple Price Actual as one 100% exit with Pending System outcome', async () => {
    createCompletedTradeActionMock.mockResolvedValue({
      ok: true,
      data: {
        tradeId: '018f0000-0000-7000-8000-000000000088',
        alreadyCreated: false,
        status: 'closed',
        actualR: '2.0000',
        traderOutcome: 'win',
        systemStatus: 'pending',
        systemR: null,
        systemOutcome: null,
        recordedRetrospectively: true,
      },
    });
    renderAfterTrade();
    chooseAfterTrade();
    chooseBasis('Actual result by', 'Price');
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Actual Initial Stop'), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText('Exit Price'), { target: { value: '120' } });

    expect(screen.getByText('+2.00R')).toBeVisible();
    expect(screen.getByText('Win')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock).not.toHaveBeenCalled();
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
      recordingTiming: 'after_trade',
      systemPlanBasis: 'price',
      actualResultBasis: 'price',
      actualEntry: '100',
      actualInitialStop: '90',
      exits: [{ closedBps: 10_000, exitPrice: '120' }],
    });
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).not.toHaveProperty('systemResult');
  });

  it('supports a Price Plan with Money Actual without double weighting P&L', async () => {
    createCompletedTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
    renderAfterTrade();
    chooseAfterTrade();
    fireEvent.click(screen.getByRole('button', { name: 'Money' }));
    fireEvent.change(screen.getByLabelText('Initial Risk'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Realized P&L'), { target: { value: '14' } });

    expect(screen.getByText('+1.40R')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
      systemPlanBasis: 'price',
      actualResultBasis: 'money',
      actualInitialRiskMinor: '1000',
      exits: [{ closedBps: 10_000, realizedPnlMinor: '1400' }],
    });
  });

  it.each(['price', 'money'] as const)(
    'supports a Money Plan with %s Actual',
    async (resultBasis) => {
      createCompletedTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
      renderAfterTrade();
      fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'eurusd' } });
      fireEvent.click(screen.getByRole('button', { name: 'Short' }));
      fireEvent.change(screen.getByLabelText('Entered At'), {
        target: { value: '2026-08-23T10:00' },
      });
      fireEvent.change(screen.getByLabelText('Exited At'), {
        target: { value: '2026-08-23T12:00' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Money' }));
      fireEvent.change(screen.getByLabelText('Risk'), { target: { value: '20' } });
      fireEvent.click(screen.getByRole('button', { name: 'Result' }));

      if (resultBasis === 'price') {
        chooseBasis('Actual result by', 'Price');
        fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '1.1' } });
        fireEvent.change(screen.getByLabelText('Actual Initial Stop'), {
          target: { value: '1.2' },
        });
        fireEvent.change(screen.getByLabelText('Exit Price'), { target: { value: '1.0' } });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'Money' }));
        fireEvent.change(screen.getByLabelText('Initial Risk'), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText('Realized P&L'), { target: { value: '-5' } });
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

      await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
      expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
        systemPlanBasis: 'money',
        plannedRiskMinor: '2000',
        actualResultBasis: resultBasis,
      });
    },
  );

  it('keeps explicit cross-basis At Entry execution inside Advanced only', async () => {
    createTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
    renderForm();
    fillIdentityAndPricePlan();
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByLabelText('Actual opening differs from the System Plan'));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Actual opening by' })).getByRole('button', {
        name: 'Money',
      }),
    );
    fireEvent.change(screen.getByLabelText('Initial Risk'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open Trade' }));

    await waitFor(() => expect(createTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createTradeActionMock.mock.calls[0]![0]).toMatchObject({
      systemPlanBasis: 'price',
      actualResultMode: 'money',
      actualInitialRiskMinor: '2500',
    });
  });

  it('maps expanded partial exits to canonical bps only when coverage totals 100%', async () => {
    createCompletedTradeActionMock.mockResolvedValue({ ok: true, data: { tradeId: 'trade-id' } });
    renderAfterTrade();
    chooseAfterTrade();
    chooseBasis('Actual result by', 'Price');
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Actual Initial Stop'), { target: { value: '90' } });
    fireEvent.click(screen.getByLabelText('Partial exits'));
    const exitPrices = screen.getAllByLabelText('Exit Price');
    fireEvent.change(exitPrices[0]!, { target: { value: '110' } });
    fireEvent.change(exitPrices[1]!, { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Completed Trade' }));

    await waitFor(() => expect(createCompletedTradeActionMock).toHaveBeenCalledTimes(1));
    expect(createCompletedTradeActionMock.mock.calls[0]![0]).toMatchObject({
      exits: [
        { closedBps: 5000, exitPrice: '110' },
        { closedBps: 5000, exitPrice: '120' },
      ],
    });
  });

  it('disables the Target preset until the selected System Plan has a target', () => {
    renderAfterTrade();
    chooseAfterTrade();

    const systemOutcome = screen.getByRole('combobox', { name: 'System Outcome' });
    expect(systemOutcome).toHaveValue('pending');
    expect(screen.getByRole('option', { name: 'Target reached' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'The trade' }));
    fireEvent.change(screen.getByLabelText(/^Take Profit/), { target: { value: '130' } });
    fireEvent.click(screen.getByRole('button', { name: 'Result' }));
    expect(screen.getByRole('option', { name: 'Target reached' })).toBeEnabled();
  });

  it('starts pristine in each mode, which is what the old in-form reset guaranteed', () => {
    /*
      The form used to clear every timing-specific field when the toggle
      flipped. It cannot flip any more — changing the mode leaves the route,
      so the next form mounts fresh. Same guarantee, no partial-reset path to
      keep correct: an At Entry form carries none of an After Trade draft.
    */
    const { unmount } = renderAfterTrade();
    chooseAfterTrade();
    chooseBasis('Actual result by', 'Price');
    fireEvent.change(screen.getByLabelText('Actual Entry'), { target: { value: '101' } });
    fireEvent.change(screen.getByLabelText('Exit Price'), { target: { value: '111' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'System Outcome' }), {
      target: { value: 'custom' },
    });
    unmount();

    renderForm();
    expect(screen.getByLabelText('Symbol')).toHaveValue('');
    /*
      Read the plan field the fresh form actually opened with, and read it
      WITHOUT clicking the basis toggle. Clicking clears the very fields this
      test is trying to prove are already clear, which would turn the
      assertion into a tautology that passes over a leaked draft.
    */
    const planField = screen.queryByLabelText('Entry') ?? screen.queryByLabelText('Risk');
    expect(planField).not.toBeNull();
    expect(planField).toHaveValue('');
    // At Entry has no Result panel at all, so none of those fields exists.
    expect(screen.queryByRole('button', { name: 'Result' })).not.toBeInTheDocument();
  });

  it('renders the frozen Thai timing and result terminology', () => {
    renderAfterTrade('th');
    expect(screen.getByText(/บันทึกออเดอร์ที่จบไปแล้ว/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'ผลลัพธ์' }));
    expect(screen.getByText('ผลลัพธ์จริง')).toBeVisible();
    expect(screen.getByText('คำนวณผลจริงจาก')).toBeVisible();
    expect(screen.getByRole('button', { name: 'บันทึกเทรดที่จบแล้ว' })).toBeVisible();
  });
});

/*
  THE VISUAL MIGRATION.

  These assert what the pass was for: the page speaks the current design
  system, and the workflow underneath it did not move. They deliberately check
  SEMANTIC token classes rather than rendered colour — jsdom resolves no
  stylesheet, and a token class is exactly what makes a control correct in both
  themes without either being special-cased.
*/
describe('TradeRecordingForm — current design system', () => {
  function segments(groupName: string) {
    return within(screen.getByRole('group', { name: groupName })).getAllByRole('button');
  }

  it('states the recording mode instead of offering to switch it mid-form', () => {
    const { container, unmount } = renderForm();

    // The mode is identified, and it is a statement rather than a control: a
    // form already carrying a plan must not be able to change what it means.
    expect(container.querySelector('[data-recording-mode="at_entry"]')).not.toBeNull();
    expect(screen.getByText(/Record the trade before the outcome is known/)).toBeVisible();
    expect(screen.queryByRole('group', { name: /When are you recording/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'After Trade' })).not.toBeInTheDocument();

    unmount();
    const afterTrade = renderAfterTrade();
    expect(
      afterTrade.container.querySelector('[data-recording-mode="after_trade"]'),
    ).not.toBeNull();
    expect(screen.getByText(/Record a trade that has already finished/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'At Entry' })).not.toBeInTheDocument();
  });

  it('offers one way back to the choice, straight through while the form is empty', () => {
    renderForm();
    const change = screen.getByRole('link', { name: 'Change' });
    expect(change).toHaveAttribute('href', '/app/trades/new');
  });

  it('asks before discarding a draft on the way back to the choice', () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'xauusd' } });

    // Once something has been entered the same control asks first, because
    // leaving the route discards the draft.
    const change = screen.getByRole('button', { name: 'Change' });
    fireEvent.click(change);
    expect(
      screen.getByRole('alertdialog', { name: 'Change how you are recording this trade?' }),
    ).toBeVisible();
  });

  it('keeps the At Entry panels: Trade, Setup, Entry Context', () => {
    renderForm();
    const nav = screen.getByRole('navigation', { name: 'New Trade sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['The trade', 'Setup · optional', 'Context · optional']);
    // No Review tab was added in this pass.
    expect(within(nav).queryByRole('button', { name: 'Review' })).not.toBeInTheDocument();
  });

  it('keeps the After Trade panels: Trade, Result, Setup, Entry Context', () => {
    renderAfterTrade();
    const nav = screen.getByRole('navigation', { name: 'New Trade sections' });
    expect(
      within(nav)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['The trade', 'Result', 'Setup · optional', 'Context · optional']);
  });

  it('dresses every segmented control in the shared raised-segment language', () => {
    renderForm();
    // WHICH segment is selected is not this test's subject — the treatment of
    // the selected one is. Read that off `aria-pressed` rather than off the
    // position, so a change of default cannot turn a styling test red.
    const [first, second] = segments('Plan by');
    const selected = first?.getAttribute('aria-pressed') === 'true' ? first : second;
    const unselected = selected === first ? second : first;
    expect(selected?.getAttribute('aria-pressed')).toBe('true');
    expect(unselected?.getAttribute('aria-pressed')).toBe('false');

    // The selected segment lifts to the shared raised surface with the shared
    // control shadow — the same treatment the shared SegmentedControl gives
    // the Dashboard filters.
    expect(selected?.className).toContain('bg-surface-raised');
    expect(selected?.className).toContain('shadow-control');
    expect(unselected?.className).toContain('text-muted-foreground');
    expect(unselected?.className).not.toContain('bg-surface-raised');
  });

  it('uses the same language for the inner panel nav', () => {
    renderForm();
    const nav = screen.getByRole('navigation', { name: 'New Trade sections' });
    expect(within(nav).getByRole('button', { name: 'The trade' }).className).toContain(
      'bg-surface-raised',
    );
    expect(within(nav).getByRole('button', { name: 'Setup · optional' }).className).toContain(
      'text-muted-foreground',
    );
  });

  it('does not colour Direction as if it were an outcome', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Long' }));
    const long = screen.getByRole('button', { name: 'Long' });
    const short = screen.getByRole('button', { name: 'Short' });

    // Positive/negative belong to what a Trade MADE. A Long is not a win.
    expect(long.className).not.toContain('bg-positive');
    expect(short.className).not.toContain('bg-negative');
    // Selection survives without colour: state, surface and a check.
    expect(long).toHaveAttribute('aria-pressed', 'true');
    expect(short).toHaveAttribute('aria-pressed', 'false');
    expect(long.className).toContain('bg-surface-raised');
  });

  it('gives every control a visible focus ring and honours reduced motion', () => {
    renderForm();
    const controls = [
      screen.getByRole('button', { name: 'Long' }),
      within(screen.getByRole('navigation', { name: 'New Trade sections' })).getByRole('button', {
        name: 'Setup · optional',
      }),
    ];
    for (const control of controls) {
      expect(control.className).toContain('focus-visible:ring-2');
      // The transition is restrained and drops out entirely under
      // prefers-reduced-motion, matching the Dashboard's policy.
      expect(control.className).toContain('transition-colors');
      expect(control.className).toContain('motion-reduce:transition-none');
    }
  });

  it('keeps the panel nav usable on a phone and the labels intact', () => {
    renderAfterTrade();
    const nav = screen.getByRole('navigation', { name: 'New Trade sections' });
    // Four panels wrap to two rows on a narrow screen rather than being
    // squeezed into four columns; every label stays spelled out.
    expect(nav.className).toContain('grid-cols-2');
    expect(nav.className).toContain('sm:grid-cols-4');
    expect(within(nav).getByRole('button', { name: 'Context · optional' })).toBeVisible();
  });

  it('keeps the Trading Account select, defaulted to the workspace account', () => {
    renderForm();
    // The field still says which Account the Trade belongs to — it was not
    // removed in favour of the header switcher.
    const account = screen.getByLabelText('Trading Account');
    expect(account.tagName).toBe('SELECT');
    expect(account).toHaveValue(options.tradingAccounts[0].tradingAccountId);
  });

  describe('the Trading Account default on a multi-account workspace', () => {
    const second = {
      tradingAccountId: '018f0000-0000-7000-8000-000000000002',
      name: 'Prop THB',
      accountMode: 'live',
      baseCurrency: 'THB',
    } as const;
    const multi = {
      ...options,
      tradingAccounts: [...options.tradingAccounts, second],
    } satisfies TradeCreateOptions;

    function renderMulti(activeTradingAccountId: string | null) {
      return render(
        <NextIntlClientProvider locale="en" messages={en}>
          <TradeRecordingForm
            options={multi}
            timing="at_entry"
            activeTradingAccountId={activeTradingAccountId}
            timezone="Asia/Bangkok"
          />
        </NextIntlClientProvider>,
      );
    }

    it('starts on the active Account rather than on a blank select', () => {
      renderMulti(second.tradingAccountId);
      expect(screen.getByLabelText('Trading Account')).toHaveValue(second.tradingAccountId);
    });

    it('is still a real choice the writer can change', () => {
      renderMulti(second.tradingAccountId);
      const account = screen.getByLabelText('Trading Account');
      fireEvent.change(account, {
        target: { value: options.tradingAccounts[0].tradingAccountId },
      });
      expect(account).toHaveValue(options.tradingAccounts[0].tradingAccountId);
    });

    it('falls back to an explicit choice when no active Account is resolved', () => {
      renderMulti(null);
      expect(screen.getByLabelText('Trading Account')).toHaveValue('');
    });

    it('ignores an active Account this workspace no longer offers', () => {
      // A per-user preference can name an Account that has since been
      // archived; seeding a value the select does not contain would blank the
      // field on submit.
      renderMulti('018f0000-0000-7000-8000-0000000000aa');
      expect(screen.getByLabelText('Trading Account')).toHaveValue('');
    });
  });

  it('keeps Advanced closed by default', () => {
    renderForm();
    const advanced = screen.getByText('Advanced').closest('details');
    expect(advanced).not.toBeNull();
    expect(advanced).not.toHaveAttribute('open');
    // A closed <details> still renders its children into the DOM; what matters
    // is that none of them is reachable until the reader opens it.
    expect(screen.getByLabelText('Actual opening differs from the System Plan')).not.toBeVisible();
  });

  it('says Confidence means confidence before entry, on both timings', () => {
    const { unmount } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Context · optional' }));
    expect(screen.getByText('Confidence', { selector: 'label' })).toBeVisible();
    expect(screen.getByText(/How confident were you before entering/)).toBeVisible();
    // At Entry has nothing to warn about: the outcome does not exist yet.
    expect(screen.queryByText(/after the outcome/)).not.toBeInTheDocument();
    unmount();

    // After Trade keeps the SAME historical field — it never becomes
    // confidence about the result, and it is never required.
    renderAfterTrade();
    fireEvent.click(screen.getByRole('button', { name: 'Context · optional' }));
    expect(screen.getByText('Confidence', { selector: 'label' })).toBeVisible();
    expect(screen.getByText(/How confident were you before entering/)).toBeVisible();
    // …and it adds the warning the timing makes necessary: this is written
    // with the result already known, so the answer has to be the one from
    // before it was.
    expect(screen.getByText(/answer as the you who had not seen it yet/)).toBeVisible();
    expect(screen.getByText('Recorded retrospectively')).toBeVisible();
  });

  it('groups the emotions, and renders no group the catalog cannot fill', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Context · optional' }));

    expect(screen.getByText('What pushed you in?')).toBeVisible();
    // This fixture's catalog holds only Calm and Focused, so exactly one
    // group has anything to show and the other three are not drawn as empty
    // rows. Grouping is layout: it never invents a heading with nothing
    // under it.
    expect(emotionGroupKeys()).toEqual(['inControl']);
    for (const label of ['Calm', 'Focused']) {
      expect(screen.getByRole('button', { name: label, pressed: false })).toBeVisible();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
    expect(screen.getByRole('button', { name: 'Calm', pressed: true })).toBeVisible();
  });

  it('orders the groups, and gives an unrecognised emotion a home instead of dropping it', () => {
    // A catalog covering all four groups plus one key the layout has never
    // heard of — the eleventh system emotion nobody has seeded yet. It must
    // appear, because a form that silently omits an option the server offered
    // is worse than one that shows it under a vague heading.
    renderWithEmotions([
      { key: 'calm', label: 'Calm' },
      { key: 'fomo', label: 'FOMO' },
      { key: 'revenge', label: 'Revenge' },
      { key: 'fearful', label: 'Fearful' },
      { key: 'tired', label: 'Tired' },
      { key: 'bewildered', label: 'Bewildered' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Context · optional' }));

    expect(emotionGroupKeys()).toEqual(['inControl', 'pushedIn', 'heldBack', 'depleted', 'other']);
    expect(screen.getByRole('button', { name: 'Bewildered' })).toBeVisible();
    // Order within a group follows the catalog the server sent, not the map.
    expect(
      Array.from(
        document.querySelector('[data-emotion-group="pushedIn"]')?.querySelectorAll('button') ?? [],
      ).map((button) => button.textContent),
    ).toEqual(['FOMO', 'Revenge']);
  });

  it('names the primary action for what it does, on each timing', () => {
    const { unmount } = renderForm();
    const openTrade = screen.getByRole('button', { name: 'Open Trade' });
    expect(openTrade).toHaveAttribute('type', 'submit');
    // The product's current primary button, not a one-off.
    expect(openTrade).toHaveAttribute('data-variant', 'default');
    expect(screen.queryByRole('button', { name: 'Save Completed Trade' })).not.toBeInTheDocument();
    unmount();

    renderAfterTrade();
    expect(screen.getByRole('button', { name: 'Save Completed Trade' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open Trade' })).not.toBeInTheDocument();
  });

  it('translates the migrated copy', () => {
    renderForm('th');
    expect(screen.getByText(/บันทึกออเดอร์ก่อนที่จะรู้ผลลัพธ์/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'เปลี่ยน' })).toBeVisible();
  });
});
