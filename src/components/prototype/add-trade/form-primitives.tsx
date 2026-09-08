'use client';

import { Check, ChevronLeft, X } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * THE RECORDING FORM'S SHARED ANATOMY — three visual levels, and no more.
 *
 * WHAT THE SECOND COMPOSITION PASS CHANGED. The previous version was right
 * about information architecture and wrong about what a reader perceives first.
 * Every logical concept had been given its own frame: a bordered core surface,
 * titled bands inside it, a bordered computed-result box, a bordered override
 * panel, a bordered optional-details plane with bordered entries inside that.
 * Nine visible containers to record four facts and one number. A reader opening
 * that page sees the DATA STRUCTURE — a form with sections — before they see the
 * thing they came to do, which is write down a trade.
 *
 * SO THERE ARE NOW EXACTLY THREE LEVELS:
 *
 *   1. CANVAS        the page, holding a title and one task
 *   2. TASK SURFACE  one card: the trade being recorded
 *   3. CONTROLS      the editable content inside it
 *
 * Nothing else gets a border. Grouping inside the task surface is done with
 * space and a single hairline rule, which is enough to separate three bands and
 * not enough to read as three sub-forms. The computed result is a line of text,
 * not a panel. The optional depth is one row, not a plane.
 *
 * TYPOGRAPHY CARRIES THE HIERARCHY THAT FRAMES USED TO CARRY. The page title is
 * the product's own `text-page-title` token; the trade's principal number is
 * `text-metric`; the one editable figure the task is ABOUT is 22–24px while
 * every supporting input stays at 16px. A reader can rank the page now without
 * reading any of it, which is what "lighter than the information it collects"
 * means in practice.
 */

/**
 * The page: a title, a quiet situation line, the task, the action.
 *
 * NO CARD AROUND THE WHOLE THING, and no title squeezed between two icons. On a
 * phone the icon row carries Back and Close only — the title used to sit between
 * them at 16px, smaller than the body text underneath it, which left the mobile
 * composition with no visible heading at all. It is below the icons now at full
 * size, so both compositions state the page the same way.
 */
