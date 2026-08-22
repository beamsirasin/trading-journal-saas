import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradesViewNav } from './trades-view-nav';

vi.mock('next/navigation', () => ({
  useSearchParams: () =>
    new URLSearchParams(
      'view=log&attention=system-pending&month=2026-08&date=2026-08-20&cursor=current&trail=prior&trade=id&section=system',
    ),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/app/trades',
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('TradesViewNav', () => {
  it('keeps locale-managed path and date filters while making each view addressable', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradesViewNav view="log" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole('link', { name: 'Trade Log' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'href',
      '/app/trades?view=calendar&month=2026-08&date=2026-08-20',
    );
    expect(screen.getByRole('link', { name: 'Trade Log' })).toHaveAttribute(
      'href',
      '/app/trades?view=log&attention=system-pending&month=2026-08&date=2026-08-20&cursor=current&trail=prior',
    );
  });
});
