import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import en from '../../../messages/en.json';
import { RecordingDraftStatus, type RecordingDraftNotice } from './trade-recording-draft-status';

function renderStatus(notice: RecordingDraftNotice, hasWork: boolean, onDiscard = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RecordingDraftStatus
        compact
        notice={notice}
        hasWork={hasWork}
        onDismissNotice={vi.fn()}
        onDiscard={onDiscard}
      />
    </NextIntlClientProvider>,
  );
  return onDiscard;
}

/*
  AFTER TRADE'S DRAFT STATUS IS ONE ROW. A restored draft is a short muted
  phrase and a quiet Discard; the warnings keep their full sentences.
*/
describe('RecordingDraftStatus, compact', () => {
  it('says a restored draft in one short phrase, long where there is room', () => {
    renderStatus('recovered', true);
    const status = screen.getByRole('status');
    // Both lengths are in the markup; the width decides which one is displayed.
    expect(within(status).getByText('Draft restored')).toHaveClass('min-[360px]:hidden');
    expect(within(status).getByText('Draft restored from this browser')).toHaveClass(
      'hidden',
      'min-[360px]:inline',
    );
    expect(screen.queryByText(/We restored your unsaved/)).toBeNull();
  });

  it('keeps Discard behind the same confirmation, named in full', () => {
    const onDiscard = renderStatus('recovered', true);
    const discard = screen.getByRole('button', { name: 'Discard draft' });
    expect(discard).toHaveTextContent(/^Discard$/);
    fireEvent.click(discard);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard draft' }),
    );
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('still offers Discard while working on a draft that was not restored', () => {
    renderStatus(null, true);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard draft' })).toHaveTextContent(
      'Discard draft',
    );
  });

  it('steps aside for a lone Discard the page has placed elsewhere, but never for a restore', () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RecordingDraftStatus
          compact
          discardElsewhere
          notice={null}
          hasWork
          onDismissNotice={vi.fn()}
          onDiscard={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(document.querySelector('[data-recording-draft-status]')).toBeNull();
    unmount();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RecordingDraftStatus
          compact
          discardElsewhere
          notice="recovered"
          hasWork
          onDismissNotice={vi.fn()}
          onDiscard={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Draft restored');
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
  });

  it('renders nothing with no draft at all', () => {
    renderStatus(null, false);
    expect(document.querySelector('[data-recording-draft-status]')).toBeNull();
  });

  it('keeps a warning as its full sentence', () => {
    renderStatus('not_durable', true);
    expect(screen.getByRole('status')).toHaveTextContent(/isn't keeping drafts right now/);
  });
});
