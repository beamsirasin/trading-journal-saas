'use client';

import { useTranslations } from 'next-intl';

import type { TradeCreateOptions } from '@/server/dal/trades';

import type { EmotionsDraft } from './at-entry-draft';
import { Chip, Helper, InlineAction, Legend, StateText } from './trade-at-entry-controls';
import { groupEmotionCatalog } from './trade-recording-primitives';

/**
 * ONE EMOTION QUESTION: Unanswered, None of these, or the emotions chosen
 * (Add Trade contract §9). The same group answers Entry Emotion and, apart,
 * Post-Trade Emotion — `phase` only names which, and the two never share an
 * answer. The host applies its own draft transitions and decides whether the
 * last chosen emotion may be taken away (`showLastOneHint`).
 */
export function TradeEmotionFields({
  phase,
  answer,
  legend,
  hint,
  removeAria,
  catalog,
  showLastOneHint,
  onToggle,
  onNone,
  onRemove,
}: {
  phase: string;
  answer: EmotionsDraft;
  legend: string;
  hint?: string | undefined;
  removeAria: string;
  catalog: TradeCreateOptions['emotionCatalog'];
  showLastOneHint: boolean;
  onToggle: (key: string) => void;
  onNone: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations('trades');
  const c = useTranslations('trades.create.recording.contractEntry');
  return (
    <fieldset className="min-w-0" data-emotions-phase={phase} data-emotions-answer={answer.answer}>
      <Legend
        aside={
          answer.answer === 'unanswered' ? (
            <StateText>{c('notAnswered')}</StateText>
          ) : (
            <InlineAction ariaLabel={removeAria} onClick={onRemove}>
              {c('removeAnswer')}
            </InlineAction>
          )
        }
      >
        {/* The surrounding surface already shows the question; the legend still names the group. */}
        <span className="sr-only">{legend}</span>
      </Legend>
      {hint === undefined ? null : <Helper>{hint}</Helper>}
      {/*
        ONE CALM LIST, NOT A TAXONOMY. The groups still carry their meaning and
        their order, but they read as quiet captions above larger choices
        rather than as fields of a database record.
      */}
      <div className="mt-3 grid min-w-0 gap-x-8 gap-y-4 min-[560px]:grid-cols-2">
        {groupEmotionCatalog(catalog).map((group) => (
          <div key={group.key} className="flex min-w-0 flex-col gap-2">
            <p className="text-subtle-foreground text-xs font-medium">
              {t(`create.recording.emotionGroups.${group.key}`)}
            </p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.emotions.map((emotion) => (
                <Chip
                  key={emotion.key}
                  size="lg"
                  selected={answer.answer === 'selected' && answer.keys.includes(emotion.key)}
                  onClick={() => onToggle(emotion.key)}
                >
                  {t(`emotions.${emotion.key}`)}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-border mt-4 flex min-w-0 flex-wrap items-center gap-3 border-t pt-4">
        <Chip size="lg" selected={answer.answer === 'none'} onClick={onNone}>
          {c('emotions.none')}
        </Chip>
      </div>
      <p aria-live="polite" className="text-muted-foreground mt-2 text-sm empty:hidden">
        {showLastOneHint ? c('emotions.lastOne') : ''}
      </p>
    </fieldset>
  );
}
