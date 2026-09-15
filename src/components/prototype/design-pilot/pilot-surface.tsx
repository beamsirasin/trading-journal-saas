'use client';

import { AlertTriangle, Check, ChevronDown, CircleAlert, Info } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * AT ENTRY VISUAL PILOT — LOCAL VISUAL PRIMITIVES.
 *
 * Calibration experiments for DESIGN.md, deliberately NOT promoted into
 * `src/components/ui`: no global token migration, no production primitive
 * changed. Each experiment is named where it happens.
 *
 * RADIUS ROLES — four, and nothing else is used on this page:
 *   control  inputs, choices, buttons          `rounded-md`  (10px)
 *   surface  the one capture plane             `rounded-xl`  (16px)
 *   overlay  dialogs / sheets                  the overlay primitive's own
 *   pill     tags and emotion chips            `rounded-full`
 */
export const RADIUS = {
  control: 'rounded-md',
  surface: 'rounded-xl',
  pill: 'rounded-full',
} as const;

/*
  THEME TEMPERATURE EXPERIMENT, SCOPED TO THIS PAGE.

  The production palette pairs a pure-neutral near-black Dark with a
  blue-tinted Light and two different accent hues (cyan / royal blue). Here both
  themes share one cool-neutral temperature and one cyan accent family, and the
  Dark ground is lifted off near-black. `:has()` scopes it to documents that
  contain this page (portals included) without touching globals.css. Header
  chrome keeps its own tokens.

  Contrast (approximate, WCAG relative luminance):
    dark  muted #a7adb5 on card #1a1d21  7.5:1   subtle #8d939b  5.5:1
          primary #3498b8 on card        5.1:1
    light muted #5b636e on #ffffff       6.1:1   subtle #6b727d  4.9:1
          primary #0e7490 on #ffffff     5.4:1   (white label on it 5.4:1)
*/
const PILOT_THEME_CSS = `
html:has([data-pilot-surface]) {
  color-scheme: dark;
  --background: #121417;
  --foreground: #f2f4f6;
  --card: #1a1d21;
  --card-foreground: #f2f4f6;
  --popover: #1f2226;
  --popover-foreground: #f2f4f6;
  --primary: #3498b8;
  --primary-foreground: #0b0d0f;
  --secondary: #24282d;
  --secondary-foreground: #f2f4f6;
  --muted: #24282d;
  --muted-foreground: #a7adb5;
  --subtle-foreground: #8d939b;
  --accent: #262a30;
  --accent-foreground: #f2f4f6;
  --border: rgb(255 255 255 / 0.08);
  --input: rgb(255 255 255 / 0.14);
  --ring: #3498b8;
  --surface-raised: #2a2e34;
  --pilot-selected: #262b31;
  --pilot-selected-border: rgb(255 255 255 / 0.3);
}
html.light:has([data-pilot-surface]) {
  color-scheme: light;
  --background: #f3f5f7;
  --foreground: #111418;
  --card: #ffffff;
  --card-foreground: #111418;
  --popover: #ffffff;
  --popover-foreground: #111418;
  --primary: #0e7490;
  --primary-foreground: #ffffff;
  --secondary: #eef0f3;
  --secondary-foreground: #111418;
  --muted: #eef0f3;
  --muted-foreground: #5b636e;
  --subtle-foreground: #6b727d;
  --accent: #e8ebef;
  --accent-foreground: #111418;
  --border: #e2e5e9;
  --input: #cdd2d8;
  --ring: #0e7490;
  --surface-raised: #ffffff;
  --pilot-selected: #eef3f5;
  --pilot-selected-border: #8a939e;
}
[data-pilot-surface] .pilot-figure { font-variant-numeric: tabular-nums lining-nums; }
[data-pilot-surface][data-figures='mono'] .pilot-figure { font-family: var(--font-mono); }
`;

export function PilotTheme({
  figures,
  children,
}: {
  /** FIGURE EXPERIMENT: `tabular` = tabular figures in Noto Sans Thai; `mono` = the current `numeric` stack. */
  figures: 'tabular' | 'mono';
  children: ReactNode;
}) {
  return (
    <div
      data-pilot-surface=""
      data-figures={figures}
      className="bg-background text-foreground min-h-dvh"
    >
      <style>{PILOT_THEME_CSS}</style>
      {children}
    </div>
  );
}

/** A group title: sentence case, weight and size carry it — never uppercase or tracking. */
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

/** Quiet state words beside a label: "Not answered". Neutral, never a warning. */
export function StateText({ children }: { children: ReactNode }) {
  return <span className="text-subtle-foreground text-sm">{children}</span>;
}

/**
 * A fieldset header whose legend stays the fieldset's FIRST child, so the group
 * keeps its accessible name, with an optional state beside it on the same line.
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

export type TagTone = 'default' | 'inherited' | 'context';

/**
 * ANSWERED vs DEFAULT vs INHERITED, as a shape rather than a colour.
 * Dashed = the system supplied it and it is waiting for the trader; solid =
 * a neutral fact. Always words, never a dot alone.
 */
