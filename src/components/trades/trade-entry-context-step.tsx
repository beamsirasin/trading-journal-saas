'use client';

import { HeartPulse, Scale } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';

import { CONFIDENCE_LEVELS } from '@/lib/trades/constants';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import type { ContextDraft, EmotionsDraft } from './at-entry-draft';
import { useActualRiskSummaryLine, type ActualRiskSummary } from './trade-actual-risk-summary';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import {
  ChoiceGroup,
  Helper,
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
 * WHAT THE TRADER KNEW, THOUGHT, FELT AND ACTUALLY DID AROUND ENTRY — and
 * nothing later. Actual Risk (what the position really carried), Confidence
 * and Entry Emotion, why this trade, timeframe and session, the entry notes,
 * and before-entry evidence. Post-Trade Emotion, the result and anything
 * Review asks belong to other stages and never appear here.
 *
 * ACTUAL RISK IS AN EXECUTION FACT, NOT A PLAN (contract decision 53). Plan &
 * Risk says what was intended and how the stop was to be held; this step says
 * what the entry actually carried. It starts Unanswered in both recording
 * moments and is never inferred from Risk at Entry (decision 52).
 *
 * DIRECT WHERE A TAP WOULD BE WASTED. Confidence is one tap on the step
 * itself, and the text answers are typed where they are asked. Only the
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
  actualRisk,
  actualRiskEditor,
  actualRiskError,
  currency,
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
  /** What the host's draft records about actual risk, for its row. */
  actualRisk: ActualRiskSummary;
  /** The host's own Actual Risk control, shown in the row's editor. */
  actualRiskEditor: ReactNode;
  /** The host's blocking error on it, so the closed row can show it too. */
  actualRiskError?: string | undefined;
  /** For reading an Actual Risk amount back on the row. */
  currency: string;
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
  const [riskEditor, setRiskEditor] = useState(false);
  const actualRiskRow = useRef<HTMLButtonElement>(null);
  const actualRiskLine = useActualRiskSummaryLine();
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
      <p className="text-muted-foreground text-sm">
        {atEntry ? e('descriptionAtEntry') : e('descriptionAfterTrade')}
      </p>

      {/* 1 — WHAT THE ENTRY ACTUALLY RISKED (contract §4, decisions 52–53). */}
      <GroupCard title={e('actualRiskTitle')}>
        <TradeLauncherRow
          id={`${idPrefix}-actual-risk-row`}
          rowRef={actualRiskRow}
          label={a('actualRisk.legend')}
          value={actualRisk.kind === 'not_recorded' ? null : actualRiskLine(actualRisk, currency)}
          placeholder={c('notAnswered')}
          error={actualRiskError}
          editLabel={a('trade.editAria', { field: a('actualRisk.legend') })}
          icon={Scale}
          answered={actualRisk.kind !== 'not_recorded'}
          onOpen={() => setRiskEditor(true)}
          buttonData={{ 'data-actual-risk-summary': actualRisk.kind }}
        />
      </GroupCard>

      {/* 2–3 — ENTRY MINDSET: how sure, and how it felt. */}
      <GroupCard title={a('steps.cards.mindset')}>
        <ChoiceGroup
          idPrefix={`${idPrefix}-confidence`}
          legend={atEntry ? c('confidence.label') : a('confidence.label')}
          value={confidence === null ? null : String(confidence)}
          status={c('notAnswered')}
          columns={5}
          compact
          fit="split"
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
        <Helper>{atEntry ? c('confidence.hint') : a('confidence.hint')}</Helper>
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

      {/* 3 — WHY THIS TRADE: the thesis, in the trader's words. */}
      <GroupCard title={a('steps.cards.thesis')}>
        <TextAreaField
          id={`${idPrefix}-context-reason`}
          label={cx('reason')}
          value={values.reason}
          onChange={(reason) => onChange({ reason })}
          placeholder={cx('reasonPlaceholder')}
        />
      </GroupCard>

      {/* 4–5 — MARKET CONTEXT: two short answers, side by side on a wide screen. */}
      <GroupCard title={a('steps.groups.market')}>
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

      {/* 6 — ENTRY NOTES: the Trade's notes, asked as the entry-time note they are. */}
      <GroupCard title={e('notesTitle')}>
        <TextAreaField
          id={`${idPrefix}-context-notes`}
          label={cx('notes')}
          value={values.notes}
          onChange={(notes) => onChange({ notes })}
          placeholder={e('notesHint')}
        />
      </GroupCard>

      {/* 7 — BEFORE-ENTRY EVIDENCE: one concept; the chart link is its first item. */}
      <GroupCard
        title={e('evidenceTitle')}
        aside={
          values.tradingviewUrl.trim() === '' ? <StateText>{c('notAnswered')}</StateText> : null
        }
        data-entry-evidence=""
      >
        <Helper>{e('evidenceHint')}</Helper>
        <TextField
          id={`${idPrefix}-context-chart`}
          label={cx('chart')}
          value={values.tradingviewUrl}
          onChange={(tradingviewUrl) => onChange({ tradingviewUrl })}
          inputMode="url"
          placeholder="https://www.tradingview.com/x/…"
          error={errors.tradingviewUrl}
        />
      </GroupCard>

      {/*
        ACTUAL RISK, IN THE EDITOR ITS ROW OPENS. The host renders its own
        mode's control; this step owns only where it is asked and how it reads
        back.
      */}
      <TradeAdaptiveOverlay
        open={riskEditor}
        onOpenChange={(open) => {
          if (!open) setRiskEditor(false);
        }}
        title={a('actualRisk.legend')}
        description={e('actualRiskHint')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={actualRiskRow}
        footer={
          <div className="flex min-w-0 justify-end">
            <Button type="button" onClick={() => setRiskEditor(false)}>
              {a('trade.done')}
            </Button>
          </div>
        }
      >
        {actualRiskEditor}
      </TradeAdaptiveOverlay>

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
