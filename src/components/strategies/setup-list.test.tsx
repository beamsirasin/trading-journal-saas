import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import type { StrategySetupDetail } from '@/server/dal/strategies';

import en from '../../../messages/en.json';
import { SetupList } from './setup-list';

vi.mock('@/server/actions/strategies', () => ({
  archiveSetupAction: vi.fn(),
  restoreSetupAction: vi.fn(),
}));

function setup(overrides: Partial<StrategySetupDetail>): StrategySetupDetail {
  return {
    setupId: 'set-1',
    isSetupArchived: false,
    isEffectivelyAvailable: true,
    setupVersionId: 'sv-1',
    name: 'Wave 2 Reversal',
    description: null,
    sortOrder: 0,
    ...overrides,
  };
}

function renderList(props: Partial<Parameters<typeof SetupList>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SetupList
        strategyId="s-1"
        isStrategyArchived={false}
        isCurrentVersionLocked={false}
        setups={[]}
        ruleCountBySetupId={{}}
        canWrite={true}
        writeBlockReason={null}
        onMutated={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe('SetupList — effective availability', () => {
  it('parent active + Setup active: available', () => {
    renderList({ setups: [setup({ isSetupArchived: false, isEffectivelyAvailable: true })] });
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('parent active + Setup archived: shows archived, not available', () => {
    renderList({
      setups: [setup({ isSetupArchived: true, isEffectivelyAvailable: false })],
    });
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
  });

  it('parent archived + Setup active identity: shows unavailable-because-parent-archived, distinct from "archived"', () => {
    renderList({
      isStrategyArchived: true,
      setups: [setup({ isSetupArchived: false, isEffectivelyAvailable: false })],
    });
    expect(screen.getByText('Unavailable — Strategy archived')).toBeInTheDocument();
    expect(screen.queryByText('Archived')).not.toBeInTheDocument();
  });

  it('parent archived + Setup archived: shows archived (its own state), not the parent-archived reason', () => {
    renderList({
      isStrategyArchived: true,
      setups: [setup({ isSetupArchived: true, isEffectivelyAvailable: false })],
    });
    expect(screen.getByText('Archived')).toBeInTheDocument();
  });
});

describe('SetupList — lifecycle controls', () => {
  it('does not offer Archive/Restore while the parent Strategy is archived', () => {
    renderList({
      isStrategyArchived: true,
      setups: [setup({ isSetupArchived: false, isEffectivelyAvailable: false })],
    });
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('explains that a restore is blocked while the parent Strategy is archived', () => {
    renderList({
      isStrategyArchived: true,
      setups: [setup({ isSetupArchived: true, isEffectivelyAvailable: false })],
    });
    expect(
      screen.getByText(
        'This Setup cannot be restored while its Strategy is archived. Restore the Strategy first.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
  });

  it('does not offer create/edit when canWrite is false (read-only/over-limit workspace)', () => {
    renderList({
      canWrite: false,
      writeBlockReason: 'read_only_workspace',
      setups: [setup({})],
    });
    expect(screen.queryByRole('button', { name: 'New setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'This workspace is read-only. Restore valid subscription access before making changes.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the empty state with no fabricated data when there are no Setups', () => {
    renderList({ setups: [] });
    expect(screen.getByText('No Setups yet')).toBeInTheDocument();
  });
});
