'use client';

import { isConfidenceStep, type ConfidenceStep } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

/**
 * THE RECORDING FLOW'S SHARED VOCABULARY.
 *
 * At Entry and After Trade are two lifecycles of one product, so they are
 * drawn from one set of parts: the same numbered section heading, the same
 * labelled field, the same radio choice, the same journal launcher. These were
 * written for the After Trade migration and moved here unchanged when At Entry
 * followed it, so the two forms cannot drift apart one class name at a time.
 *
 * What differs between the lifecycles — timestamps, Actual Result, exits, tense
 * — lives in each form, never in here.
 */

export const EMOTION_GROUPS = [
  { key: 'inControl', emotions: ['calm', 'focused'] },
  { key: 'pushedIn', emotions: ['fomo', 'greedy', 'excited', 'revenge'] },
  { key: 'heldBack', emotions: ['fearful', 'hesitant'] },
  { key: 'depleted', emotions: ['tired', 'frustrated'] },
] as const;

/**
 * The server's emotion catalog arranged for reading. Same rows, same labels,
 * same order within a group; any key the map does not know lands in `other`,
 * and an empty group is never returned.
 */
export function groupEmotionCatalog<E extends { key: string }>(catalog: readonly E[]) {
  const groupedKeys = new Set<string>(EMOTION_GROUPS.flatMap((group) => group.emotions));
  return [
    ...EMOTION_GROUPS.map((group) => ({
      key: group.key,
      emotions: catalog.filter((emotion) =>
        (group.emotions as readonly string[]).includes(emotion.key),
      ),
    })),
    {
      key: 'other' as const,
      emotions: catalog.filter((emotion) => !groupedKeys.has(emotion.key)),
    },
  ].filter((group) => group.emotions.length > 0);
}

/** Parse only one of the five accepted confidence steps. */
export function confidenceOf(value: string): ConfidenceStep | undefined {
  const parsed = Number.parseInt(value, 10);
  return isConfidenceStep(parsed) ? parsed : undefined;
}

export function Field({
  id,
  label,
  value,
  onChange,
  error,
  optional = false,
  type = 'text',
  inputMode,
  hint,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  optional?: boolean;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  hint?: string | undefined;
  placeholder?: string | undefined;
}) {
  const describedBy = [hint === undefined ? null : `${id}-hint`, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional ? <span className="text-muted-foreground font-normal"> · optional</span> : null}
      </label>
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy === '' ? undefined : describedBy}
      />
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  error,
}: {
  legend: string;
  name: string;
  value: T | '';
  options: readonly { value: T; label: string; description?: string }[];
  onChange: (value: T) => void;
  error?: string | undefined;
}) {
  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-describedby={error === undefined ? undefined : `${name}-error`}
    >
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'border-border focus-within:ring-ring flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2',
              value === option.value ? 'bg-primary/10 border-primary' : 'hover:bg-accent',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.description === undefined ? null : (
                <span className="text-muted-foreground block text-xs">{option.description}</span>
              )}
            </span>
          </label>
        ))}
      </div>
      {error === undefined ? null : (
        <p id={`${name}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function SectionHeading({
  number,
  title,
  description,
  strong = false,
}: {
  number: string;
  title: string;
  description: string;
  strong?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className={cn(
          'bg-muted text-muted-foreground numeric flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
          strong && 'bg-primary text-primary-foreground',
        )}
      >
        {number}
      </span>
      <div className="min-w-0">
        <h2 className={cn('font-semibold', strong ? 'text-xl' : 'text-base')}>{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}

export function JournalLauncher({
  ref,
  icon,
  label,
  prompt,
  summary,
  onClick,
}: {
  ref: React.Ref<HTMLButtonElement>;
  icon: React.ReactNode;
  label: string;
  prompt: string;
  summary: string | null;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="border-border hover:bg-accent focus-visible:ring-ring flex min-h-24 min-w-0 items-start gap-3 rounded-xl border p-4 text-left outline-none focus-visible:ring-2"
    >
      <span className="text-primary mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground mt-1 line-clamp-2 block text-sm">
          {summary ?? prompt}
        </span>
      </span>
    </button>
  );
}
