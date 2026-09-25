'use client';

import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, History } from 'lucide-react';
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

import { entryTimestampParts } from './after-trade-draft';
import {
  setTimeDate,
  setTimeTime,
  type ActualRReadout,
  type ExitLegDraft,
} from './close-trade-draft';
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
import { TradeTimeWheel } from './trade-time-wheel';

/**
 * CANONICAL STAGE 5 — EXIT & RESULT, the shared pieces (Add Trade contract
 * §10–§12; UX Rules §20). Close Existing Open Trade (Part / All Remaining) and
 * Record Closed read with the same controls:
 *
 *   final exit date & time → Final Net P&L → Actual R (derived) →
 *   Trader Outcome → exit detail / history (supporting evidence)
 *
 * They own no semantics. Every answer goes back through the host's draft, and
 * nothing here fills one in: a time starts unanswered, "Use now" and "Use last
 * recorded exit time" are named actions, and the Final Net P&L becomes the
 * exit subtotal only through "Use recorded exits".
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

function OptionalTag() {
  const s = useTranslations('trades.stage5');
  return <Tag tone="context">{s('optional')}</Tag>;
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
// Final Net P&L — authoritative, with its source said plainly
// ---------------------------------------------------------------------------

export type FinalPnlSource = 'typed' | 'adopted';

/**
 * THE WHOLE TRADE'S RESULT, AS THE TRADER STATES IT. Never derived from price.
 * When the recorded exits can stand in for it (a Complete history, every leg
 * priced), "Use recorded exits" offers the subtotal — and the line under the
 * figure says where the figure now comes from, so an adopted value never reads
 * as one the trader typed.
 */
export function FinalPnlField({
  id,
  value,
  currency,
  error,
  source,
  adoptable,
  subtotal,
  subtotalBlocked,
  quiet = false,
  onChange,
  onAdopt,
}: {
  id: string;
  value: string;
  currency: string;
  error?: string | undefined;
  /** Where the figure shown came from; `null` while nothing is recorded. */
  source: FinalPnlSource | null;
  /** "Use recorded exits" may be offered right now. */
  adoptable: boolean;
  /** The recorded exit subtotal, formatted, when every leg carries P&L. */
  subtotal: string | null;
  /** Why the subtotal cannot be offered yet, when that is worth saying. */
  subtotalBlocked: string | null;
  /**
   * The step's lead answer, said once: no Optional tag, the short hint, and a
   * source line only when the figure was adopted — a typed figure is plainly
   * the trader's own. Close Trade keeps the full wording.
   */
  quiet?: boolean;
  onChange: (value: string) => void;
  onAdopt: () => void;
}) {
  const s = useTranslations('trades.stage5.pnl');
  return (
    <div data-final-pnl-source={source ?? 'none'} className="flex min-w-0 flex-col gap-2">
      <TextField
        id={id}
        label={s('label')}
        value={value}
        onChange={onChange}
        suffix={currency}
        inputMode="decimal"
        size="lead"
        figure
        hint={quiet ? s('hintShort') : s('hint', { currency })}
        error={error}
        labelAside={quiet ? undefined : <OptionalTag />}
      />
      {source === null || (quiet && source === 'typed') ? null : (
        <p data-final-pnl-source-line="" className="text-muted-foreground text-xs">
          {s(source === 'adopted' ? 'sourceAdopted' : 'sourceTyped')}
        </p>
      )}
      {adoptable && subtotal !== null ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-muted-foreground text-sm tabular-nums">
            {s('subtotal', { amount: subtotal })}
          </span>
          <InlineAction onClick={onAdopt}>{s('useRecorded')}</InlineAction>
        </div>
      ) : subtotalBlocked === null ? null : (
        <p className="text-muted-foreground text-xs">{subtotalBlocked}</p>
      )}
    </div>
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
  onChange,
}: {
  idPrefix: string;
  value: OutcomeValue | null;
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
  const a = useTranslations('trades.create.recording.contractAfter');
  if (exits.length === 0) {
    return <p className="text-muted-foreground text-sm">{s('none')}</p>;
  }
  return (
    <ol data-recorded-exits="" className="flex min-w-0 flex-col gap-2">
      {exits.map((exit) => {
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
          <li
            key={exit.exitId}
            data-recorded-exit={exit.sequence}
            className="border-border flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2.5"
          >
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
          </li>
        );
      })}
    </ol>
  );
}

/** A quiet, non-blocking discrepancy note (contract §11). */
export function ExitDiscrepancyNotice({ children }: { children: ReactNode }) {
  return (
    <Notice
      icon={<History className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />}
    >
      {children}
    </Notice>
  );
}
