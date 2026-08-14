import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradeQuickSelectField } from './trade-quick-select';

function Harness({
  favorites,
  recents,
  suggestions,
  onToggleFavorite,
}: {
  favorites: readonly string[];
  recents: readonly string[];
  suggestions?: readonly string[] | undefined;
  onToggleFavorite: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <TradeQuickSelectField
      id="symbol"
      label="Symbol"
      value={value}
      onChange={setValue}
      favorites={favorites}
      recents={recents}
      suggestions={suggestions}
      onToggleFavorite={onToggleFavorite}
    />
  );
}

function renderField(props: Partial<React.ComponentProps<typeof Harness>> = {}) {
  const onToggleFavorite = props.onToggleFavorite ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Harness
        favorites={props.favorites ?? []}
        recents={props.recents ?? []}
        suggestions={props.suggestions}
        onToggleFavorite={onToggleFavorite}
      />
    </NextIntlClientProvider>,
  );
  return { onToggleFavorite };
}

describe('TradeQuickSelectField', () => {
  it('still accepts a fully custom typed value', () => {
    renderField();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'NZDJPY' } });
    expect(screen.getByLabelText('Symbol')).toHaveValue('NZDJPY');
  });

  it('renders no default suggestion chips when none are supplied (Symbol has none by design)', () => {
    renderField();
    expect(within(screen.getByRole('group')).queryAllByRole('button')).toHaveLength(0);
  });

  it('fills the value when a favorite/suggestion/recent chip is clicked', () => {
    renderField({ favorites: ['XAUUSD'], recents: ['EURUSD'] });
    fireEvent.click(screen.getByRole('button', { name: 'EURUSD' }));
    expect(screen.getByLabelText('Symbol')).toHaveValue('EURUSD');
  });

  it('toggles favorite status for an existing chip', () => {
    const { onToggleFavorite } = renderField({ favorites: ['XAUUSD'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove XAUUSD from favorites' }));
    expect(onToggleFavorite).toHaveBeenCalledWith('XAUUSD');
  });

  it('offers to add the currently typed custom value to favorites, and hides once it already is one', () => {
    const { onToggleFavorite } = renderField({ favorites: [] });
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'BTCUSD' } });
    const addButton = screen.getByRole('button', { name: 'Add "BTCUSD" to favorites' });
    fireEvent.click(addButton);
    expect(onToggleFavorite).toHaveBeenCalledWith('BTCUSD');
  });

  it('does not offer to add-current when the typed value is already a favorite', () => {
    renderField({ favorites: ['BTCUSD'] });
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'BTCUSD' } });
    expect(
      screen.queryByRole('button', { name: 'Add "BTCUSD" to favorites' }),
    ).not.toBeInTheDocument();
  });

  it('shows default suggestions (Timeframe/Session style) alongside favorites and recents', () => {
    renderField({ suggestions: ['M1', 'M5'], recents: ['H4'] });
    expect(screen.getByRole('button', { name: 'M1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'M5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'H4' })).toBeInTheDocument();
  });
});
