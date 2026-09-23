'use client';

import { ArrowLeft, ArrowRight, CircleAlert } from 'lucide-react';
import type { FormEvent, ReactNode, RefObject } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { InlineAction } from './trade-at-entry-controls';
import { DiscardDraftAction } from './trade-recording-draft-status';
import { TradeRecordingModeChange } from './trade-recording-mode-change';

/** One rail segment per step. Literal classes, so the stylesheet contains every count a flow uses. */
const RAIL_COLUMNS: Readonly<Record<number, string>> = {
  2: 'grid-cols-2',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};

/** One step as the frame shows it — never its answers, only what it holds in a line. */
export interface TradeStepView {
  readonly key: string;
  readonly label: string;
  /** What the step holds, in a line; `null` when nothing is recorded. */
  readonly summary: string | null;
  /** Blocking errors the step holds, so it is marked wherever it is listed. */
  readonly errors: number;
  /** What Save is still waiting for on this step, said instead of its summary. */
  readonly pending: string | null;
}

/** The words the frame speaks, resolved by the host for its own recording mode. */
export interface TradeStepFlowCopy {
  readonly navLabel: string;
  readonly progress: string;
  readonly goTo: (index: number, label: string) => string;
  readonly needsAttention: string;
  readonly optional: string;
  readonly back: string;
  readonly nextTo: (label: string) => string;
}

/**
 * THE GUIDED RECORDING FRAME — one step at a time, shared by every recording
 * flow (UX Rules §20.3, §20.9; the protected Step 1 header and footer).
 *
 * It draws where the trader is and how to move: the mode line with Change and
 * Discard, "Step n of m" and the progress rail on a phone, the labelled step
 * list beside a wide form, the step's own heading, the docked action bar with
 * Back / Next and the last step's Save, and the quiet Quick Save line. It holds
 * no answers and decides nothing about them: the host owns the draft, the
 * current step, validation and Save, and passes the frame what to say.
 *
 * THE CURRENT STEP IS VIEW STATE, NOT DRAFT STATE. Every step stays mounted
 * and only the current one is shown, so moving between steps can never drop
 * an answer or an editor's local state.
 */
