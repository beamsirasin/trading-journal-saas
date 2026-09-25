'use client';

import { HeartPulse } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { CONFIDENCE_LEVELS } from '@/lib/trades/constants';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import type { ContextDraft, EmotionsDraft } from './at-entry-draft';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import {
  ChoiceGroup,
  InlineAction,
  StateText,
  TextAreaField,
  TextField,
} from './trade-at-entry-controls';
import { TradeEmotionFields } from './trade-emotion-fields';
import { TradeLauncherRow } from './trade-launcher-row';
import { GroupCard } from './trade-recording-step-parts';

/** The recording moment this step is shown in. It decides wording, never meaning. */
export type EntryContextMode = 'at_entry' | 'after_trade';

/** The entry-time context fields this step asks. Price levels are Plan & Risk's. */
export type EntryContextValues = Pick<
  ContextDraft,
  'reason' | 'timeframe' | 'session' | 'notes' | 'tradingviewUrl'
>;

/**
 * ENTRY CONTEXT & EVIDENCE — canonical lifecycle Step 4, one component for both
 * recording moments (Add Trade contract §6, §9, §13; UX Rules §20.1, §20.12).
 *
 * WHAT THE TRADER KNEW, THOUGHT AND FELT AROUND ENTRY — and nothing later.
 * Confidence and Entry Emotion, why this trade, timeframe and session, the
 * entry notes, and before-entry evidence. Post-Trade Emotion, the result and
 * anything Review asks belong to other stages and never appear here.
 *
 * NO RISK QUESTION (contract decision 56). The Trade's one risk figure is the
 * 1R set in Risk & target; Actual Risk is retired from capture, so this step
 * asks no second risk value in either recording moment.
 *
 * THREE GROUPS: Entry mindset (Confidence, Entry Emotion), Entry context (why
 * this trade, timeframe, session) and Notes & evidence. The stage's one
 * subtitle is the step header's; nothing here repeats it.
 *
 * DIRECT WHERE A TAP WOULD BE WASTED. Confidence is one tap on a light
 * five-point scale on the step itself, and the text answers are typed where
 * they are asked. Only the
 * emotion question — a long multi-choice list — opens a focused editor from a
 * launcher row, which reads back what was chosen.
 *
 * EVERY ANSWER KEEPS ITS OWN STATE. Confidence has no default and returns to
 * Unanswered only through Remove answer; Entry Emotion is Unanswered, None of
 * these, or the emotions chosen. Blank text stays blank.
 *
 * EVIDENCE IS ONE CONCEPT. Today it holds the chart link; an uploaded image
 * can join it later as another item of the same "Before-entry evidence"
 * without changing what the Trade records. It is context, never a result.
 *
 * IT OWNS NO SEMANTICS: every change goes through the host's own draft
 * transitions, so the draft models stay separate.
 */
