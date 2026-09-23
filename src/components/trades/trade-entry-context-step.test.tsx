import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TradeCreateOptions } from '@/server/dal/trades';

import en from '../../../messages/en.json';
import * as afterTrade from './after-trade-draft';
import * as atEntry from './at-entry-draft';
import { TradeEntryContextStep, type EntryContextMode } from './trade-entry-context-step';

vi.setConfig({ testTimeout: 15_000 });
afterEach(cleanup);

const ACCOUNT_ID = '018f0000-0000-7000-8000-000000000001';
const catalog = [
  { key: 'calm', label: 'Calm' },
  { key: 'focused', label: 'Focused' },
] as const satisfies TradeCreateOptions['emotionCatalog'];

type Hosted = { entry: atEntry.AtEntryDraft; after: afterTrade.AfterTradeDraft };
let latest: Hosted;

/**
 * THE STEP, HOSTED THE WAY EACH FORM HOSTS IT: its own draft and its own
 * module's transitions. The drafts are never merged.
 */
function Host({
  mode,
  plannedRiskState = 'defined',
}: {
  mode: EntryContextMode;
  plannedRiskState?: atEntry.RiskStateDraft;
}) {
  const [drafts, setDrafts] = useState<Hosted>(() => ({
    entry: atEntry.createAtEntryDraft(ACCOUNT_ID),
    after: afterTrade.createAfterTradeDraft(ACCOUNT_ID),
  }));
  useEffect(() => {
    latest = drafts;
  }, [drafts]);
  const entry = (change: (draft: atEntry.AtEntryDraft) => atEntry.AtEntryDraft) =>
    setDrafts((current) => ({ ...current, entry: change(current.entry) }));
  const after = (change: (draft: afterTrade.AfterTradeDraft) => afterTrade.AfterTradeDraft) =>
    setDrafts((current) => ({ ...current, after: change(current.after) }));

  const entryRisk = drafts.entry.actualRisk;
  const afterRisk = drafts.after.actualRisk;

  return mode === 'at_entry' ? (
    <TradeEntryContextStep
      mode="at_entry"
      idPrefix="entry"
      currency="USD"
      plannedRiskState={plannedRiskState}
      actualRisk={
        entryRisk.mode === 'different'
          ? { kind: 'different', amount: entryRisk.amount }
          : entryRisk.mode === 'different_unknown'
            ? { kind: 'different_unknown' }
            : entryRisk.mode === 'matched'
              ? { kind: 'matched' }
              : { kind: 'not_recorded' }
      }
      actualRiskEditor={
        <div>
          <button
            type="button"
            onClick={() => entry((d) => atEntry.setActualRiskMode(d, 'matched'))}
          >
            It matched
          </button>
          <button type="button" onClick={() => entry((d) => atEntry.setActualRiskAmount(d, '150'))}>
            It was different
          </button>
        </div>
      }
      confidence={drafts.entry.confidence}
      emotions={drafts.entry.emotions}
      catalog={catalog}
      values={drafts.entry.context}
      canDeselectEmotion={(key) => atEntry.canDeselectEmotion(drafts.entry, key)}
      onConfidence={(value) => entry((draft) => atEntry.setConfidence(draft, value))}
      onToggleEmotion={(key) => entry((draft) => atEntry.toggleEmotion(draft, key))}
      onNoEmotions={() => entry(atEntry.answerNoEmotions)}
      onRemoveEmotions={() => entry(atEntry.removeEmotionsAnswer)}
      onChange={(patch) =>
        entry((draft) => ({ ...draft, context: { ...draft.context, ...patch } }))
      }
    />
  ) : (
    <TradeEntryContextStep
      mode="after_trade"
      idPrefix="after"
      currency="USD"
      plannedRiskState={plannedRiskState}
      actualRisk={
        afterRisk.answer === 'matched'
          ? { kind: 'matched' }
          : afterRisk.answer === 'different'
            ? { kind: 'different', amount: afterRisk.amount }
            : afterRisk.answer === 'unknown'
              ? { kind: 'unknown' }
              : { kind: 'not_recorded' }
      }
      actualRiskEditor={
        <div>
          {(['matched', 'different', 'unknown'] as const).map((answer) => (
            <button
              key={answer}
              type="button"
              onClick={() => after((d) => afterTrade.setActualRiskAnswer(d, answer))}
            >
              {answer}
            </button>
          ))}
        </div>
      }
      confidence={drafts.after.confidence}
      emotions={drafts.after.emotions}
      catalog={catalog}
      values={drafts.after.context}
      canDeselectEmotion={(key) => afterTrade.canDeselectEmotion(drafts.after.emotions, key)}
      onConfidence={(value) => after((draft) => afterTrade.setConfidence(draft, value))}
      onToggleEmotion={(key) => after((draft) => afterTrade.toggleEmotion(draft, 'emotions', key))}
      onNoEmotions={() => after((draft) => afterTrade.answerNoEmotions(draft, 'emotions'))}
      onRemoveEmotions={() => after((draft) => afterTrade.removeEmotionsAnswer(draft, 'emotions'))}
      onChange={(patch) =>
        after((draft) => ({ ...draft, context: { ...draft.context, ...patch } }))
      }
    />
  );
}

