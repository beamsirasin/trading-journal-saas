import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import { AfterTradeForm } from './after-trade-form';
import { AtEntryForm } from './at-entry-form';

function show(form: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {form}
    </NextIntlClientProvider>,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Save open trade' });

describe('Pass 7B At Entry save contract', () => {
  it('opens quietly with an enabled Save', () => {
    show(<AtEntryForm />);

    expect(saveButton()).toBeEnabled();
    expect(screen.queryByText('Enter the symbol you are trading.')).toBeNull();
    expect(screen.queryByText('Choose Long or Short.')).toBeNull();
    expect(screen.queryByText('Enter your risk at entry.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('waits for Save, then names every required At Entry field', () => {
    const onSave = vi.fn();
    show(<AtEntryForm onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'XAUUSD' } });
    expect(screen.queryByText('Choose Long or Short.')).toBeNull();
    expect(screen.queryByText('Enter your risk at entry.')).toBeNull();

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: '' } });
    fireEvent.click(saveButton());

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText('Enter the symbol you are trading.')).toHaveLength(2);
    expect(screen.getAllByText('Choose Long or Short.')).toHaveLength(2);
    expect(screen.getAllByText('Enter your risk at entry.')).toHaveLength(2);
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(saveButton()).toBeEnabled();
    expect(saveButton()).toHaveAttribute('aria-describedby');
  });

  it('clears only the corrected field after an attempted Save', () => {
    show(<AtEntryForm />);
    fireEvent.click(saveButton());

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'XAUUSD' } });

    expect(screen.queryByText('Enter the symbol you are trading.')).toBeNull();
    expect(screen.getAllByText('Choose Long or Short.')).toHaveLength(2);
    expect(screen.getAllByText('Enter your risk at entry.')).toHaveLength(2);
  });

  it('invokes the injectable seam with the valid At Entry draft', () => {
    const onSave = vi.fn();
    show(<AtEntryForm onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'XAUUSD' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Long' }));
    fireEvent.change(screen.getByLabelText('Risk at entry'), { target: { value: '200.00' } });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      symbol: 'XAUUSD',
      direction: 'long',
      riskAtEntry: '200.00',
      enteredAt: { date: '2026-09-07', time: '14:32' },
      targetProfit: '',
      noFixedTarget: false,
    });
  });
});

describe('Pass 7B lifecycle-aware Trade idea copy', () => {
  it('uses present tense throughout At Entry without replacing the shared editor', () => {
    show(<AtEntryForm />);

    const launcher = screen.getByRole('button', { name: /Trade idea/ });
    expect(launcher).toHaveTextContent('Why are you taking this trade?');
    expect(launcher).not.toHaveTextContent('Why did you take this trade?');
    fireEvent.click(launcher);

    expect(
      screen.getByText(
        'Why you are taking this trade, and anything you want to remember about it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Why are you taking this trade?')).toBeInTheDocument();
    expect(screen.getByText('Strategy & setup')).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
    expect(screen.queryByText('Why did you take this trade?')).toBeNull();
  });

  it('keeps Fully Closed retrospective throughout the same shared editor', () => {
    show(<AfterTradeForm />);

    const launcher = screen.getByRole('button', { name: /Trade idea/ });
    expect(launcher).toHaveTextContent('Why did you take this trade?');
    expect(launcher).not.toHaveTextContent('Why are you taking this trade?');
    fireEvent.click(launcher);

    expect(
      screen.getByText('Why you took this trade, and anything you want to remember about it.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Why did you take this trade?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Why are you taking this trade?')).toBeNull();
  });
});
