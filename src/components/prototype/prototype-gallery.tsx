'use client';

import { ExternalLink, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme/theme-toggle';

/**
 * THE REVIEW INDEX.
 *
 * WHY IFRAMES AND NOT NARROW DIVS. Every responsive rule in this codebase is a
 * viewport media query, so a 390px-wide column inside a 1440px window renders
 * the DESKTOP composition squeezed into 390px — precisely the failure the
 * mobile design exists to prevent, presented as though it were the design. An
 * iframe has its own viewport, so the frames below show the layout a phone
 * actually produces. Each is also a real page: open it in its own tab and it is
 * the same screen at the browser's width.
 *
 * The theme control is the product's own `ThemeToggle`. It writes the same
 * `localStorage` key the application uses and the frames are same-origin, so
 * one switch re-themes every frame on the page.
 */

interface Screen {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly note: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

const SCREENS: readonly Screen[] = [
  {
    id: 'log-desktop',
    number: '1',
    title: 'Trade Log · desktop',
    note: 'Seven columns. Title and scope, toolbar, one summary strip, then the journal.',
    path: '/prototype/trade-log',
    width: 1440,
    height: 900,
  },
  {
    id: 'log-laptop',
    number: '2',
    title: 'Trade Log · laptop',
    note: 'Below 1,120px of journal content the table gives way to multi-line rows — a different composition, not a compressed table.',
    path: '/prototype/trade-log',
    width: 1120,
    height: 820,
  },
  {
    id: 'log-mobile',
    number: '3',
    title: 'Trade Log · mobile',
    note: 'A purpose-built list. A fourth line only where there is genuinely an action.',
    path: '/prototype/trade-log',
    width: 390,
    height: 780,
  },
  {
    id: 'log-thai',
    number: '3b',
    title: 'Trade Log · Thai',
    note: 'The same journal with the wider script, to check the column widths hold.',
    path: '/prototype/trade-log?lang=th',
    width: 1440,
    height: 700,
  },
  {
    id: 'log-mixed',
    number: '3c',
    title: 'Trade Log · All accounts',
    note: 'Two currencies in scope: Net P&L reads "Multiple currencies" and is never summed or converted.',
    path: '/prototype/trade-log?account=all',
    width: 1440,
    height: 700,
  },
  {
    id: 'detail-desktop',
    number: '4',
    title: 'Trade details · desktop drawer',
    note: '640px, three tabs, no metric block in the fixed header.',
    path: '/prototype/trade-log?trade=t-01',
    width: 1440,
    height: 900,
  },
  {
    id: 'detail-mobile',
    number: '4b',
    title: 'Trade details · mobile',
    note: 'The same content, full viewport. No narrow strip of dimmed table.',
    path: '/prototype/trade-log?trade=t-04',
    width: 390,
    height: 780,
  },
  {
    id: 'choice',
    number: '5',
    title: 'Log a trade · choice',
    note: 'One question — is the trade still open? — and two answers, each a single activation.',
    path: '/prototype/log-trade',
    width: 1440,
    height: 620,
  },
  {
    id: 'still-open',
    number: '6',
    title: 'Still open · desktop',
    note: 'Symbol, direction, risk at entry, save. Everything else is a question the trader may ignore.',
    path: '/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
  },
  {
    id: 'still-open-filled',
    number: '6b',
    title: 'Still open · journal answered',
    note: 'Answered prompts summarise what they hold. Nothing states what is missing.',
    path: '/prototype/log-trade/at-entry?filled=1',
    width: 1440,
    height: 1000,
  },
  {
    id: 'still-open-mobile',
    number: '7',
    title: 'Still open · mobile',
    note: 'One column, the global header suppressed, the save action docked until a keyboard needs the room.',
    path: '/prototype/log-trade/at-entry',
    width: 390,
    height: 780,
  },
  {
    id: 'fully-closed',
    number: '8',
    title: 'Fully closed · desktop',
    note: 'Two factual groups — the trade, then the result. Money leads; R follows.',
    path: '/prototype/log-trade/after-trade',
    width: 1440,
    height: 1100,
  },
  {
    id: 'fully-closed-mobile',
    number: '9',
    title: 'Fully closed · mobile',
    note: 'The same two groups, and Profit / Loss / Break-even rather than a sign toggle to discover.',
    path: '/prototype/log-trade/after-trade',
    width: 390,
    height: 780,
  },
  {
    id: 'exits',
    number: '10',
    title: 'Partial exits · recorded legs',
    note: 'Saved exits read as summary rows. Only one leg is ever an editor, and no empty next row stands open.',
    path: '/prototype/log-trade/after-trade?exits=1',
    width: 1120,
    height: 1100,
  },
  {
    id: 'close-trade',
    number: '10b',
    title: 'Close trade · an already-recorded position',
    note: 'Carries the baseline forward and asks only what happened. Actual R divides by the original risk at entry.',
    path: '/prototype/close-trade?trade=t-03',
    width: 1120,
    height: 1100,
  },
  {
    id: 'exit-editor',
    number: '11',
    title: 'Partial exits · active editor',
    note: '"How much did you close?" with All remaining beside it, so the trader never does the arithmetic.',
    path: '/prototype/log-trade/after-trade?exits=1&edit=e2',
    width: 1120,
    height: 1200,
  },
];

const WIDTH_ICON = (width: number) =>
  width >= 1280 ? Monitor : width >= 700 ? Tablet : Smartphone;

/**
 * WHY IFRAMES MOUNT ONE AT A TIME, NOT ALL AT ONCE.
 *
 * `SCREENS` lists 15 frames over 6 distinct routes, and every `<iframe>` used
 * to get its `src` on the same render — so opening this gallery on a COLD dev
 * server fired a burst of up to 15 near-simultaneous requests, several of them
 * the FIRST-EVER compile of a given route. That burst reliably corrupted a
 * Turbopack dev-server manifest (a genuine upstream race in concurrent first
 * compiles, confirmed by reproducing the identical failure against an
 * equally-sized production route group under the same concurrency) and
 * returned 500 for EVERY route touched in the burst, including this gallery
 * page itself. A single ordinary navigation never mounts more than one route
 * at a time and never hit it; visiting this review index was the one place in
 * the whole product that self-inflicted the concurrency this bug needs.
 *
 * A FIXED-DELAY STAGGER WAS TRIED FIRST AND WAS NOT ENOUGH. Loading 15 iframes
 * — several of them cold Next.js compiles — keeps this tab's main thread busy
 * enough that a chain of independent `setTimeout` calls does not fire evenly:
 * several backlogged timers can go off within the same few milliseconds once
 * the thread frees up, which reintroduces the exact multi-route burst this
 * exists to prevent. It also does not explain why TWO frames pointing at the
 * SAME already-releasing route can still race each other — a fixed delay only
 * ever staggers the first request to each distinct path.
 *
 * ONE FRAME AT A TIME, GATED BY THE PREVIOUS FRAME'S OWN LOAD EVENT, FIXES
 * BOTH. Frame N does not mount until frame N-1 has fired `load` or `error` —
 * so at most one HTTP request to any prototype route is ever in flight from
 * this page, regardless of whether consecutive frames share a route or not,
 * and regardless of how busy the main thread gets (a delayed callback still
 * only ever advances the count by one, because it IS the signal, not a guess
 * at how much time has passed). A `Loading …` placeholder reserves each
 * frame's exact geometry while it waits its turn, so nothing shifts.
 */
function useSequentialReveal(total: number): {
  readonly revealedCount: number;
  readonly advance: () => void;
} {
  // The first frame mounts immediately; each one after waits for the previous
  // frame's own load/error event to call `advance`.
  const [revealedCount, setRevealedCount] = useState(1);

  const advance = useCallback(() => {
    setRevealedCount((count) => Math.min(count + 1, total));
  }, [total]);

  // A safety net only — never let one frame that never fires `load` (a
  // network hiccup, a throttled devtools profile) stall every frame behind it
  // forever. Far longer than any real compile in these reproductions, so it
  // never fires on a normal successful load.
  useEffect(() => {
    if (revealedCount >= total) return;
    const timer = window.setTimeout(advance, 10_000);
    return () => window.clearTimeout(timer);
  }, [revealedCount, total, advance]);

  return { revealedCount, advance };
}

export function PrototypeGallery() {
  const [zoom, setZoom] = useState(0.62);
  const { revealedCount, advance } = useSequentialReveal(SCREENS.length);

  return (
    <div className="bg-background text-foreground min-h-dvh">
      <header className="border-border bg-card sticky top-0 z-10 border-b">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="min-w-0">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              Trade Log &amp; Add Trade — visual prototype
            </h1>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Fixture data. Wired to no mutation, no server action and no database. Development
              only.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              Frame scale
              <input
                type="range"
                min={0.35}
                max={1}
                step={0.01}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="accent-primary w-32"
              />
              <span className="numeric w-10">{Math.round(zoom * 100)}%</span>
            </label>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-6 py-8">
        <div className="flex flex-col gap-10">
          {SCREENS.map((screen, index) => {
            const Icon = WIDTH_ICON(screen.width);
            const isReleased = index < revealedCount;
            return (
              <section key={screen.id} className="min-w-0">
                <div className="mb-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-foreground flex min-w-0 items-center gap-2 text-base font-semibold">
                    <span className="bg-muted text-muted-foreground numeric flex size-6 shrink-0 items-center justify-center rounded-full text-xs">
                      {screen.number}
                    </span>
                    {screen.title}
                    <span className="text-subtle-foreground inline-flex items-center gap-1 text-xs font-normal">
                      <Icon className="size-3.5" aria-hidden="true" />
                      {screen.width}px
                    </span>
                  </h2>
                  <a
                    href={screen.path}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
                  >
                    Open at browser width
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </div>
                <p className="text-muted-foreground mb-3 max-w-3xl text-sm leading-relaxed">
                  {screen.note}
                </p>

                <div
                  className={cn(
                    'border-border bg-background overflow-hidden rounded-lg border',
                    'shadow-card',
                  )}
                  style={{ width: screen.width * zoom, height: screen.height * zoom }}
                >
                  {/*
                    THE PLACEHOLDER RESERVES THE FRAME'S OWN GEOMETRY — same
                    width/height as the eventual iframe — so nothing shifts as
                    routes are released. Never blank: the label says exactly
                    what is about to appear, matching this codebase's own
                    "reserve final geometry, never a bare spinner" loading
                    convention.
                  */}
                  {isReleased ? (
                    <iframe
                      src={screen.path}
                      title={screen.title}
                      width={screen.width}
                      height={screen.height}
                      className="origin-top-left border-0"
                      style={{ transform: `scale(${zoom})` }}
                      /*
                        THE NEXT FRAME DOES NOT EXIST UNTIL THIS ONE FIRES.

                        Because frame N+1 is not even in the DOM until
                        `revealedCount` passes N, at most one frame is ever
                        "mounted but not yet loaded" at a time — so wiring
                        `advance` to every frame is just each frame reporting
                        "I'm done" once, in the order they were allowed to
                        start. `onError` counts too: a frame that fails to
                        load must not stall every frame behind it.
                      */
                      onLoad={advance}
                      onError={advance}
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="text-subtle-foreground flex size-full animate-pulse items-center justify-center text-xs motion-reduce:animate-none"
                      style={{ width: screen.width * zoom, height: screen.height * zoom }}
                    >
                      Loading {screen.title}…
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
