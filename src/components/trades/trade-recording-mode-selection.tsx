import { ArrowRight, CheckCircle2, Target, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { RECORDING_TIMINGS, type RecordingTiming } from '@/lib/trades/recording-timing';
import { Link } from '@/i18n/navigation';

const ICON: Record<RecordingTiming, LucideIcon> = {
  at_entry: Target,
  after_trade: CheckCircle2,
};

/**
 * THE ONE DECISION LOG A TRADE ASKS FIRST.
 *
 * At Entry and After Trade were a small segmented toggle above an
 * already-visible form, which made them read as two ways of looking at one
 * thing. They are not: one records a trade whose outcome nobody knows yet, the
 * other journals a trade that is already over. Asking once, clearly, before
 * the form appears is what makes that distinction legible to a beginner — and
 * it stops a half-filled form from having its meaning changed underneath it.
 *
 * THE CARD IS THE ACTION, AND IT IS A LINK. The mode lives in the URL, so each
 * choice has a real address: keyboard activation, focus-visible, Enter, middle
 * click, browser Back and deep links all come from the browser's own anchor
 * semantics rather than from a bespoke widget. There is no Continue button —
 * with exactly two choices, a second click confirms nothing.
 *
 * IT IS A DECISION MOMENT, NOT A MARKETING SCREEN. Ordinary card surface,
 * ordinary border, the shared `hover:border-ring/40` the Dashboard's KPI cards
 * use, and `ToolbarTrigger`'s press deflection and 150ms standard easing. No
 * gradient, no illustration, no progress bar, and nothing that moves when the
 * reader has asked for reduced motion.
 */
export function TradeRecordingModeSelection() {
  const t = useTranslations('trades.create.mode');

  return (
    <section aria-labelledby="recording-mode-question" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="recording-mode-question" className="text-card-title">
          {t('question')}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">{t('helper')}</p>
      </div>

      {/*
        Side by side from `sm` up, stacked below it. Both cards stretch to one
        height so the pair reads as one choice rather than two unrelated
        blocks, whichever description wraps further.
      */}
      <ul className="grid min-w-0 gap-4 sm:grid-cols-2">
        {RECORDING_TIMINGS.map((timing) => {
          const Icon = ICON[timing];
          return (
            <li key={timing} className="min-w-0">
              <Link
                href={`/app/trades/new?timing=${timing}`}
                data-recording-mode={timing}
                // The description is wired as the accessible description, so a
                // screen reader announces "At Entry, Record the trade before
                // the outcome is known" rather than two unlabelled cards.
                aria-describedby={`recording-mode-${timing}-description`}
                className={[
                  'border-border bg-card flex h-full min-w-0 flex-col gap-3 rounded-lg border p-5 outline-none sm:p-6',
                  'hover:border-ring/40 hover:bg-accent',
                  'focus-visible:ring-ring focus-visible:ring-2',
                  'active:scale-[0.99]',
                  'transition-[color,background-color,border-color,transform] duration-150 ease-(--motion-ease-standard)',
                  'motion-reduce:transition-none motion-reduce:active:scale-100',
                ].join(' ')}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md"
                  >
                    <Icon className="size-4.5" />
                  </span>
                  <span className="text-foreground min-w-0 text-base font-semibold">
                    {t(`${timing}.title`)}
                  </span>
                </span>

                <span
                  id={`recording-mode-${timing}-description`}
                  className="text-muted-foreground min-w-0 text-sm leading-relaxed"
                >
                  {t(`${timing}.description`)}
                </span>

                {/*
                  Three words, not a feature list — what this mode captures, so
                  a reader can recognise their own situation at a glance.
                */}
                <span className="text-subtle-foreground mt-auto flex min-w-0 items-center justify-between gap-3 pt-1 text-xs">
                  <span className="min-w-0 break-words">{t(`${timing}.hint`)}</span>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
