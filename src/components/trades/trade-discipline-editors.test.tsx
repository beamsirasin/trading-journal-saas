import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachTradeMistakeAction,
  removeTradeMistakeAction,
  updateTradeRuleCheckAction,
} from '@/server/actions/trades';

import en from '../../../messages/en.json';
import { TradeMistakesEditor, TradeRulesEditor } from './trade-discipline-editors';

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/server/actions/trades', () => ({
  updateTradeRuleCheckAction: vi.fn(),
  attachTradeMistakeAction: vi.fn(),
  removeTradeMistakeAction: vi.fn(),
}));

const tradeId = '018f0000-0000-7000-8000-000000000001';
const mistakeTypeId = '018f0000-0000-7000-8000-000000000002';

function renderWithMessages(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe('Trade discipline editors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateTradeRuleCheckAction).mockResolvedValue({
      ok: true,
      data: { tradeId, ruleKey: '018f0000-0000-7000-8000-000000000003', checkStatus: 'violated' },
    });
    vi.mocked(attachTradeMistakeAction).mockResolvedValue({
      ok: true,
      data: { tradeId, mistakeTypeId, alreadyAttached: false },
    });
    vi.mocked(removeTradeMistakeAction).mockResolvedValue({
      ok: true,
      data: { tradeId, mistakeTypeId, alreadyRemoved: false },
    });
  });

  it('offers exactly the four Rule states and submits the stable Rule key', async () => {
    const user = userEvent.setup();
    const ruleKey = '018f0000-0000-7000-8000-000000000003';
    renderWithMessages(
      <TradeRulesEditor
        tradeId={tradeId}
        canWrite
        rules={[
          {
            ruleKey,
            scope: 'strategy',
            title: 'Wait for confirmation',
            category: 'entry',
            isRequired: true,
            isPreTradeCheck: true,
            sortOrder: 0,
            checkStatus: 'not_checked',
          },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Rule status for Wait for confirmation' });
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual(
      ['followed', 'violated', 'not_applicable', 'not_checked'],
    );
    expect(screen.getByText(/Entry · Required · Pre-trade check/)).toBeVisible();
    await user.selectOptions(select, 'violated');
    await waitFor(() =>
      expect(updateTradeRuleCheckAction).toHaveBeenCalledWith({
        tradeId,
        ruleKey,
        checkStatus: 'violated',
      }),
    );
  });

  it('keeps the changed Rule control disabled until its full transition settles', async () => {
    const user = userEvent.setup();
    const ruleKey = '018f0000-0000-7000-8000-000000000003';
    let resolveAction: (
      result: Awaited<ReturnType<typeof updateTradeRuleCheckAction>>,
    ) => void = () => undefined;
    vi.mocked(updateTradeRuleCheckAction).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    renderWithMessages(
      <TradeRulesEditor
        tradeId={tradeId}
        canWrite
        rules={[
          {
            ruleKey,
            scope: 'strategy',
            title: 'Wait for confirmation',
            category: 'entry',
            isRequired: true,
            isPreTradeCheck: true,
            sortOrder: 0,
            checkStatus: 'not_checked',
          },
        ]}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Rule status for Wait for confirmation' });
    await user.selectOptions(select, 'followed');
    await waitFor(() => expect(select).toBeDisabled());

    resolveAction({ ok: true, data: { tradeId, ruleKey, checkStatus: 'followed' } });
    await waitFor(() => expect(select).toBeEnabled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('attaches a canonical Mistake with an optional note and no scoring fields', async () => {
    const user = userEvent.setup();
    renderWithMessages(
      <TradeMistakesEditor
        tradeId={tradeId}
        mistakes={[]}
        catalog={[{ mistakeTypeId, key: 'moved_stop', label: 'Moved stop' }]}
        canWrite
      />,
    );
    await user.selectOptions(screen.getByLabelText('Mistake type'), mistakeTypeId);
    await user.type(screen.getByLabelText(/Note/), 'Adjusted after entry');
    await user.click(screen.getByRole('button', { name: 'Attach mistake' }));
    await waitFor(() => expect(attachTradeMistakeAction).toHaveBeenCalledOnce());
    const payload = vi.mocked(attachTradeMistakeAction).mock.calls[0]?.[0];
    expect(payload).toEqual({ tradeId, mistakeTypeId, note: 'Adjusted after entry' });
    expect(payload).not.toHaveProperty('severity');
    expect(payload).not.toHaveProperty('weight');
    await waitFor(() => expect(screen.getByText('Adjusted after entry')).toBeVisible());
    expect(screen.queryByRole('option', { name: 'Moved stop' })).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('removes an attached Mistake by canonical id and hides controls without write access', async () => {
    const mistake = {
      mistakeTypeId,
      key: 'moved_stop',
      label: 'Moved stop',
      severityAtTime: 'moderate' as const,
      weightAtTime: '1.0000',
      note: null,
    };
    const user = userEvent.setup();
    const { rerender } = renderWithMessages(
      <TradeMistakesEditor tradeId={tradeId} mistakes={[mistake]} catalog={[]} canWrite />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(removeTradeMistakeAction).toHaveBeenCalledWith({ tradeId, mistakeTypeId }),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull());
    expect(refresh).not.toHaveBeenCalled();
    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <TradeMistakesEditor tradeId={tradeId} mistakes={[mistake]} catalog={[]} canWrite={false} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});
