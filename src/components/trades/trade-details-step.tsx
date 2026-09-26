'use client';

import {
  ArrowUpDown,
  CalendarClock,
  ChartCandlestick,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingDown,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode, type RefObject } from 'react';

import { shiftCalendarMonth } from '@/lib/dashboard/calendar-grid';
import { buildDateRangePickerMonth } from '@/lib/dashboard/date-range-calendar';
import {
  formatCalendarDateLabel,
  formatCalendarMonthLabel,
} from '@/lib/dashboard/date-range-presentation';
import { calendarDateIn } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { TradeCreateOptions } from '@/server/dal/trades';
import { DateRangeMonthGrid } from '@/components/dashboard/toolbar/date-range-month-grid';
import { Button } from '@/components/ui/button';

import { entryTimestampParts } from './after-trade-draft';
import { RequirementBadge } from './requirement-badge';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { FieldError, InlineAction, Tag, type ChoiceTone } from './trade-at-entry-controls';
import { TradeChoiceList } from './trade-choice-list';
import { TradeSymbolPicker } from './trade-symbol-picker';
import { TradeTimeWheel } from './trade-time-wheel';
import { useSavedSymbols } from './use-saved-symbols';

/** The recording moment Step 1 is shown in. It decides the entry time's semantics, never the design. */
export type TradeDetailsMode = 'at_entry' | 'after_trade';

/**
 * THE FOUR THINGS STEP 1 RECORDS, each its own concept and its own editor.
 * The key is the draft field, so a blocked Save maps straight onto the row
 * that holds the problem.
 */
export type TradeConcept = 'tradingAccountId' | 'symbol' | 'direction' | 'enteredAt';

/** Where At Entry's entry time came from; After Trade has no default, so no source. */
export type EntryTimeSource = 'default_now' | 'trader' | 'cleared';

/**
 * Which half of the entry timestamp a blocking error is about, if either. A
 * half answer is the missing half's problem, and only speaks up once the
 * trader has left the sheet on it or a Save has stopped on it.
 */
export type EntryErrorCode = 'entry_time_required' | 'entry_date_required' | 'other' | null;

/** The launcher row for a Step 1 concept — what a failed Save focuses. */
export function tradeDetailsRowId(idPrefix: string, concept: TradeConcept): string {
  return `${idPrefix}-row-${concept}`;
}

/** The trader's calendar date, in THEIR zone — never the browser's (CLAUDE.md §7). */
function todayIn(now: Date, timezone: string): string | null {
  const resolved = calendarDateIn(now, timezone);
  return resolved.ok ? resolved.value : null;
}

/**
 * The month the entry-date calendar opens on: the recorded date's, else the
 * trader's current month, else the epoch — never the browser's month, which
 * may be a different day from the trader's own (CLAUDE.md §7).
 */
function monthOf(
  date: string,
  todayDate: string | null,
): { readonly year: number; readonly month: number } {
  const anchor = date !== '' ? date : (todayDate ?? '1970-01-01');
  return {
    year: Number.parseInt(anchor.slice(0, 4), 10),
    month: Number.parseInt(anchor.slice(5, 7), 10),
  };
}

/**
 * HOW MUCH OF "WHEN" IS RECORDED, IN ONE LINE. A date whose time is unknown
 * reads as the date plus that fact — never as a date pretending to be an
 * instant, and never as nothing at all.
 */
export function formatEntryStamp(
  value: string,
  locale: string,
  words: { readonly timeNotRecorded: string; readonly dateNotRecorded: string },
): string | null {
  const parts = entryTimestampParts(value);
  const day = parts.date === '' ? '' : (formatCalendarDateLabel(parts.date, locale) ?? parts.date);
  if (parts.date !== '' && parts.time !== '') return `${day} · ${parts.time}`;
  // Half an answer reads as the half that is there, and what is not.
  if (parts.date !== '') return `${day} · ${words.timeNotRecorded}`;
  if (parts.time !== '') return `${parts.time} · ${words.dateNotRecorded}`;
  return null;
}

