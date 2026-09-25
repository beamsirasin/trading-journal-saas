'use client';

import { ArrowRight, ChevronRight, CircleCheckBig, CircleDot } from 'lucide-react';

import { cn } from '@/lib/utils';

import { PrototypeShell } from '../prototype-shell';

/**
 * THE OPENING CHOICE — one question, two answers.
 *
 * THE QUESTION CHANGED, AND IT IS THE MOST IMPORTANT CHANGE ON THIS SCREEN.
 * The choice used to be `At entry` and `After trade`, which are the product's
 * own internal path names and describe WHEN the journal was opened. A trader who
 * opened a position last Tuesday and is writing it up today fits neither label,
 * and picking wrongly puts them in a form that asks for a final result they do
 * not have. The real distinction is the STATE of the position: is any of it
 * still open, or is all of it closed? So that is what the page asks.
 *
 * `Still open` covers a partially closed position, which is the case the old
 * wording handled worst — half the position banked, half still running, and
 * neither "at entry" nor "after trade" true of it.
 *
 * NOT `Open a trade` / `Close a trade`. Those read as instructions to a broker.
 * Nothing on this screen sends an order, and a label that could be misread as
 * one is not a label worth its brevity.
 *
 * WHAT WENT. The `Start` row at the foot of each card — a second, smaller click
 * target inside a surface that is clickable everywhere, and, after the
 * description, the widest thing in each card. The arrow survives as the
 * affordance; the word does not.
 *
 * THE MOBILE COMPOSITION IS A DIFFERENT SHAPE, NOT A NARROWER ONE. Two tall
 * cards stacked on a phone put roughly 150px of vertical centring and padding
 * between a reader and a binary question. They are compact rows below 600px —
 * icon, answer, consequence, chevron — the shape a phone reader already reads as
 * "pick one and move on".
 */
export function EntryChoiceScreen() {
  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <div className="mx-auto w-full max-w-[760px] px-4 pt-8 pb-16 sm:px-6 md:pt-14">
        <h1 className="text-foreground text-page-title">Log a trade</h1>
        {/*
          THE QUESTION IS THE SUBHEAD, not a third card and not a caption under
          the pair. A reader who reads only the title and this line already knows
          what to do.
        */}
        <p className="text-foreground mt-2 text-base">Is the trade still open?</p>
        <p className="text-muted-foreground mt-1 text-sm">Live · FTMO 100K · USD · Asia/Bangkok</p>

        <div className="mt-6 grid min-w-0 gap-3 min-[600px]:mt-7 min-[600px]:grid-cols-2 min-[600px]:gap-4">
          <ChoiceCard
            href="./log-trade/at-entry"
            title="Still open"
            description="Save now. Add exits later."
            Icon={CircleDot}
          />
          <ChoiceCard
            href="./log-trade/after-trade"
            title="Fully closed"
            description="Record the trade and its final result."
            Icon={CircleCheckBig}
          />
        </div>

        {/*
          A QUIET LINK, NOT A PARAGRAPH. It was a full sentence sized like the
          descriptions above it, so a third option competed with the two the page
          exists to offer. It looks like the afterthought it is now.
        */}
        <p className="mt-6 text-sm">
          <a
            href="./trade-log"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring relative inline-flex min-h-11 items-center rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
          >
            Already logged it? Find your trade.
          </a>
        </p>
      </div>
    </PrototypeShell>
  );
}

function ChoiceCard({
  href,
  title,
  description,
  Icon,
}: {
  href: string;
  title: string;
  description: string;
  Icon: typeof CircleDot;
}) {
  return (
    <a
      href={href}
      className={cn(
        'border-border bg-card shadow-card group/card flex min-w-0 items-center gap-3.5 rounded-xl border p-4',
        'min-[600px]:items-start min-[600px]:gap-4 min-[600px]:p-5',
        'hover:border-primary/50 hover:bg-accent/40 transition-colors',
        'focus-visible:ring-ring outline-none focus-visible:ring-2',
      )}
    >
      <span className="bg-primary/10 text-primary-text flex size-10 shrink-0 items-center justify-center rounded-lg min-[600px]:size-11">
        <Icon className="size-5" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="text-foreground block text-base font-semibold min-[600px]:text-lg">
          {title}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-sm leading-relaxed">
          {description}
        </span>
      </span>

      {/* Two affordances, one per composition: a phone row ends in a chevron, a
          desktop card in an arrow that leans on hover. Never both at once. */}
      <ChevronRight
        className="text-subtle-foreground size-5 shrink-0 min-[600px]:hidden"
        aria-hidden="true"
      />
      <ArrowRight
        className="text-primary-text mt-2.5 hidden size-5 shrink-0 transition-transform duration-150 group-hover/card:translate-x-0.5 motion-reduce:transition-none min-[600px]:block"
        aria-hidden="true"
      />
    </a>
  );
}
