import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AdminOverviewDashboard } from '@/server/services/admin/metrics';

import { AdminOverviewPage } from './admin-overview-page';

/**
 * `AdminOverviewPage` is deliberately `next-intl`-free (Phase 11's EN-only
 * contract) and uses plain `next/link` internals only inside `AdminShell`,
 * not this component — so unlike `analytics-page.test.tsx`, no
 * `NextIntlClientProvider`/`@/i18n/navigation` mock is needed here.
 */

/** Real UTC calendar-day arithmetic — not string padding, which overflows past day 31 for a 30-entry window starting mid-month. */
function thirtyDays(
  startIso: string,
  countFn: (index: number) => number,
): { day: string; count: number }[] {
  const start = new Date(startIso);
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
    );
    const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return { day, count: countFn(i) };
  });
}

function buildDashboard(overrides: Partial<AdminOverviewDashboard> = {}): AdminOverviewDashboard {
  return {
    generatedAt: '2026-08-10T12:00:00.000Z',
    totals: { users: 42, workspaces: 30 },
    subscriptions: {
      byEffectiveStatus: [
        { status: 'trialing', count: 10 },
        { status: 'active', count: 15 },
        { status: 'expired', count: 3 },
        { status: 'canceled', count: 2 },
      ],
      byPlan: [
        { plan: 'starter', count: 5 },
        { plan: 'trader', count: 6 },
        { plan: 'professional', count: 4 },
        { plan: 'none', count: 15 },
      ],
      bySource: [
        { source: 'trial', count: 15 },
        { source: 'paid', count: 14 },
        { source: 'complimentary', count: 1 },
      ],
    },
    activity: {
      newUsers30d: thirtyDays('2026-07-12T00:00:00Z', (i) => i % 3),
      tradesLogged30d: thirtyDays('2026-07-12T00:00:00Z', () => 0),
    },
    ...overrides,
  };
}

describe('AdminOverviewPage', () => {
  it('renders the headline totals', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.getByRole('heading', { name: 'Platform Overview' })).toBeInTheDocument();
    expect(screen.getByText('Total users')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Total workspaces')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('renders subscription status, plan distribution, and source breakdown headings', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.getByRole('heading', { name: 'Subscription status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan distribution' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entitlement source' })).toBeInTheDocument();
    expect(screen.getByText('Trialing')).toBeInTheDocument();
    expect(screen.getByText('No plan (trial)')).toBeInTheDocument();
    expect(screen.getByText('Complimentary')).toBeInTheDocument();
  });

  it('uses truthful "Plan distribution" wording, never "Paid plan distribution"', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.queryByText(/paid plan distribution/i)).not.toBeInTheDocument();
  });

  it('never mislabels complimentary access as paid/revenue', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.getAllByText(/never counted as revenue/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: /^revenue$/i })).not.toBeInTheDocument();
  });

  it('renders the two activity charts with UTC labeling', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.getByRole('heading', { name: 'New users' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trades logged' })).toBeInTheDocument();
    expect(screen.getAllByText('Last 30 days · UTC').length).toBeGreaterThan(0);
  });

  it('renders correctly with every count at zero — no crash, no NaN, no divide-by-zero artifact', () => {
    const zeroed = buildDashboard({
      totals: { users: 0, workspaces: 0 },
      subscriptions: {
        byEffectiveStatus: [
          { status: 'trialing', count: 0 },
          { status: 'active', count: 0 },
          { status: 'expired', count: 0 },
          { status: 'canceled', count: 0 },
        ],
        byPlan: [
          { plan: 'starter', count: 0 },
          { plan: 'trader', count: 0 },
          { plan: 'professional', count: 0 },
          { plan: 'none', count: 0 },
        ],
        bySource: [
          { source: 'trial', count: 0 },
          { source: 'paid', count: 0 },
          { source: 'complimentary', count: 0 },
        ],
      },
      activity: {
        newUsers30d: thirtyDays('2026-07-12T00:00:00Z', () => 0),
        tradesLogged30d: thirtyDays('2026-07-12T00:00:00Z', () => 0),
      },
    });
    render(<AdminOverviewPage dashboard={zeroed} />);
    expect(screen.getByRole('heading', { name: 'Platform Overview' })).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('Infinity')).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('never renders revenue/MRR/ARR, conversion-rate, or last-active/sign-in metrics', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.queryByText(/\bMRR\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bARR\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/conversion rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/last active/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/last sign.?in/i)).not.toBeInTheDocument();
  });

  it('never renders user/Workspace/Trade identifiers or PII — DTO has none, and none is fabricated in presentation', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.queryByText(/@example\./)).not.toBeInTheDocument();
  });

  it('renders no mutation controls — Phase 11C is read-only', () => {
    render(<AdminOverviewPage dashboard={buildDashboard()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
});
