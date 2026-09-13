'use client';

import { Check, ChevronRight, Plus, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode, type Ref } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * THE RECORDING FLOW'S TASK-SURFACE ANATOMY — three visual levels and no more.
 *
 * Carried into production from the accepted Add Trade prototype. A page, one
 * task surface holding the trade, and the controls inside it. Grouping inside
 * the surface is done with space and a single hairline between bands, never
 * with a card inside a card, so a reader sees a trade being recorded before they
 * see the structure of a form.
 *
 * Typography carries the hierarchy the frames used to: 12px muted labels, 16px
 * inputs, and the one figure the task is about — the risk — at 22–24px.
 *
 * Everything here is presentation. No state, no copy of its own (every string
 * arrives translated), and no knowledge of what a trade is.
 */

function describedBy(...ids: readonly (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

/** The one card the task lives on. */
export function TaskSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'border-border bg-card shadow-card flex min-w-0 flex-col rounded-xl border',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A band inside the task surface; it owns the hairline beneath it. */
export function Band({
  children,
  className,
  divided = true,
}: {
  children: ReactNode;
  className?: string;
  divided?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4',
        divided && 'border-border border-b',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A quiet uppercase label that names a band without becoming a second heading level of weight. */
export function SectionLabel({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      id={id}
      /*
        Literal, not cn(): tailwind-merge does not know `text-label` is a font
        size (src/lib/utils.ts extends only the metric sizes), so merging it with
        `text-muted-foreground` silently dropped the size.
      */
      className={['text-label text-muted-foreground uppercase', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </h2>
  );
}

/** A text action with a 44px target and no layout cost. */
export function QuietAction({
  children,
  onClick,
  expanded,
  controls,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      aria-controls={controls}
      className={cn(
        'text-primary focus-visible:ring-ring relative min-w-0 rounded-sm text-left text-sm font-medium',
        'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Context, not a decision: a name, a qualifier, and an optional way to change it. */
export function ContextLine({
  primary,
  secondary,
  action,
}: {
  primary: string;
  secondary?: string;
  action?: ReactNode;
}) {
  return (
    <div data-account-context="" className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
        <span className="text-foreground font-medium">{primary}</span>
        {secondary === undefined ? null : (
          <>
            <span className="text-subtle-foreground"> · </span>
            {secondary}
          </>
        )}
      </p>
      {action}
    </div>
  );
}

/** Related fields side by side only where there is room for both. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-1 gap-4 min-[560px]:grid-cols-2">{children}</div>;
}

/** A short line beneath a control: guidance, a warning worth stating, or the error that stops Save. */
export function InlineNote({
  id,
  tone = 'quiet',
  children,
  className,
  ...data
}: {
  id?: string;
  tone?: 'quiet' | 'warning' | 'error';
  children: ReactNode;
  className?: string;
  [dataAttribute: `data-${string}`]: string;
}) {
  return (
    <p
      id={id}
      {...data}
      {...(tone === 'error' ? { role: 'alert' } : tone === 'warning' ? { role: 'status' } : {})}
      className={cn(
        'min-w-0 text-xs leading-relaxed',
        tone === 'error'
          ? 'text-destructive'
          : tone === 'warning'
            ? 'text-warning'
            : 'text-subtle-foreground',
        className,
      )}
    >
      {children}
    </p>
  );
}

function FieldLabel({
  htmlFor,
  label,
  optionalLabel,
}: {
  htmlFor: string;
  label: string;
  optionalLabel?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <label htmlFor={htmlFor} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      {optionalLabel === undefined ? null : (
        <span className="text-subtle-foreground text-xs">{optionalLabel}</span>
      )}
    </div>
  );
}

/** A labelled 16px input: editable content with a name, not a row in a settings table. */
export function TextInputField({
  id,
  label,
  value,
  onChange,
  optionalLabel,
  hint,
  error,
  type = 'text',
  inputMode,
  placeholder,
  numeric = false,
  extraDescribedBy,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  optionalLabel?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  placeholder?: string | undefined;
  numeric?: boolean;
  extraDescribedBy?: string | undefined;
  className?: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <FieldLabel htmlFor={id} label={label} optionalLabel={optionalLabel} />
      <Input
        id={id}
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(
          extraDescribedBy,
          hint !== undefined && hintId,
          error !== undefined && errorId,
        )}
        className={cn('text-base', numeric && 'numeric')}
      />
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <InlineNote id={errorId} tone="error">
          {error}
        </InlineNote>
      )}
    </div>
  );
}

/** A labelled native select in the same field treatment. */
export function SelectField({
  id,
  label,
  optionalLabel,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optionalLabel?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} optionalLabel={optionalLabel} />
      {children}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <InlineNote id={`${id}-error`} tone="error">
          {error}
        </InlineNote>
      )}
    </div>
  );
}

/**
 * THE ONE FIGURE THE TASK IS ABOUT.
 *
 * 22–24px tabular figures with the currency stated inside the control rather
 * than as another label. The size is the hierarchy: a reader can tell which
 * number matters before reading a single label.
 */
export function PrimaryAmountField({
  id,
  label,
  currency,
  value,
  onChange,
  hint,
  error,
  optionalLabel,
}: {
  id: string;
  label: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  optionalLabel?: string | undefined;
}) {
  const currencyId = `${id}-currency`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </label>
        {optionalLabel === undefined ? null : (
          <span className="text-subtle-foreground text-xs">{optionalLabel}</span>
        )}
      </div>
      <div
        className={cn(
          'bg-background focus-within:ring-ring/50 flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg border px-3 py-1 focus-within:ring-[3px]',
          error === undefined ? 'border-input focus-within:border-ring' : 'border-destructive',
        )}
      >
        <input
          id={id}
          value={value}
          inputMode="decimal"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(
            currencyId,
            hint !== undefined && hintId,
            error !== undefined && errorId,
          )}
          className="numeric text-foreground h-12 w-full min-w-[112px] flex-1 bg-transparent text-[1.375rem] leading-none outline-none sm:text-2xl"
        />
        <span id={currencyId} className="text-muted-foreground shrink-0 text-sm">
          {currency}
        </span>
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <InlineNote id={errorId} tone="error">
          {error}
        </InlineNote>
      )}
    </div>
  );
}

