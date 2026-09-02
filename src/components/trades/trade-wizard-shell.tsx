import { ArrowLeft, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * THE FRAME A GUIDED STEP RENDERS IN — Log a trade's choice step, today.
 *
 * It exists because a decision step and an ordinary product page want opposite
 * things. A product page announces where you are in the app: shell chrome, a
 * left-aligned `PageHeader`, a toolbar, a Back control shaped like every other
 * secondary action. A step in a flow wants the opposite — one question, in the
 * middle of the screen, with the surrounding page saying as little as possible
 * and the way out reduced to two unobtrusive glyphs.
 *
 * WHY IT IS NOT `PageHeader`. `PageHeader` owns the page's single `<h1>` and
 * puts it on the left with its actions on the right, which is right for a
 * destination and wrong for a question. This shell owns the `<h1>` instead —
 * still exactly one per page — and centres it, because a question the reader
 * has to answer before anything else appears should not compete with a header
 * row for the middle of the screen. Nothing renders both: the route picks one
 * (`timing === null` gets this, the form keeps `PageHeader`).
 *
 * WHY THE PROGRESS BAR IS REAL AND NOT DECORATION. `role="progressbar"` with
 * `aria-valuetext` means a screen reader announces "Step 1 of 2" rather than a
 * bare percentage, so the visual reassurance the bar gives a sighted reader is
 * available to everyone. `step`/`totalSteps` are passed in rather than counted
 * here because the shell must never be the thing that decides how long a flow
 * is.
 *
 * WHY BOTH THE ARROW AND THE CLOSE LEAD TO THE SAME PLACE ON STEP ONE. There
 * is no earlier step to go back to, so both exit to `exitHref`. They are still
 * two controls with two different accessible names — "Back to Trades" and
 * "Close" — because a reader who has learned that the arrow means "one step
 * back" should find it where they expect it when this flow grows a third step,
 * and until then it must at least not lie about where it lands.
 *
 * WIDTH IS A PROP WITH A DELIBERATE DEFAULT. 42.5rem (680px) is a reading
 * measure for one question and a small set of choices. The form step is not
 * this width and should not be forced into it — its two-column field grids
 * need the app's standard page width — so widening is an explicit decision at
 * the call site, not something this shell assumes it may do.
 */
export function WizardShell({
  step,
  totalSteps,
  eyebrow,
  title,
  description,
  exitHref,
  className,
  children,
}: {
  /** 1-based position of the current step. */
  step: number;
  totalSteps: number;
  /** Small label above the heading — what flow this is. */
  eyebrow: string;
  /** The step's question. Rendered as the page's single `<h1>`. */
  title: string;
  description?: string;
  /** Where the back arrow and the close button both lead. */
  exitHref: string;
  /** Escape hatch for a wider step. Defaults to the 42.5rem reading measure. */
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('trades.create');

  return (
    <div className="relative isolate flex min-w-0 flex-col">
      {/*
        The only decorative element on the page: a brand wash that fades out
        before the content starts, so the top of the screen belongs to the
        flow rather than to the application behind it. `-z-10` and
        `pointer-events-none` keep it strictly a backdrop, and it is
        `aria-hidden` because it carries no information at all.
      */}
      <div
        aria-hidden="true"
        className="from-brand/8 pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b to-transparent"
      />

      <div
        className={cn('mx-auto w-full max-w-[42.5rem] min-w-0 px-4 pt-6 pb-10 sm:px-6', className)}
      >
        <WizardProgressBar
          step={step}
          totalSteps={totalSteps}
          label={t('wizard.progressLabel')}
          valueText={t('wizard.stepStatus', { current: step, total: totalSteps })}
        />

        <div className="mt-3 flex min-w-0 items-center justify-between">
          <Button asChild variant="ghost" size="icon" aria-label={t('backToTrades')}>
            <Link href={exitHref}>
              <ArrowLeft aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label={t('wizard.close')}>
            <Link href={exitHref}>
              <X aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <header className="mt-4 flex min-w-0 flex-col items-center gap-2 text-center">
          <p className="text-muted-foreground text-label uppercase">{eyebrow}</p>
          <h1 className="text-page-title text-balance">{title}</h1>
          {description === undefined ? null : (
            <p className="text-muted-foreground max-w-prose text-sm leading-relaxed text-pretty">
              {description}
            </p>
          )}
        </header>

        <div className="mt-8 min-w-0">{children}</div>
      </div>
    </div>
  );
}

/**
 * A 4px rail whose filled portion is the flow's progress.
 *
 * The width is an inline percentage because it is a computed value, not a
 * style choice — there is no utility class for "n/m of the way along", and
 * inventing one per step count would put the flow's length in the stylesheet.
 * Colour stays entirely in tokens (`bg-brand` on `bg-muted`).
 */
export function WizardProgressBar({
  step,
  totalSteps,
  label,
  valueText,
}: {
  step: number;
  totalSteps: number;
  label: string;
  valueText: string;
}) {
  const percentage = totalSteps <= 0 ? 0 : Math.min(100, Math.max(0, (step / totalSteps) * 100));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={totalSteps}
      aria-valuenow={step}
      aria-valuetext={valueText}
      className="bg-muted h-1 w-full overflow-hidden rounded-full"
    >
      <div
        className="bg-brand h-full rounded-full transition-[width] duration-300 ease-(--motion-ease-standard) motion-reduce:transition-none"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
