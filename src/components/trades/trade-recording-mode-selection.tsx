'use client';

import { Check, CheckCircle2, Target, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLinkStatus } from 'next/link';
import { useRef, useState, type KeyboardEvent } from 'react';

import { RECORDING_TIMINGS, type RecordingTiming } from '@/lib/trades/recording-timing';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

const ICON: Record<RecordingTiming, LucideIcon> = {
  at_entry: Target,
  after_trade: CheckCircle2,
};

/**
 * What each mode captures, as three words. The KEYS live here and the WORDS
 * live in the catalogs — which chips belong to which mode is structure, not
 * copy, so it is the one part of this that is not translated.
 */
const CHIP_KEYS: Record<RecordingTiming, readonly string[]> = {
  at_entry: ['plan', 'risk', 'confidence'],
  after_trade: ['plan', 'result', 'review'],
};

/** One class list, so the disabled button and the live link are one control. */
const CONTINUE_CLASS = 'h-12 w-full text-base font-semibold';

function timingHref(timing: RecordingTiming): string {
  return `/app/trades/new?timing=${timing}`;
}

/**
 * THE ONE DECISION LOG A TRADE ASKS FIRST.
 *
 * At Entry and After Trade are not two ways of looking at one thing. One
 * records a trade whose outcome nobody knows yet, the other journals a trade
 * that is already over, and which one applies changes what the form can
 * truthfully ask for. Asking once, before the form appears, is what makes that
 * distinction legible to a beginner — and it stops a half-filled form from
 * having its meaning changed underneath it.
 *
 * PICK, THEN CONFIRM — AND WHY THAT REPLACED "THE CARD IS THE LINK". The cards
 * used to navigate on click, which put choosing and committing in the same
 * gesture: a mis-aimed tap landed the reader in a form built around the wrong
 * situation, and nothing on screen ever showed the two answers in a
 * chosen/unchosen state to compare. Selecting first means the reader can
 * compare, change their mind, and commit deliberately. The default is
 * deliberately nothing selected: pre-selecting either one would be this flow
 * quietly deciding which situation the trader is in.
 *
 * THE COMMIT IS STILL A REAL LINK, NOT A ROUTER CALL. Once a card is chosen,
 * Continue renders as `<Link>` to that mode's own URL, so prefetch, middle
 * click, right-click "open in new tab", and activation before hydration all
 * come from the browser and the router rather than from a click handler.
 * Before a choice exists there is no destination to link to, so it renders as
 * a disabled `<button>` wearing the identical class list — one visual control,
 * two elements, chosen by whether a destination exists yet.
 *
 * A RADIOGROUP, BECAUSE THAT IS WHAT THIS IS. Two mutually exclusive answers
 * to one question, with a separate commit — `role="radio"` on each card and a
 * roving tabindex through the group gives a screen reader the right
 * announcement ("At Entry, radio button, 1 of 2") and a keyboard user the
 * arrow-key behaviour they already expect, which a pair of clickable divs
 * never would.
 */
