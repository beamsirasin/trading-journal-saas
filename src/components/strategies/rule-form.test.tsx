import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { RuleFormDialog } from './rule-form';

const createStrategyRuleActionMock = vi.fn();
const updateStrategyRuleActionMock = vi.fn();

vi.mock('@/server/actions/strategies', () => ({
  createStrategyRuleAction: (...args: unknown[]) => createStrategyRuleActionMock(...args),
  updateStrategyRuleAction: (...args: unknown[]) => updateStrategyRuleActionMock(...args),
}));

function renderDialog(node: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  createStrategyRuleActionMock.mockReset();
  updateStrategyRuleActionMock.mockReset();
});

describe('RuleFormDialog — create', () => {
  it('offers Strategy-level and each available Setup as scope options', () => {
    renderDialog(
      <RuleFormDialog
        mode="create"
        strategyId="s-1"
        isCurrentVersionLocked={false}
        availableSetups={[{ setupId: 'set-1', name: 'Wave 2 Reversal' }]}
        defaultSetupId={null}
        defaultSortOrder={0}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByRole('option', { name: 'Strategy-level' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Wave 2 Reversal' })).toBeInTheDocument();
  });

  it('keeps ruleKey stable across a retry within the same open dialog', async () => {
    createStrategyRuleActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    renderDialog(
      <RuleFormDialog
        mode="create"
        strategyId="s-1"
        isCurrentVersionLocked={false}
        availableSetups={[]}
        defaultSetupId={null}
        defaultSortOrder={0}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('Rule title'), {
      target: { value: 'Wait for confirmation' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createStrategyRuleActionMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createStrategyRuleActionMock).toHaveBeenCalledTimes(2));

    const first = (createStrategyRuleActionMock.mock.calls[0]?.[0] as Record<string, unknown>)
      .ruleKey;
    const second = (createStrategyRuleActionMock.mock.calls[1]?.[0] as Record<string, unknown>)
      .ruleKey;
    expect(typeof first).toBe('string');
    expect(first).toBe(second);
  });

  it('omits setupId from the payload for a Strategy-level rule', async () => {
    createStrategyRuleActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected_error' },
    });
    renderDialog(
      <RuleFormDialog
        mode="create"
        strategyId="s-1"
        isCurrentVersionLocked={false}
        availableSetups={[]}
        defaultSetupId={null}
        defaultSortOrder={0}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('Rule title'), {
      target: { value: 'Only clean breaks' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createStrategyRuleActionMock).toHaveBeenCalledTimes(1));
    const payload = createStrategyRuleActionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('setupId');
  });
});

describe('RuleFormDialog — edit', () => {
  it('shows scope as read-only text, not a select', () => {
    renderDialog(
      <RuleFormDialog
        mode="edit"
        strategyId="s-1"
        ruleKey="rule-key-1"
        scopeLabel="Wave 2 Reversal"
        isCurrentVersionLocked={false}
        initialValues={{
          category: 'entry',
          title: 'Wait for confirmation',
          description: '',
          isRequired: true,
          sortOrder: '0',
        }}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Wave 2 Reversal')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Scope' })).not.toBeInTheDocument();
  });

  it('reuses the existing ruleKey rather than generating a new one', async () => {
    updateStrategyRuleActionMock.mockResolvedValue({
      ok: true,
      data: {
        strategyId: 's-1',
        ruleKey: 'rule-key-1',
        versionId: 'v-2',
        versionNumber: 2,
        copied: false,
      },
    });
    renderDialog(
      <RuleFormDialog
        mode="edit"
        strategyId="s-1"
        ruleKey="rule-key-1"
        scopeLabel="Strategy-level"
        isCurrentVersionLocked={false}
        initialValues={{
          category: 'risk',
          title: 'Stop below the range low',
          description: '',
          isRequired: true,
          sortOrder: '0',
        }}
        trigger={<button>Open</button>}
        onSuccess={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateStrategyRuleActionMock).toHaveBeenCalledTimes(1));
    expect(
      (updateStrategyRuleActionMock.mock.calls[0]?.[0] as Record<string, unknown>).ruleKey,
    ).toBe('rule-key-1');
  });
});
