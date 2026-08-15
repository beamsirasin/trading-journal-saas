'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { REVIEW_NOTES_MAX_LENGTH } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { replaceTradeEmotionsAction, updateTradeReviewNotesAction } from '@/server/actions/trades';
import type { TradeEmotionOption } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function TradeReflectionEditor({
  tradeId,
  emotions,
  emotionCatalog,
  emotionsRecorded,
  reviewNotes,
  canWrite,
}: {
  tradeId: string;
  emotions: readonly TradeEmotionOption[];
  emotionCatalog: readonly TradeEmotionOption[];
  emotionsRecorded: boolean;
  reviewNotes: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations('trades');
  const [selected, setSelected] = useState(() => emotions.map((emotion) => emotion.key));
  const [recorded, setRecorded] = useState(emotionsRecorded);
  const [notes, setNotes] = useState(reviewNotes ?? '');
  const [emotionState, setEmotionState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  const [reviewState, setReviewState] = useState<'idle' | 'saving' | 'saved' | string>('idle');

  async function saveEmotions() {
    setEmotionState('saving');
    const result = await replaceTradeEmotionsAction({ tradeId, emotionKeys: selected });
    if (result.ok) setRecorded(true);
    setEmotionState(result.ok ? 'saved' : result.error.code);
  }

  async function saveReview() {
    setReviewState('saving');
    const result = await updateTradeReviewNotesAction({
      tradeId,
      reviewNotes: notes.trim() === '' ? null : notes,
    });
    if (result.ok) {
      setNotes(result.data.reviewNotes ?? '');
      setReviewState('saved');
    } else {
      setReviewState(result.error.code);
    }
  }

  const status = (value: string) =>
    value === 'idle'
      ? null
      : value === 'saving' || value === 'saved'
        ? t(`lifecycle.reflection.${value}`)
        : t(`errors.${value}`);

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <h4 className="text-sm font-medium">{t('lifecycle.reflection.emotions')}</h4>
        {!canWrite && !recorded ? (
          <p className="text-muted-foreground text-sm">{t('lifecycle.reflection.notRecorded')}</p>
        ) : !canWrite && selected.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('lifecycle.reflection.noneSelected')}</p>
        ) : (
          <>
            {canWrite ? (
              <>
                <p className="text-muted-foreground text-sm">
                  {!recorded
                    ? t('lifecycle.reflection.notRecorded')
                    : selected.length === 0
                      ? t('lifecycle.reflection.noneSelected')
                      : t('lifecycle.reflection.selectHint')}
                </p>
                {recorded && selected.length > 0 ? null : (
                  <p className="text-muted-foreground text-sm">
                    {t('lifecycle.reflection.selectHint')}
                  </p>
                )}
              </>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {(canWrite ? emotionCatalog : emotions).map((emotion) => {
                const isSelected = selected.includes(emotion.key);
                return (
                  <button
                    key={emotion.key}
                    type="button"
                    disabled={!canWrite}
                    aria-pressed={isSelected}
                    onClick={() =>
                      setSelected((current) =>
                        current.includes(emotion.key)
                          ? current.filter((key) => key !== emotion.key)
                          : [...current, emotion.key],
                      )
                    }
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium',
                      isSelected
                        ? 'border-primary bg-primary/10 ring-primary/25 ring-2'
                        : 'border-border',
                    )}
                  >
                    {isSelected ? <Check aria-hidden="true" size={15} /> : null}
                    {t(`emotions.${emotion.key}`)}
                  </button>
                );
              })}
            </div>
            {canWrite ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={emotionState === 'saving'}
                  onClick={() => void saveEmotions()}
                >
                  {t('lifecycle.reflection.saveEmotions')}
                </Button>
                <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
                  {status(emotionState)}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="grid gap-3">
        <label htmlFor="trade-review-notes" className="text-sm font-medium">
          {t('lifecycle.reflection.reviewNotes')}
        </label>
        {canWrite ? (
          <>
            <Textarea
              id="trade-review-notes"
              value={notes}
              maxLength={REVIEW_NOTES_MAX_LENGTH}
              onChange={(event) => setNotes(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={reviewState === 'saving'}
                onClick={() => void saveReview()}
              >
                {t('lifecycle.reflection.saveReview')}
              </Button>
              <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
                {status(reviewState)}
              </p>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {reviewNotes ?? t('lifecycle.reflection.notRecorded')}
          </p>
        )}
      </div>
    </div>
  );
}
