'use client';

import { Check, ChevronLeft, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * THE RECORDING FORM'S SHARED ANATOMY.
 *
 * ONE CORE SURFACE, THEN OPTIONAL DISCLOSURES. The single decision these
 * primitives encode is that required work and optional depth are not peers.
 * The current form presents them as tabs of equal weight, which is why a trade
 * that needs four facts feels like a questionnaire: the reader has to inspect
 * six sections to discover that five of them are optional. Here the required
 * fields live on one surface and everything else is a closed row underneath it
 * that says, when it holds something, what it holds.
 *
 * A COLLAPSED SECTION IS NOT AN EMPTY ONE — see `OptionalEntry` in
 * `optional-details.tsx`, which owns that behaviour now. Expanding and
 * collapsing changes nothing about the data, which is the other half of the same
 * promise: the current production form clears the actual-opening override when
 * Advanced is collapsed, and a gesture that looks like tidying must never be a
 * gesture that deletes.
 */

export function FormShell({
  situation,
  onChangeSituation,
  children,
  footer,
}: {
  situation: string;
  onChangeSituation?: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-4 pb-24 sm:px-6 md:pt-8">
      {/*
        MOBILE FORM HEADER — Back, title, Close. The global product header is
        suppressed below `lg` on this route: on a 390px screen it costs 60px of
        vertical space to repeat a brand the reader is not currently using and
        an account they already see below.

        ONE `<h1>`, RENDERED ONCE, STYLED TWICE. It used to be a desktop-only
        `<h1>` plus a mobile `<p>`, which meant the phone layout — the one this
        flow is most used on — had no page heading in the accessibility tree at
        all. `min-w-0 truncate` on it is what stops the row from pushing the
        page sideways at 200% text zoom on a 320px screen, where two 44px icon
        buttons and a 32px title do not fit.
      */}
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2 lg:mb-5 lg:justify-start">
        <Button variant="ghost" size="icon" aria-label="Back" className="shrink-0 lg:hidden">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Button>
        <h1 className="text-foreground min-w-0 truncate text-base font-semibold lg:text-2xl lg:leading-8 lg:tracking-tight">
          Log a trade
        </h1>
        <Button variant="ghost" size="icon" aria-label="Close" className="shrink-0 lg:hidden">
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <div className="border-border mb-5 flex min-w-0 flex-wrap items-center justify-between gap-2 border-b pb-3">
        <p className="text-muted-foreground min-w-0 text-sm">{situation}</p>
        {onChangeSituation === undefined ? null : (
          <button
            type="button"
            onClick={onChangeSituation}
            className={cn(
              'text-primary focus-visible:ring-ring relative rounded-sm text-sm font-medium',
              'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
              // 20px of ink, 44px of target — see `FollowUpAction`.
              'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
            )}
          >
            Change
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">{children}</div>

      {/*
        THE FOOTER IS A DIRECT CHILD OF THE FORM COLUMN, not of a wrapper.

        It was inside a `<div className="mt-6">` whose height was exactly the
        footer's own — and a `position: sticky` element can only travel inside
        its containing block, so with nowhere to travel it never stuck to
        anything. It computed as `sticky`, reported itself docked, and rendered
        1,379px down the page on a 844px screen: a docked CTA that was never
        docked, and no amount of reading the class list would have said so.
      */}
      {footer}
    </div>
  );
}

/** The one surface the required work sits on. */
export function CoreSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'border-border bg-card shadow-card flex min-w-0 flex-col gap-5 rounded-lg border p-4 sm:p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A titled band inside the core surface — Identity, Actual result. */
export function CoreGroup({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {title === undefined ? null : (
        <div className="min-w-0">
          <h2 className="text-foreground text-base leading-6 font-semibold">{title}</h2>
          {description === undefined ? null : (
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/** Related fields, side by side only where there is room and only where they belong together. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-1 gap-4 min-[600px]:grid-cols-2">{children}</div>;
}

export function Field({
  label,
  hint,
  optional = false,
  suffix,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  /** A currency code or timezone shown beside the control's label. */
  suffix?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Label htmlFor={id}>{label}</Label>
        {optional ? <span className="text-muted-foreground text-xs">Optional</span> : null}
        {suffix === undefined ? null : (
          <span className="text-subtle-foreground ml-auto text-xs">{suffix}</span>
        )}
      </div>
      {children(id)}
      {hint === undefined ? null : (
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

export function TextField({
  label,
  hint,
  optional,
  suffix,
  value,
  onChange,
  placeholder,
  inputMode,
  numeric = false,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  suffix?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'decimal' | 'text';
  numeric?: boolean;
}) {
  return (
    <Field
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(optional === undefined ? {} : { optional })}
      {...(suffix === undefined ? {} : { suffix })}
    >
      {(id) => (
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(inputMode === undefined ? {} : { inputMode })}
          className={cn('text-base', numeric && 'numeric')}
        />
      )}
    </Field>
  );
}

/**
 * A two-choice control sized for a thumb.
 *
 * Long/Short are NEUTRAL. They are directions, not outcomes, and colouring them
 * green and red — which almost every trading tool does — teaches a reader to
 * see a short position as a loss before any result exists.
 */
export function ChoiceGroup<T extends string>({
  legend,
  options,
  value,
  onChange,
  className,
}: {
  legend: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn('min-w-0', className)}>
      <legend className="sr-only">{legend}</legend>
      <div
        className={cn(
          'grid min-w-0 gap-2',
          options.length === 2 ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-3',
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
                checked={checked}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <label
                htmlFor={id}
                className={cn(
                  'flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  checked
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                {/* Selection is a filled surface PLUS a border and a check —
                    never colour alone. */}
                {checked ? (
                  <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
                ) : null}
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * The computed answer, stated once, directly under the inputs that produce it.
 *
 * It appears only when it MEANS something. A summary that reads "Not enough
 * yet" beneath two untouched fields is a reproach for not having typed, and the
 * current form shows one from the moment it mounts.
 */
export function ComputedResult({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  return (
    <div
      className={cn(
        'bg-muted/60 border-border flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border px-3 py-2.5 text-sm',
        tone === 'positive' && 'border-positive/25 bg-positive/5',
        tone === 'negative' && 'border-negative/25 bg-negative/5',
      )}
    >
      {children}
    </div>
  );
}

/**
 * The primary action and the sentence that removes the anxiety around it.
 *
 * ONE filled button per task. The helper line is not decoration: the single
 * most common reason a trader abandons a journal entry at the moment of entry
 * is not knowing whether saving now commits them to a record they cannot
 * finish later.
 */
export function FormFooter({
  action,
  helper,
  secondary,
  sticky = false,
}: {
  action: string;
  helper: string;
  secondary?: string;
  sticky?: boolean;
}) {
  /*
    THE DOCKED SAVE RELEASES ITSELF WHEN THE KEYBOARD NEEDS THE ROOM.

    A CTA docked to `bottom-0` is docked to the LAYOUT viewport, which a mobile
    keyboard does not shrink. So the bar keeps sitting at the bottom of a
    viewport the keyboard is now covering — either hidden behind it, or worse,
    floating over the field the reader is typing into along with its error.

    `visualViewport` is the only API that reports the region actually visible.
    When it is meaningfully shorter than the layout viewport a keyboard is up,
    and the footer stops being sticky and returns to the form's natural end.
    Nothing is hidden and nothing overlaps: the focused input and its message
    keep the screen, which is the non-negotiable half of this requirement, and
    the docked convenience is what yields.

    It degrades safely: with no `visualViewport` the footer simply stays docked,
    which is today's behaviour.
  */
  const keyboardOpen = useKeyboardObscuringViewport();
  const docked = sticky && !keyboardOpen;

  return (
    <div
      data-form-footer={docked ? 'docked' : 'inline'}
      className={cn(
        'mt-6 flex min-w-0 flex-col gap-2',
        docked &&
          'bg-background/95 border-border sticky bottom-0 -mx-4 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Button size="lg" className="min-h-12 w-full sm:w-auto">
          {action}
        </Button>
        {secondary === undefined ? null : (
          <Button variant="ghost" size="lg" className="min-h-12 w-full sm:w-auto">
            {secondary}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{helper}</p>
    </div>
  );
}

/**
 * `true` while the visual viewport is materially shorter than the layout
 * viewport — the only honest signal available that a keyboard (or another
 * platform panel) is covering the page.
 *
 * 140px rather than any smaller number: a mobile browser's collapsing URL bar
 * changes the visual viewport by 50–90px during ordinary scrolling, and a
 * threshold under that would undock the save button every time someone scrolled.
 */
function useKeyboardObscuringViewport(): boolean {
  const [obscured, setObscured] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === undefined || viewport === null) return;

    const read = () => {
      setObscured(window.innerHeight - viewport.height > 140);
    };
    read();
    viewport.addEventListener('resize', read);
    return () => viewport.removeEventListener('resize', read);
  }, []);

  return obscured;
}

/**
 * Money and Prices, as a visible consequence rather than a hidden mode.
 *
 * The sentence under the choice is the important part: choosing Prices means
 * this trade will have an R and no monetary P&L, and a trader who discovers
 * that three weeks later in an analytics total has been misled by a control
 * that looked like a formatting preference.
 */
export function BasisSwitch({
  value,
  onChange,
}: {
  value: 'money' | 'price';
  onChange: (value: 'money' | 'price') => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <span className="text-muted-foreground text-sm">Record using</span>
        <ChoiceGroup
          legend="Recording basis"
          value={value}
          onChange={onChange}
          options={[
            { value: 'money', label: 'Money' },
            { value: 'price', label: 'Prices' },
          ]}
          className="w-[220px]"
        />
      </div>
      {value === 'price' ? (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Prices calculate R. Monetary P&amp;L is not recorded in this mode.
        </p>
      ) : null}
    </div>
  );
}
