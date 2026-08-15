import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StrategyListItem } from '@/server/dal/strategies';

import en from '../../../messages/en.json';
import { StrategiesManager } from './strategies-manager';
import type { StrategyDetailView } from './strategy-detail';

const refreshMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: pushMock }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/server/actions/strategies', () => ({
  createStrategyAction: vi.fn(),
  updateStrategyAction: vi.fn(),
  archiveStrategyAction: vi.fn(),
  restoreStrategyAction: vi.fn(),
  createSetupAction: vi.fn(),
  updateSetupAction: vi.fn(),
  archiveSetupAction: vi.fn(),
  restoreSetupAction: vi.fn(),
  createStrategyRuleAction: vi.fn(),
  updateStrategyRuleAction: vi.fn(),
  removeStrategyRuleAction: vi.fn(),
}));

function listItem(overrides: Partial<StrategyListItem> = {}): StrategyListItem {
  return {
    strategyId: 's-1',
    isStrategyArchived: false,
    currentVersion: {
      versionId: 'v-1',
      versionNumber: 1,
      name: 'London breakout',
      description: 'Range break on the London open.',
      notes: null,
      isCurrentVersionLocked: false,
    },
    setupCounts: { total: 0, effectiveAvailable: 0, individuallyArchived: 0 },
    ruleCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function detail(overrides: Partial<StrategyDetailView> = {}): StrategyDetailView {
  return {
    strategyId: 's-1',
    isStrategyArchived: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    currentVersion: {
      versionId: 'v-1',
      versionNumber: 1,
      name: 'London breakout',
      description: 'Range break on the London open.',
      notes: null,
      isCurrentVersionLocked: false,
    },
    setups: [],
    setupConditionsBySetupId: {},
    strategyLevelRules: [],
    setupLevelRulesBySetupId: {},
    versionCount: 1,
    versionHistory: [],
    ...overrides,
  };
}

function renderManager(props: Partial<Parameters<typeof StrategiesManager>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StrategiesManager
        strategies={[listItem()]}
        selectedStrategy={null}
        selectedStrategyId={null}
        canWrite={true}
        writeBlockReason={null}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  refreshMock.mockClear();
  pushMock.mockClear();
});

describe('StrategiesManager — empty state', () => {
  it('shows a first-action empty state with no fabricated data when there are no Strategies', () => {
    renderManager({ strategies: [] });
    expect(screen.getByText('No Strategies yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New strategy' })).toBeInTheDocument();
    expect(screen.queryByText(/win rate/i)).not.toBeInTheDocument();
  });

  it('does not offer Create when the workspace cannot write', () => {
    renderManager({ strategies: [], canWrite: false, writeBlockReason: 'read_only_workspace' });
    expect(screen.queryByRole('button', { name: 'New strategy' })).not.toBeInTheDocument();
  });
});

describe('StrategiesManager — list and selection', () => {
  it('renders the Strategy list with real DAL fields, not fixture content', () => {
    renderManager();
    expect(screen.getByText('London breakout')).toBeInTheDocument();
    expect(screen.getByText('Range break on the London open.')).toBeInTheDocument();
  });

  it('marks the selected Strategy card as current', () => {
    renderManager({ selectedStrategyId: 's-1', selectedStrategy: detail() });
    expect(screen.getByRole('link', { name: /London breakout/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('StrategiesManager — Strategy detail', () => {
  it('shows an archived Strategy as readable with Restore instead of Edit/Archive, and no hard-delete control anywhere', () => {
    renderManager({
      selectedStrategyId: 's-1',
      selectedStrategy: detail({ isStrategyArchived: true }),
    });
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('opening the Archive confirmation explains archive-not-delete without mentioning irreversible removal', () => {
    renderManager({ selectedStrategyId: 's-1', selectedStrategy: detail() });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/Archiving is not deletion/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it('shows the mobile back-to-list control when a Strategy is selected', () => {
    renderManager({ selectedStrategyId: 's-1', selectedStrategy: detail() });
    expect(screen.getByRole('button', { name: /Back to strategies/ })).toBeInTheDocument();
  });

  it('shows the current-Version and locked/editable state', () => {
    renderManager({
      selectedStrategyId: 's-1',
      selectedStrategy: detail({
        currentVersion: {
          versionId: 'v-2',
          versionNumber: 2,
          name: 'London breakout',
          description: null,
          notes: null,
          isCurrentVersionLocked: true,
        },
        versionCount: 2,
      }),
    });
    expect(screen.getByText('Current version 2')).toBeInTheDocument();
    expect(screen.getByText('Locked version')).toBeInTheDocument();
  });
});

describe('StrategiesManager — access-mode gating', () => {
  it('disables mutations and explains why under a read-only workspace', () => {
    renderManager({
      canWrite: false,
      writeBlockReason: 'read_only_workspace',
      selectedStrategyId: 's-1',
      selectedStrategy: detail(),
    });
    expect(
      screen.getAllByText(
        'This workspace is read-only. Restore valid subscription access before making changes.',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
  });

  it('disables mutations and explains why when the workspace is over its limit', () => {
    renderManager({
      canWrite: false,
      writeBlockReason: 'over_limit_workspace',
      selectedStrategyId: 's-1',
      selectedStrategy: detail(),
    });
    expect(
      screen.getAllByText(
        'This workspace is over its active-account limit. Archive an active account before making other changes.',
      ).length,
    ).toBeGreaterThan(0);
  });
});
