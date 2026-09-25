'use client';

import { AlertTriangle, Check, ChevronDown, CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * AT ENTRY CONTROLS — the calibrated Capture treatment from the At Entry visual
 * pilot, rebuilt for production rather than imported from the frozen pilot.
 *
 * WHAT CHANGED FROM THE PILOT. Control boundaries use `border-control-border`,
 * which meets 3:1 non-text contrast against both card and canvas in Light and
 * Dark; the pilot's outlines did not. Form values use tabular figures in the
 * primary family (DESIGN.md §4 rule 7). Nothing here knows what a trade is and
 * every string arrives translated.
 */

function describedBy(...ids: readonly (string | false | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

const WELL =
  'bg-background focus-within:border-ring focus-within:ring-ring/40 flex min-w-0 items-center gap-2 rounded-md border px-3 focus-within:ring-[3px]';

/** A group title: sentence case; weight and size carry it. */
export function GroupHeading({
  id,
  title,
  description,
  aside,
}: {
  id: string;
  title: string;
  description?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-1">
      <div className="min-w-0">
        <h2 id={id} className="text-foreground text-base font-semibold">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        )}
      </div>
      {aside}
    </div>
  );
}

/** Quiet state words beside a label, such as "Not answered". Neutral, never a warning. */
export function StateText({ children }: { children: ReactNode }) {
  return <span className="text-subtle-foreground text-sm">{children}</span>;
}

/**
 * A fieldset header whose legend stays the fieldset's FIRST child, so the group
 * keeps its accessible name, with an optional state or action beside it.
 */
export function Legend({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <>
      <legend className="text-foreground float-left mb-2 max-w-full text-sm font-medium">
        {children}
      </legend>
      {aside === undefined || aside === null ? null : (
        <span className="float-right mb-2 ml-3">{aside}</span>
      )}
      <span aria-hidden="true" className="clear-both block" />
    </>
  );
}

/**
 * ANSWERED vs DEFAULT vs INHERITED, as a shape rather than a colour. Dashed =
 * the system supplied it and it is waiting for the trader; solid = a neutral
 * fact. Always words, never a dot alone.
 */
export function Tag({
  tone,
  icon,
  children,
}: {
  tone: 'default' | 'inherited' | 'context';
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone === 'context'
          ? 'text-foreground border-border bg-muted'
          : 'text-muted-foreground border-control-border border-dashed',
      )}
    >
      {icon}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

/** An inline text action with a 44px target and no layout cost. */
export function InlineAction({
  children,
  onClick,
  ariaLabel,
  controls,
  expanded,
  id,
  buttonRef,
}: {
  children: ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  controls?: string;
  expanded?: boolean;
  id?: string;
  /** For a caller that returns focus here, e.g. when a sheet it opened closes. */
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      id={id}
      ref={buttonRef}
      onClick={onClick}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      className={cn(
        'text-primary-text focus-visible:ring-ring relative rounded-sm text-left text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2',
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
      )}
    >
      {children}
    </button>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  aside,
}: {
  htmlFor: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <label htmlFor={htmlFor} className="text-foreground text-sm font-medium">
        {children}
      </label>
      {aside}
    </div>
  );
}

/** The error that stops Save, at its field: icon, destructive text, plain words. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-destructive flex min-w-0 items-start gap-1.5 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function Helper({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="text-muted-foreground text-sm leading-relaxed">
      {children}
    </p>
  );
}

/** A quiet notice beside its subject — not an error and not a filled alert box. */
export function Notice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="text-foreground flex min-w-0 items-start gap-2 text-sm" role="status">
      {icon ?? <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** Text, price or amount. `lead` is the one figure At Entry is about: Risk at Entry. */
export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  suffix,
  placeholder,
  inputMode,
  type = 'text',
  size = 'standard',
  figure = false,
  dashed = false,
  labelAside,
  autoCapitalize,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  suffix?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  type?: string;
  size?: 'lead' | 'standard';
  figure?: boolean;
  /** A value the system supplied and the trader has not confirmed. */
  dashed?: boolean;
  labelAside?: ReactNode;
  autoCapitalize?: string;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const suffixId = `${id}-suffix`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id} aside={labelAside}>
        {label}
      </FieldLabel>
      <div
        className={cn(
          WELL,
          size === 'lead' ? 'min-h-14' : 'min-h-11',
          error === undefined ? 'border-control-border' : 'border-destructive',
          dashed && error === undefined && 'border-dashed',
        )}
      >
        <input
          id={id}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          inputMode={inputMode}
          autoComplete="off"
          {...(autoCapitalize === undefined ? {} : { autoCapitalize })}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy(
            suffix !== undefined && suffixId,
            hint !== undefined && hintId,
            error !== undefined && errorId,
          )}
          className={cn(
            'text-foreground placeholder:text-subtle-foreground w-full min-w-0 flex-1 bg-transparent py-2 outline-none',
            size === 'lead' ? 'text-2xl font-semibold' : 'text-base',
            figure && 'tabular-nums',
          )}
        />
        {suffix === undefined ? null : (
          <span id={suffixId} className="text-muted-foreground shrink-0 text-sm">
            {suffix}
          </span>
        )}
      </div>
      {hint === undefined ? null : <Helper id={hintId}>{hint}</Helper>}
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function TextAreaField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  /** The application limit the server enforces, stated to the browser too. */
  maxLength?: number;
  error?: string | undefined;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint === undefined ? null : hintId, error === undefined ? null : errorId]
      .filter((part): part is string => part !== null)
      .join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        value={value}
        rows={3}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-describedby={describedBy}
        aria-invalid={error === undefined ? undefined : true}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'bg-background border-control-border text-foreground placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-ring/40 min-h-24 w-full rounded-md border px-3 py-2.5 text-base outline-none focus-visible:ring-[3px]',
          error !== undefined && 'border-destructive',
        )}
      />
      {hint === undefined ? null : <Helper id={hintId}>{hint}</Helper>}
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
  aside,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
  aside?: ReactNode;
  error?: string | undefined;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id} aside={aside}>
        {label}
      </FieldLabel>
      <div className="relative min-w-0">
        <select
          id={id}
          value={value}
          disabled={disabled}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : errorId}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/40 min-h-11 w-full appearance-none rounded-md border py-2 pr-10 pl-3 text-base outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60',
            error === undefined ? 'border-control-border' : 'border-destructive',
            value === '' && 'text-muted-foreground',
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
      </div>
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * A SEMANTIC TONE AN OPTION MAY CARRY. Opt-in and rare: only where the two
 * answers have a direction the eye can use, such as Long and Short. An
 * untoned group is unchanged, and a toned option is neutral until it is
 * chosen — the hue marks the SELECTION, never the existence of the choice.
 */
