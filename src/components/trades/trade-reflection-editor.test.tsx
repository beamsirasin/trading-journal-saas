import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradeReflectionEditor } from './trade-reflection-editor';

const replaceMock = vi.fn();
const reviewMock = vi.fn();

vi.mock('@/server/actions/trades', () => ({
  replaceTradeEmotionsAction: (...args: unknown[]) => replaceMock(...args),
  updateTradeReviewNotesAction: (...args: unknown[]) => reviewMock(...args),
}));

const tradeId = '019112a0-0000-7000-8000-000000000001';
const catalog = [
  { key: 'calm', label: 'Calm' },
  { key: 'fomo', label: 'FOMO' },
];

function renderEditor(
  canWrite = true,
  overrides: Partial<React.ComponentProps<typeof TradeReflectionEditor>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeReflectionEditor
        tradeId={tradeId}
        emotions={[catalog[1]!]}
        emotionCatalog={catalog}
        emotionsRecorded
        reviewNotes="Initial review"
        canWrite={canWrite}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replaceMock.mockReset();
  reviewMock.mockReset();
  replaceMock.mockResolvedValue({ ok: true, data: { tradeId, emotionKeys: ['calm', 'fomo'] } });
  reviewMock.mockResolvedValue({ ok: true, data: { tradeId, reviewNotes: 'Updated review' } });
});

describe('TradeReflectionEditor', () => {
  it('replaces the full accessible Emotion selection and saves Review separately', async () => {
    renderEditor();
    const calm = screen.getByRole('button', { name: 'Calm' });
    const fomo = screen.getByRole('button', { name: 'FOMO' });
    expect(calm).toHaveAttribute('aria-pressed', 'false');
    expect(fomo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(calm);
    fireEvent.click(screen.getByRole('button', { name: 'Save emotions' }));
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith({ tradeId, emotionKeys: ['fomo', 'calm'] }),
    );

    fireEvent.change(screen.getByLabelText('Post-trade review'), {
      target: { value: 'Updated review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() =>
      expect(reviewMock).toHaveBeenCalledWith({ tradeId, reviewNotes: 'Updated review' }),
    );
  });

  it('renders a read-only localized reflection without mutation controls', () => {
    renderEditor(false);
    expect(screen.getByText('FOMO')).toBeInTheDocument();
    expect(screen.getByText('Initial review')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save emotions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('distinguishes historical not-recorded from a recorded zero selection', async () => {
    const { unmount } = renderEditor(true, { emotions: [], emotionsRecorded: false });
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    unmount();

    renderEditor(true, { emotions: [], emotionsRecorded: true, reviewNotes: null });
    expect(screen.getByText('No emotions selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save emotions' }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith({ tradeId, emotionKeys: [] }));
  });
});
