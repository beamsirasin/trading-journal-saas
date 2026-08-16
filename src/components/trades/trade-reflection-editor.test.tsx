import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { TradeEmotionsEditor, TradeReviewNotesEditor } from './trade-reflection-editor';

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

function renderEmotions(
  canWrite = true,
  overrides: Partial<React.ComponentProps<typeof TradeEmotionsEditor>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeEmotionsEditor
        tradeId={tradeId}
        emotions={[catalog[1]!]}
        emotionCatalog={catalog}
        emotionsRecorded
        canWrite={canWrite}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

function renderReview(
  canWrite = true,
  overrides: Partial<React.ComponentProps<typeof TradeReviewNotesEditor>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <TradeReviewNotesEditor
        tradeId={tradeId}
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

describe('TradeEmotionsEditor', () => {
  it('replaces the full accessible Emotion selection', async () => {
    renderEmotions();
    const calm = screen.getByRole('button', { name: 'Calm' });
    const fomo = screen.getByRole('button', { name: 'FOMO' });
    expect(calm).toHaveAttribute('aria-pressed', 'false');
    expect(fomo).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(calm);
    fireEvent.click(screen.getByRole('button', { name: 'Save emotions' }));
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith({ tradeId, emotionKeys: ['fomo', 'calm'] }),
    );
  });

  it('renders a read-only localized selection without mutation controls', () => {
    renderEmotions(false);
    expect(screen.getByText('FOMO')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save emotions' })).not.toBeInTheDocument();
  });

  it('distinguishes historical not-recorded from a recorded zero selection', async () => {
    const { unmount } = renderEmotions(true, { emotions: [], emotionsRecorded: false });
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    unmount();

    renderEmotions(true, { emotions: [], emotionsRecorded: true });
    expect(screen.getByText('No emotions selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save emotions' }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith({ tradeId, emotionKeys: [] }));
  });
});

describe('TradeReviewNotesEditor', () => {
  it('saves an edited Review note', async () => {
    renderReview();
    fireEvent.change(screen.getByLabelText('Post-trade review'), {
      target: { value: 'Updated review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    await waitFor(() =>
      expect(reviewMock).toHaveBeenCalledWith({ tradeId, reviewNotes: 'Updated review' }),
    );
  });

  it('renders a read-only Review note without a textbox', () => {
    renderReview(false);
    expect(screen.getByText('Initial review')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renders a calm not-recorded empty state when unset and read-only', () => {
    renderReview(false, { reviewNotes: null });
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
  });
});
