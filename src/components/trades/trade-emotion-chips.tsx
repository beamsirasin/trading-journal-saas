'use client';

import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TradeEmotionOption } from '@/server/dal/trades';

import { groupEmotionCatalog } from './trade-recording-primitives';

/**
 * EMOTIONS — the server's catalog, in two readable columns.
 *
 * `null` means the trader never said; `[]` means they explicitly said "none of
 * these". Production already stores the difference (sending `emotionKeys: []`
 * records an answer, omitting it records nothing), so this control keeps the two
 * apart instead of turning a glance at the section into "I felt nothing".
 *
 * Clearing the last chip returns to untouched, not to "none". The chips carry no
 * valence colour: a feeling is not a mistake.
 */
export function TradeEmotionChips({
  legend,
  catalog,
  value,
  onChange,
  groupLabel,
  noneLabel,
  notRecordedLabel,
}: {
  legend: string;
  catalog: readonly TradeEmotionOption[];
  /** `null` = never answered. `[]` = explicitly none of these. */
  value: readonly string[] | null;
  onChange: (value: readonly string[] | null) => void;
  groupLabel: (key: string) => string;
  noneLabel: string;
  notRecordedLabel: string;
}) {
  const isNone = value !== null && value.length === 0;
  const groups = groupEmotionCatalog(catalog);

  function toggle(key: string, selected: boolean) {
    const current = value === null || isNone ? [] : [...value];
    const next = selected ? current.filter((item) => item !== key) : [...current, key];
    onChange(next.length === 0 ? null : next);
  }

  return (
    <fieldset className="min-w-0" data-slot="emotion-chips">
      <legend className="text-foreground text-sm font-medium">{legend}</legend>

      <div className="mt-3 grid min-w-0 gap-x-6 gap-y-4 min-[560px]:grid-cols-2">
        {groups.map((group) => (
          <div key={group.key} data-emotion-group={group.key} className="min-w-0">
            <p className="text-subtle-foreground text-label mb-1.5 uppercase">
              {groupLabel(group.key)}
            </p>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {group.emotions.map((emotion) => {
                const selected = value !== null && value.includes(emotion.key);
                return (
                  <button
                    key={emotion.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(emotion.key, selected)}
                    className={cn(
                      'relative inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm',
                      'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
                      'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                      selected
                        ? 'border-primary bg-primary/10 text-foreground font-medium'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {selected ? (
                      <Check className="text-primary-text size-3.5" aria-hidden="true" />
                    ) : null}
                    {emotion.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          aria-pressed={isNone}
          onClick={() => onChange(isNone ? null : [])}
          className={cn(
            'relative inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-xs',
            'focus-visible:ring-ring transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
            'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
            isNone
              ? 'border-primary bg-primary/10 text-foreground font-medium'
              : 'border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground border-dashed',
          )}
        >
          {isNone ? <Check className="text-primary-text size-3.5" aria-hidden="true" /> : null}
          {noneLabel}
        </button>
        {value === null ? (
          <span className="text-muted-foreground text-xs">{notRecordedLabel}</span>
        ) : null}
      </div>
    </fieldset>
  );
}
