import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import type { StrategyRuleDetail, StrategySetupDetail } from '@/server/dal/strategies';

import en from '../../../messages/en.json';
import { RulesManager } from './rules-manager';

vi.mock('@/server/actions/strategies', () => ({
  removeStrategyRuleAction: vi.fn(),
}));

function rule(overrides: Partial<StrategyRuleDetail>): StrategyRuleDetail {
  return {
    ruleId: 'internal-row-id-should-never-render',
    ruleKey: 'rule-key-1',
    category: 'entry',
    title: 'Only after 07:00 London',
    description: null,
    isRequired: true,
    isPreTradeCheck: false,
    sortOrder: 0,
    ...overrides,
  };
}

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

function renderManager(props: Partial<Parameters<typeof RulesManager>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RulesManager
        strategyId="s-1"
        isStrategyArchived={false}
        isCurrentVersionLocked={false}
        strategyLevelRules={[]}
        setupLevelRulesBySetupId={{}}
        setups={[]}
        canWrite={true}
        writeBlockReason={null}
        onMutated={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe('RulesManager grouping', () => {
  it('groups Strategy-level rules under their own heading', () => {
    renderManager({ strategyLevelRules: [rule({ title: 'Only clean breaks' })] });
    expect(screen.getByText('Strategy-level rules')).toBeInTheDocument();
    expect(screen.getByText('Only clean breaks')).toBeInTheDocument();
  });

  it('groups Setup-level rules beneath their own Setup, and never renders the internal Rule row id', () => {
    renderManager({
      setups: [setup({ setupId: 'set-1', name: 'Wave 2 Reversal' })],
      setupLevelRulesBySetupId: {
        'set-1': [rule({ ruleKey: 'rule-key-2', title: 'Stop beyond the failed extreme' })],
      },
    });
    expect(screen.getByText('Wave 2 Reversal')).toBeInTheDocument();
    expect(screen.getByText('Stop beyond the failed extreme')).toBeInTheDocument();
    expect(screen.queryByText('internal-row-id-should-never-render')).not.toBeInTheDocument();
  });

  it('localizes the rule category and shows required/pre-trade-check state', () => {
    renderManager({
      strategyLevelRules: [
        rule({ category: 'invalidation', isRequired: true, isPreTradeCheck: true }),
      ],
    });
    expect(screen.getByText('Invalidation')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Pre-trade check')).toBeInTheDocument();
  });

  it('shows the empty state and no fabricated analytics when there are no rules', () => {
    renderManager();
    expect(screen.getByText('No rules yet')).toBeInTheDocument();
  });

  it('does not offer edit/remove controls when canWrite is false', () => {
    renderManager({
      canWrite: false,
      writeBlockReason: 'over_limit_workspace',
      strategyLevelRules: [rule({ title: 'Only clean breaks' })],
    });
    expect(screen.queryByRole('button', { name: /Edit rule/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove rule/ })).not.toBeInTheDocument();
  });
});