export function FormShell({
  title = 'Log a trade',
  situation,
  onChangeSituation,
  children,
  footer,
}: {
  title?: string;
  situation: string;
  onChangeSituation?: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-1 pb-24 sm:px-6 md:pt-10">
      {/* The icon row overlaps the title's own leading rather than sitting on a
          line of its own — 44px targets kept, roughly 30px of dead space at the
          top of every phone screen returned. */}
      <div className="-mb-1 flex min-w-0 items-center justify-between gap-2 lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Back" className="-ml-2 shrink-0">
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close" className="-mr-2 shrink-0">
          <X className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <h1 className="text-foreground text-page-title min-w-0">{title}</h1>

      {/*
        THE SITUATION IS METADATA, NOT A SECOND HEADING. It was a bordered band
        of its own; it is one quiet line under the title now, with its escape
        beside it, which is all it ever said.
      */}
      <div className="mt-1 mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 md:mb-5">
        <p className="text-muted-foreground min-w-0 text-sm">{situation}</p>
        {onChangeSituation === undefined ? null : (
          <>
            <span className="text-subtle-foreground" aria-hidden="true">
              ·
            </span>
            <QuietAction onClick={onChangeSituation}>Change</QuietAction>
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 md:gap-4">{children}</div>

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

/**
 * LEVEL 2 — the one surface the task lives on.
 *
 * Named for what it is rather than for what it contains: the previous name
 * (`CoreSurface`) implied a matching non-core surface, and that second plane is
 * exactly what this pass removed.
 */
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

/**
 * A band inside the task surface.
 *
 * `divide-y` on the parent would have been shorter, but bands need different
 * padding — the identity band is denser than the one carrying the primary
 * figure — so each band states its own and owns the rule beneath it.
 */
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
    <section
      className={cn(
        'flex min-w-0 flex-col gap-3 px-4 py-3.5 sm:gap-4 sm:px-5 sm:py-4',
        divided && 'border-border border-b',
        className,
      )}
    >
      {children}
    </section>
  );
}

/**
 * THE ACCOUNT IS CONTEXT, NOT A DECISION.
 *
 * It was a full-width `<select>` with a label, which gave "which account" the
 * same weight as "how much did you risk" — the reader's eye met a dropdown
 * first, and a form-shaped page was the impression that followed. It is one line
 * of supporting text now, with Change beside it. The account can still be
 * changed; it just no longer opens the page.
 *
 * THE TIMEZONE LEFT THIS LINE. It was the fourth item in a dense run of
 * metadata — "Live · FTMO 100K · USD · Asia/Bangkok · GMT+7" — and it was ALSO
 * printed above the timestamp fields, so the same fact appeared twice in one
 * card. A timezone qualifies timestamps, not accounts, so it now lives with the
 * fields it changes the meaning of and this line states the account's identity
 * and its currency.
 */
export function ContextLine({
  account,
  currency,
  onChange,
}: {
  account: string;
  currency: string;
  onChange?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
      <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
        <span className="text-foreground font-medium">{account}</span>
        <span className="text-subtle-foreground"> · </span>
        {currency}
      </p>
      {onChange === undefined ? null : <QuietAction onClick={onChange}>Change</QuietAction>}
    </div>
  );
}

/**
 * A text link with a 44px target and no layout cost.
 *
 * The transparent `::after` is this codebase's established way of giving 16–20px
 * of ink a thumb-sized hit area without adding 24px to the row it sits in — see
 * `FollowUpAction`. Every quiet action in the recording flow uses this one
 * implementation now rather than five copies of the same class list.
 */
export function QuietAction({
  children,
  onClick,
  expanded,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  expanded?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      className={cn(
        // `min-w-0` and a normal white-space, NOT `shrink-0`: these labels are
        // whole sentences ("It closed in more than one exit"), and at 200% text
        // zoom on a 320px screen an unbreakable one is 473px that pushes the
        // page sideways. Wrapping costs nothing at ordinary type — none of them
        // wrap there — and turns the zoom case into a second line.
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

/** Related fields, side by side only where there is room and only where they belong together. */
export function FieldPair({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-1 gap-4 min-[560px]:grid-cols-2">{children}</div>;
}

/**
 * A labelled control.
 *
 * THE LABEL IS 13px, NOT 14px BODY WEIGHT. Labels and the values they describe
 * were the same size, so a column of fields read as an undifferentiated stack of
 * text. Dropping the label a step and keeping the input at 16px is what makes a
 * field read as editable CONTENT with a name, rather than as a row in a settings
 * table.
 */
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
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Label htmlFor={id} className="text-muted-foreground text-xs font-medium">
          {label}
        </Label>
        {optional ? <span className="text-subtle-foreground text-xs">Optional</span> : null}
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
 * THE ONE FIGURE THE TASK IS ABOUT.
 *
 * At Entry that is the initial risk; After Trade it is the net realized P&L.
 * Everything else on the page — the account, the symbol, the timestamps, the
 * optional target — is scaffolding around this number, and until this pass the
 * page did not say so: every input was 16px in an identically sized box, so the
 * reader had to read the labels to discover which one mattered.
 *
 * 22–24px of tabular figures, the currency stated inside the control rather than
 * as another label, and a sign toggle where a sign is meaningful. Nothing here
 * is decorative — the size IS the hierarchy.
 */
export function PrimaryAmountField({
  label,
  currency,
  value,
  onChange,
  hint,
  trailing,
}: {
  label: string;
  currency: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** A small control that belongs on the label's own line. */
  trailing?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Label htmlFor={id} className="text-foreground text-sm font-medium">
          {label}
        </Label>
        {trailing}
      </div>

      {/*
        THE CURRENCY YIELDS ITS LINE BEFORE THE FIELD YIELDS ITS WIDTH.

        The row was `flex` with the code `shrink-0` beside a `flex-1 min-w-0`
        input — which is correct at ordinary sizes and collapses at the extreme:
        at 200% text zoom on a 320px screen the code took the row and left the
        input 18px, a field whose own value could not be read. `flex-wrap` plus a
        floor on the input means the code drops beneath it instead. It costs
        nothing at any width where both fit, which is every width a reader is
        likely to be at.
      */}
      <div className="border-input bg-background focus-within:border-ring focus-within:ring-ring/50 flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg border px-3 py-1 focus-within:ring-[3px]">
        <input
          id={id}
          value={value}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          // The floor is PX, not REM: a rem floor scales with the root font size, which
          // is exactly what 200% text zoom changes — so it grew to 224px and pushed
          // the page sideways. 112px keeps the value readable without ever
          // outgrowing the box that holds it.
          className="numeric text-foreground h-12 w-full min-w-[112px] flex-1 bg-transparent text-[1.375rem] leading-none outline-none sm:text-2xl"
        />
        <span className="text-muted-foreground shrink-0 pb-1 text-sm">{currency}</span>
      </div>

      {hint === undefined ? null : (
        <p className="text-muted-foreground text-xs leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

/** Profit, Loss or Break-even — what the typed amount MEANS. */
export type MoneyOutcome = 'profit' | 'loss' | 'break_even';

/**
 * THE SIGN, ASKED IN WORDS.
 *
 * WHAT THIS REPLACES. A 44px square carrying a `+` or a `−` glyph, which the
 * reader had to notice, understand as a toggle, and press to record a losing
 * trade. Every part of that is a discovery problem: it is icon-only, its two
 * states look equally "on", and nothing on the screen says that pressing it is
 * how a loss gets entered. A trader who does not find it records their worst
 * trade as a profit — and the form will happily save it.
 *
 * Three named choices instead. `Break-even` is one of them because a reader who
 * ended flat should not have to decide whether zero is a profit or a loss, and
 * because typing `0` into an amount field labelled "Profit" is a sentence nobody
 * wants to write about their own trade.
 *
 * THIS IS INPUT MEANING, NOT CLASSIFICATION. It determines the SIGN of the
 * amount the trader is typing. It is not the engine's outcome verdict: that is
 * still derived from the resulting R against the break-even tolerance band, and
 * a trade entered as a `profit` of a few cents can still classify as break-even.
 * The two must not be conflated, and nothing here writes the classification.
 */
export function OutcomeChoice({
  value,
  onChange,
  legend = 'Was this a profit or a loss?',
}: {
  value: MoneyOutcome;
  onChange: (value: MoneyOutcome) => void;
  legend?: string;
}) {
  const name = useId();
  const options = [
    { value: 'profit' as const, label: 'Profit' },
    { value: 'loss' as const, label: 'Loss' },
    { value: 'break_even' as const, label: 'Break-even' },
  ];

  return (
    <fieldset className="min-w-0">
      <legend className="text-muted-foreground mb-1.5 text-xs font-medium">{legend}</legend>
      <div className="grid min-w-0 grid-cols-3 gap-2">
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
                  'flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2 text-sm font-medium',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                  checked
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-input bg-background text-muted-foreground hover:bg-accent',
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
    </fieldset>
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
                  'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium',
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
 * HOW THE TRADE IS BEING RECORDED — small, local, and no longer unexplained.
 *
 * IT WAS A HEADLINE, THEN IT WAS A MYSTERY. First it was a full-width labelled
 * control with a standing explanatory sentence, sitting above the figures — so
 * the first decision the page presented was a representation choice, before the
 * reader had been asked for a single number. Shrinking it to a bare
 * `Money | Prices` pair on the amount field's label line fixed the weight and
 * created a worse problem: two nouns with no verb and no question, offering a
 * choice a beginner has no way to evaluate.
 *
 * It carries its own visible label now — "Record using" — and its options say
 * what the trader will be typing: `Amounts` or `Prices`. Small, local, beside
 * the figures it governs, and answerable without knowing anything about how the
 * product stores a trade. The consequence sentence appears only in the mode that
 * has one, and only the active basis submits.
 */
export function BasisToggle({
  value,
  onChange,
}: {
  value: 'money' | 'price';
  onChange: (value: 'money' | 'price') => void;
}) {
  const name = useId();
  return (
    /*
      IT WRAPS RATHER THAN OVERFLOWS. `shrink-0` was right for the control at
      ordinary type and wrong at 200% text zoom, where "Record using · Amounts ·
      Prices" is 495px of unbreakable row on a 320px screen — the page scrolled
      sideways, which this design system forbids at every width. Both the label
      and the two options are allowed to break onto their own lines; nothing
      shrinks, and no touch target loses a pixel.
    */
    <fieldset className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <legend className="sr-only">Record using</legend>
      <span aria-hidden="true" className="text-muted-foreground text-xs font-medium">
        Record using
      </span>
      <div className="bg-muted/60 flex min-w-0 flex-wrap items-center gap-0.5 rounded-md p-0.5">
        {(
          [
            { value: 'money', label: 'Amounts' },
            { value: 'price', label: 'Prices' },
          ] as const
        ).map((option) => {
          const id = `${name}-${option.value}`;
          const checked = value === option.value;
          return (
            <div key={option.value} className="relative">
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
                  'relative flex h-8 cursor-pointer items-center rounded-[0.3rem] px-2.5 text-xs font-medium',
                  'peer-focus-visible:ring-ring transition-colors peer-focus-visible:ring-2',
                  // 32px of ink, 44px of target — the same extension the quiet
                  // links use, so compactness never costs a thumb its hit area.
                  'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                  checked
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * THE COMPUTED ANSWER AS A LINE, NOT A PANEL.
 *
 * `ComputedResult` was a bordered, tinted box holding one short sentence. On the
 * short path — the path whose entire claim is that it looks short — a framed
 * element reads as another section to deal with. The answer is a line of text
 * now: label, figure, qualifier. It still appears only when it MEANS something,
 * because a summary reading "Not enough yet" beneath two untouched fields is a
 * reproach for not having typed.
 *
 * `emphasis` is for the one figure a screen exists to produce — After Trade's
 * Actual R — which takes `text-metric` and carries its outcome word beside it.
 * Everything else states its number at 16px.
 */
/**
 * THE RESULT, WITH MONEY IN FRONT.
 *
 * THE PREVIOUS COMPOSITION LED WITH R, at `text-metric`, with the money a
 * smaller line underneath. That is the right emphasis for a trader who already
 * thinks in R and exactly the wrong one for a beginner, who has no idea what
 * `+2.10R` is and every idea what `+420.00 USD` is. A journal whose headline
 * figure is a unit the reader has not learned yet is a journal they cannot check
 * their own work against.
 *
 * So money is the headline and R sits beneath it, labelled `Result (R)` rather
 * than `Actual R` — the word "actual" only means something once you know what it
 * is being contrasted with, and at this point in the product nothing has told
 * them. `Net profit` / `Net loss` names the direction in the label so the figure
 * never has to be read for its sign alone.
 *
 * WHEN MONEY IS ABSENT it says `Not recorded` and R still prints below: a
 * price-recorded trade has a real R and genuinely has no monetary P&L, and
 * showing a zero there would be a fabricated fact.
 */
export function ResultSummary({
  money,
  moneyLabel,
  r,
  tone,
  className,
}: {
  /** The formatted, signed monetary result, or `null` when it was never recorded. */
  money: string | null;
  /** `Net profit`, `Net loss`, `Net P&L` — the caller names the direction. */
  moneyLabel: string;
  /** The formatted, signed R, or `null` when it cannot be derived. */
  r: string | null;
  tone: 'positive' | 'negative' | 'neutral';
  className?: string;
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-positive'
      : tone === 'negative'
        ? 'text-negative'
        : 'text-foreground';

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs font-medium">{moneyLabel}</p>
        <p
          className={cn(
            'numeric mt-0.5 font-semibold',
            money === null ? 'text-subtle-foreground text-base' : cn('text-metric', toneClass),
          )}
        >
          {money ?? 'Not recorded'}
        </p>
      </div>

      {r === null ? null : (
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-medium">Result (R)</p>
          <p className={cn('numeric mt-0.5 text-base font-semibold', toneClass)}>{r}</p>
        </div>
      )}
    </div>
  );
}

export function ResultLine({
  label,
  value,
  detail,
  tone = 'neutral',
  emphasis = false,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'positive' | 'negative';
  emphasis?: boolean;
}) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span
        className={cn(
          'numeric font-semibold',
          emphasis ? 'text-metric' : 'text-base',
          tone === 'positive'
            ? 'text-positive'
            : tone === 'negative'
              ? 'text-negative'
              : 'text-foreground',
        )}
      >
        {value}
      </span>
      {detail === undefined ? null : (
        <span className={cn('text-muted-foreground', emphasis ? 'text-sm' : 'text-xs')}>
          {detail}
        </span>
      )}
    </p>
  );
}

/**
 * The primary action and the sentence that removes the anxiety around it.
 *
 * ONE filled button per task. The helper line is not decoration: the single most
 * common reason a trader abandons a journal entry at the moment of entry is not
 * knowing whether saving now commits them to a record they cannot finish later.
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
        'mt-2 flex min-w-0 flex-col gap-2',
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
export function useKeyboardObscuringViewport(): boolean {
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