/**
 * STEP 1 — TRADE DETAILS, READ FIRST (UX Rules §20.9, the protected baseline).
 *
 * Four concepts, four rows: which account, what was traded, which way, and
 * when it was entered. A row SHOWS the answer — the input that records it
 * exists only inside the editor the row opens (DESIGN.md §6, "a disclosure
 * that opens an editor surface looks like a launcher row"). Required or
 * Optional is said once, on the row, so no helper paragraph repeats it.
 *
 * ONE DESIGN, TWO MOMENTS. The rows, the editors, the Symbol picker, the date
 * and time sheet, their geometry and their motion are the same in both
 * recording modes. Only the entry time's MEANING differs, inside the same
 * interaction:
 * - After Trade: blank until recalled, either half may come first, and Save
 *   asks for the missing half (contract §13; UX Rules §8.5).
 * - At Entry: it starts as the approved "now" default and follows the clock,
 *   shown as a default until the trader confirms it, changes it, or clears it;
 *   a cleared time can go back to now (contract §6; UX Rules §4.1, §11.3). A
 *   change to either half keeps the one complete stamp At Entry records, so
 *   the half-only clears are not offered.
 *
 * IT OWNS NO SEMANTICS. Every answer goes back through the host's own draft
 * transitions; the open editor, the open half and the calendar month are view
 * state here.
 */
