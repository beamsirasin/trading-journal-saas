'use client';

import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode, type RefObject } from 'react';

import { shiftCalendarMonth } from '@/lib/dashboard/calendar-grid';
import { buildDateRangePickerMonth } from '@/lib/dashboard/date-range-calendar';
import {
  formatCalendarDateLabel,
  formatCalendarMonthLabel,
} from '@/lib/dashboard/date-range-presentation';
import { calendarDateIn } from '@/lib/time';
import type { OutcomeValue } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import { DateRangeMonthGrid } from '@/components/dashboard/toolbar/date-range-month-grid';
import { Button } from '@/components/ui/button';

import {
  entryTimestampParts,
  formatShare,
  type CloseMode,
  type ClosingState,
  type PartsResult,
} from './after-trade-draft';
import {
  setTimeDate,
  setTimeTime,
  type ActualRReadout,
  type ExitLegDraft,
} from './close-trade-draft';
import { RequirementBadge } from './requirement-badge';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import {
  ChoiceGroup,
  Helper,
  InlineAction,
  Notice,
  Tag,
  TextField,
} from './trade-at-entry-controls';
import { instantToDatetimeLocal } from './trade-form-values';
import { formatR, formatTradeInstant, formatTradeMoney } from './trade-format';
import { TradeLauncherRow } from './trade-launcher-row';
import { GroupCard } from './trade-recording-step-parts';
import { TradeTimeWheel } from './trade-time-wheel';

/**
 * CANONICAL STAGE 5 — TRADER RESULT, the shared pieces (Add Trade contract
 * §10–§12 as amended by decisions 57–58; UX Rules §20). Record Closed and
 * Close Existing Open Trade's Final Close read with the same components, in
 * the same order:
 *
 *   Trader Outcome → Trade result (how it closed → the close's answers →
 *   the Final Net P&L it proves → Trader R, derived) → final exit time
 *
 * They own no semantics. Every answer goes back through the host's draft, and
 * nothing here fills one in: a time starts unanswered, "Use now" and "Use last
 * recorded exit time" are named actions, and the Final Net P&L is only ever
 * what the close proves — or the total the trader states.
 *
 * What differs by lifecycle comes in through props: Record Closed edits every
 * exit of a Trade it reconstructs; a Final Close lists the exits already
 * recorded and adds only the one that closes the rest.
 */

// ---------------------------------------------------------------------------
// Exit date & time — a launcher row and a focused sheet, in Step 1's language
// ---------------------------------------------------------------------------

/**
 * How much of an exit time is recorded, in one line — Step 1's stamp reading,
 * repeated here so this module does not reach into the protected Step 1 file.
 */