export function TradeRecordingModeSelection() {
  const t = useTranslations('trades.create.mode');
  const [selected, setSelected] = useState<RecordingTiming | null>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /*
    Arrow keys move the selection, not merely the focus — the ARIA radiogroup
    pattern, and the reason a keyboard user never has to press Space after
    arrowing onto the answer they want. Space and Enter need no handling here:
    a `<button>` already fires `click` for both.
  */
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = RECORDING_TIMINGS.length - 1;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        target = index === 0 ? last : index - 1;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = last;
        break;
      default:
        return;
    }
    const timing = RECORDING_TIMINGS[target];
    if (timing === undefined) return;
    event.preventDefault();
    setSelected(timing);
    cardRefs.current[target]?.focus();
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div
        role="radiogroup"
        aria-label={t('question')}
        className="grid min-w-0 gap-4 md:grid-cols-2"
      >
        {RECORDING_TIMINGS.map((timing, index) => (
          <OptionCard
            key={timing}
            ref={(node) => {
              cardRefs.current[index] = node;
            }}
            timing={timing}
            selected={selected === timing}
            /*
              Exactly one card is tabbable, so Tab enters and leaves the group
              in one press instead of stopping on every answer. With nothing
              chosen yet that is the first card — the group must never become
              unreachable by keyboard just because it has no value.
            */
            tabIndex={(selected === null ? index === 0 : selected === timing) ? 0 : -1}
            onSelect={() => setSelected(timing)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          />
        ))}
      </div>

      {/*
        On a phone the commit is pinned to the bottom of the viewport so it is
        reachable without scrolling past both cards, over a surface opaque
        enough to keep the content behind it readable, and clear of the home
        indicator. `max(env(...), 0.75rem)` rather than the `pb-safe` utility
        because this needs a real resting padding on the many devices where the
        inset is zero. From `md` it stops being sticky and simply follows the
        cards.
      */}
      <div
        className={cn(
          'border-border bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky bottom-0 z-10 -mx-4 border-t px-4 pt-3 backdrop-blur',
          'pb-[max(env(safe-area-inset-bottom),0.75rem)]',
          'md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
        )}
      >
        {selected === null ? (
          <Button size="lg" disabled className={CONTINUE_CLASS}>
            {t('continue')}
          </Button>
        ) : (
          <Button asChild size="lg" className={CONTINUE_CLASS}>
            <Link href={timingHref(selected)}>
              <ContinueLabel idle={t('continue')} pending={t('continuing')} />
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The commit's label, which becomes "Opening…" while the navigation it started
 * is still in flight.
 *
 * `useLinkStatus` only reports from inside a `<Link>`, which is why this is its
 * own component rather than a ternary in the parent. Outside one — in a unit
 * test that stubs the router's Link, or before hydration — the context falls
 * back to idle rather than throwing, so the label is simply the idle one.
 */
function ContinueLabel({ idle, pending }: { idle: string; pending: string }) {
  const { pending: navigating } = useLinkStatus();
  return <>{navigating ? pending : idle}</>;
}

/**
 * One answer.
 *
 * ROW ON A PHONE, COLUMN ON A DESKTOP. Stacked cards on a narrow screen are
 * two tall blocks the reader has to scroll between to compare; laying each one
 * out horizontally — icon, then everything else — halves their height and puts
 * both answers and the commit on one screen. Side by side from `md`, where
 * there is width for the column form the eye reads faster.
 *
 * SELECTION IS A BRAND BORDER PLUS A TRANSLUCENT BRAND RING, NOT A THICKER
 * BORDER. A 1px→2px border change reflows the text inside the card by a pixel
 * every time the reader arrows between the two answers. Border and ring
 * together read as the same emphatic brand edge and move nothing.
 */
function OptionCard({
  ref,
  timing,
  selected,
  tabIndex,
  onSelect,
  onKeyDown,
}: {
  ref: (node: HTMLButtonElement | null) => void;
  timing: RecordingTiming;
  selected: boolean;
  tabIndex: number;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const t = useTranslations('trades.create.mode');
  const Icon = ICON[timing];
  const titleId = `recording-mode-${timing}-title`;
  const descriptionId = `recording-mode-${timing}-description`;

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      // Name from the title alone and description from the sentence under it,
      // so the announcement is "At Entry, radio button" followed by the
      // explanation — not the whole card read out as one run-on name.
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-recording-mode={timing}
      tabIndex={tabIndex}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        // `pr-10` is reserved at every state so the check mark appearing in the
        // corner never rewraps the text beneath it.
        'relative flex min-w-0 items-start gap-4 rounded-xl border p-4 pr-10 text-left outline-none',
        'shadow-control md:flex-col md:gap-3',
        'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-(--motion-ease-standard)',
        'hover:border-ring/40 hover:shadow-card hover:-translate-y-0.5',
        'focus-visible:ring-ring focus-visible:ring-2',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        selected ? 'border-brand bg-brand/5 ring-brand/30 ring-2' : 'border-border bg-card',
      )}
    >
      <span
        aria-hidden="true"
        className="bg-brand/10 text-brand flex size-12 shrink-0 items-center justify-center rounded-2xl"
      >
        <Icon className="size-6" />
      </span>

      <span className="flex min-w-0 flex-col gap-1.5">
        <span id={titleId} className="text-foreground text-base font-semibold">
          {t(`${timing}.title`)}
        </span>
        <span id={descriptionId} className="text-muted-foreground text-sm leading-relaxed">
          {t(`${timing}.description`)}
        </span>

        {/*
          Three words, not a feature list — what this mode captures, so a
          reader can recognise their own situation at a glance.
        */}
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          {CHIP_KEYS[timing].map((chip) => (
            <span
              key={chip}
              className="text-subtle-foreground inline-flex min-w-0 items-center gap-1 text-xs"
            >
              <CheckCircle2 aria-hidden="true" className="text-brand size-3.5 shrink-0" />
              <span className="min-w-0 break-words">{t(`${timing}.chips.${chip}`)}</span>
            </span>
          ))}
        </span>
      </span>

      {selected ? (
        <span
          aria-hidden="true"
          className="bg-brand text-primary-foreground absolute top-3 right-3 flex size-5 items-center justify-center rounded-full"
        >
          <Check className="size-3.5" />
        </span>
      ) : null}
    </button>
  );
}