function renderStep(
  mode: EntryContextMode,
  options: { plannedRiskState?: atEntry.RiskStateDraft } = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <Host mode={mode} {...options} />
    </NextIntlClientProvider>,
  );
}

const WORDING = {
  at_entry: { confidence: 'Confidence', emotions: 'How you feel as you enter' },
  after_trade: { confidence: 'Confidence at entry', emotions: 'How you felt as you entered' },
} as const;

function hosted(mode: EntryContextMode) {
  return mode === 'at_entry' ? latest.entry : latest.after;
}

function emotionRow(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-entry-emotions]')!;
}

const MODES: readonly EntryContextMode[] = ['at_entry', 'after_trade'];

describe('Entry Context — what the step holds', () => {
  it.each(MODES)('asks only entry-time questions (%s)', (mode) => {
    renderStep(mode);
    const confidence = screen.getByRole('group', { name: WORDING[mode].confidence });
    expect(within(confidence).getAllByRole('radio')).toHaveLength(5);
    expect(emotionRow()).toHaveTextContent('Not answered');
    expect(screen.getByLabelText('Why this trade')).toHaveValue('');
    expect(screen.getByLabelText('Timeframe')).toHaveValue('');
    expect(screen.getByLabelText('Session')).toHaveValue('');
    expect(screen.getByLabelText('Notes')).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'Entry notes' })).toBeInTheDocument();
    const evidence = document.querySelector<HTMLElement>('[data-entry-evidence]')!;
    expect(within(evidence).getByRole('heading', { name: 'Before-entry evidence' })).toBeVisible();
    expect(within(evidence).getByLabelText('Chart link')).toHaveValue('');
    // Actual Risk is asked HERE since contract decision 53: an execution fact
    // recorded with the entry, never with the plan.
    expect(
      document.getElementById(`${mode === 'at_entry' ? 'entry' : 'after'}-actual-risk-row`),
    ).toHaveTextContent('Actual risk');
    // Nothing from later stages, and no upload that could orphan a file.
    for (const absent of [
      /feel about the trade now/i,
      /net p&l/i,
      /^win$/i,
      /system/i,
      /followed|violated|mistake/i,
      /price levels/i,
    ]) {
      expect(screen.queryByText(absent)).toBeNull();
    }
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it.each(MODES)('uses the wording of its moment (%s)', (mode) => {
    renderStep(mode);
    expect(screen.getByRole('group', { name: WORDING[mode].confidence })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Edit ${WORDING[mode].emotions}` }),
    ).toBeInTheDocument();
  });
});

describe('Entry Context — Confidence has no default', () => {
  it.each(MODES)('is Unanswered until chosen, and returns only by Remove answer (%s)', (mode) => {
    renderStep(mode);
    const group = screen.getByRole('group', { name: WORDING[mode].confidence });
    for (const radio of within(group).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(hosted(mode).confidence).toBeNull();
    fireEvent.click(within(group).getByRole('radio', { name: 'High' }));
    expect(hosted(mode).confidence).toBe(75);
    fireEvent.click(screen.getByRole('button', { name: 'Remove confidence answer' }));
    expect(hosted(mode).confidence).toBeNull();
    expect(within(group).getByRole('radio', { name: 'High' })).not.toBeChecked();
  });
});

describe('Entry Context — Entry Emotion', () => {
  it.each(MODES)(
    'keeps Unanswered, None of these and chosen emotions distinct (%s)',
    async (mode) => {
      renderStep(mode);
      fireEvent.click(screen.getByRole('button', { name: `Edit ${WORDING[mode].emotions}` }));
      const editor = within(screen.getByRole('dialog'));
      fireEvent.click(editor.getByRole('button', { name: 'Calm' }));
      expect(hosted(mode).emotions).toEqual({ answer: 'selected', keys: ['calm'] });

      // The last chosen emotion is never silently taken away: the trader is told how.
      fireEvent.click(editor.getByRole('button', { name: 'Calm' }));
      expect(hosted(mode).emotions).toEqual({ answer: 'selected', keys: ['calm'] });
      expect(
        editor.getByText('To clear this answer, choose None of these or Remove answer.'),
      ).toBeInTheDocument();

      fireEvent.click(editor.getByRole('button', { name: 'None of these' }));
      expect(hosted(mode).emotions.answer).toBe('none');
      fireEvent.click(editor.getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(emotionRow()).toHaveTextContent('None of these');
      expect(emotionRow()).toHaveAttribute('data-entry-emotions', 'none');

      fireEvent.click(screen.getByRole('button', { name: `Edit ${WORDING[mode].emotions}` }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove emotions answer' }),
      );
      expect(hosted(mode).emotions.answer).toBe('unanswered');
    },
  );

  it.each(MODES)(
    'Escape keeps what was chosen, and reads it back on the row (%s)',
    async (mode) => {
      renderStep(mode);
      fireEvent.click(screen.getByRole('button', { name: `Edit ${WORDING[mode].emotions}` }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Calm' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Focused' }));
      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(emotionRow()).toHaveTextContent('Calm, Focused');
      expect(hosted(mode).emotions).toEqual({ answer: 'selected', keys: ['calm', 'focused'] });
    },
  );
});

describe('Entry Context — the typed context', () => {
  it.each(MODES)('writes each answer to its own field, and blank stays blank (%s)', (mode) => {
    renderStep(mode);
    fireEvent.change(screen.getByLabelText('Why this trade'), {
      target: { value: 'Clean retest of the London high.' },
    });
    fireEvent.change(screen.getByLabelText('Timeframe'), { target: { value: '15m' } });
    fireEvent.change(screen.getByLabelText('Chart link'), {
      target: { value: 'https://www.tradingview.com/x/abc123/' },
    });
    expect(hosted(mode).context).toMatchObject({
      reason: 'Clean retest of the London high.',
      timeframe: '15m',
      session: '',
      notes: '',
      tradingviewUrl: 'https://www.tradingview.com/x/abc123/',
      // Price levels are Plan & Risk's; this step never writes them.
      entryPrice: '',
      stopPrice: '',
      positionSize: '',
    });
  });
});

/*
  ACTUAL RISK LIVES HERE NOW (contract decision 53): an execution fact asked
  with the rest of the entry's context, never with the plan. Its three states
  stay apart, and an untouched draft asserts none of them (decision 52).
*/
describe('Entry Context — Actual Risk, the execution fact', () => {
  const MODES: readonly EntryContextMode[] = ['at_entry', 'after_trade'];

  function riskRow(mode: EntryContextMode): HTMLElement {
    return document.getElementById(`${mode === 'at_entry' ? 'entry' : 'after'}-actual-risk-row`)!;
  }

  it.each(MODES)('starts Unanswered and claims no match (%s)', (mode) => {
    renderStep(mode);
    expect(riskRow(mode)).toHaveAttribute('data-actual-risk-summary', 'not_recorded');
    expect(riskRow(mode)).toHaveTextContent('Not answered');
    expect(riskRow(mode)).not.toHaveTextContent(/matched/i);
    // Nothing opens until it is asked for.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(MODES)('reads a stated Matched back on the row (%s)', (mode) => {
    renderStep(mode);
    fireEvent.click(riskRow(mode));
    const editor = within(screen.getByRole('dialog'));
    fireEvent.click(
      editor.getByRole('button', { name: mode === 'at_entry' ? 'It matched' : 'matched' }),
    );
    expect(riskRow(mode)).toHaveAttribute('data-actual-risk-summary', 'matched');
    expect(riskRow(mode)).toHaveTextContent('Matched risk at entry');
  });

  it.each(MODES)('reads an explicit Different back with its amount (%s)', (mode) => {
    renderStep(mode);
    fireEvent.click(riskRow(mode));
    const editor = within(screen.getByRole('dialog'));
    fireEvent.click(
      editor.getByRole('button', { name: mode === 'at_entry' ? 'It was different' : 'different' }),
    );
    expect(riskRow(mode)).toHaveAttribute('data-actual-risk-summary', 'different');
    if (mode === 'at_entry') expect(riskRow(mode)).toHaveTextContent('Actual risk 150 USD');
  });

  it('keeps After Trade\'s "Don\'t know" as its own answer, never as Matched', () => {
    renderStep('after_trade');
    fireEvent.click(riskRow('after_trade'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'unknown' }));
    expect(riskRow('after_trade')).toHaveAttribute('data-actual-risk-summary', 'unknown');
    expect(riskRow('after_trade')).toHaveTextContent('Actual risk not known');
  });
});

/*
  ACTUAL RISK NEEDS A PLAN TO COMPARE WITH (contract decision 54). On a Trade
  whose trader said there was no planned 1R, "did what you risked match your
  plan?" has no answer, so the row says the question does not apply instead of
  offering Matched / Different against nothing.
*/
describe('Entry Context — Actual Risk needs a planned risk', () => {
  function riskRow(): HTMLElement {
    return document.getElementById('entry-actual-risk-row')!;
  }

  it('asks the question when a risk was defined', () => {
    renderStep('at_entry', { plannedRiskState: 'defined' });
    expect(riskRow()).toHaveAttribute('data-actual-risk-summary', 'not_recorded');
    expect(riskRow()).not.toBeDisabled();
  });

  it('does not ask it when the trader defined no risk', () => {
    renderStep('at_entry', { plannedRiskState: 'no_defined' });
    expect(riskRow()).toHaveAttribute('data-actual-risk-summary', 'not_applicable');
    expect(riskRow()).toHaveTextContent('Not applicable — no planned risk was defined.');
    expect(riskRow()).toBeDisabled();
    // And nothing opens: there is no answer to give.
    fireEvent.click(riskRow());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
