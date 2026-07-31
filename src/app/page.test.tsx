import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Home from './page';

describe('Home', () => {
  it('renders the product name as the page heading', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1, name: 'Trading OS' })).toBeInTheDocument();
  });

  it('states the system vs trader distinction', () => {
    render(<Home />);
    expect(screen.getByRole('heading', { name: 'System performance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trader performance' })).toBeInTheDocument();
  });

  it('shows placeholders rather than invented metrics', () => {
    render(<Home />);
    // Guards the decision in page.tsx: sample numbers on a trading product
    // read as real performance. There is no data yet, so there are no numbers.
    const placeholders = screen.getAllByLabelText('No data yet');
    expect(placeholders).toHaveLength(2);
    for (const placeholder of placeholders) {
      expect(placeholder).toHaveTextContent('—');
    }
  });

  it('exposes a main landmark', () => {
    render(<Home />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
