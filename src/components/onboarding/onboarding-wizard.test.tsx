import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { OnboardingWizard } from './onboarding-wizard';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const completeOnboardingActionMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/server/actions/onboarding', () => ({
  completeOnboardingAction: (...args: unknown[]) => completeOnboardingActionMock(...args),
}));

function renderWizard() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <OnboardingWizard defaultTimezone="Asia/Bangkok" />
    </NextIntlClientProvider>,
  );
}

function fillStepOne() {
  fireEvent.change(screen.getByLabelText('Trading account name'), {
    target: { value: 'My First Account' },
  });
  fireEvent.change(screen.getByLabelText('Starting balance'), { target: { value: '10000' } });
}

function goToStepTwo() {
  fillStepOne();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('OnboardingWizard — step one', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    completeOnboardingActionMock.mockReset();
  });

  it('renders the trading-setup fields', () => {
    renderWizard();
    expect(screen.getByLabelText('Trading account name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Broker/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Platform/)).toBeInTheDocument();
    expect(screen.getByLabelText('Base currency')).toBeInTheDocument();
    expect(screen.getByLabelText('Starting balance')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Live' })).toBeInTheDocument();
  });

  it('identifies optional fields', () => {
    renderWizard();
    expect(screen.getByText('Broker').parentElement).toHaveTextContent('Broker (optional)');
    expect(screen.getByText('Platform').parentElement).toHaveTextContent('Platform (optional)');
  });

  it('blocks Continue and shows an error when the account name is empty', () => {
    renderWizard();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Enter a trading account name.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Risk preferences' })).not.toBeInTheDocument();
  });

  it('advances to step two once step-one fields are valid', () => {
    renderWizard();
    goToStepTwo();

    expect(screen.getByRole('heading', { name: 'Risk preferences' })).toBeInTheDocument();
  });

  it('moves focus to the new step heading after advancing', () => {
    renderWizard();
    goToStepTwo();

    expect(screen.getByRole('heading', { name: 'Risk preferences' })).toHaveFocus();
  });

  it('exposes the current step via aria-current on the step list', () => {
    renderWizard();
    expect(screen.getByRole('listitem', { name: /Trading setup/ })).toHaveAttribute(
      'aria-current',
      'step',
    );

    goToStepTwo();

    expect(screen.getByRole('listitem', { name: /Risk preferences/ })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});

describe('OnboardingWizard — back/continue value preservation', () => {
  beforeEach(() => {
    pushMock.mockClear();
    completeOnboardingActionMock.mockReset();
  });

  it('keeps step-one values after going back from step two', () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText(/Broker/), { target: { value: 'Interactive Brokers' } });
    goToStepTwo();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Trading account name')).toHaveValue('My First Account');
    expect(screen.getByLabelText('Starting balance')).toHaveValue('10000');
    expect(screen.getByLabelText(/Broker/)).toHaveValue('Interactive Brokers');
  });

  it('keeps step-two values after going back to step one and forward again', () => {
    renderWizard();
    goToStepTwo();
    fireEvent.change(screen.getByLabelText(/Default risk per trade/), {
      target: { value: '2' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByLabelText(/Default risk per trade/)).toHaveValue('2');
  });

  it('pre-fills sensible defaults: 1% risk per trade and 3% maximum daily loss', () => {
    renderWizard();
    goToStepTwo();

    expect(screen.getByLabelText(/Default risk per trade/)).toHaveValue('1');
    expect(screen.getByLabelText(/Maximum daily loss/)).toHaveValue('3');
  });
});

describe('OnboardingWizard — final submit', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    completeOnboardingActionMock.mockReset();
  });

  it('sends the expected payload and never a workspaceId/userId field', async () => {
    completeOnboardingActionMock.mockResolvedValue({ ok: true, accountId: 'account-1' });
    renderWizard();
    goToStepTwo();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(completeOnboardingActionMock).toHaveBeenCalledTimes(1));
    const payload = completeOnboardingActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      name: 'My First Account',
      accountMode: 'live',
      baseCurrency: 'USD',
      startingBalance: '10000',
      timezone: 'Asia/Bangkok',
      riskPerTradePercent: '1',
      maximumDailyLossPercent: '3',
    });
    expect(payload).not.toHaveProperty('workspaceId');
    expect(payload).not.toHaveProperty('userId');
  });

  it('redirects to /app on success', async () => {
    completeOnboardingActionMock.mockResolvedValue({ ok: true, accountId: 'account-1' });
    renderWizard();
    goToStepTwo();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app'));
  });

  it('falls back to a plain text timezone input when Intl.supportedValuesOf is unavailable, and blocks submission on an invalid value', async () => {
    type IntlWithSupportedValuesOf = typeof Intl & {
      supportedValuesOf?: ((key: string) => string[]) | undefined;
    };
    const intlWithSupportedValuesOf = Intl as IntlWithSupportedValuesOf;
    const original = intlWithSupportedValuesOf.supportedValuesOf;
    delete intlWithSupportedValuesOf.supportedValuesOf;

    try {
      renderWizard();
      goToStepTwo();

      const timezoneInput = screen.getByLabelText('Timezone');
      expect(timezoneInput.tagName).toBe('INPUT');

      fireEvent.change(timezoneInput, { target: { value: 'Not/AZone' } });
      fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

      await waitFor(() => expect(screen.getByText('Choose a valid timezone.')).toBeInTheDocument());
      expect(completeOnboardingActionMock).not.toHaveBeenCalled();
    } finally {
      intlWithSupportedValuesOf.supportedValuesOf = original;
    }
  });

  it('shows a generic localized message and does not call the action again on a validation-error result', async () => {
    completeOnboardingActionMock.mockResolvedValue({ ok: false, code: 'validation' });
    renderWizard();
    goToStepTwo();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() =>
      expect(
        screen.getByText('Some details are not valid. Please check the form and try again.'),
      ).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a generic localized message for an unexpected-error result', async () => {
    completeOnboardingActionMock.mockResolvedValue({ ok: false, code: 'unexpected' });
    renderWizard();
    goToStepTwo();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

    await waitFor(() =>
      expect(
        screen.getByText('Something went wrong finishing setup. Please try again.'),
      ).toBeInTheDocument(),
    );
  });

  it('prevents a double submission from calling the action twice', async () => {
    let resolveAction: (value: { ok: true; accountId: string }) => void = () => {};
    completeOnboardingActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    renderWizard();
    goToStepTwo();

    const finishButton = screen.getByRole('button', { name: 'Finish' });
    fireEvent.click(finishButton);
    expect(finishButton).toBeDisabled();
    fireEvent.click(finishButton);

    expect(completeOnboardingActionMock).toHaveBeenCalledTimes(1);

    resolveAction({ ok: true, accountId: 'account-1' });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/app'));
  });
});