export function TradeEntryContextStep({
  mode,
  idPrefix,
  confidence,
  emotions,
  catalog,
  values,
  errors = {},
  canDeselectEmotion,
  onConfidence,
  onToggleEmotion,
  onNoEmotions,
  onRemoveEmotions,
  onChange,
}: {
  mode: EntryContextMode;
  /** Prefix for DOM ids, so each host keeps the ids it already had. */
  idPrefix: string;
  /** `null` is Unanswered; there is no default. */
  confidence: number | null;
  emotions: EmotionsDraft;
  catalog: TradeCreateOptions['emotionCatalog'];
  values: EntryContextValues;
  /** The host validation’s error for an answer on this step, already worded. */
  errors?: { readonly tradingviewUrl?: string | undefined };
  /** The host's own rule: the last chosen emotion is never silently taken away. */
  canDeselectEmotion: (key: string) => boolean;
  onConfidence: (confidence: number | null) => void;
  onToggleEmotion: (key: string) => void;
  onNoEmotions: () => void;
  onRemoveEmotions: () => void;
  onChange: (patch: Partial<EntryContextValues>) => void;
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const cx = useTranslations('trades.create.recording.contractEntry.context');
  const e = useTranslations('trades.create.recording.entryContextStep');
  const atEntry = mode === 'at_entry';
  const [emotionEditor, setEmotionEditor] = useState(false);
  const [lastOneHint, setLastOneHint] = useState(false);
  const emotionRow = useRef<HTMLButtonElement>(null);

  const emotionLegend = atEntry ? c('emotions.legend') : a('emotions.entryLegend');
  const emotionValue =
    emotions.answer === 'selected'
      ? emotions.keys.map((key) => t(`emotions.${key}`)).join(', ')
      : emotions.answer === 'none'
        ? c('emotions.none')
        : null;

  return (
    <div data-entry-context-step={mode} className="flex min-w-0 flex-col gap-4">
      {/* ENTRY MINDSET: how sure, and how it felt. */}
      <GroupCard title={a('steps.cards.mindset')}>
        <ChoiceGroup
          idPrefix={`${idPrefix}-confidence`}
          legend={atEntry ? c('confidence.label') : a('confidence.label')}
          value={confidence === null ? null : String(confidence)}
          status={c('notAnswered')}
          columns={5}
          appearance="segmented"
          aside={
            <InlineAction ariaLabel={c('confidence.removeAria')} onClick={() => onConfidence(null)}>
              {c('removeAnswer')}
            </InlineAction>
          }
          onChange={(value) => onConfidence(Number.parseInt(value, 10))}
          options={CONFIDENCE_LEVELS.map((level) => ({
            value: String(level.value),
            label: t(`create.confidence.level.${level.key}`),
          }))}
        />
        <TradeLauncherRow
          id={`${idPrefix}-entry-emotions`}
          rowRef={emotionRow}
          label={emotionLegend}
          value={emotionValue}
          placeholder={c('notAnswered')}
          editLabel={a('trade.editAria', { field: emotionLegend })}
          icon={HeartPulse}
          answered={emotions.answer !== 'unanswered'}
          onOpen={() => setEmotionEditor(true)}
          buttonData={{ 'data-entry-emotions': emotions.answer }}
        />
      </GroupCard>

      {/* ENTRY CONTEXT: the thesis in the trader's words, then where and when. */}
      <GroupCard title={e('contextTitle')}>
        <TextAreaField
          id={`${idPrefix}-context-reason`}
          label={cx('reason')}
          value={values.reason}
          onChange={(reason) => onChange({ reason })}
          placeholder={cx('reasonPlaceholder')}
        />
        <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
          <TextField
            id={`${idPrefix}-context-timeframe`}
            label={cx('timeframe')}
            value={values.timeframe}
            onChange={(timeframe) => onChange({ timeframe })}
            placeholder="15m"
          />
          <TextField
            id={`${idPrefix}-context-session`}
            label={cx('session')}
            value={values.session}
            onChange={(session) => onChange({ session })}
            placeholder="London"
          />
        </div>
      </GroupCard>

      {/*
        NOTES & EVIDENCE: the Trade's notes, asked as the entry-time note they
        are, and before-entry evidence — one concept whose first item is the
        chart link.
      */}
      <GroupCard title={e('notesEvidenceTitle')}>
        <TextAreaField
          id={`${idPrefix}-context-notes`}
          label={e('notesTitle')}
          value={values.notes}
          onChange={(notes) => onChange({ notes })}
          placeholder={e('notesHint')}
        />
        <div data-entry-evidence="" className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 className="text-foreground text-sm font-medium">{e('evidenceTitle')}</h4>
            {values.tradingviewUrl.trim() === '' ? <StateText>{c('notAnswered')}</StateText> : null}
          </div>
          <TextField
            id={`${idPrefix}-context-chart`}
            label={cx('chart')}
            value={values.tradingviewUrl}
            onChange={(tradingviewUrl) => onChange({ tradingviewUrl })}
            inputMode="url"
            placeholder="https://www.tradingview.com/x/…"
            error={errors.tradingviewUrl}
          />
        </div>
      </GroupCard>

      {/*
        ENTRY EMOTION, IN ONE FOCUSED EDITOR. Every tap lands in the draft as it
        is made, so Done, X, Escape and the backdrop all keep the answer.
      */}
      <TradeAdaptiveOverlay
        open={emotionEditor}
        onOpenChange={(open) => {
          if (!open) {
            setEmotionEditor(false);
            setLastOneHint(false);
          }
        }}
        title={emotionLegend}
        description={atEntry ? e('emotionEditorAtEntry') : e('emotionEditorAfterTrade')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={emotionRow}
        footer={
          <div className="flex min-w-0 justify-end">
            <Button
              type="button"
              onClick={() => {
                setEmotionEditor(false);
                setLastOneHint(false);
              }}
            >
              {a('trade.done')}
            </Button>
          </div>
        }
      >
        <TradeEmotionFields
          phase="emotions"
          answer={emotions}
          legend={emotionLegend}
          removeAria={c('emotions.removeAria')}
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