export function TradeStepFlow({
  recordingMode,
  formRef,
  formId,
  formData,
  onSubmit,
  wide,
  keyboardOpen,
  modeSentence,
  modeShort,
  onDiscardDraft,
  steps,
  step,
  onShowStep,
  headingId,
  headingRef,
  title,
  description,
  attention,
  copy,
  status,
  quickSave,
  save,
  footerNote,
  replayPanel,
  requirements,
  children,
}: {
  recordingMode: 'at_entry' | 'after_trade';
  formRef: RefObject<HTMLFormElement | null>;
  formId: string;
  /** The host's own `data-*` markers for the form. */
  formData: Record<`data-${string}`, string>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  wide: boolean;
  keyboardOpen: boolean;
  /** The mode, said once above the flow on a wide screen. */
  modeSentence: string;
  /** The mode in two words, inside the phone's step header. */
  modeShort: string;
  onDiscardDraft: (() => void) | null;
  steps: readonly TradeStepView[];
  step: number;
  onShowStep: (index: number) => void;
  headingId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  title: string;
  description: string;
  /** How much of the current step needs attention, when anything does. */
  attention: string | null;
  copy: TradeStepFlowCopy;
  status: { readonly show: boolean; readonly text: string; readonly tone: string };
  /** The short way out, where it is honest to offer it; `null` hides it. */
  quickSave: {
    readonly id: string;
    readonly label: string;
    readonly ariaLabel: string;
    readonly hint: string;
    readonly onClick: () => void;
  } | null;
  save: { readonly label: string; readonly pendingLabel: string; readonly pending: boolean };
  footerNote: ReactNode;
  replayPanel: ReactNode;
  /** What Save is still waiting for, beside a wide form. */
  requirements: {
    readonly ready: boolean;
    readonly readyText: string;
    readonly missing: string;
    readonly list: string;
  };
  children: ReactNode;
}) {
  const onLastStep = step === steps.length - 1;
  /** Step 1 has no earlier step, so its bar holds one action rather than a pair. */
  const noBack = step === 0;
  const next = steps[step + 1];

  /** The step list, tappable: a segmented rail on a phone, a labelled list beside a wide form. */
  const stepNav = wide ? (
    <nav aria-label={copy.navLabel}>
      <ol className="flex min-w-0 flex-col gap-1">
        {steps.map((item, index) => {
          const current = index === step;
          return (
            <li key={item.key} className="min-w-0">
              <button
                type="button"
                data-step-link={item.key}
                aria-current={current ? 'step' : undefined}
                onClick={() => onShowStep(index)}
                className={cn(
                  'hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-start gap-3 rounded-md px-3 py-2.5 text-left outline-none focus-visible:ring-2',
                  current && 'bg-accent',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
                    item.errors > 0
                      ? 'border-destructive text-destructive'
                      : current
                        ? 'border-primary bg-primary text-primary-foreground'
                        : item.summary === null
                          ? 'border-control-border text-muted-foreground'
                          : 'border-primary text-primary',
                  )}
                >
                  {item.errors > 0 ? <CircleAlert className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-foreground block text-sm',
                      current ? 'font-semibold' : 'font-medium',
                    )}
                  >
                    {item.label}
                  </span>
                  {/*
                    AN UNANSWERED OPTIONAL STEP IS OPTIONAL, NOT UNFINISHED.
                    An untouched optional step reads "Optional" rather than as
                    work outstanding. A step that holds something Save still
                    needs says what instead.
                  */}
                  <span
                    className={cn(
                      'block truncate text-xs',
                      item.errors > 0 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {item.errors > 0
                      ? copy.needsAttention
                      : (item.pending ?? item.summary ?? copy.optional)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  ) : (
    /*
      THE RAIL SITS CLOSE UNDER ITS LABEL. Each segment keeps its 32px hit
      area, but the bar rides near the top of it rather than in the middle, so
      the "Step 1 of 5" line and the segments that draw it read as one unit;
      and the rail gives back the header's gap beneath it, so the step heading
      starts right where the hit areas end — touching, never overlapping.
    */
    <nav aria-label={copy.navLabel} className="-mb-2.5">
      <ol className={cn('grid min-w-0 gap-1.5', RAIL_COLUMNS[steps.length] ?? 'grid-cols-5')}>
        {steps.map((item, index) => {
          const current = index === step;
          return (
            <li key={item.key} className="min-w-0">
              <button
                type="button"
                data-step-link={item.key}
                aria-current={current ? 'step' : undefined}
                aria-label={copy.goTo(index, item.label)}
                onClick={() => onShowStep(index)}
                className="focus-visible:ring-ring flex h-8 w-full items-start rounded-sm pt-1.5 outline-none focus-visible:ring-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1.5 w-full rounded-full transition-colors motion-reduce:transition-none',
                    item.errors > 0
                      ? 'bg-destructive'
                      : current
                        ? 'bg-progress-active'
                        : index < step
                          ? 'bg-progress-complete'
                          : 'bg-progress-rail',
                  )}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-3 lg:gap-6">
      {/*
        THE MODE, SAID ONCE AND BRIEFLY. On a wide screen the sentence
        explaining the mode sits above the flow, where it costs nothing. On a
        phone it would be a whole row of page furniture between the trader and
        the question, so it travels down into the step header as two words
        beside "Step 2 of 5" — the same element, in one place, either way.
      */}
      {wide ? (
        <p
          data-recording-mode={recordingMode}
          className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm"
        >
          <span>{modeSentence}</span>
          <TradeRecordingModeChange />
          {/* The same place on every width: after Change, never a row of its own. */}
          {onDiscardDraft === null ? null : (
            <DiscardDraftAction onDiscard={onDiscardDraft} className="ml-2" />
          )}
        </p>
      ) : null}

      {/*
        THE WORKFLOW IS THE PAGE'S SUBJECT, NOT A WIDGET ON IT. 50rem of step
        beside 17.5rem of rail, centred, with room between them — the step card
        carries the reading measure and the rail stays a companion. The scale
        inside the card does the rest: a card this wide holding phone-sized
        type is what made the flow read as a small dialog adrift in a large
        workspace.
      */}
      <div className="grid min-w-0 flex-1 gap-6 lg:grid-cols-[minmax(0,50rem)_17.5rem] lg:justify-center lg:gap-8 xl:gap-10">
        <form
          ref={formRef}
          id={formId}
          {...formData}
          noValidate
          onSubmit={onSubmit}
          /*
            FLAT ON A PHONE, A CARD ON A WIDE SCREEN. One step at a time is
            already the container; a raised card around it only nests the
            step's own panels one level deeper.
          */
          className="lg:bg-card lg:shadow-card lg:border-border flex w-full min-w-0 scroll-mt-[calc(var(--shell-header-height,0px)+1rem)] flex-col lg:rounded-xl lg:border"
        >
          {/*
            ONE LAYER OF CONTEXT, THEN THE STEP. A phone reads down: where this
            is in the flow (mode, a way to change it, how far along), the
            progress itself, then the step's own question. Saying "Step 1 of 5"
            in its own row above the segments that already draw it, and the
            mode again under a page title that already names it, put three
            lines of furniture between the trader and the first answer.
          */}
          <header className="flex min-w-0 flex-col gap-2.5 px-0 pt-0.5 pb-4 sm:px-6 lg:pt-7 lg:pb-5 lg:pl-8">
            {wide ? null : (
              /*
                A 12px LINE IN A 44px BOX. `Change` keeps its full tap target,
                which leaves 14px of air above and below the words; the row
                gives most of it back — up into the space under the page title
                (still clear of the Back link) and down into the header's gap
                (meeting the rail's hit areas, not overlapping them).
              */
              <div className="text-muted-foreground -mt-3 -mb-2.5 flex min-w-0 items-baseline justify-between gap-3 text-xs font-medium">
                {/*
                  THE ROW'S ACTIONS ON THE LEFT, ITS STATUS ON THE RIGHT.
                  Discard sits after Change — both act on this draft — quiet
                  and destructive, so it needs no row of its own.
                */}
                <div className="flex min-w-0 items-baseline gap-x-3">
                  <p
                    data-recording-mode={recordingMode}
                    className="flex min-w-0 flex-wrap items-baseline gap-x-2"
                  >
                    <span>{modeShort}</span>
                    <TradeRecordingModeChange />
                  </p>
                  {onDiscardDraft === null ? null : (
                    <DiscardDraftAction onDiscard={onDiscardDraft} short className="text-sm" />
                  )}
                </div>
                <span data-step-progress="" className="shrink-0 tracking-wide tabular-nums">
                  {copy.progress}
                </span>
              </div>
            )}
            {wide ? null : stepNav}
            <div className="flex min-w-0 flex-col gap-1 pt-0.5 lg:gap-1.5">
              {wide ? (
                <span
                  data-step-progress=""
                  className="text-muted-foreground text-xs font-medium tracking-wide tabular-nums"
                >
                  {copy.progress}
                </span>
              ) : null}
              <h2
                id={headingId}
                ref={headingRef}
                tabIndex={-1}
                className="text-foreground text-[1.375rem] leading-tight font-semibold tracking-tight outline-none sm:text-2xl lg:text-[1.75rem]"
              >
                {title}
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed lg:text-base">
                {description}
              </p>
            </div>
            {/*
              THE STEP SAYS WHAT IS WRONG WITH IT. A phone has no rail to read,
              so the count lives with the step; the error itself stays beside
              the control it belongs to.
            */}
            {attention === null ? null : (
              <p
                data-step-attention=""
                role="status"
                className="text-destructive flex min-w-0 items-center gap-2 text-sm font-medium"
              >
                <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                {attention}
              </p>
            )}
          </header>

          {children}

          {/*
            WHAT A SAVE SAID, WHERE THE TRADER IS. Quick Save can be pressed
            from an earlier step, so its answer — a server refusal, or a Save
            key that already created a different Trade — belongs beside the
            action that was pressed, not inside a step that is not being shown.
          */}
          {replayPanel === null ? null : (
            <div className="min-w-0 px-0 pb-4 sm:px-6">{replayPanel}</div>
          )}

          {/* STEP NAVIGATION — the last step's Save, and the quiet one before it */}
          <div
            data-step-actions=""
            {...(onLastStep ? { 'data-global-save': '' } : {})}
            data-action-bar={wide || keyboardOpen ? 'inline' : 'docked'}
            /*
              A SCREEN BAR ON A PHONE, A CARD FOOTER ON A WIDE ONE.

              Docked, it spans the viewport rather than the content column — a
              card-coloured strip inset inside the page's gutters reads as an
              empty card someone left a button in, which is exactly what it
              was. Full-bleed it reads as the bottom of the screen, while its
              CONTENT stays on the same left edge as the rows above, so the
              action still lines up with the stack it belongs to. The
              safe-area inset is the bar's own, which is why the page below it
              carries no bottom padding on a phone.
            */
            className={cn(
              'border-border bg-card flex min-w-0 flex-col gap-2 border-t pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 lg:gap-2.5 lg:rounded-b-xl lg:px-8 lg:pt-5 lg:pb-5',
              wide || keyboardOpen
                ? 'px-0'
                : 'sticky bottom-0 z-20 -mx-4 px-4 shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.45)] sm:-mx-6 sm:px-6',
            )}
          >
            {status.show ? (
              <p
                data-save-status=""
                tabIndex={-1}
                aria-live="polite"
                className={cn('min-w-0 text-sm leading-snug outline-none', status.tone)}
              >
                {status.text}
              </p>
            ) : null}
            {/*
              THE SHORT WAY OUT, ONCE IT IS HONEST TO OFFER IT. A trader who is
              done can save from here. It sits above the step's own Back/Next
              as a quiet line, and runs the very same Save as the last step's
              button — including every answer already given on steps further
              on.
            */}
            {onLastStep || quickSave === null ? null : (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <InlineAction
                  id={quickSave.id}
                  ariaLabel={quickSave.ariaLabel}
                  onClick={quickSave.onClick}
                >
                  {quickSave.label}
                </InlineAction>
                <span className="text-subtle-foreground text-xs">{quickSave.hint}</span>
              </div>
            )}
            {/*
              THE FIRST STEP HAS NOWHERE TO GO BACK TO, so it does not reserve
              half the bar for an action that is not there. On a phone the one
              forward action takes the width; from Step 2 on, Back and Next
              share the row as a pair. A wide card keeps the forward action at
              its natural size on the right — full width across 50rem would be
              a banner, not a button.
            */}
            <div
              data-step-actions-layout={noBack ? 'single' : 'paired'}
              className={cn(
                'flex min-w-0 items-center gap-3',
                noBack ? 'justify-end' : 'justify-between',
              )}
            >
              {noBack ? null : (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="min-h-12 shrink-0"
                  onClick={() => onShowStep(step - 1)}
                >
                  <ArrowLeft aria-hidden="true" />
                  {copy.back}
                </Button>
              )}
              {/*
                TWO BUTTONS, NEVER ONE BUTTON RETYPED. Next opens the last step,
                and in the same click the last step's Save replaces it here.
                Without distinct keys React reuses the pressed element and turns
                it into \`type="submit"\` before the browser runs the click's
                default action — so pressing Next submitted the form, saving the
                trade before its last step was ever seen. Keyed apart, the
                pressed Next is removed instead, and nothing is submitted.
              */}
              {onLastStep || next === undefined ? (
                <Button
                  key="save"
                  type="submit"
                  size="lg"
                  className={cn('min-h-12 min-w-0 shrink', noBack && 'w-full lg:w-auto')}
                  disabled={save.pending}
                >
                  {save.pending ? save.pendingLabel : save.label}
                </Button>
              ) : (
                <Button
                  key="next"
                  type="button"
                  size="lg"
                  className={cn('min-h-12 min-w-0 shrink', noBack && 'w-full lg:w-auto')}
                  onClick={() => onShowStep(step + 1)}
                >
                  <span className="truncate">{copy.nextTo(next.label)}</span>
                  <ArrowRight aria-hidden="true" />
                </Button>
              )}
            </div>
            {onLastStep ? footerNote : null}
          </div>
        </form>

        {wide ? (
          <aside
            aria-label={copy.navLabel}
            className="hidden lg:sticky lg:top-[calc(var(--shell-header-height)+1.5rem)] lg:block"
          >
            <div className="bg-card border-border shadow-card flex flex-col gap-3 rounded-xl border p-2">
              <p
                aria-hidden="true"
                className="text-muted-foreground px-3 pt-2 text-xs font-medium tabular-nums"
              >
                {copy.progress}
              </p>
              {stepNav}
              {/*
                WHAT SAVE IS STILL WAITING FOR — and nothing once it is waiting
                for nothing. Permanent ticks beside a form that can already be
                saved are noise, not awareness.
              */}
              <div
                data-required-status={requirements.ready ? 'ready' : 'missing'}
                className="border-border flex flex-col gap-1 border-t px-3 pt-3 pb-2"
              >
                {requirements.ready ? (
                  <p className="text-muted-foreground text-sm">{requirements.readyText}</p>
                ) : (
                  <>
                    <p className="text-foreground text-sm font-medium">{requirements.missing}</p>
                    <p className="text-muted-foreground text-xs">{requirements.list}</p>
                  </>
                )}
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One step's own section. Every step stays mounted and only the current one is
 * shown, so moving between steps never drops an answer. The shown step takes
 * the space between the header and the action bar, so the bar sits at the
 * foot of the step rather than wherever the step's content happened to stop.
 */
export function TradeStepSection({
  stepKey,
  current,
  headingId,
  className,
  children,
}: {
  stepKey: string;
  current: boolean;
  headingId: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId}
      data-step={stepKey}
      hidden={!current}
      className={cn(
        'min-w-0 flex-col px-0 pb-5 sm:px-6 lg:px-8',
        current ? 'flex flex-1' : 'hidden',
        className,
      )}
    >
      {children}
    </section>
  );
}
