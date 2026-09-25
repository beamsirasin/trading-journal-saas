'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useIsDesktopViewport } from '@/hooks/use-is-desktop-viewport';

/**
 * OPTIONAL DEPTH, ASKED AS QUESTIONS RATHER THAN OFFERED AS CATEGORIES.
 *
 * WHAT THIS REPLACES, AND WHY THE PREVIOUS ANSWER WAS STILL WRONG. First the
 * optional work was five bordered cards. Then it was one muted plane with five
 * hairline-separated rows. Then it was a single `Add details` row hiding those
 * same five rows — Strategy, Entry context, Notes and chart, Original plan,
 * System result. Each pass made the surface quieter and none of them changed
 * what the reader was actually being shown, which was a list of the product's
 * own storage categories. A beginner opening `Add details` still had to decide
 * what "Context" is, whether their trade has a "System result", and which of
 * five boxes their thought belongs in. That is asking a trader to learn the
 * data model before they can write a sentence about their trade.
 *
 * THE ROWS ARE QUESTIONS NOW. "What was your plan?" "How did you feel at
 * entry?" "What would you repeat or change next time?" Every one of them can be
 * answered by someone who has never used a trading journal, in the order they
 * like, or not at all. The taxonomy has not gone anywhere — a strategy, a setup,
 * a confidence level and a rule-based comparison are all still recorded — but
 * they are reached by answering a question rather than by choosing a container.
 *
 * NOTHING HERE IS A TASK. No count, no progress, no completion tick, no "2 of 3".
 * A trade with every prompt untouched is a complete, valid record, and the
 * surface must never imply otherwise — which is why the summaries below a row
 * list only what EXISTS and never what is missing.
 *
 * ONE EDITOR AT A TIME, ON BOTH SURFACES. Opening a question replaces the prompt
 * list on a desktop and takes the whole screen on a phone. Two open accordions
 * would put the reader back in a form; a modal over a modal would put them in a
 * maze. `Done` closes the editor, keeps the draft and returns to the trade —
 * it never saves the trade, and it says so.
 */

export interface JournalPrompt {
  readonly id: string;
  /** The human question, exactly as the row and the editor header state it. */
  readonly question: string;
  /** Only what has actually been answered. At most two lines are shown. */
  readonly summary: readonly string[];
  readonly children: ReactNode;
}