/** A computed answer as a line of text, never a panel. */
export function ResultLine({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string | undefined;
}) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="numeric text-foreground text-base font-semibold">{value}</span>
      {detail === undefined ? null : (
        <span className="text-muted-foreground numeric text-xs break-all">{detail}</span>
      )}
    </p>
  );
}

/**
 * Two or three thumb-sized choices. Neutral by design — Long and Short are
 * directions, not outcomes — and selection is a filled surface plus a border and
 * a check, never colour alone.
 */
export function SegmentedChoice<T extends string>({
  legend,
  value,
  options,
  onChange,
  error,
  errorId,
}: {
  legend: string;
  value: T | '';
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  error?: string | undefined;
  errorId: string;
}) {
  const name = useId();
  return (
    <fieldset
      className="flex min-w-0 flex-col"
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <legend className="text-muted-foreground mb-1.5 text-xs font-medium">{legend}</legend>
      <div
        className={cn(
          'grid min-w-0 gap-2',
          options.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3',
        )}
      >
        {options.map((option, index) => {
          const id = `${name}-${option.value}`;
          const checked = value === option.value;
          return (
            <div key={option.value} className="min-w-0">
              <input
                type="radio"
                id={id}
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                /* A native radio has no aria-invalid; the fieldset carries the error
                   description, and this marker lets a failed Save focus the choice. */
                data-invalid={error !== undefined && index === 0 ? 'true' : undefined}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 motion-reduce:transition-none',
                  checked
                    ? 'border-primary bg-primary/10 text-foreground'
                    : cn(
                        'bg-background text-muted-foreground hover:bg-accent',
                        error === undefined ? 'border-input' : 'border-destructive',
                      ),
                )}
              >
                {checked ? (
                  <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                ) : null}
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
      {error === undefined ? null : (
        <InlineNote id={errorId} tone="error" className="mt-1.5">
          {error}
        </InlineNote>
      )}
    </fieldset>
  );
}

/**
 * `true` while the visual viewport is materially shorter than the layout
 * viewport — the one honest signal that a phone keyboard is covering the page.
 * 140px so a collapsing URL bar during scrolling never counts.
 */
export function useKeyboardObscuringViewport(): boolean {
  const [obscured, setObscured] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === undefined || viewport === null) return;
    const read = () => setObscured(window.innerHeight - viewport.height > 140);
    read();
    viewport.addEventListener('resize', read);
    return () => viewport.removeEventListener('resize', read);
  }, []);
  return obscured;
}

