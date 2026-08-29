import { cn } from '@/lib/utils';

/**
 * The Dashboard's one loading mark — a small five-bar equalizer over two
 * lines of copy.
 *
 * WHY AN EQUALIZER AND NOT A SPINNER. A spinner says "something is
 * happening"; this says "figures are being recomputed", which is the only
 * thing that is ever happening when this appears. It is also the one motion
 * on the page that resembles the data it stands in for, and at 3px wide bars
 * it costs almost no area — the opposite of the full-screen spinner CLAUDE.md
 * §8's restraint rules out.
 *
 * IT IS NOT A PROGRESS INDICATOR. The bars carry no percentage, no estimate
 * and no phase; nothing in this architecture knows how far along a document
 * navigation is, and a bar that pretended to would be inventing a number.
 *
 * COLOUR IS THE FROZEN ACCENT, NEVER THE OUTCOME PALETTE. `--positive` /
 * `--negative` mean "this trade made or lost money" everywhere else in the
 * product; spending green on "loading" would make the one non-semantic
 * element on the page speak the semantic vocabulary.
 *
 * REDUCED MOTION IS HANDLED IN CSS, NOT HERE. `globals.css` swaps the
 * staggered scale for a single slow opacity breath on the whole group under
 * `prefers-reduced-motion: reduce` — the indicator stays alive (a frozen
 * loader reads as a hung page) without anything travelling.
 *
 * @param tone `'overlay'` for the departure overlay, which sits on its own
 *   raised surface above dimmed content; `'inline'` for the arrival skeleton,
 *   where it sits directly on the page and must not look like a second card.
 */
export function DashboardLoadingIndicator({
  message,
  detail,
  tone = 'inline',
  className,
}: {
  /** The primary line. Announced; see `DashboardLoadingStatus` below. */
  message: string;
  /** One quiet supporting line, or `null` for the message alone. */
  detail?: string | null;
  tone?: 'overlay' | 'inline';
  className?: string;
}) {
  return (
    <div
      data-dashboard-loading-indicator={tone}
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg px-5 py-4 text-center',
        tone === 'overlay' ? 'bg-card border-border shadow-elevated border' : '',
        className,
      )}
    >
      <DashboardLoadingBars />
      <div className="flex flex-col gap-0.5">
        <p className="text-foreground text-sm font-semibold">{message}</p>
        {detail === undefined || detail === null ? null : (
          <p className="text-muted-foreground text-xs leading-4">{detail}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Five bars, staggered by 120ms each so the group reads as a travelling wave
 * rather than five things blinking together. `aria-hidden` because the copy
 * beside it already says everything this means — an animation with an ARIA
 * label would announce twice.
 */
function DashboardLoadingBars() {
  return (
    <span
      aria-hidden="true"
      data-dashboard-loading-bars=""
      className="flex h-5 items-end justify-center gap-[3px]"
    >
      {[0, 1, 2, 3, 4].map((index) => (
        <span key={index} className="bg-primary w-[3px] origin-bottom rounded-full" />
      ))}
    </span>
  );
}

/**
 * The Dashboard's loading announcement, separated from the visual on purpose.
 *
 * A `role="status"` region announces its content when that content CHANGES.
 * Rendering the loader and its live region as one node means every skeleton
 * that mounts, on every navigation, re-announces — and on a page with three
 * independently suspending boundaries that is three announcements for one
 * user action (CLAUDE.md §25's "no repeated screen-reader spam"). So exactly
 * one of these exists per view: the departure overlay owns it while a
 * navigation is in flight, and the page-level skeleton owns it on arrival.
 * The Calendar, insight and Risk sub-skeletons render the visual only.
 */
export function DashboardLoadingStatus({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
