import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../../messages/en.json';
import { AfterTradeForm } from './after-trade-form';
import { AtEntryForm } from './at-entry-form';

function renderForm(form: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {form}
    </NextIntlClientProvider>,
  );
}

function openTradeIdea() {
  fireEvent.click(screen.getByRole('button', { name: /Trade idea/ }));
}

function saveButton() {
  return screen.getByRole('button', { name: 'Save closed trade' });
}

function saveFooter() {
  return saveButton().closest('[data-form-footer]') as HTMLElement;
}

describe('Pass 6B Fully closed polish', () => {
  it('asks the Trade idea question in retrospective language', () => {
    renderForm(<AfterTradeForm />);
    openTradeIdea();

    expect(screen.getByLabelText('Why did you take this trade?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Why are you taking this trade?')).toBeNull();
  });

  it('keeps the At Entry Trade idea question in present tense', () => {
    renderForm(<AtEntryForm />);
    openTradeIdea();

    expect(screen.getByLabelText('Why are you taking this trade?')).toBeInTheDocument();
    expect(screen.queryByLabelText('Why did you take this trade?')).toBeNull();
  });

  it('renders the complete Break-even label without truncation', () => {
    renderForm(<AfterTradeForm />);

    const text = screen.getByText('Break-even');
    expect(text).toHaveClass('whitespace-normal');
    expect(text).not.toHaveClass('truncate');
  });

  it('keeps all three result choices in a bounded equal-height narrow layout', () => {
    renderForm(<AfterTradeForm />);

    const breakEven = screen.getByText('Break-even').closest('label');
    const choices = breakEven?.parentElement?.parentElement;
    expect(choices).toHaveClass('grid', 'min-w-0', 'grid-cols-3');
    for (const label of ['Profit', 'Loss', 'Break-even']) {
      expect(screen.getByText(label).closest('label')).toHaveClass('h-full', 'min-h-12');
    }
  });

  it('suppresses the mobile-global Save while an exit editor is active', () => {
    renderForm(<AfterTradeForm filled exits />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit exit 1' }));

    expect(saveFooter()).toHaveAttribute('data-mobile-suppressed', 'true');
    expect(saveFooter()).toHaveClass('max-lg:hidden');
    expect(screen.getByRole('button', { name: 'Update exit' })).toBeInTheDocument();
  });

  it('restores Save after updating, including repeated editing', () => {
    const onSave = vi.fn();
    renderForm(<AfterTradeForm filled exits onSave={onSave} />);

    for (const index of [1, 2]) {
      fireEvent.click(screen.getByRole('button', { name: `Edit exit ${index}` }));
      expect(saveFooter()).toHaveAttribute('data-mobile-suppressed', 'true');
      fireEvent.click(screen.getByRole('button', { name: 'Update exit' }));
      expect(saveFooter()).toHaveAttribute('data-mobile-suppressed', 'false');
    }

    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('restores Save when the active exit editor is closed with its disclosure', () => {
    renderForm(<AfterTradeForm filled exits />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit exit 1' }));
    expect(saveFooter()).toHaveAttribute('data-mobile-suppressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Hide exit details' }));
    expect(saveFooter()).toHaveAttribute('data-mobile-suppressed', 'false');
  });

  it('leaves the desktop Save visible while the mobile bar is suppressed', () => {
    renderForm(<AfterTradeForm filled exits activeExit="e1" />);

    expect(saveFooter()).toHaveClass('max-lg:hidden', 'lg:static');
    expect(saveFooter()).not.toHaveClass('hidden');
  });
});