/**
 * ONE PRIMARY ACTION, AND THE SENTENCE THAT REMOVES THE ANXIETY AROUND IT.
 *
 * Always pressable: the attempt is what reveals what is missing. Docked to the
 * bottom of a phone screen, and released back into the page while a keyboard is
 * up so it never sits over the field being typed into.
 */
export function FormFooter({
  action,
  pendingLabel,
  pending,
  helper,
}: {
  action: string;
  pendingLabel: string;
  pending: boolean;
  helper: string;
}) {
  const keyboardOpen = useKeyboardObscuringViewport();
  return (
    <div
      data-global-save=""
      data-form-footer={keyboardOpen ? 'inline' : 'docked'}
      className={cn(
        'mt-1 flex min-w-0 flex-col gap-2',
        !keyboardOpen &&
          'bg-background/95 border-border sticky bottom-0 z-10 -mx-4 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none',
      )}
    >
      <Button
        type="submit"
        size="lg"
        className="min-h-12 w-full sm:w-auto sm:self-start"
        disabled={pending}
      >
        {pending ? pendingLabel : action}
      </Button>
      <p className="text-muted-foreground text-xs">{helper}</p>
    </div>
  );
}

export interface JournalLauncherArea {
  readonly id: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  /** Shown while the area is untouched: a question, not a noun. */
  readonly invitation: string;
  /** What it holds once answered. The preview IS the status — no badges, no counts. */
  readonly preview: readonly string[];
  readonly onOpen: () => void;
  readonly triggerRef: Ref<HTMLButtonElement>;
}

/**
 * THE JOURNAL, AS ONE SURFACE WITH A NAME.
 *
 * One boundary with a quiet divider between areas — side by side where there
 * is room, stacked where there is not — under a heading and an aside saying the
 * whole thing can wait. Optional without being nearly invisible.
 */
export function JournalLauncherSurface({
  headingId,
  heading,
  aside,
  areas,
}: {
  headingId: string;
  heading: string;
  aside?: string;
  areas: readonly JournalLauncherArea[];
}) {
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 px-1">
        <SectionLabel id={headingId}>{heading}</SectionLabel>
        {aside === undefined ? null : <p className="text-subtle-foreground text-xs">{aside}</p>}
      </div>
      <div
        className={cn(
          'border-border bg-muted/20 divide-border grid min-w-0 divide-y overflow-hidden rounded-xl border',
          areas.length > 1 && 'min-[560px]:grid-cols-2 min-[560px]:divide-x min-[560px]:divide-y-0',
        )}
      >
        {areas.map((area) => {
          const populated = area.preview.length > 0;
          return (
            <button
              key={area.id}
              ref={area.triggerRef}
              type="button"
              data-journal-area={area.id}
              onClick={area.onOpen}
              className={cn(
                'group/area flex min-h-[3.75rem] w-full min-w-0 items-center gap-3 px-3 py-3 text-left',
                'hover:bg-accent/40 focus-visible:ring-ring transition-colors outline-none motion-reduce:transition-none',
                'focus-visible:ring-2 focus-visible:-outline-offset-2',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                  populated ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                <area.Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-sm font-medium">{area.label}</span>
                {populated ? (
                  area.preview.slice(0, 2).map((line) => (
                    <span key={line} className="text-muted-foreground block truncate text-xs">
                      {line}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground block text-xs">{area.invitation}</span>
                )}
              </span>
              <span
                aria-hidden="true"
                className="text-subtle-foreground group-hover/area:text-foreground shrink-0 transition-colors"
              >
                {populated ? <ChevronRight className="size-4" /> : <Plus className="size-4" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
