import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnimatedNumber } from './animated-number';

describe('AnimatedNumber', () => {
  it('always renders the settled input characters', () => {
    const { rerender } = render(<AnimatedNumber value="27.9" />);
    expect(screen.getByText('27.9')).toHaveAttribute('data-animated-number', '27.9');

    rerender(<AnimatedNumber value="8.4" />);
    expect(screen.getByText('8.4')).toHaveAttribute('data-animated-number', '8.4');
    expect(screen.queryByText(/^(21\.1|16\.7|9\.6)$/)).not.toBeInTheDocument();
  });
});