export function Tag({
  tone,
  icon,
  children,
}: {
  tone: TagTone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1 border px-2 py-0.5 text-xs font-medium',
        RADIUS.pill,
        tone === 'context'
          ? 'text-foreground border-border bg-muted'
          : 'text-muted-foreground border-dashed border-[var(--pilot-selected-border)]',
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** An inline text action with a 44px target and no layout cost. */
export function InlineAction({
  children,
  onClick,
  tone = 'default',
  controls,
  expanded,
  ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'destructive';
  controls?: string;
  expanded?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
      className={cn(
        'focus-visible:ring-ring relative rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2',
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
        tone === 'destructive' ? 'text-destructive' : 'text-primary',
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

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-destructive flex min-w-0 items-start gap-1.5 text-sm">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function Helper({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-muted-foreground text-sm leading-relaxed">
      {children}
    </p>
  );
}

/** A quiet notice: icon + sentence beside its subject. Not an error, not a filled alert box. */
export function Notice({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'warning' ? AlertTriangle : Info;
  return (
    <p className="text-foreground flex min-w-0 items-start gap-2 text-sm" role="status">
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

function describedBy(...ids: readonly (string | false | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(' ');
  return joined === '' ? undefined : joined;
}

const WELL =
  'bg-background border-input focus-within:border-ring focus-within:ring-ring/40 flex min-w-0 items-center gap-2 border px-3 focus-within:ring-[3px]';

/** Text, price or amount. `lead` is the one figure At Entry genuinely needs: Risk at Entry. */
export function PilotInput({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  suffix,
  placeholder,
  inputMode,
  size = 'standard',
  figure = false,
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
  size?: 'lead' | 'standard';
  figure?: boolean;
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
          RADIUS.control,
          size === 'lead' ? 'min-h-14' : 'min-h-11',
          error === undefined ? '' : 'border-destructive',
        )}
      >
        <input
          id={id}
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
            'text-foreground placeholder:text-subtle-foreground w-full min-w-0 flex-1 bg-transparent outline-none',
            size === 'lead' ? 'text-2xl font-semibold' : 'text-base',
            figure && 'pilot-figure',
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

export function PilotTextarea({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'bg-background border-input text-foreground placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-ring/40 min-h-24 w-full border px-3 py-2.5 text-base outline-none focus-visible:ring-[3px]',
          RADIUS.control,
        )}
      />
    </div>
  );
}

export function PilotSelect({
  id,
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative min-w-0">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'bg-background border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/40 min-h-11 w-full appearance-none border py-2 pr-10 pl-3 text-base outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60',
            RADIUS.control,
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
    </div>
  );
}

/**
 * A RECORDED-ANSWER CHOICE GROUP (DESIGN.md §6).
 *
 * Native radios, no initial selection. Every option is neutral at rest; the
 * chosen one gets a neutral active step, a filled radio marker and a stronger
 * label — never accent-filled area and never colour alone. Not a segmented
 * control: a segmented control always looks like one segment is on.
 */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  error,
  hint,
  columns = 2,
  status,
  compact = false,
}: {
  legend: string;
  value: T | null;
  options: readonly { value: T; label: string; description?: string }[];
  onChange: (value: T) => void;
  error?: string | undefined;
  hint?: string;
  columns?: 1 | 2 | 3;
  /** Shown beside the legend while unanswered, e.g. "Not answered". */
  status?: string;
  compact?: boolean;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  return (
    <fieldset
      className="min-w-0"
      aria-describedby={describedBy(hint !== undefined && hintId, error !== undefined && errorId)}
    >
      <Legend
        aside={value === null && status !== undefined ? <StateText>{status}</StateText> : null}
      >
        {legend}
      </Legend>
      <div className="flex min-w-0 flex-col gap-2">
        {hint === undefined ? null : <Helper id={hintId}>{hint}</Helper>}
        <div
          className={cn(
            'grid min-w-0 gap-2',
            columns === 1 && 'grid-cols-1',
            columns === 2 &&
              (options.some((option) => option.description !== undefined)
                ? 'grid-cols-1 min-[420px]:grid-cols-2'
                : 'grid-cols-2'),
            columns === 3 && 'grid-cols-1 sm:grid-cols-3',
          )}
        >
          {options.map((option) => {
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
                  className="peer sr-only"
                />
                <label
                  htmlFor={id}
                  className={cn(
                    'flex h-full min-w-0 cursor-pointer gap-2.5 border px-3 transition-colors motion-reduce:transition-none',
                    compact ? 'min-h-11 items-center py-2' : 'min-h-12 items-start py-2.5',
                    'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                    RADIUS.control,
                    checked
                      ? 'border-[var(--pilot-selected-border)] bg-[var(--pilot-selected)]'
                      : cn(
                          'bg-background hover:bg-accent',
                          error === undefined ? 'border-input' : 'border-destructive',
                        ),
                  )}
                >
                  <RadioMark checked={checked} className={compact ? '' : 'mt-0.5'} />
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'text-foreground block text-sm',
                        checked ? 'font-semibold' : 'font-medium',
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

export function RadioMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border',
        checked ? 'border-primary bg-primary' : 'border-[var(--pilot-selected-border)]',
        className,
      )}
    >
      {checked ? <span className="bg-primary-foreground size-1.5 rounded-full" /> : null}
    </span>
  );
}

/**
 * A quiet disclosure that always says what it holds (UX Rules §3.2).
 * `openFromDesktop` keeps the content permanently open at `lg` and above, where
 * the trigger is not rendered — one copy of the fields, never two.
 */
export function Disclosure({
  id,
  title,
  summary,
  open,
  onToggle,
  children,
  openFromDesktop = false,
  className,
}: {
  id: string;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  openFromDesktop?: boolean;
  className?: string;
}) {
  const regionId = `${id}-region`;
  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={onToggle}
        className={cn(
          'hover:bg-accent focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2',
          RADIUS.control,
          openFromDesktop && 'lg:hidden',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="text-foreground block text-sm font-semibold">{title}</span>
          <span className="text-muted-foreground block truncate text-sm">{summary}</span>
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

export function RequirementRow({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border',
          done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-[var(--pilot-selected-border)]',
        )}
      >
        {done ? <Check className="size-3" /> : null}
      </span>
      <span className={done ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
      <span className="sr-only">{done ? 'added' : 'still needed'}</span>
    </li>
  );
}
