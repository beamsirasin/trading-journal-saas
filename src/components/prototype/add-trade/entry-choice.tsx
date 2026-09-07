'use client';

import { ArrowRight, CircleCheckBig, CircleDot } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PrototypeShell } from '../prototype-shell';

/**
 * THE OPENING CHOICE — two cards, each a link, and nothing else on the page.
 *
 * WHAT WENT. A selection step followed by Continue; a progress rail that
 * reached its final step the moment the form opened, reporting NAVIGATION
 * progress where a reader naturally reads TASK progress; and a centred
 * introduction explaining a decision that two labels already make obvious.
 * Three pieces of shell for one binary question.
 *
 * WHAT THE READER HAS TO KNOW is which of two situations they are in, and the
 * supporting labels say it in the words they would use themselves: the position
 * is open, or the position is closed. The consequence line underneath each card
 * is the second half — what recording it now will actually ask of them — so the
 * choice is made on cost as well as on category.
 *
 * ONE ACTIVATION. Click the card, land in the form. There is no state between
 * the two screens worth confirming.
 */
export function EntryChoiceScreen() {
  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <div className="mx-auto w-full max-w-[760px] px-4 pt-8 pb-16 sm:px-6 md:pt-12">
        <h1 className="text-foreground text-2xl leading-8 font-semibold tracking-tight">
          Log a trade
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Live · FTMO 100K · USD · Asia/Bangkok · GMT+7
        </p>

        {/*
          CONCISE, AND NO LONGER ABOUT WHEN YOU TRADED.

          "Record the trade you have just taken" implied At Entry was only for a
          position opened moments ago; it is equally the path for a position
          opened last week that is still running. The "Asks for…" paragraphs went
          because the form answers that question in one activation, and a card
          that pre-explains a form the reader is one click from is a card asking
          to be skipped.
        */}
        <div className="mt-6 grid min-w-0 gap-4 min-[600px]:grid-cols-2">
          <ChoiceCard
            href="./log-trade/at-entry"
            title="At entry"
            situation="Position is open"
            description="Record an open position. Add exits later."
            Icon={CircleDot}
          />
          <ChoiceCard
            href="./log-trade/after-trade"
            title="After trade"
            situation="Position is closed"
            description="Record the completed trade and its result."
            Icon={CircleCheckBig}
          />
        </div>

        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">
          Already recorded this position? Open it to record an exit.
        </p>
      </div>
    </PrototypeShell>
  );
}

function ChoiceCard({
  href,
  title,
  situation,
  description,
  Icon,
}: {
  href: string;
  title: string;
  situation: string;
  description: string;
  Icon: typeof CircleDot;
}) {
  return (
    <a
      href={href}
      className={cn(
        'border-border bg-card shadow-card group/card flex min-w-0 flex-col gap-3 rounded-lg border p-5',
        'hover:border-primary/50 hover:bg-accent/40 transition-colors',
        'focus-visible:ring-ring outline-none focus-visible:ring-2',
      )}
    >
      <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <span className="min-w-0">
        <span className="text-foreground block text-base font-semibold">{title}</span>
        <span className="text-primary block text-sm font-medium">{situation}</span>
      </span>

      <span className="text-muted-foreground block text-sm leading-relaxed">{description}</span>

      {/* No `mt-auto`. The cards are as tall as their content; stretching them to
          match each other was filling whitespace because the page is sparse. */}
      <span className="text-primary inline-flex items-center gap-1.5 pt-1 text-sm font-medium">
        Start
        <ArrowRight
          className="size-4 transition-transform duration-150 group-hover/card:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </span>
    </a>
  );
}