export function TradeDetailsStep({
  mode,
  idPrefix,
  options,
  timezone,
  now,
  tradingAccountId,
  symbol,
  direction,
  enteredAt,
  entrySource = null,
  errors,
  entryError,
  attempted,
  onTradingAccount,
  onSymbol,
  onDirection,
  onEntryDate,
  onEntryTime,
  onClearEntry,
  onConfirmEntry,
  onUseNowEntry,
}: {
  mode: TradeDetailsMode;
  /** Prefix for every DOM id, so each host keeps the ids it already had. */
  idPrefix: string;
  options: Pick<TradeCreateOptions, 'tradingAccounts' | 'savedSymbols' | 'workspaceId'>;
  timezone: string;
  now: Date;
  tradingAccountId: string;
  symbol: string;
  direction: '' | 'long' | 'short';
  /** A `datetime-local` wall clock in the trader's zone, or either half of one, or ''. */
  enteredAt: string;
  /** At Entry only: whether the time is still the "now" default. */
  entrySource?: EntryTimeSource | null;
  errors: {
    readonly tradingAccountId?: string | undefined;
    readonly symbol?: string | undefined;
    readonly direction?: string | undefined;
  };
  entryError: { readonly code: EntryErrorCode; readonly text: string | undefined };
  /** A Save has been attempted: every blocking error speaks. */
  attempted: boolean;
  onTradingAccount: (tradingAccountId: string) => void;
  onSymbol: (symbol: string) => void;
  onDirection: (direction: 'long' | 'short') => void;
  /** A date for the entry, keeping any time; '' clears the date alone. */
  onEntryDate: (date: string) => void;
  /** A time for the entry, keeping any date; '' clears the time alone. */
  onEntryTime: (time: string) => void;
  onClearEntry: () => void;
  /** At Entry: "This time is right" — the default becomes the trader's answer. */
  onConfirmEntry?: (() => void) | undefined;
  /** At Entry: a cleared time goes back to following the clock. */
  onUseNowEntry?: (() => void) | undefined;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const locale = useLocale();
  const savedSymbols = useSavedSymbols(options.savedSymbols, options.workspaceId);
  const atEntry = mode === 'at_entry';

  /*
    WHICH STEP 1 EDITOR IS OPEN — view state, never draft state. Step 1 shows
    what has been recorded; an editing control exists only while the trader has
    one open, and every change inside it lands in the draft as it is made, so
    closing by Done, Escape, the backdrop or the system back gesture keeps the
    work (UX Rules §5.2, §17.4).
  */
  const [editor, setEditor] = useState<TradeConcept | null>(null);
  /**
   * Which half of the entry timestamp has its control open, if either. View
   * state inside one sheet, so the two answers never need a second overlay.
   */
  const [entryPane, setEntryPane] = useState<'date' | 'time' | null>(null);
  /**
   * The sheet has been closed at least once with only half an answer in it.
   * That is when the missing half starts saying so — not while the trader is
   * still part-way through giving it.
   */
  const [entryStampReviewed, setEntryStampReviewed] = useState(false);
  /*
    WHICH MONTH THE ENTRY-DATE CALENDAR SHOWS — view state, like the open
    editor. It opens on the recorded date's month, or on the trader's own
    current month, and every reopen re-anchors it, so paging never drifts away
    from the answer it is meant to be adjusting.
  */
  const [pickerMonth, setPickerMonth] = useState(() =>
    monthOf(entryTimestampParts(enteredAt).date, todayIn(new Date(), timezone)),
  );
  // The row each editor returns focus to when it closes.
  const accountRow = useRef<HTMLButtonElement>(null);
  const symbolRow = useRef<HTMLButtonElement>(null);
  const directionRow = useRef<HTMLButtonElement>(null);
  const enteredAtRow = useRef<HTMLButtonElement>(null);

  const selectedAccount = options.tradingAccounts.find(
    (item) => item.tradingAccountId === tradingAccountId,
  );

  /*
    STEP 1's EDITORS, ONE RULE. A single-choice editor — Trading Account,
    Symbol, Direction — commits on the choice and closes; a multi-part one —
    Entry date & time — keeps Done. Either way the answer is written to the
    draft as it is made, so closing by X, Escape or the backdrop changes
    nothing that was not already chosen.
  */
  const closeEditorOn = (next: boolean) => {
    if (!next) setEditor(null);
  };
  /*
    THE ENTRY TIMESTAMP, READ AS ITS TWO HALVES. One stored value still; these
    only say how it is shown and which row an error belongs beside. A date with
    no time is the time's problem, not the date's — the date is a perfectly
    good answer and the row must not mark it wrong.
  */
  const entryParts = entryTimestampParts(enteredAt);
  const entryDateLabel =
    entryParts.date === ''
      ? null
      : (formatCalendarDateLabel(entryParts.date, locale) ?? entryParts.date);
  /*
    HALF AN ANSWER IS NOT AN ERROR WHILE IT IS BEING GIVEN. A trader who picks
    a day has not done anything wrong yet — they are mid-answer, and the other
    row is right there. The completion message appears once they have closed
    the sheet on it, or once a Save has stopped on it; until then the rows just
    say what is recorded.
  */
  const entryIncomplete =
    entryError.code === 'entry_time_required' || entryError.code === 'entry_date_required';
  const showEntryIncomplete = entryIncomplete && (attempted || entryStampReviewed);
  const entryErrorText = entryIncomplete
    ? showEntryIncomplete
      ? entryError.text
      : undefined
    : entryError.text;
  const timeError = entryError.code === 'entry_time_required' ? entryErrorText : undefined;
  const dateError = entryError.code === 'entry_date_required' ? entryErrorText : undefined;
  const entryStampLabel = formatEntryStamp(enteredAt, locale, {
    timeNotRecorded: a('times.entryTimeNotRecorded'),
    dateNotRecorded: a('times.entryDateNotRecorded'),
  });
  /** At Entry's untouched "now": a default until the trader says otherwise. */
  const entryIsDefault = atEntry && entrySource === 'default_now' && enteredAt !== '';

  /*
    THE MONTH THE CALENDAR OPENS ON. The recorded date's month, or the trader's
    current month when nothing is recorded — resolved in THEIR timezone, never
    the browser's or the server's (CLAUDE.md §7). Paging is view state and is
    reset every time the editor opens, so it never drifts away from the answer.
  */
  const todayDate = todayIn(now, timezone);
  const pickerGrid = buildDateRangePickerMonth({
    year: pickerMonth.year,
    month: pickerMonth.month,
    // The range collapsed to one day: the builder reports it as `single`.
    draft: { datePreset: 'custom', from: entryParts.date, to: entryParts.date },
    todayDate,
    // An entry cannot be in the future.
    maxDate: todayDate,
  });

  return (
    <>
      <div className="grid min-w-0 gap-2.5 min-[560px]:grid-cols-2 lg:gap-3">
        <ConceptRow
          id={tradeDetailsRowId(idPrefix, 'tradingAccountId')}
          concept="tradingAccountId"
          rowRef={accountRow}
          label={c('account.label')}
          marker={<RequiredTag />}
          /* The chosen account, or the same "Choose an account" the editor opens on. */
          value={
            selectedAccount === undefined
              ? null
              : `${selectedAccount.name} · ${selectedAccount.baseCurrency}`
          }
          placeholder={c('account.choose')}
          raw={tradingAccountId}
          error={errors.tradingAccountId}
          editLabel={a('trade.editAria', { field: c('account.label') })}
          icon={Wallet}
          iconTone={selectedAccount === undefined ? undefined : 'accent'}
          onOpen={() => setEditor('tradingAccountId')}
          data-account-context=""
        />
        <ConceptRow
          id={tradeDetailsRowId(idPrefix, 'symbol')}
          concept="symbol"
          rowRef={symbolRow}
          label={c('symbol.label')}
          marker={<RequiredTag />}
          value={symbol.trim() === '' ? null : symbol.trim().toUpperCase()}
          placeholder={c('notAnswered')}
          raw={symbol}
          error={errors.symbol}
          editLabel={a('trade.editAria', { field: c('symbol.label') })}
          icon={ChartCandlestick}
          iconTone={symbol.trim() === '' ? undefined : 'accent'}
          onOpen={() => setEditor('symbol')}
        />
        <ConceptRow
          id={tradeDetailsRowId(idPrefix, 'direction')}
          concept="direction"
          rowRef={directionRow}
          label={c('direction.label')}
          marker={<RequiredTag />}
          value={
            direction === 'long'
              ? c('direction.long')
              : direction === 'short'
                ? c('direction.short')
                : null
          }
          /*
            A SCANNING AID, NOT A VERDICT. The word is always there and
            always first; the hue only helps the eye find which way this
            trade went in a column of rows. Nothing on this step shows a
            result, so green here cannot be misread as a win.
          */
          valueTone={
            direction === 'long' ? 'positive' : direction === 'short' ? 'negative' : undefined
          }
          placeholder={c('notAnswered')}
          raw={direction}
          error={errors.direction}
          editLabel={a('trade.editAria', { field: c('direction.label') })}
          /*
            THE SHAPE SAYS IT BEFORE THE HUE DOES: both ways while
            unanswered, then the trend the trade took — so the icon
            carries the direction in greyscale too, beside the word.
          */
          icon={
            direction === 'long' ? TrendingUp : direction === 'short' ? TrendingDown : ArrowUpDown
          }
          iconTone={
            direction === 'long' ? 'positive' : direction === 'short' ? 'negative' : undefined
          }
          onOpen={() => setEditor('direction')}
        />
        {/*
          WHEN, AS ONE CONCEPT ON THE STEP AND TWO ANSWERS INSIDE IT.
          "When did you enter?" is one question a trader either can or
          cannot answer, so it takes one row here and says how much of it
          is recorded; the day and the minute are separate answers only
          once the editor is open, because they are separately knowable.
          Blank is "Not recorded", never unanswered and never a zero (UX
          Rules §4). At Entry's "now" says it is a default on the row itself.
        */}
        <ConceptRow
          id={tradeDetailsRowId(idPrefix, 'enteredAt')}
          concept="enteredAt"
          rowRef={enteredAtRow}
          label={a('times.entryDateTime')}
          marker={
            entryIsDefault ? (
              <Tag tone="default" icon={<Clock className="size-3" aria-hidden="true" />}>
                {c('entryTime.defaulted')}
              </Tag>
            ) : (
              <OptionalTag />
            )
          }
          value={entryStampLabel}
          placeholder={
            atEntry && entrySource === 'cleared' ? c('entryTime.notSet') : a('times.notRecorded')
          }
          raw={enteredAt}
          error={entryErrorText}
          editLabel={a('trade.editAria', { field: a('times.entryDateTime') })}
          icon={CalendarClock}
          // Half a timestamp is not an answer yet: a date needs its time.
          iconTone={entryParts.date !== '' && entryParts.time !== '' ? 'accent' : undefined}
          onOpen={() => {
            setPickerMonth(monthOf(entryParts.date, todayDate));
            /*
              THE SHEET OPENS SHOWING BOTH QUESTIONS AND ANSWERING
              NEITHER. Opening one of them for the trader guesses which
              half they came to give, and a calendar or a wheel unfolding
              on arrival is a control they have to dismiss before they can
              even read what the other row says.
            */
            setEntryPane(null);
            setEditor('enteredAt');
          }}
          {...(atEntry ? { 'data-entry-source': entrySource ?? undefined } : {})}
        />
      </div>

      {/*
        STEP 1's EDITORS. One per concept, portalled out of the form so nothing
        typed in one can submit the Trade (UX Rules §17.4), and each a centered
        dialog on a desktop and a reachable bottom sheet on a phone — the
        geometry this codebase already accepted for nested Trade editors. Every
        change is written to the draft as it is made, so X, Escape, the
        backdrop and the system back gesture never take one back; focus returns
        to the row that opened the editor.

        THE ACCOUNTS, LISTED. A trader has a handful of accounts at most — the
        plan limit is 15 — so every one is on screen as its own answer and one
        tap is the whole choice. No search: there is nothing to search through.
      */}
      <TradeAdaptiveOverlay
        open={editor === 'tradingAccountId'}
        onOpenChange={closeEditorOn}
        title={c('account.label')}
        description={a('trade.accountEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={accountRow}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <TradeChoiceList
            label={c('account.label')}
            value={tradingAccountId === '' ? null : tradingAccountId}
            error={errors.tradingAccountId}
            errorId={`${idPrefix}-account-error`}
            onChoose={(next) => {
              onTradingAccount(next);
              setEditor(null);
            }}
            options={options.tradingAccounts.map((account) => ({
              value: account.tradingAccountId,
              label: `${account.name} · ${account.baseCurrency}`,
            }))}
          />
          {errors.tradingAccountId === undefined ? null : (
            <FieldError id={`${idPrefix}-account-error`}>{errors.tradingAccountId}</FieldError>
          )}
        </div>
      </TradeAdaptiveOverlay>

      {/*
        SYMBOL IS STILL FREE TEXT. There is no instrument catalogue in this
        product, so "search" here searches the trader's saved symbols — the
        typed value filters them and adding it is itself the answer. Typing
        something nothing matches is a perfectly good Symbol.
      */}
      <TradeAdaptiveOverlay
        open={editor === 'symbol'}
        onOpenChange={closeEditorOn}
        title={c('symbol.label')}
        description={a('trade.symbolEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={symbolRow}
      >
        <div className="flex min-w-0 flex-col gap-3">
          {/*
            CHOOSING IS THE WHOLE INTERACTION, so the sheet closes on it. There
            is nothing to confirm afterwards and no second answer to give.
          */}
          <TradeSymbolPicker
            id={`${idPrefix}-symbol`}
            value={symbol}
            saved={savedSymbols.symbols}
            onSelect={(next) => {
              onSymbol(next);
              setEditor(null);
            }}
            onSave={(next) => void savedSymbols.save(next)}
            onRemove={(next) => void savedSymbols.remove(next)}
            labels={{
              searchLabel: c('symbol.label'),
              searchPlaceholder: a('trade.symbolSearch'),
              savedHeading: a('trade.symbolSaved'),
              empty: a('trade.symbolEmpty'),
              noMatches: a('trade.symbolNoMatch'),
              addTyped: (value) => a('trade.symbolAddTyped', { symbol: value }),
              alreadySaved: (value) => a('trade.symbolAlreadySaved', { symbol: value }),
              remove: (value) => a('trade.symbolRemove', { symbol: value }),
              selected: a('trade.symbolSelected'),
            }}
          />
          {errors.symbol === undefined ? null : (
            <FieldError id={`${idPrefix}-symbol-error`}>{errors.symbol}</FieldError>
          )}
        </div>
      </TradeAdaptiveOverlay>

      <TradeAdaptiveOverlay
        open={editor === 'direction'}
        onOpenChange={closeEditorOn}
        title={c('direction.label')}
        description={a('trade.directionEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={directionRow}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <TradeChoiceList
            label={c('direction.label')}
            columns={2}
            value={direction === '' ? null : direction}
            error={errors.direction}
            errorId={`${idPrefix}-direction-error`}
            onChoose={(next) => {
              onDirection(next);
              setEditor(null);
            }}
            options={[
              { value: 'long', label: c('direction.long'), tone: 'positive' },
              { value: 'short', label: c('direction.short'), tone: 'negative' },
            ]}
          />
          {errors.direction === undefined ? null : (
            <FieldError id={`${idPrefix}-direction-error`}>{errors.direction}</FieldError>
          )}
        </div>
      </TradeAdaptiveOverlay>

      {/*
        THE DASHBOARD'S CALENDAR, NOT A SECOND ONE. `DateRangeMonthGrid` and
        `buildDateRangePickerMonth` are the Dashboard and Trade Log date
        picker's own grid and month builder, used here with the range collapsed
        to a single day — `from` and `to` the same date, which that builder
        already reports as `single`. Two seven-column calendars in one product
        that disagreed about which column is Sunday, what today looks like or
        how a selected day reads would be a defect, so there is one.
      */}
      <TradeAdaptiveOverlay
        open={editor === 'enteredAt'}
        onOpenChange={closeEditorOn}
        title={a('times.entryDateTime')}
        description={
          atEntry ? c('entryTime.hint', { timezone }) : a('trade.stampEditor', { timezone })
        }
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={enteredAtRow}
        footer={
          <div className="flex min-w-0 flex-wrap-reverse items-center justify-between gap-3">
            {/*
              WHAT CAN BE DONE WITH THE ANSWER AS A WHOLE. After Trade: clear
              it. At Entry: confirm the "now" default, clear the time, or put
              a cleared time back on the clock — each an explicit, named
              action, never a side effect of Done.
            */}
            {atEntry ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                {entryIsDefault && onConfirmEntry !== undefined ? (
                  <InlineAction onClick={onConfirmEntry}>{c('entryTime.confirm')}</InlineAction>
                ) : null}
                {entrySource === 'cleared' ? (
                  onUseNowEntry === undefined ? null : (
                    <InlineAction
                      onClick={() => {
                        onUseNowEntry();
                        setEntryStampReviewed(false);
                        setEntryPane(null);
                      }}
                    >
                      {c('entryTime.useNow')}
                    </InlineAction>
                  )
                ) : enteredAt === '' ? null : (
                  <InlineAction
                    ariaLabel={a('times.clearStamp')}
                    onClick={() => {
                      onClearEntry();
                      setEntryStampReviewed(false);
                      setEntryPane(null);
                    }}
                  >
                    {a('times.clearStamp')}
                  </InlineAction>
                )}
              </div>
            ) : enteredAt === '' ? (
              <span aria-hidden="true" />
            ) : (
              <InlineAction
                ariaLabel={a('times.clearStamp')}
                onClick={() => {
                  onClearEntry();
                  setEntryStampReviewed(false);
                  setEntryPane(null);
                }}
              >
                {a('times.clearStamp')}
              </InlineAction>
            )}
            <Button
              type="button"
              size="lg"
              className="min-h-12"
              onClick={() => {
                // Closing on half an answer is when the other half speaks up.
                if (entryIncomplete) setEntryStampReviewed(true);
                setEditor(null);
              }}
            >
              {a('trade.done')}
            </Button>
          </div>
        }
      >
        {/*
          TWO ANSWERS, ONE SURFACE. The day and the minute are separately
          knowable, so each gets its own row and its own control — but they are
          one question, so they share one sheet. Only one control is open at a
          time and it opens under the row it belongs to: a second modal over
          this one would be two overlays deep, which this system does not do
          (DESIGN.md §3, L4).
        */}
        <div data-entry-stamp-editor="" className="flex min-w-0 flex-col gap-2">
          <EntryStampRow
            id={`${idPrefix}-entry-date`}
            label={a('times.entryDate')}
            value={entryDateLabel}
            placeholder={a('times.notRecorded')}
            raw={entryParts.date}
            error={dateError}
            open={entryPane === 'date'}
            onToggle={() => {
              setPickerMonth(monthOf(entryParts.date, todayDate));
              setEntryPane((current) => (current === 'date' ? null : 'date'));
            }}
          >
            <div data-entry-date-picker="" className="flex min-w-0 flex-col gap-2 pt-1">
              <nav
                aria-label={a('trade.monthNav')}
                className="flex min-w-0 items-center justify-between gap-2"
              >
                <MonthStepButton
                  direction="previous"
                  label={a('trade.previousMonth')}
                  onClick={() =>
                    setPickerMonth((current) => shiftCalendarMonth(current.year, current.month, -1))
                  }
                />
                <MonthStepButton
                  direction="next"
                  label={a('trade.nextMonth')}
                  onClick={() =>
                    setPickerMonth((current) => shiftCalendarMonth(current.year, current.month, 1))
                  }
                />
              </nav>
              <DateRangeMonthGrid
                month={pickerGrid}
                monthLabel={formatCalendarMonthLabel(pickerMonth.year, pickerMonth.month, locale)}
                onSelect={(date) => onEntryDate(date)}
                dateLocale={locale}
              />
              {atEntry || entryParts.date === '' ? null : (
                <div>
                  <InlineAction ariaLabel={a('times.clearDate')} onClick={() => onEntryDate('')}>
                    {a('times.clearDate')}
                  </InlineAction>
                </div>
              )}
            </div>
          </EntryStampRow>

          {/*
            EITHER HALF CAN COME FIRST. A trader recalling a closed trade may
            remember the minute and have to work out the day, so the time is
            not gated behind the date: both rows open on their own, and it is
            Save that insists on the pair, not the order of opening.
          */}
          <EntryStampRow
            id={`${idPrefix}-entry-time`}
            label={a('times.entryTime')}
            value={entryParts.time === '' ? null : entryParts.time}
            placeholder={a('times.notRecorded')}
            raw={entryParts.time}
            error={timeError}
            open={entryPane === 'time'}
            onToggle={() => setEntryPane((current) => (current === 'time' ? null : 'time'))}
          >
            <div className="flex min-w-0 flex-col gap-3 pt-1">
              <TradeTimeWheel
                id={`${idPrefix}-enteredTime`}
                value={entryParts.time}
                onChange={(time) => onEntryTime(time)}
                labels={{ hour: a('times.hour'), minute: a('times.minute') }}
              />
              {atEntry || entryParts.time === '' ? null : (
                <div>
                  <InlineAction
                    ariaLabel={a('times.clearOnlyTime')}
                    onClick={() => onEntryTime('')}
                  >
                    {a('times.clearOnlyTime')}
                  </InlineAction>
                </div>
              )}
            </div>
          </EntryStampRow>
        </div>
      </TradeAdaptiveOverlay>
    </>
  );
}

/**
 * ONE OF THE TWO ANSWERS INSIDE THE ENTRY-TIMESTAMP SHEET.
 *
 * A launcher row again — name, what is recorded, a chevron — but a disclosure
 * rather than a door: its control opens underneath it, inside the same sheet.
 * That is what keeps the day and the minute separately answerable without
 * stacking a second modal over the first (DESIGN.md §3, L4), and it is why the
 * chevron turns rather than pointing on.
 *
 * It sits one plane above the sheet it is on, by plane and not by a hairline,
 * which is the same step the Step 1 rows take against the step card.
 */
function EntryStampRow({
  id,
  label,
  value,
  placeholder,
  raw,
  error,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  value: string | null;
  placeholder: string;
  raw: string;
  error?: string | undefined;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `${id}-panel`;
  const errorId = `${id}-error`;
  /*
    A SECTION NOBODY OPENED COSTS NOTHING. The collapse animation needs the
    content to stay mounted once it has been shown — that is what gives the
    height something to travel to — but a wheel is eighty-four cells and a
    month is forty-two, and building both every time this sheet opens is work
    for a question the trader may never ask. So it mounts on first open and
    stays: the cost is paid by whoever actually opens the section.
  */
  const [opened, setOpened] = useState(open);
  // React’s sanctioned adjust-state-during-render: it re-renders before painting.
  if (open && !opened) setOpened(true);
  return (
    <div
      data-entry-stamp={id}
      data-value={raw}
      className={cn(
        'bg-muted/50 min-w-0 rounded-lg border px-3 py-1',
        error === undefined ? 'border-transparent' : 'border-destructive',
      )}
    >
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={panelId}
        aria-describedby={error === undefined ? undefined : errorId}
        onClick={onToggle}
        className="focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2"
      >
        <span className="text-muted-foreground min-w-0 flex-1 text-[0.8125rem] font-medium">
          {label}
        </span>
        <span
          className={cn(
            'min-w-0 truncate text-base',
            value === null
              ? 'text-subtle-foreground'
              : 'text-foreground font-semibold tabular-nums',
          )}
        >
          {value ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'text-subtle-foreground size-4 shrink-0 transition-transform duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      {error === undefined ? null : (
        <div className="pb-2">
          <FieldError id={errorId}>{error}</FieldError>
        </div>
      )}
      {/*
        HEIGHT, OPACITY AND A SHORT TRAVEL — on the surface-enter clock the
        sheets and dialogs already use, so a section opening inside a sheet
        moves at the same speed as the sheet that carries it.

        `grid-template-rows` is what animates the height: there is no CSS
        length to transition to "as tall as the content is", and measuring it
        in JS to set a pixel height would make the row re-measure on every
        locale, font and month change. `invisible` when closed is not
        decoration either — it takes the collapsed control out of the tab
        order and out of the accessibility tree, which `height: 0` alone does
        not. Reduced motion is handled centrally: `globals.css` rebinds these
        duration tokens rather than switching the transition off, so the
        section still changes state visibly, just without the travel.
      */}
      <div
        id={panelId}
        data-open={open ? '' : undefined}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility] duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        <div
          className={cn(
            'min-h-0 overflow-hidden transition-transform duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
            open ? 'translate-y-0' : '-translate-y-1',
          )}
        >
          <div className="pb-2">{opened ? children : null}</div>
        </div>
      </div>
    </div>
  );
}

/** Paging for the entry-date calendar: an icon with a name, never an icon alone. */
function MonthStepButton({
  direction,
  label,
  onClick,
}: {
  direction: 'previous' | 'next';
  label: string;
  onClick: () => void;
}) {
  const Icon = direction === 'previous' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      data-month-step={direction}
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

/**
 * A LAUNCHER ROW: one concept, read first. The name, what is recorded — or a
 * neutral word for what is not — and a chevron; the control that records it
 * lives in the editor this row opens. `raw` exposes the stored value, so a
 * test or a capture can read what is recorded without opening an editor.
 *
 * THE ICON IS AN ANCHOR, NOT A STATUS. A small glyph in a quiet inset gives
 * the eye four fixed places to land; it is neutral until the concept is
 * answered, then takes the accent — or, for Direction, the restrained
 * positive/negative the value already carries. It never says anything on its
 * own: the value text says it first, and Direction's glyph changes shape as
 * well as hue. Decorative, so hidden from assistive technology.
 */
function ConceptRow({
  id,
  concept,
  rowRef,
  label,
  marker,
  value,
  valueTone,
  placeholder,
  raw,
  error,
  editLabel,
  icon: Icon,
  iconTone,
  onOpen,
  ...rest
}: {
  id: string;
  concept: TradeConcept;
  rowRef: RefObject<HTMLButtonElement | null>;
  label: string;
  /** Required or Optional, said here rather than in a paragraph below. */
  marker: ReactNode;
  /** What is recorded, or null when nothing is. */
  value: string | null;
  /** A direction the value itself carries, never the only way it is said. */
  valueTone?: ChoiceTone | undefined;
  /** The neutral word for nothing recorded — never a negative (UX Rules §4.3). */
  placeholder: string;
  raw: string;
  error?: string | undefined;
  editLabel: string;
  icon: LucideIcon;
  /** Unset while unanswered: the anchor stays neutral. */
  iconTone?: 'accent' | ChoiceTone | undefined;
  onOpen: () => void;
} & Record<`data-${string}`, string | undefined>) {
  const errorId = `${id}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" {...rest}>
      <button
        type="button"
        id={id}
        ref={rowRef}
        data-concept={concept}
        data-value={raw}
        aria-label={editLabel}
        aria-haspopup="dialog"
        /* A button role carries no aria-invalid; the error is named to it instead. */
        aria-describedby={error === undefined ? undefined : errorId}
        data-invalid={error === undefined ? undefined : 'true'}
        onClick={onOpen}
        /*
          THE DASHBOARD'S SURFACE LADDER, NOT A NEW ONE (DESIGN.md §3). A row
          lifts one step off whatever plane is behind it, by plane first and
          never by a hairline:

            phone   workspace (`background`) → row `card` + `shadow-card`
            lg      step card (`card`)       → row `muted/50`, no shadow

          Both pairs are the relationships the Dashboard already uses — page
          against panel, panel against inset — so Step 1 reads with the same
          depth in Light and in Dark without inventing a colour. The border
          stays in the box model and stays transparent until there is an error
          to show, exactly as `data-dashboard-panel` does, so nothing shifts.
        */
        className={cn(
          'shadow-card bg-card hover:bg-accent focus-visible:ring-ring flex w-full min-w-0 items-center gap-3 rounded-lg border text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
          // 76px on a phone, 84px once the card has room: substantial enough to
          // read as a Trade concept, tight enough that four of them fit above
          // the fold with the step's heading.
          'min-h-[4.75rem] px-4 py-3 lg:min-h-[5.25rem] lg:px-5',
          /*
            THE DESKTOP GRID IS TWO ROWS ABREAST, so the value's width is what
            runs short: at 1280px and up "Main Trading Account · USD" needed
            243px and had 235px beside a 40px icon and 12px gaps. A 36px icon
            and 8px gaps give it 247px. The chevron does not move — the row's
            padding pins it — only the text box reaches 4px closer to it.
          */
          'lg:gap-2',
          'lg:bg-muted/50 lg:hover:bg-muted lg:shadow-none',
          error === undefined ? 'border-transparent' : 'border-destructive',
        )}
      >
        {/*
          40px on a phone and 36px on the desktop's two-abreast grid, one plane
          step off the row — `muted` on the phone's card row, `card` on the
          desktop's muted row — so it reads as an inset, not a badge. Answered
          tints stay at a tenth: a hint, never a coloured disc.
        */}
        <span
          aria-hidden="true"
          data-concept-icon={iconTone ?? 'neutral'}
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-md transition-colors motion-reduce:transition-none lg:size-9',
            iconTone === 'accent'
              ? 'bg-primary/10 text-primary-text'
              : iconTone === 'positive'
                ? 'bg-positive/10 text-positive'
                : iconTone === 'negative'
                  ? 'bg-negative/10 text-negative'
                  : 'bg-muted text-muted-foreground lg:bg-card',
          )}
        >
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-muted-foreground text-[0.8125rem] leading-5 font-medium">
              {label}
            </span>
            {marker}
          </span>
          {/*
            THE VALUE IS WHAT THE ROW IS FOR. It is the largest, heaviest thing
            in the row so a trader scans four answers before reading a single
            label; an unrecorded one drops to subtle weight and colour rather
            than shouting its absence.
          */}
          <span
            className={cn(
              'mt-0.5 block truncate text-[1.0625rem] leading-6 lg:text-lg',
              value === null
                ? 'text-subtle-foreground'
                : cn(
                    'font-semibold',
                    valueTone === 'positive'
                      ? 'text-positive'
                      : valueTone === 'negative'
                        ? 'text-negative'
                        : 'text-foreground',
                  ),
            )}
          >
            {value ?? placeholder}
          </span>
        </span>
        <ChevronRight className="text-subtle-foreground size-5 shrink-0" aria-hidden="true" />
      </button>
      {error === undefined ? null : <FieldError id={errorId}>{error}</FieldError>}
    </div>
  );
}

/**
 * REQUIRED AND OPTIONAL, AS THE SHARED BADGE (decision 59). Required means
 * required to complete the record, never to save it; the badge sits at the
 * right end of the label line and is never an error colour.
 */
function RequiredTag() {
  return <RequirementBadge level="required" className="ml-auto" />;
}

function OptionalTag() {
  return <RequirementBadge level="optional" className="ml-auto" />;
}
