import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { ActionableNotice, EntryTimeNotice } from './actionable-notice';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function withIntl(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {children}
    </NextIntlClientProvider>,
  );
}

describe('ActionableNotice', () => {
  it('renders the fact and a specific, filtered deep link — never a bare list link', () => {
    withIntl(
      <ActionableNotice
        fact="5 System Outcomes pending"
        actionLabel="Review"
        href="/app/trades?systemStatus=pending"
      />,
    );
    expect(screen.getByText('5 System Outcomes pending')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Review' });
    expect(link).toHaveAttribute('href', '/app/trades?systemStatus=pending');
  });
});

describe('EntryTimeNotice', () => {
  it('never offers a "complete now" style action, only an optional view action', () => {
    withIntl(
      <EntryTimeNotice
        detail="Not recorded at entry. Excluded from this analysis."
        viewLabel="View trades"
        href="/app/trades"
      />,
    );
    expect(
      screen.getByText('Not recorded at entry. Excluded from this analysis.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View trades' })).toBeInTheDocument();
    expect(screen.queryByText(/complete/i)).not.toBeInTheDocument();
  });

  it('renders with no action at all when no view link is meaningful', () => {
    withIntl(<EntryTimeNotice detail="Not configured." />);
    expect(screen.getByText('Not configured.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
