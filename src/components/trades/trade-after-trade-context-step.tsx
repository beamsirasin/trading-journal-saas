'use client';

import { HeartPulse } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { NOTES_MAX_LENGTH } from '@/lib/trades/constants';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import type { EmotionsDraft } from './at-entry-draft';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { Helper, StateText, TextAreaField, TextField } from './trade-at-entry-controls';
import { TradeEmotionFields } from './trade-emotion-fields';
import { TradeLauncherRow } from './trade-launcher-row';
import { GroupCard } from './trade-recording-step-parts';

/** The control ids a blocked Save focuses — one per field. */
export function afterTradeContextIds(idPrefix: string) {
  return {
    emotions: `${idPrefix}-post-emotions`,
    note: `${idPrefix}-after-note`,
    tradingviewUrl: `${idPrefix}-after-chart`,
  } as const;
}

/**
 * CANONICAL STAGE 6 — AFTER TRADE (Add Trade contract §9, decision 55; UX
 * Rules §20.5). Shared by Close Existing Open Trade and Record Closed.
 *
 * Two sections, in this order. SYSTEM RESULT (`systemResult`, the host's
 * `TradePlanOutcomeSection`): what the original plan would have produced.
 * Then AFTER-TRADE CONTEXT: how it felt afterwards, a note, and after-trade
 * evidence. Both are optional and factual. Neither is Review — no reflection,
 * mistakes, rules, Exit Plan Adherence or System Assessment — and Stage 6
 * never closes a Trade. Its note and chart link are their own fields, never
 * the entry notes or the before-entry link.
 *
 * Post-Trade Emotion is a launcher into one focused editor (the Step 4 Entry
 * Emotion pattern): Unanswered, None of these, or the emotions chosen, and
 * Unanswered never silently becomes None. The note and the link are direct
 * fields — no overlay between the trader and a sentence.
 *
 * IT OWNS NO SEMANTICS. The host applies every answer to its own draft.
 */
export function TradeAfterTradeContextStep({
  idPrefix,
  emotions,
  catalog,
  note,
  tradingviewUrl,
  errors,
  canDeselectEmotion,
  onToggleEmotion,
  onNoEmotions,
  onRemoveEmotions,
  onNote,
  onTradingviewUrl,
  systemResult = null,
  task,
}: {
  idPrefix: string;
  /**
   * Which task shows Stage 6, for the one sentence that differs. After a Final
   * Close the Trade is already Closed and saved. In Record Closed nothing is
   * saved until the task's own Save, which saves these answers with it.
   */
  task: 'close_existing' | 'record_closed';
  /** Section A, the System Result — rendered first, before the context fields. */
  systemResult?: ReactNode;
  emotions: EmotionsDraft;
  catalog: TradeCreateOptions['emotionCatalog'];
  note: string;
  tradingviewUrl: string;
  errors: { readonly note?: string | undefined; readonly tradingviewUrl?: string | undefined };
  /** The host's own rule: the last chosen emotion is never silently taken away. */
  canDeselectEmotion: (key: string) => boolean;
  onToggleEmotion: (key: string) => void;
  onNoEmotions: () => void;
  onRemoveEmotions: () => void;
  onNote: (value: string) => void;
  onTradingviewUrl: (value: string) => void;
}) {
  const t = useTranslations('trades');
  const s = useTranslations('trades.stage6');
  const c = useTranslations('trades.create.recording.contractEntry');
  const [editor, setEditor] = useState(false);
  const [lastOneHint, setLastOneHint] = useState(false);
  const emotionRow = useRef<HTMLButtonElement>(null);
  const ids = afterTradeContextIds(idPrefix);

  const emotionValue =
    emotions.answer === 'selected'
      ? emotions.keys.map((key) => t(`emotions.${key}`)).join(', ')
      : emotions.answer === 'none'
        ? c('emotions.none')
        : null;

  return (
    <div data-after-trade-context-step="" className="flex min-w-0 flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        {task === 'record_closed' ? s('descriptionRecordClosed') : s('description')}
      </p>

      {systemResult}

      {/* 1 — POST-TRADE EMOTION: how it felt afterwards, apart from Entry Emotion. */}
      <GroupCard title={s('emotion.title')}>
        <TradeLauncherRow
          id={ids.emotions}
          rowRef={emotionRow}
          label={s('emotion.label')}
          value={emotionValue}
          placeholder={c('notAnswered')}
          editLabel={s('emotion.editAria')}
          icon={HeartPulse}
          answered={emotions.answer !== 'unanswered'}
          onOpen={() => setEditor(true)}
          buttonData={{ 'data-post-trade-emotions': emotions.answer }}
        />
      </GroupCard>

      {/* 2 — AFTER-TRADE NOTE: a direct field, never the entry notes. Its label is its heading. */}
      <GroupCard aside={note.trim() === '' ? <StateText>{c('notAnswered')}</StateText> : null}>
        <TextAreaField
          id={ids.note}
          label={s('note.label')}
          value={note}
          onChange={onNote}
          placeholder={s('note.placeholder')}
          maxLength={NOTES_MAX_LENGTH}
          error={errors.note}
        />
      </GroupCard>

      {/* 3 — AFTER-TRADE EVIDENCE: its own chart link, never the before-entry one. */}
      <GroupCard
        title={s('evidence.title')}
        aside={tradingviewUrl.trim() === '' ? <StateText>{c('notAnswered')}</StateText> : null}
        data-after-trade-evidence=""
      >
        <Helper>{s('evidence.hint')}</Helper>
        <TextField
          id={ids.tradingviewUrl}
          label={s('evidence.chart')}
          value={tradingviewUrl}
          onChange={onTradingviewUrl}
          inputMode="url"
          placeholder="https://www.tradingview.com/x/…"
          error={errors.tradingviewUrl}
        />
      </GroupCard>

      <TradeAdaptiveOverlay
        open={editor}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(false);
            setLastOneHint(false);
          }
        }}
        title={s('emotion.label')}
        description={s('emotion.editor')}
        closeLabel={s('close')}
        size="focused"
        returnFocusRef={emotionRow}
        footer={
          <div className="flex min-w-0 justify-end">
            <Button
              type="button"
              onClick={() => {
                setEditor(false);
                setLastOneHint(false);
              }}
            >
              {s('done')}
            </Button>
          </div>
        }
      >
        <TradeEmotionFields
          phase="postTradeEmotions"
          answer={emotions}
          legend={s('emotion.label')}
          removeAria={s('emotion.removeAria')}
          catalog={catalog}
          showLastOneHint={lastOneHint}
          onToggle={(key) => {
            if (!canDeselectEmotion(key)) {
              setLastOneHint(true);
              return;
            }
            setLastOneHint(false);
            onToggleEmotion(key);
          }}
          onNone={() => {
            setLastOneHint(false);
            onNoEmotions();
          }}
          onRemove={() => {
            setLastOneHint(false);
            onRemoveEmotions();
          }}
        />
      </TradeAdaptiveOverlay>
    </div>
  );
}