function formatExitStamp(
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

function todayIn(now: Date, timezone: string): string | null {
  const resolved = calendarDateIn(now, timezone);
  return resolved.ok ? resolved.value : null;
}

function monthOf(date: string, todayDate: string | null) {
  const anchor = date !== '' ? date : (todayDate ?? '1970-01-01');
  return {
    year: Number.parseInt(anchor.slice(0, 4), 10),
    month: Number.parseInt(anchor.slice(5, 7), 10),
  };
}

/**
 * AN EXIT DATE & TIME. The row shows what is recorded — or "Not recorded" —
 * and opens one focused sheet holding the day and the minute as separately
 * answerable halves, exactly the Step 1 entry-time interaction. It repeats
 * that language rather than sharing Step 1's private rows, because Step 1 is
 * the protected baseline (UX Rules §20.9); `TradeLauncherRow` does the same.
 *
 * THE SHORTCUTS ARE ACTIONS, NEVER DEFAULTS. "Use now" and "Use last recorded
 * exit time" appear beside the row while it is unanswered and in the sheet's
 * footer; each writes only when pressed.
 */
export function ExitTimeField({
  id,
  rowRef,
  label,
  value,
  timezone,
  locale,
  error,
  lastRecordedExit,
  optionalMarker = true,
  onChange,
}: {
  id: string;
  rowRef?: RefObject<HTMLButtonElement | null>;
  label: string;
  /** The draft's two-half stamp: ``, `YYYY-MM-DD`, `THH:mm` or both joined. */
  value: string;
  timezone: string;
  locale: string;
  error?: string | undefined;
  /** ISO instant of the latest recorded exit leg, when one states a time. */
  lastRecordedExit: string | null;
  /** Left out where the whole step is already optional and says so once. */
  optionalMarker?: boolean;
  onChange: (value: string) => void;
}) {
  const s = useTranslations('trades.stage5.time');
  const ownRowRef = useRef<HTMLButtonElement | null>(null);
  const rowFocus = rowRef ?? ownRowRef;
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<'date' | 'time' | null>(null);
  const parts = entryTimestampParts(value);
  const todayDate = todayIn(new Date(), timezone);
  const [pickerMonth, setPickerMonth] = useState(() => monthOf(parts.date, todayDate));
  const display = formatExitStamp(value, locale, {
    timeNotRecorded: s('timeNotRecorded'),
    dateNotRecorded: s('dateNotRecorded'),
  });
  const lastLocal =
    lastRecordedExit === null ? null : instantToDatetimeLocal(lastRecordedExit, timezone);
  const lastLabel =
    lastRecordedExit === null ? null : formatTradeInstant(lastRecordedExit, timezone, locale);

  const useNow = () => onChange(instantToDatetimeLocal(new Date().toISOString(), timezone));
  const useLast = () => {
    if (lastLocal !== null && lastLocal !== '') onChange(lastLocal);
  };
  const shortcuts = (
    <>
      <InlineAction onClick={useNow} ariaLabel={s('useNowAria', { field: label })}>
        {s('useNow')}
      </InlineAction>
      {lastLabel === null ? null : (
        <InlineAction onClick={useLast} ariaLabel={s('useLastAria', { field: label })}>
          {s('useLast', { time: lastLabel })}
        </InlineAction>
      )}
    </>
  );

  const pickerGrid = buildDateRangePickerMonth({
    year: pickerMonth.year,
    month: pickerMonth.month,
    draft: { datePreset: 'custom', from: parts.date, to: parts.date },
    todayDate,
    // An exit cannot be in the future.
    maxDate: todayDate,
  });

  return (
    <div data-exit-time={id} data-value={value} className="flex min-w-0 flex-col gap-2">
      <TradeLauncherRow
        id={id}
        rowRef={rowFocus}
        label={label}
        marker={optionalMarker ? <OptionalTag /> : undefined}
        value={display}
        placeholder={s('notRecorded')}
        error={error}
        editLabel={s('editAria', { field: label })}
        icon={CalendarClock}
        answered={value !== ''}
        onOpen={() => {
          setPickerMonth(monthOf(parts.date, todayDate));
          setPane(null);
          setOpen(true);
        }}
        buttonData={{ 'data-exit-time-row': value }}
      />
      {value === '' ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-1">
          {shortcuts}
        </div>
      ) : null}

      <TradeAdaptiveOverlay
        open={open}
        onOpenChange={setOpen}
        title={label}
        description={s('description', { timezone })}
        closeLabel={s('close')}
        size="focused"
        returnFocusRef={rowFocus}
        footer={
          <div className="flex min-w-0 flex-wrap-reverse items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
              {shortcuts}
              {value === '' ? null : (
                <InlineAction
                  ariaLabel={s('clearAria', { field: label })}
                  onClick={() => {
                    onChange('');
                    setPane(null);
                  }}
                >
                  {s('clear')}
                </InlineAction>
              )}
            </div>
            <Button type="button" size="lg" className="min-h-12" onClick={() => setOpen(false)}>
              {s('done')}
            </Button>
          </div>
        }
      >
        <div data-exit-time-editor={id} className="flex min-w-0 flex-col gap-2">
          <StampRow
            id={`${id}-date`}
            label={s('date')}
            value={
              parts.date === '' ? null : (formatCalendarDateLabel(parts.date, locale) ?? parts.date)
            }
            placeholder={s('notRecorded')}
            raw={parts.date}
            open={pane === 'date'}
            onToggle={() => {
              setPickerMonth(monthOf(parts.date, todayDate));
              setPane((current) => (current === 'date' ? null : 'date'));
            }}
          >
            <div className="flex min-w-0 flex-col gap-2 pt-1">
              <nav
                aria-label={s('monthNav')}
                className="flex min-w-0 items-center justify-between gap-2"
              >
                <MonthStepButton
                  direction="previous"
                  label={s('previousMonth')}
                  onClick={() =>
                    setPickerMonth((current) => shiftCalendarMonth(current.year, current.month, -1))
                  }
                />
                <MonthStepButton
                  direction="next"
                  label={s('nextMonth')}
                  onClick={() =>
                    setPickerMonth((current) => shiftCalendarMonth(current.year, current.month, 1))
                  }
                />
              </nav>
              <DateRangeMonthGrid
                month={pickerGrid}
                monthLabel={formatCalendarMonthLabel(pickerMonth.year, pickerMonth.month, locale)}
                onSelect={(date) => onChange(setTimeDate(value, date))}
                dateLocale={locale}
              />
              {parts.date === '' ? null : (
                <div>
                  <InlineAction onClick={() => onChange(setTimeDate(value, ''))}>
                    {s('clearDate')}
                  </InlineAction>
                </div>
              )}
            </div>
          </StampRow>
          <StampRow
            id={`${id}-time`}
            label={s('time')}
            value={parts.time === '' ? null : parts.time}
            placeholder={s('notRecorded')}
            raw={parts.time}
            open={pane === 'time'}
            onToggle={() => setPane((current) => (current === 'time' ? null : 'time'))}
          >
            <div className="flex min-w-0 flex-col gap-3 pt-1">
              <TradeTimeWheel
                id={`${id}-wheel`}
                value={parts.time}
                onChange={(time) => onChange(setTimeTime(value, time))}
                labels={{ hour: s('hour'), minute: s('minute') }}
              />
              {parts.time === '' ? null : (
                <div>
                  <InlineAction onClick={() => onChange(setTimeTime(value, ''))}>
                    {s('clearTime')}
                  </InlineAction>
                </div>
              )}
            </div>
          </StampRow>
        </div>
      </TradeAdaptiveOverlay>
    </div>
  );
}