export type ChoiceTone = 'positive' | 'negative' | 'break_even';

export function RadioMark({
  checked,
  className,
  tone,
}: {
  checked: boolean;
  className?: string;
  tone?: ChoiceTone | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border',
        checked
          ? tone === 'positive'
            ? 'border-positive bg-positive'
            : tone === 'negative'
              ? 'border-negative bg-negative'
              : tone === 'break_even'
                ? 'border-break-even bg-break-even'
                : 'border-primary bg-primary'
          : 'border-control-border',
        className,
      )}
    >
      {checked ? (
        <span
          className={cn(
            'size-1.5 rounded-full',
            tone === undefined ? 'bg-primary-foreground' : 'bg-card',
          )}
        />
      ) : null}
    </span>
  );
}

/**
 * A RECORDED-ANSWER CHOICE GROUP (DESIGN.md §6). Native radios, no initial
 * selection; the chosen option shows a neutral active step, a filled radio
 * marker and a stronger label — never colour alone, never a segmented control.
 * `idPrefix` makes each radio addressable so a failed Save can focus the group.
 */
export function ChoiceGroup<T extends string>({
  idPrefix,
  legend,
  value,
  options,
  onChange,
  error,
  status,
  aside,
  columns = 2,
  compact = false,
  fit,
  appearance = 'cards',
  hideLegend = false,
}: {
  idPrefix: string;
  legend: string;
  value: T | null;
  options: readonly { value: T; label: string; description?: string; tone?: ChoiceTone }[];
  onChange: (value: T) => void;
  error?: string | undefined;
  /** Shown beside the legend while unanswered, e.g. "Not answered". */
  status?: string;
  /** Shown beside the legend once answered, e.g. "Remove answer". */
  aside?: ReactNode;
  columns?: 2 | 3 | 5;
  compact?: boolean;
  /**
   * A denser layout than one full-width row per option, for groups whose
   * labels are short enough to read in a column.
   *
   * `row` keeps every option on one row at every width — Win / BE / Loss.
   * `split` gives longer labels more room on the narrowest phones and closes
   * up from `min-[420px]` (three choices) or `min-[380px]` (five), so a small
   * screen never has to choose between cramped text and five stacked rows.
   *
   * Five across always stacks each marker above its label.
   */
  fit?: 'row' | 'split';
  /**
   * `scale` is a compact rating row for a secondary question: one small
   * answer tile per option, five across at every width, each with its own
   * radio marker above the label so the recorded answer reads as an answer,
   * never as a mode or filter. Same radios, states and keyboard behaviour.
   *
   * `buttons` is a short row of direct text answers — Win / BE / Loss — with
   * no radio marker. Unchosen they are neutral; the chosen one takes its
   * option's tone as a tinted fill, a full-strength border ring, emphasised
   * text and a check, so the answer survives greyscale (DESIGN.md §9.4).
   */
  appearance?: 'cards' | 'scale' | 'buttons';
  /**
   * The group sits under a heading that already asks the question, so the
   * legend stays for the accessible name and drops out of the picture.
   */
  hideLegend?: boolean;
}) {
  const name = useId();
  const scale = appearance === 'scale';
  const buttons = appearance === 'buttons';
  const stacked = !scale && !buttons && fit !== undefined && columns === 5;
  const errorId = `${idPrefix}-error`;
  return (
    <fieldset className="min-w-0" aria-describedby={error === undefined ? undefined : errorId}>
      <Legend
        aside={
          value === null ? status === undefined ? null : <StateText>{status}</StateText> : aside
        }
      >
        {hideLegend ? <span className="sr-only">{legend}</span> : legend}
      </Legend>
      <div className="flex min-w-0 flex-col gap-2">
        <div
          className={cn(
            'grid min-w-0 gap-2',
            buttons
              ? columns === 5
                ? 'grid-cols-5'
                : columns === 3
                  ? 'grid-cols-3'
                  : 'grid-cols-2'
              : scale
                ? columns === 5
                  ? 'grid-cols-5 gap-1.5'
                  : columns === 3
                    ? 'grid-cols-3 gap-1.5'
                    : 'grid-cols-2 gap-1.5'
                : fit === 'row'
                  ? columns === 5
                    ? 'grid-cols-5 gap-1.5 min-[560px]:gap-2'
                    : columns === 3
                      ? 'grid-cols-3'
                      : 'grid-cols-2'
                  : fit === 'split'
                    ? columns === 5
                      ? 'grid-cols-3 gap-1.5 min-[380px]:grid-cols-5 min-[560px]:gap-2'
                      : columns === 3
                        ? 'grid-cols-2 min-[420px]:grid-cols-3'
                        : 'grid-cols-2'
                    : columns === 5
                      ? 'grid-cols-1 min-[560px]:grid-cols-5'
                      : columns === 3
                        ? 'grid-cols-1 min-[420px]:grid-cols-3'
                        : options.some((option) => option.description !== undefined)
                          ? 'grid-cols-1 min-[420px]:grid-cols-2'
                          : 'grid-cols-2',
          )}
        >
          {options.map((option, index) => {
            const id = `${idPrefix}-${option.value}`;
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
                  data-invalid={error !== undefined && index === 0 ? 'true' : undefined}
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  className={cn(
                    'flex h-full min-w-0 cursor-pointer gap-2.5 rounded-md border px-3 transition-colors motion-reduce:transition-none',
                    buttons
                      ? 'min-h-12 items-center justify-center gap-1.5 px-2 py-2 text-center'
                      : scale
                        ? 'min-h-12 flex-col items-center justify-center gap-1 px-0.5 py-1.5 text-center'
                        : stacked
                          ? 'min-h-14 flex-col items-center justify-center gap-1.5 px-1 py-2 text-center min-[560px]:px-2'
                          : compact
                            ? 'min-h-11 items-center py-2'
                            : 'min-h-12 items-start py-2.5',
                    'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                    /*
                      SELECTED, WITH A DIRECTION WHERE THERE IS ONE. The tint is
                      the Dashboard Calendar's restrained pair — a wash, a
                      border and emphasised text, never a saturated fill — so a
                      chosen Long reads as "selected Long", not as a success
                      banner. The label is always the word, so the state
                      survives greyscale and colour blindness (DESIGN.md §9.4).
                    */
                    buttons && checked
                      ? option.tone === 'positive'
                        ? 'border-positive bg-positive/12 ring-positive ring-1 ring-inset'
                        : option.tone === 'negative'
                          ? 'border-negative bg-negative/12 ring-negative ring-1 ring-inset'
                          : option.tone === 'break_even'
                            ? 'border-break-even bg-break-even/12 ring-break-even ring-1 ring-inset'
                            : 'border-foreground bg-accent ring-foreground ring-1 ring-inset'
                      : checked
                        ? option.tone === 'positive'
                          ? 'border-positive/45 bg-positive/8'
                          : option.tone === 'negative'
                            ? 'border-negative/45 bg-negative/8'
                            : option.tone === 'break_even'
                              ? 'border-break-even/45 bg-break-even/8'
                              : 'border-foreground/60 bg-accent'
                        : cn(
                            'bg-background hover:bg-accent',
                            error === undefined ? 'border-control-border' : 'border-destructive',
                          ),
                  )}
                >
                  {buttons ? (
                    checked ? (
                      <Check
                        aria-hidden="true"
                        className={cn(
                          'size-4 shrink-0',
                          option.tone === 'positive'
                            ? 'text-positive'
                            : option.tone === 'negative'
                              ? 'text-negative'
                              : option.tone === 'break_even'
                                ? 'text-break-even'
                                : 'text-foreground',
                        )}
                      />
                    ) : null
                  ) : (
                    <RadioMark
                      checked={checked}
                      tone={option.tone}
                      className={scale ? 'size-3.5' : compact || stacked ? '' : 'mt-0.5'}
                    />
                  )}
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block break-words',
                        scale
                          ? 'text-xs leading-tight min-[420px]:text-sm'
                          : buttons
                            ? 'text-[0.9375rem]'
                            : 'text-sm',
                        checked ? 'font-semibold' : 'font-medium',
                        checked && option.tone === 'positive'
                          ? 'text-positive'
                          : checked && option.tone === 'negative'
                            ? 'text-negative'
                            : checked && option.tone === 'break_even'
                              ? 'text-break-even'
                              : 'text-foreground',
                      )}
                    >
                      {option.label}
                    </span>
                    {option.description === undefined ? null : (
                      <span className="text-muted-foreground mt-0.5 block text-sm">
                        {option.description}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
        {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </fieldset>
  );
}

/** A neutral toggle chip: no valence colour, selection is a check plus weight. */
export function Chip({
  selected,
  onClick,
  children,
  size = 'default',
}: {
  selected: boolean;
  onClick: () => void;
  children: string;
  /** `lg` is a primary choice on a phone rather than a tag beside a field. */
  size?: 'default' | 'lg';
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-ring relative inline-flex items-center gap-1.5 rounded-full border outline-none focus-visible:ring-2',
        size === 'lg' ? 'min-h-11 px-4 text-[0.9375rem]' : 'min-h-10 px-3 text-sm',
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
        selected
          ? 'text-foreground border-foreground/60 bg-accent font-semibold'
          : 'border-control-border bg-background text-foreground hover:bg-accent',
      )}
    >
      {selected ? <Check className="text-primary-text size-3.5" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/**
 * A quiet disclosure that always says what it holds (UX Rules §3.2). With
 * `openFromDesktop` the content stays open at `lg` and up, where the trigger
 * is not rendered — one copy of the fields, never two.
 */
export function Disclosure({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
  openFromDesktop = false,
}: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  openFromDesktop?: boolean;
}) {
  const regionId = `${id}-region`;
  return (
    <div className="min-w-0">
      <button
        id={id}
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
        className={cn(
          'hover:bg-accent focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2',
          openFromDesktop && 'lg:hidden',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="text-foreground block text-sm font-semibold">{title}</span>
          <span className="text-muted-foreground block text-sm break-words">{summary}</span>
        </span>
        <ChevronDown
          className={cn(
            'text-muted-foreground size-4 shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>
      <div
        id={regionId}
        className={cn(
          'min-w-0',
          open ? 'block' : 'hidden',
          openFromDesktop ? 'px-3 pt-3 pb-1 lg:block lg:p-0' : 'px-3 pt-3 pb-1',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function RequirementRow({
  label,
  done,
  addedLabel,
  neededLabel,
}: {
  label: string;
  done: boolean;
  addedLabel: string;
  neededLabel: string;
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border',
          done ? 'border-primary bg-primary text-primary-foreground' : 'border-control-border',
        )}
      >
        {done ? <Check className="size-3" /> : null}
      </span>
      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className="sr-only">{done ? addedLabel : neededLabel}</span>
    </li>
  );
}
