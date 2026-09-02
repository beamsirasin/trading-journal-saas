import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import th from '../../../messages/th.json';
import { WizardShell } from './trade-wizard-shell';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const CATALOG = { en, th } as const;

function renderShell(locale: 'en' | 'th' = 'en') {
  const messages = CATALOG[locale];
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <WizardShell
        step={1}
        totalSteps={2}
        eyebrow={messages.trades.create.pageTitle}
        title={messages.trades.create.mode.question}
        description={messages.trades.create.mode.helper}
        exitHref="/app/trades"
      >
        <p>step body</p>
      </WizardShell>
    </NextIntlClientProvider>,
  );
}

/**
 * Fills the catalog's own ICU message the way `next-intl` would, so this file
 * asserts that `aria-valuetext` COMES FROM the catalog — not that it happens
 * to read one particular English sentence. Rewording `stepStatus` in both
 * locales must leave these tests green; hardcoding the rendered string here
 * would turn every copy edit into a test failure and would still not prove the
 * value was translated at all.
 */
function stepStatus(locale: 'en' | 'th', current: number, total: number): string {
  return CATALOG[locale].trades.create.wizard.stepStatus
    .replace('{current}', String(current))
    .replace('{total}', String(total));
}

describe('the wizard shell', () => {
  it('reports progress as a real progressbar, not a decorative bar', () => {
    renderShell();
    const progress = screen.getByRole('progressbar');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '2');
    expect(progress).toHaveAccessibleName(en.trades.create.wizard.progressLabel);
  });

  it('announces the step in words taken from the catalog, in both locales', () => {
    const { unmount } = renderShell('en');
    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      stepStatus('en', 1, 2),
    );
    unmount();

    renderShell('th');
    const thai = screen.getByRole('progressbar');
    expect(thai).toHaveAttribute('aria-valuetext', stepStatus('th', 1, 2));
    // The two locales must not resolve to the same string, which is what would
    // happen if the value were a hardcoded English sentence.
    expect(thai.getAttribute('aria-valuetext')).not.toBe(stepStatus('en', 1, 2));
  });

  it('makes the step question the page heading, and the only one', () => {
    renderShell();
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(en.trades.create.mode.question);
    // The flow's name sits above the question rather than replacing it.
    expect(screen.getByText(en.trades.create.pageTitle)).toBeVisible();
    expect(screen.getByText(en.trades.create.mode.helper)).toBeVisible();
  });

  it('offers two ways out to the same place, named differently', () => {
    renderShell();
    const back = screen.getByRole('link', { name: en.trades.create.backToTrades });
    const close = screen.getByRole('link', { name: en.trades.create.wizard.close });
    expect(back).toHaveAttribute('href', '/app/trades');
    expect(close).toHaveAttribute('href', '/app/trades');
    // Same destination, but never the same control: a reader who has learned
    // the arrow means "back" must not find it announced as "Close".
    expect(back).not.toBe(close);
  });

  it('renders the step it is given', () => {
    renderShell();
    expect(screen.getByText('step body')).toBeVisible();
  });
});
