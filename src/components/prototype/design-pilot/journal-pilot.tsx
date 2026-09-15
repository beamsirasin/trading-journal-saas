'use client';

import { Check } from 'lucide-react';
import { useId } from 'react';

import { CANONICAL_SYSTEM_EMOTION_TYPES, type EmotionKey } from '@/config/emotions';
import { CONFIDENCE_STEPS, type ConfidenceStep } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';

import {
  CONFIDENCE_LABELS,
  PILOT_STRATEGIES,
  setupConditions,
  type ConditionAnswer,
  type FrameworkAnswer,
  type PilotDraft,
} from './at-entry-pilot-model';
import { ChoiceGroup, InlineAction, Legend, PilotSelect, RADIUS, StateText } from './pilot-surface';

const NONE = '__none';

function answerToValue(answer: FrameworkAnswer): string {
  return answer.kind === 'selected' ? answer.name : answer.kind === 'none' ? NONE : '';
}

function valueToAnswer(value: string): FrameworkAnswer {
  if (value === '') return { kind: 'unanswered' };
  if (value === NONE) return { kind: 'none' };
  return { kind: 'selected', name: value };
}

/** Strategy, Setup and that setup's conditions — Unanswered never collapses into No Strategy. */
export function StrategyFields({
  draft,
  onChange,
}: {
  draft: PilotDraft;
  onChange: (next: PilotDraft) => void;
}) {
  const strategy = draft.strategy.kind === 'selected' ? draft.strategy.name : null;
  const setups = PILOT_STRATEGIES.find((item) => item.name === strategy)?.setups ?? [];
  const conditions = setupConditions(draft.setup);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
        <PilotSelect
          id="pilot-strategy"
          label="Strategy"
          value={answerToValue(draft.strategy)}
          onChange={(value) =>
            onChange({
              ...draft,
              strategy: valueToAnswer(value),
              setup: { kind: 'unanswered' },
              conditions: {},
            })
          }
          options={[
            { value: '', label: 'Not answered' },
            { value: NONE, label: 'No strategy' },
            ...PILOT_STRATEGIES.map((item) => ({ value: item.name, label: item.name })),
          ]}
        />
        <PilotSelect
          id="pilot-setup"
          label="Setup"
          value={answerToValue(draft.setup)}
          disabled={strategy === null}
          onChange={(value) => onChange({ ...draft, setup: valueToAnswer(value), conditions: {} })}
          options={[
            { value: '', label: strategy === null ? 'Choose a strategy first' : 'Not answered' },
            { value: NONE, label: 'No setup' },
            ...setups.map((name) => ({ value: name, label: name })),
          ]}
        />
      </div>

      {conditions.length === 0 ? null : (
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-foreground text-sm font-medium">Setup conditions</p>
          <p className="text-muted-foreground text-sm">
            Answer the ones you checked. Skipped ones are never counted as not met.
          </p>
          <ul className="divide-border mt-2 flex min-w-0 flex-col divide-y">
            {conditions.map((condition) => (
              <ConditionRow
                key={condition}
                label={condition}
                value={draft.conditions[condition] ?? null}
                onChange={(answer) =>
                  onChange({
                    ...draft,
                    conditions:
                      answer === null
                        ? Object.fromEntries(
                            Object.entries(draft.conditions).filter(([key]) => key !== condition),
                          )
                        : { ...draft.conditions, [condition]: answer },
                  })
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConditionRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ConditionAnswer | null;
  onChange: (value: ConditionAnswer | null) => void;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 min-[720px]:flex-row min-[720px]:items-center min-[720px]:gap-4">
      <div className="min-w-0 flex-1">
        <ChoiceGroup
          legend={label}
          value={value}
          compact
          status="Not answered"
          onChange={onChange}
          options={[
            { value: 'met', label: 'Met' },
            { value: 'not_met', label: 'Not met' },
          ]}
        />
      </div>
      {value === null ? null : (
        <div className="min-[720px]:self-end min-[720px]:pb-3">
          <InlineAction onClick={() => onChange(null)} ariaLabel={`Remove answer for ${label}`}>
            Remove answer
          </InlineAction>
        </div>
      )}
    </li>
  );
}

/**
 * CONFIDENCE — five ordered steps on one rail, no default position.
 * Untouched shows no fill and no knob: it must not suggest 0% or 50%.
 */
export function ConfidenceRail({
  value,
  onChange,
}: {
  value: ConfidenceStep | null;
  onChange: (value: ConfidenceStep | null) => void;
}) {
  const name = useId();
  const selectedIndex = value === null ? -1 : CONFIDENCE_STEPS.indexOf(value);
  return (
    <fieldset className="min-w-0">
      <Legend
        aside={
          value === null ? (
            <StateText>Not answered</StateText>
          ) : (
            <InlineAction onClick={() => onChange(null)} ariaLabel="Remove confidence answer">
              Remove answer
            </InlineAction>
          )
        }
      >
        Confidence
      </Legend>
      <p className="text-muted-foreground text-sm">
        How sure were you as you entered? The result never changes this.
      </p>
      <div className="relative mt-3 grid min-w-0 grid-cols-5">
        <span
          aria-hidden="true"
          className="bg-border absolute top-[0.6875rem] right-[10%] left-[10%] h-0.5"
        />
        {selectedIndex > 0 ? (
          <span
            aria-hidden="true"
            className="bg-primary absolute top-[0.6875rem] left-[10%] h-0.5"
            style={{ width: `${selectedIndex * 20}%` }}
          />
        ) : null}
        {CONFIDENCE_STEPS.map((step, index) => {
          const id = `${name}-${step}`;
          const checked = value === step;
          const reached = selectedIndex >= index;
          return (
            <div key={step} className="relative flex min-w-0 flex-col items-center">
              <input
                type="radio"
                id={id}
                name={name}
                checked={checked}
                onChange={() => onChange(step)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className="peer-focus-visible:ring-ring flex min-h-14 w-full cursor-pointer flex-col items-center gap-1.5 rounded-md px-0.5 peer-focus-visible:ring-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'relative mt-1 size-4 rounded-full border-2',
                    reached
                      ? 'border-primary bg-primary'
                      : 'bg-card border-[var(--pilot-selected-border)]',
                    checked && 'ring-primary/30 ring-4',
                  )}
                />
                <span
                  className={cn(
                    'text-center text-xs leading-tight',
                    checked ? 'text-foreground font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {CONFIDENCE_LABELS[step]}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

const EMOTION_GROUPS: readonly { key: string; label: string; emotions: readonly EmotionKey[] }[] = [
  { key: 'inControl', label: 'In control', emotions: ['calm', 'focused'] },
  { key: 'pushedIn', label: 'Pushed in', emotions: ['fomo', 'greedy', 'excited', 'revenge'] },
  { key: 'heldBack', label: 'Held back', emotions: ['fearful', 'hesitant'] },
  { key: 'depleted', label: 'Depleted', emotions: ['tired', 'frustrated'] },
];

const EMOTION_LABEL = new Map<string, string>(
  CANONICAL_SYSTEM_EMOTION_TYPES.map((item) => [item.key, item.label]),
);

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-ring relative inline-flex min-h-10 items-center gap-1.5 border px-3 text-sm outline-none focus-visible:ring-2',
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
        RADIUS.pill,
        selected
          ? 'text-foreground border-[var(--pilot-selected-border)] bg-[var(--pilot-selected)] font-semibold'
          : 'border-input bg-background text-foreground hover:bg-accent',
      )}
    >
      {selected ? <Check className="text-primary size-3.5" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Entry emotions: neutral chips, no valence colour; `null` and `[]` look and read differently. */
export function EmotionChoices({
  value,
  onChange,
}: {
  value: readonly EmotionKey[] | null;
  onChange: (value: readonly EmotionKey[] | null) => void;
}) {
  const isNone = value !== null && value.length === 0;
  function toggle(key: EmotionKey) {
    const current = value === null ? [] : [...value];
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    onChange(next.length === 0 ? null : next);
  }
  return (
    <fieldset className="min-w-0">
      <Legend aside={value === null ? <StateText>Not answered</StateText> : null}>
        How you felt as you entered
      </Legend>
      <div className="grid min-w-0 gap-x-6 gap-y-3 min-[560px]:grid-cols-2">
        {EMOTION_GROUPS.map((group) => (
          <div key={group.key} className="flex min-w-0 flex-col gap-1.5">
            <p className="text-muted-foreground text-sm">{group.label}</p>
            <div className="flex min-w-0 flex-wrap gap-2">
              {group.emotions.map((key) => (
                <Chip
                  key={key}
                  selected={value?.includes(key) ?? false}
                  onClick={() => toggle(key)}
                >
                  {EMOTION_LABEL.get(key) ?? key}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-border flex min-w-0 flex-wrap items-center gap-3 border-t pt-3">
        <Chip selected={isNone} onClick={() => onChange(isNone ? null : [])}>
          None of these
        </Chip>
      </div>
    </fieldset>
  );
}
