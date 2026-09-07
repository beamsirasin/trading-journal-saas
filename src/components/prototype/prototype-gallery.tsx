'use client';

import { ExternalLink, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';

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
    note: 'Two cards, each one activation. No Continue, no progress rail.',
    path: '/prototype/log-trade',
    width: 1440,
    height: 620,
  },
  {
    id: 'at-entry',
    number: '6',
    title: 'At entry · desktop',
    note: 'The short path: four facts and one number, with everything else closed beneath.',
    path: '/prototype/log-trade/at-entry',
    width: 1440,
    height: 1000,
  },
  {
    id: 'at-entry-filled',
    number: '6b',
    title: 'At entry · optional sections answered',
    note: 'Collapsed sections state what they hold rather than sitting anonymous.',
    path: '/prototype/log-trade/at-entry?expand=1',
    width: 1440,
    height: 1000,
  },
  {
    id: 'at-entry-mobile',
    number: '7',
    title: 'At entry · mobile',
    note: 'One column, 48px controls, the global header suppressed, the save action sticky.',
    path: '/prototype/log-trade/at-entry',
    width: 390,
    height: 780,
  },
  {
    id: 'after-trade',
    number: '8',
    title: 'After trade · desktop',
    note: 'Actual first. The original plan is an optional row underneath the result.',
    path: '/prototype/log-trade/after-trade',
    width: 1440,
    height: 1000,
  },
  {
    id: 'after-trade-mobile',
    number: '9',
    title: 'After trade · mobile',
    note: 'The same hierarchy, made fast to complete on a phone.',
    path: '/prototype/log-trade/after-trade',
    width: 390,
    height: 780,
  },
  {
    id: 'exits',
    number: '10',
    title: 'Exits',
    note: 'Three completion states. No invented 50/50 rows; realized-so-far is never shown as final.',
    path: '/prototype/exits',
    width: 1120,
    height: 900,
  },
  {
    id: 'context',
    number: '11',
    title: 'Confidence and entry context',
    note: 'Five discrete states with a real null, and emotions that distinguish unanswered from "none of these".',
    path: '/prototype/context',
    width: 1120,
    height: 900,
  },
];

const WIDTH_ICON = (width: number) =>
  width >= 1280 ? Monitor : width >= 700 ? Tablet : Smartphone;

export function PrototypeGallery() {
  const [zoom, setZoom] = useState(0.62);

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
          {SCREENS.map((screen) => {
            const Icon = WIDTH_ICON(screen.width);
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
                  <iframe
                    src={screen.path}
                    title={screen.title}
                    width={screen.width}
                    height={screen.height}
                    className="origin-top-left border-0"
                    style={{ transform: `scale(${zoom})` }}
                  />
                </div>
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