export function JournalPrompts({ prompts }: { prompts: readonly JournalPrompt[] }) {
  const isDesktop = useIsDesktopViewport();
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = prompts.find((prompt) => prompt.id === activeId) ?? null;

  /*
    THE PHONE EDITOR OWNS THE SCREEN, so the page behind it must not scroll
    underneath. Two scroll containers fighting is the commonest way a
    full-screen editor on a phone loses the reader's place.
  */
  useEffect(() => {
    if (isDesktop || active === null) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isDesktop, active]);

  /**
   * RETURNING PUTS FOCUS BACK ON THE QUESTION IT CAME FROM.
   *
   * The editor replaces the prompt list on a desktop and the whole screen on a
   * phone, so on return there is nothing focused and a keyboard user lands back
   * at the top of the document with the trade they were part-way through
   * somewhere below. The row is re-focused on the frame after the state change,
   * once it exists again.
   */
  function close(id: string) {
    setActiveId(null);
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-journal-prompt="${id}"]`)?.focus();
    });
  }

  if (active !== null && isDesktop) {
    return (
      <section className="min-w-0">
        {/*
          ONE RETURN CONTROL, NAMED FOR WHERE IT GOES.

          It was a `Done` button plus a paragraph explaining that Done returns to
          the trade and does not save it. Two problems: `Done` is the same word
          the trade-level Save neighbourhood uses, so the sentence existed to
          undo the impression the button gave — and a control that needs a
          sentence to correct it is the wrong control. "Back to trade" says where
          it goes, so nothing has to say where it does not.
        */}
        <div className="border-border mb-3 flex min-w-0 items-center justify-between gap-3 border-b pb-2">
          <h2 className="text-foreground min-w-0 text-sm font-semibold">{active.question}</h2>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0"
            onClick={() => close(active.id)}
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to trade
          </Button>
        </div>
        {active.children}
      </section>
    );
  }

  return (
    <>
      <section className="min-w-0">
        {/*
          A QUIET EYEBROW, NOT A QUESTION ABOUT THE QUESTIONS.

          The heading read "Anything useful to add? · Optional" — a fourth
          question above three questions, and the only one nobody can answer.
          The rows say what they are; all this line has to carry is that none of
          them is required. It is deliberately not "Optional notes": what is
          behind these rows is a structured plan, a psychology record and a
          review, and calling that "notes" would undersell it into being skipped.
        */}
        <p className="text-subtle-foreground text-label mb-1 px-1 uppercase">Optional</p>

        <div className="divide-border border-border divide-y border-t">
          {prompts.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              data-journal-prompt={prompt.id}
              onClick={() => setActiveId(prompt.id)}
              className="hover:bg-accent/40 focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 px-1 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:-outline-offset-2"
            >
              <span className="min-w-0 flex-1">
                <span className="text-foreground block text-sm">{prompt.question}</span>
                {/*
                  TWO LINES, NEVER MORE. A populated row was printing everything
                  it held — classification, planned figures and a reason excerpt —
                  so the answered state was three or four lines per row and the
                  list of three questions became a wall. The full answer is one
                  activation away; the row's job is to say the question has been
                  answered and roughly how.
                */}
                {prompt.summary.slice(0, 2).map((line) => (
                  <span key={line} className="text-muted-foreground block truncate text-xs">
                    {line}
                  </span>
                ))}
              </span>
              <ChevronRight className="text-subtle-foreground size-4 shrink-0" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      {active === null ? null : (
        <div
          role="group"
          aria-label={active.question}
          data-journal-editor={active.id}
          className="bg-background fixed inset-0 z-50 flex flex-col"
        >
          {/*
            ONE CONTROL ON A PHONE TOO. It was a back ARROW on the left and a
            `Done` button on the right — two controls that did the same thing,
            which is a reader's cue that they must differ somehow. "← Trade"
            is the single way back, and it is lighter than the filled button it
            replaces.
          */}
          <header className="border-border bg-background flex shrink-0 items-center gap-2 border-b px-2 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 shrink-0"
              onClick={() => close(active.id)}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              Trade
            </Button>
            <h2 className="text-foreground min-w-0 flex-1 truncate text-right text-sm font-semibold">
              {active.question}
            </h2>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{active.children}</div>
        </div>
      )}
    </>
  );
}
/**
 * A contextual editor that REPLACES its parent editor's body.
 *
 * The entry checklist and the rule-based comparison are both reached from
 * inside a prompt, and both need real room. The alternatives were a nested
 * sheet — a modal inside a modal, which on a phone is a maze with two Backs
 * that mean different things — or an accordion inside an accordion, which is
 * how a focused editor turns back into a form. So the child takes the body it
 * was opened from and offers one way back, named after where it goes.
 *
 * The parent's own `Done` stays visible above, and still means the same thing.
 */
export function NestedEditor({
  open,
  title,
  backLabel,
  onBack,
  children,
  body,
}: {
  open: boolean;
  title: string;
  /** Where Back returns to, named — never a bare chevron. */
  backLabel: string;
  onBack: () => void;
  /** The nested content. */
  children: ReactNode;
  /** What the parent editor shows while this is closed. */
  body: ReactNode;
}) {
  if (!open) return <>{body}</>;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="text-primary-text focus-visible:ring-ring -ml-1 inline-flex min-h-11 items-center gap-1 self-start rounded-sm px-1 text-sm font-medium outline-none focus-visible:ring-2"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {backLabel}
      </button>
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

/**
 * A small contextual entrance inside an editor — "View entry checklist",
 * "Compare with your rules", "Attach chart".
 *
 * Deliberately a link rather than a row in a list: a second list of rows inside
 * a focused editor is the category stack growing back, one level down.
 */
export function ContextualAction({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-primary-text focus-visible:ring-ring relative self-start rounded-sm text-sm font-medium',
        'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
        'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
        className,
      )}
    >
      {children}
    </button>
  );
}
