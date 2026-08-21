import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { STATUS_KINDS, type StatusKind } from '@/lib/status/status-kind';

import en from '../../../messages/en.json';
import { StatusBadge } from './status-badge';

function renderBadge(kind: StatusKind, label?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StatusBadge kind={kind} {...(label === undefined ? {} : { label })} />
    </NextIntlClientProvider>,
  );
}

describe('StatusBadge', () => {
  it.each(STATUS_KINDS)('renders accessible text for "%s" from the shared vocabulary', (kind) => {
    renderBadge(kind);
    // Every state must render SOME visible text — status is never colour-only.
    expect(screen.getByText(/.+/)).toBeInTheDocument();
  });

  it('renders the default vocabulary label for "complete"', () => {
    renderBadge('complete');
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('renders the default vocabulary label for "error", reserved for genuine errors', () => {
    renderBadge('error');
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('lets a call site override the label without changing the underlying kind', () => {
    renderBadge('active', 'Open');
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('distinguishes the three neutral "nothing recorded" states by text, not colour alone', () => {
    const first = renderBadge('not_recorded');
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    first.unmount();

    const second = renderBadge('not_recorded_at_entry');
    expect(screen.getByText('Not recorded at entry')).toBeInTheDocument();
    second.unmount();

    renderBadge('not_configured');
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });
});