/** The shared requirement badge (decision 59), at the right end of the label line. */
function OptionalTag() {
  return <RequirementBadge level="optional" className="ml-auto" />;
}

/** One half of the exit stamp: a disclosure row inside the sheet (Step 1's `EntryStampRow` language). */
function StampRow({
  id,
  label,
  value,
  placeholder,
  raw,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  value: string | null;
  placeholder: string;
  raw: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `${id}-panel`;
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return (
    <div
      data-exit-stamp={id}
      data-value={raw}
      className="bg-muted/50 min-w-0 rounded-lg border border-transparent px-3 py-1"
    >
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={panelId}
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
      <div
        id={panelId}
        data-open={open ? '' : undefined}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility] duration-[var(--motion-surface-enter-duration)] ease-(--motion-ease-standard) motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pb-2">{opened ? children : null}</div>
        </div>
      </div>
    </div>
  );
}

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
      onClick={onClick}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
    >
      <Icon className="size-4" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Actual R — a readout, never a field
// ---------------------------------------------------------------------------

/** Final Net P&L ÷ Risk at Entry. Unknown says what is missing; never a fabricated 0R. */
export function ActualRReadoutRow({
  readout,
  variant = 'lead',
}: {
  readout: ActualRReadout;
  /**
   * `derived` sits under a lead Final Net P&L and stays smaller than it, marked
   * Calculated, so it reads as what the figure above comes to — never as a
   * second input competing with it.
   */
  variant?: 'lead' | 'derived';
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const derived = variant === 'derived';
  return (
    <div
      data-actual-r={readout.status}
      data-actual-r-variant={variant}
      className={cn(
        'border-border flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 border-t',
        derived ? 'items-center pt-3' : 'items-end pt-4',
      )}
    >
      <div className="min-w-0">
        <p className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          {a('result.actualR')}
          {derived ? <Tag tone="context">{a('result.calculated')}</Tag> : null}
        </p>
        <p className="text-subtle-foreground text-xs">{a('result.actualRBasis')}</p>
      </div>
      {readout.status === 'known' ? (
        <p
          className={cn(
            'text-foreground leading-none font-semibold tabular-nums',
            derived ? 'text-xl' : 'text-3xl',
          )}
        >
          {formatR(readout.value)}
        </p>
      ) : (
        <p className="text-muted-foreground min-w-0 text-sm">
          {a(`result.unavailable.${readout.reason}`)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trader Outcome — an explicit Win / BE / Loss, always in view
// ---------------------------------------------------------------------------

export function TraderOutcomeField({
  idPrefix,
  value,
  contradicts,
  hint,
  appearance = 'cards',
  badge,
  onChange,
}: {
  idPrefix: string;
  value: OutcomeValue | null;
  /** The outcome's requirement badge (decision 59): Required wherever it is asked. */
  badge?: ReactNode;
  /** A host's own shorter wording of the outcome hint. */
  hint?: string;
  /**
   * `buttons`: three direct text answers with no radio marker, each chosen
   * one in its own semantic tone — Win positive, BE break-even, Loss negative.
   */
  appearance?: 'cards' | 'buttons';
  /** The choice runs against the Final Net P&L sign — a quiet notice, never a block. */
  contradicts: boolean;
  onChange: (value: OutcomeValue | null) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const c = useTranslations('trades.create.recording.contractEntry');
  return (
    <div data-trader-outcome={value ?? 'unanswered'} className="flex min-w-0 flex-col gap-3">
      <ChoiceGroup
        idPrefix={idPrefix}
        legend={a('result.outcome')}
        value={value}
        status={c('notAnswered')}
        columns={3}
        fit="row"
        appearance={appearance}
        {...(badge === undefined ? {} : { badge })}
        aside={
          <InlineAction ariaLabel={a('result.removeOutcomeAria')} onClick={() => onChange(null)}>
            {c('removeAnswer')}
          </InlineAction>
        }
        onChange={(outcome: OutcomeValue) => onChange(outcome)}
        options={
          appearance === 'buttons'
            ? [
                { value: 'win', label: a('result.win'), tone: 'positive' },
                { value: 'break_even', label: a('result.breakEven'), tone: 'break_even' },
                { value: 'loss', label: a('result.loss'), tone: 'negative' },
              ]
            : [
                { value: 'win', label: a('result.win') },
                { value: 'break_even', label: a('result.breakEven') },
                { value: 'loss', label: a('result.loss') },
              ]
        }
      />
      <Helper>{hint ?? a('result.outcomeHint')}</Helper>
      {contradicts ? (
        <Notice>{value === 'win' ? a('result.winNegative') : a('result.lossPositive')}</Notice>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One exit leg — the answers a Part exit is made of, and All Remaining's closing leg
// ---------------------------------------------------------------------------

export type ExitLegFieldErrors = Partial<
  Record<'exitedAt' | 'pnl' | 'closedPercent' | 'price', string | undefined>
>;

export function exitLegFieldId(idPrefix: string, field: keyof ExitLegDraft): string {
  return `${idPrefix}-${field}`;
}

export function ExitLegFields({
  idPrefix,
  leg,
  currency,
  timezone,
  locale,
  errors,
  lastRecordedExit,
  timeLabel,
  timeRowRef,
  onChange,
}: {
  idPrefix: string;
  leg: ExitLegDraft;
  currency: string;
  timezone: string;
  locale: string;
  errors: ExitLegFieldErrors;
  lastRecordedExit: string | null;
  timeLabel: string;
  timeRowRef?: RefObject<HTMLButtonElement | null>;
  onChange: (patch: Partial<ExitLegDraft>) => void;
}) {
  const s = useTranslations('trades.stage5.leg');
  const c = useTranslations('trades.create.recording.contractEntry');
  return (
    <div data-exit-leg={idPrefix} className="flex min-w-0 flex-col gap-4">
      <ExitTimeField
        id={exitLegFieldId(idPrefix, 'exitedAt')}
        {...(timeRowRef === undefined ? {} : { rowRef: timeRowRef })}
        label={timeLabel}
        value={leg.exitedAt}
        timezone={timezone}
        locale={locale}
        error={errors.exitedAt}
        lastRecordedExit={lastRecordedExit}
        onChange={(exitedAt) => onChange({ exitedAt })}
      />
      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
        <TextField
          id={exitLegFieldId(idPrefix, 'pnl')}
          label={s('pnl')}
          value={leg.pnl}
          onChange={(pnl) => onChange({ pnl })}
          suffix={currency}
          inputMode="decimal"
          figure
          hint={s('pnlHint')}
          error={errors.pnl}
        />
        <TextField
          id={exitLegFieldId(idPrefix, 'closedPercent')}
          label={s('percent')}
          value={leg.closedPercent}
          onChange={(closedPercent) => onChange({ closedPercent })}
          suffix="%"
          inputMode="decimal"
          figure
          error={errors.closedPercent}
        />
        <TextField
          id={exitLegFieldId(idPrefix, 'price')}
          label={s('price')}
          value={leg.price}
          onChange={(price) => onChange({ price })}
          inputMode="decimal"
          figure
          labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
          error={errors.price}
        />
        <TextField
          id={exitLegFieldId(idPrefix, 'reason')}
          label={s('reason')}
          value={leg.reason}
          onChange={(reason) => onChange({ reason })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recorded exits — supporting evidence, each leg kept as it was recorded
// ---------------------------------------------------------------------------

export interface RecordedExitView {
  readonly exitId: string;
  readonly sequence: number;
  readonly exitScope: string | null;
  readonly closedBps: number | null;
  readonly exitPrice: string | null;
  readonly realizedPnlMinor: string | null;
  readonly exitReason: string | null;
  readonly exitedAt: string | null;
}

/** One recorded exit, read-only: which exit, what it closed, and what it records. */
export function RecordedExitSummary({
  exit,
  currency,
  timezone,
  locale,
}: {
  exit: RecordedExitView;
  currency: string;
  timezone: string;
  locale: string;
}) {
  const s = useTranslations('trades.stage5.history');
  const a = useTranslations('trades.create.recording.contractAfter');
  const facts = [
    exit.realizedPnlMinor === null
      ? null
      : `${a('exits.pnl')} ${formatTradeMoney(exit.realizedPnlMinor, currency) ?? ''}`,
    exit.closedBps === null
      ? null
      : `${(exit.closedBps / 100).toFixed(exit.closedBps % 100 === 0 ? 0 : 2)}%`,
    exit.exitPrice === null ? null : `${a('exits.price')} ${exit.exitPrice}`,
    exit.exitedAt === null ? null : formatTradeInstant(exit.exitedAt, timezone, locale),
  ].filter((fact): fact is string => fact !== null && fact !== '');
  return (
    <>
      <p className="text-foreground text-sm font-semibold">
        {a('exits.exitNumber', { number: exit.sequence })}
        {exit.exitScope === 'part' ? (
          <span className="text-muted-foreground font-normal"> · {a('exits.scopePart')}</span>
        ) : null}
      </p>
      <p className="text-muted-foreground text-sm tabular-nums">
        {facts.length === 0 ? s('noDetail') : facts.join(' · ')}
      </p>
      {exit.exitReason === null ? null : (
        <p className="text-muted-foreground text-sm">{exit.exitReason}</p>
      )}
    </>
  );
}

export function RecordedExitsList({
  exits,
  currency,
  timezone,
  locale,
}: {
  exits: readonly RecordedExitView[];
  currency: string;
  timezone: string;
  locale: string;
}) {
  const s = useTranslations('trades.stage5.history');
  if (exits.length === 0) {
    return <p className="text-muted-foreground text-sm">{s('none')}</p>;
  }
  return (
    <ol data-recorded-exits="" className="flex min-w-0 flex-col gap-2">
      {exits.map((exit) => (
        <li
          key={exit.exitId}
          data-recorded-exit={exit.sequence}
          className="border-border flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2.5"
        >
          <RecordedExitSummary
            exit={exit}
            currency={currency}
            timezone={timezone}
            locale={locale}
          />
        </li>
      ))}
    </ol>
  );
}

/**
 * "RECORD EACH EXIT" FOR A FINAL CLOSE — Record Closed's exit list, as this
 * lifecycle has it. The exits recorded while the Trade was open are listed as
 * they were recorded (read-only: they are saved history), and the one exit
 * this close adds follows them. That exit closes whatever is left, so its
 * scope is All remaining by definition, never asked; its time is the final
 * exit time, asked once on its own. The status line above reads exactly as
 * Record Closed's.
 */
export function ClosingExitsEditor({
  recorded,
  closing,
  leg,
  idPrefix,
  currency,
  timezone,
  locale,
  errors,
  onChange,
}: {
  recorded: readonly RecordedExitView[];
  closing: ClosingState;
  leg: ExitLegDraft;
  idPrefix: string;
  currency: string;
  timezone: string;
  locale: string;
  errors: ExitLegFieldErrors;
  onChange: (patch: Partial<ExitLegDraft>) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const c = useTranslations('trades.create.recording.contractEntry');
  const s = useTranslations('trades.stage5.history');
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-3">
      <ClosingStatusLine closing={closing} />
      <ol className="divide-border flex min-w-0 flex-col divide-y">
        {recorded.map((exit) => (
          <li
            key={exit.exitId}
            data-recorded-exit={exit.sequence}
            className="flex min-w-0 flex-col gap-1 py-4 first:pt-0"
          >
            <RecordedExitSummary
              exit={exit}
              currency={currency}
              timezone={timezone}
              locale={locale}
            />
          </li>
        ))}
        <li data-closing-exit="" className="flex min-w-0 flex-col gap-4 py-4 first:pt-0">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-foreground flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
              {a('exits.exitNumber', { number: recorded.length + 1 })}
              <Tag tone="context">{a('exits.scopeAll')}</Tag>
            </p>
            <p className="text-muted-foreground text-xs">{s('closingLegHint')}</p>
          </div>
          <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
            <TextField
              id={exitLegFieldId(idPrefix, 'pnl')}
              label={a('exits.pnl')}
              value={leg.pnl}
              onChange={(pnl) => onChange({ pnl })}
              suffix={currency}
              inputMode="decimal"
              figure
              error={errors.pnl}
            />
            <TextField
              id={exitLegFieldId(idPrefix, 'closedPercent')}
              label={a('exits.percent')}
              value={leg.closedPercent}
              onChange={(closedPercent) => onChange({ closedPercent })}
              suffix="%"
              inputMode="decimal"
              figure
              error={errors.closedPercent}
            />
            <TextField
              id={exitLegFieldId(idPrefix, 'price')}
              label={a('exits.price')}
              value={leg.price}
              onChange={(price) => onChange({ price })}
              inputMode="decimal"
              figure
              labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
              error={errors.price}
            />
          </div>
          <TextField
            id={exitLegFieldId(idPrefix, 'reason')}
            label={a('exits.reason')}
            value={leg.reason}
            onChange={(reason) => onChange({ reason })}
          />
        </li>
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The Trader Result, as one step: outcome, result, final exit time
// ---------------------------------------------------------------------------

/** THE OUTCOME LEADS: the trader's own Win / BE / Loss, which the P&L never fills in. */
export function TraderOutcomeCard({
  idPrefix,
  value,
  contradicts,
  onChange,
}: {
  idPrefix: string;
  value: OutcomeValue | null;
  contradicts: boolean;
  onChange: (value: OutcomeValue | null) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  return (
    <GroupCard data-result-outcome="">
      <TraderOutcomeField
        idPrefix={idPrefix}
        value={value}
        contradicts={contradicts}
        hint={a('result.outcomeHintShort')}
        appearance="buttons"
        badge={<RequirementBadge level="required" />}
        onChange={onChange}
      />
    </GroupCard>
  );
}

/** FINAL EXIT TIME: its own launcher, outside the result card — when it closed, not what it made. */
export function FinalExitTimeRow(props: Parameters<typeof ExitTimeField>[0]) {
  return (
    <div data-result-exit-time="" className="min-w-0">
      <ExitTimeField {...props} />
    </div>
  );
}

/** A signed amount: a gain reads with its plus sign, so it is never mistaken for a loss. */
export function signedMoney(minor: string, format: (minor: string) => string): string {
  return BigInt(minor) > 0n ? `+${format(minor)}` : format(minor);
}

/**
 * WHAT A CLOSE WITH NO FINAL RESULT IS WAITING FOR — the key under
 * `contractAfter.close.result`, read the same way wherever the result is shown.
 */
export function closingWaitingKey(
  closing: ClosingState,
):
  | 'waitingForClose'
  | 'waitingForPnl'
  | 'waitingForPartsChoice'
  | 'waitingForStatedTotal'
  | 'waitingForEveryPnl'
  | 'waitingForAllocation'
  | 'waitingForRemaining' {
  if (closing.mode === 'unanswered') return 'waitingForClose';
  if (closing.mode === 'all_at_once') return 'waitingForPnl';
  if (closing.partsResult === 'unanswered') return 'waitingForPartsChoice';
  if (closing.partsResult === 'total_only') return 'waitingForStatedTotal';
  if (closing.missingPnl) return 'waitingForEveryPnl';
  return closing.accountedBps === null ? 'waitingForAllocation' : 'waitingForRemaining';
}

export interface TradeResultIds {
  /** Focus anchor for the whole card. */
  readonly anchor: string;
  readonly closeMode: string;
  readonly partsResult: string;
  /** "Closed all at once": the one close's fields. */
  readonly fullClose: { readonly pnl: string; readonly price: string; readonly reason: string };
  /** "I only know the final result". */
  readonly statedTotal: string;
}

/**
 * THE TRADE RESULT IS HOW THE TRADE CLOSED (decisions 57–58). One source:
 * the close. "Closed all at once" is one exit whose P&L is the Final Net P&L;
 * "Closed in parts" is recorded exit by exit — their sum is the result once
 * they prove the close — or as the one total the trader knows. The result
 * below the answers is read-only, never typed beside the close.
 *
 * `closedInParts` is a lifecycle fact, not an answer: a Trade whose exits
 * are already recorded was closed in parts, so the first question is replaced
 * by what the recorded exits say. `eachExit` is the host's exit editor.
 */
export function TradeResultCard({
  ids,
  currency,
  closeMode,
  closedInParts = null,
  partsResult,
  fullClose,
  fullCloseErrors,
  statedTotal,
  statedTotalError,
  eachExit,
  closing,
  finalPnlMinor,
  actualR,
  formatMoney,
  onCloseMode,
  onPartsResult,
  onFullClose,
  onStatedTotal,
}: {
  ids: TradeResultIds;
  currency: string;
  closeMode: CloseMode;
  /** Said instead of asking how it closed, when recorded exits already prove it. */
  closedInParts?: ReactNode;
  partsResult: PartsResult;
  fullClose: { readonly pnl: string; readonly price: string; readonly reason: string };
  fullCloseErrors: { readonly pnl?: string | undefined; readonly price?: string | undefined };
  statedTotal: string;
  statedTotalError?: string | undefined;
  eachExit: ReactNode;
  closing: ClosingState;
  finalPnlMinor: string | null;
  actualR: ActualRReadout;
  formatMoney: (minor: string) => string;
  onCloseMode: (mode: CloseMode) => void;
  onPartsResult: (mode: PartsResult) => void;
  onFullClose: (patch: Partial<{ pnl: string; price: string; reason: string }>) => void;
  onStatedTotal: (value: string) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const c = useTranslations('trades.create.recording.contractEntry');
  return (
    <GroupCard
      filled
      title={a('sections.tradeResult')}
      aside={<RequirementBadge level="required" />}
      data-result-panel=""
    >
      <div id={ids.anchor} tabIndex={-1} className="min-w-0 outline-none">
        {closedInParts === null ? (
          <ChoiceGroup
            idPrefix={ids.closeMode}
            legend={a('close.question')}
            value={closeMode === 'unanswered' ? null : closeMode}
            status={c('notAnswered')}
            columns={2}
            compact
            fit="row"
            aside={
              <InlineAction
                ariaLabel={a('close.removeAria')}
                onClick={() => onCloseMode('unanswered')}
              >
                {c('removeAnswer')}
              </InlineAction>
            }
            onChange={onCloseMode}
            options={[
              { value: 'all_at_once', label: a('close.allAtOnce') },
              { value: 'in_parts', label: a('close.inParts') },
            ]}
          />
        ) : (
          <div data-closed-in-parts="" className="flex min-w-0 flex-col gap-1">
            <p className="text-muted-foreground text-[0.8125rem] font-medium">
              {a('close.question')}
            </p>
            <p className="text-foreground text-base font-semibold">{a('close.inParts')}</p>
            <p className="text-muted-foreground text-xs">{closedInParts}</p>
          </div>
        )}
      </div>

      {closeMode === 'all_at_once' ? (
        <FullCloseFields
          ids={ids.fullClose}
          value={fullClose}
          currency={currency}
          errors={fullCloseErrors}
          onChange={onFullClose}
        />
      ) : null}

      {closeMode === 'in_parts' ? (
        <ChoiceGroup
          idPrefix={ids.partsResult}
          legend={a('close.partsQuestion')}
          value={partsResult === 'unanswered' ? null : partsResult}
          status={c('notAnswered')}
          columns={2}
          compact
          fit="row"
          aside={
            <InlineAction
              ariaLabel={a('close.partsRemoveAria')}
              onClick={() => onPartsResult('unanswered')}
            >
              {c('removeAnswer')}
            </InlineAction>
          }
          onChange={onPartsResult}
          options={[
            { value: 'each_exit', label: a('close.eachExit') },
            { value: 'total_only', label: a('close.totalOnly') },
          ]}
        />
      ) : null}

      {closeMode === 'in_parts' && partsResult === 'each_exit' ? eachExit : null}

      {closeMode === 'in_parts' && partsResult === 'total_only' ? (
        <TextField
          id={ids.statedTotal}
          label={a('close.statedTotal')}
          value={statedTotal}
          onChange={onStatedTotal}
          suffix={currency}
          inputMode="decimal"
          size="lead"
          figure
          hint={a('close.statedTotalHint')}
          error={statedTotalError}
        />
      ) : null}

      <FinalResultReadout
        closing={closing}
        finalPnlMinor={finalPnlMinor}
        actualR={actualR}
        formatMoney={formatMoney}
      />
    </GroupCard>
  );
}

/** "Closed all at once": the one close — its P&L is the whole Trade's. */
function FullCloseFields({
  ids,
  value,
  currency,
  errors,
  onChange,
}: {
  ids: TradeResultIds['fullClose'];
  value: { readonly pnl: string; readonly price: string; readonly reason: string };
  currency: string;
  errors: { readonly pnl?: string | undefined; readonly price?: string | undefined };
  onChange: (patch: Partial<{ pnl: string; price: string; reason: string }>) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const c = useTranslations('trades.create.recording.contractEntry');
  return (
    <div data-full-close="" className="flex min-w-0 flex-col gap-4">
      <TextField
        id={ids.pnl}
        label={a('close.pnl')}
        value={value.pnl}
        onChange={(pnl) => onChange({ pnl })}
        suffix={currency}
        inputMode="decimal"
        size="lead"
        figure
        hint={a('close.pnlHint')}
        error={errors.pnl}
      />
      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
        <TextField
          id={ids.price}
          label={a('exits.price')}
          value={value.price}
          onChange={(price) => onChange({ price })}
          inputMode="decimal"
          figure
          labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
          error={errors.price}
        />
        <TextField
          id={ids.reason}
          label={a('exits.reason')}
          value={value.reason}
          onChange={(reason) => onChange({ reason })}
        />
      </div>
    </div>
  );
}

/**
 * WHERE THE CLOSE IN PARTS STANDS, above its exits: fully closed, or how much
 * of the position the exits account for and what remains — or, when an exit
 * states no share, that the allocation is unknown. Never an estimate.
 */
export function ClosingStatusLine({ closing }: { closing: ClosingState }) {
  const s = useTranslations('trades.create.recording.contractAfter.close.status');
  const bps = closing.accountedBps;
  const state =
    closing.exitCount === 0
      ? 'none'
      : closing.closed
        ? 'closed'
        : bps === null
          ? 'unknown'
          : 'partial';
  return (
    <div
      data-closing-status={state}
      data-accounted-bps={bps ?? 'unknown'}
      aria-live="polite"
      className="flex min-w-0 flex-col gap-1.5"
    >
      <p className="text-foreground text-sm font-semibold">
        {state === 'none'
          ? s('none')
          : state === 'closed'
            ? s('closed')
            : state === 'unknown'
              ? s('unknown')
              : s('partial', { percent: formatShare(bps ?? 0) })}
      </p>
      {state === 'none' || bps === null ? null : (
        <span
          aria-hidden="true"
          className="bg-muted block h-1.5 w-full max-w-60 overflow-hidden rounded-full"
        >
          <span
            className="bg-primary block h-full rounded-full"
            style={{ width: `${Math.min(bps, 10_000) / 100}%` }}
          />
        </span>
      )}
      {state === 'none' ? null : (
        <p className="text-muted-foreground text-xs">
          {state === 'partial'
            ? s('partialDetail', {
                count: closing.exitCount,
                percent: formatShare(10_000 - (bps ?? 0)),
              })
            : state === 'unknown'
              ? s('unknownDetail', { count: closing.exitCount })
              : s('closedDetail', { count: closing.exitCount })}
        </p>
      )}
    </div>
  );
}

/**
 * THE RESULT, READ-ONLY. The Final Net P&L exists only once the close proves
 * the whole position closed and every exit states its P&L — or the trader
 * states the total; until then this shows what was recorded so far, named as
 * such, and what the result is waiting for. Trader R follows the Final Net
 * P&L, never a running figure.
 */
function FinalResultReadout({
  closing,
  finalPnlMinor,
  actualR,
  formatMoney,
}: {
  closing: ClosingState;
  finalPnlMinor: string | null;
  actualR: ActualRReadout;
  formatMoney: (minor: string) => string;
}) {
  const s = useTranslations('trades.create.recording.contractAfter.close.result');
  const waiting = s(closingWaitingKey(closing));
  return (
    <div
      data-final-result={finalPnlMinor === null ? 'waiting' : 'final'}
      className="border-border flex min-w-0 flex-col gap-3 border-t pt-4"
    >
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {s('title')}
      </p>
      {finalPnlMinor === null ? (
        <div className="flex min-w-0 flex-col gap-1">
          {closing.recordedSoFarMinor === null ? null : (
            <p data-recorded-so-far="" className="text-foreground text-sm tabular-nums">
              {s('recordedSoFar', {
                amount: signedMoney(closing.recordedSoFarMinor, formatMoney),
              })}
            </p>
          )}
          <p className="text-muted-foreground text-sm">{waiting}</p>
        </div>
      ) : (
        <div
          data-final-pnl-provenance={closing.source ?? undefined}
          className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
        >
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm font-medium">{s('finalPnl')}</p>
            {/* Where the one result came from, said once. */}
            <p className="text-subtle-foreground text-xs">
              {closing.source === 'stated_total'
                ? s('fromStatedTotal')
                : closing.source === 'exit_legs'
                  ? s('fromExits')
                  : s('fromFullClose')}
            </p>
          </div>
          <p
            data-final-pnl=""
            className="text-foreground text-2xl leading-none font-semibold tabular-nums"
          >
            {signedMoney(finalPnlMinor, formatMoney)}
          </p>
        </div>
      )}
      <ActualRReadoutRow readout={actualR} variant="derived" />
    </div>
  );
}
