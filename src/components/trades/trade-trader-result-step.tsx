'use client';

import { ArrowLeft, ChevronDown, ChevronRight, Flag, Layers, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';

import { generateId } from '@/lib/identifiers';
import { HISTORICAL_EXIT_LIMIT } from '@/lib/trades/schemas';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import {
  addExit,
  canAddExit,
  exitField,
  FULL_CLOSE_EXIT_ID,
  meaningfulExit,
  removeExit,
  setCloseMode,
  setOutcome,
  setPartsResult,
  setStatedTotal,
  updateExit,
  updateFullClose,
  type AfterTradeDraft,
  type AfterTradeExitDraft,
  type AfterTradeField,
  type AfterTradeValidation,
} from './after-trade-draft';
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
import { TradeChoiceList } from './trade-choice-list';
import { closingWaitingKey, FinalExitTimeRow, signedMoney } from './trade-exit-result-step';
import { parseTradeMoneyInput } from './trade-form-values';
import { formatR } from './trade-format';
import { TradeLauncherRow } from './trade-launcher-row';
import { SummaryCard, SummaryLine } from './trade-planned-summary';

/** The ids Step 5 renders: its three rows, and the inputs inside the editors they open. */
export const TRADER_RESULT_IDS = {
  outcomeRow: 'after-outcome-row',
  closingRow: 'after-closing-row',
  exitTime: 'after-exitedAt',
  outcome: 'after-outcome',
  closeMode: 'after-close-mode',
  partsResult: 'after-parts-result',
  statedTotal: 'after-finalPnl',
  addExit: 'after-add-exit',
  exitBack: 'after-exit-back',
} as const;

/** An exit's own input id — the ids Record Closed has always used. */
export function exitInputId(id: string, part: string): string {
  return `after-exit-${id}-${part}`;
}

function exitRowId(id: string): string {
  return `after-exit-row-${id}`;
}

/** Whether a field is answered inside the Closing details editor. */
export function isClosingField(field: AfterTradeField): boolean {
  return field.startsWith('exit:') || field === 'exits' || field === 'finalPnl';
}

type Editor = null | 'outcome' | 'closing';
type ClosingView = { readonly kind: 'overview' } | { readonly kind: 'exit'; readonly id: string };

/**
 * CANONICAL STEP 5 — TRADER RESULT for Record Closed, read the way Steps 1–4
 * are read (UX Rules §20.4): an overview of launcher rows, each reading back
 * what is recorded and opening the one focused editor that records it, then a
 * read-only summary beneath them.
 *
 *   Outcome            → the trader's own Win / BE / Loss (never from the P&L)
 *   Closing details    → how the trade closed, and what the close made
 *   Final exit time    → when it finally closed
 *   Trade result       → Net P&L and Trader R, read back — never typed
 *
 * PROGRESSIVE DISCLOSURE. The overview never holds a form. Closing details
 * opens one editor that asks the close question first and reveals only the
 * chosen way's answers; recorded exit by exit, the exits are a list, and each
 * exit opens in the same editor on its own. Nothing changes meaning: every
 * answer goes through the host draft's own transitions, each way of closing
 * keeps its answers when another is chosen, and only the chosen way is saved
 * (decisions 57–58).
 */
export function TradeTraderResultStep({
  draft,
  validation,
  outcomeContradicts,
  currency,
  timezone,
  locale,
  lastRecordedExit,
  errorText,
  closingErrorCount,
  formatMoney,
  apply,
}: {
  draft: AfterTradeDraft;
  validation: Pick<AfterTradeValidation, 'closing' | 'finalPnlMinor' | 'actualR'>;
  outcomeContradicts: boolean;
  currency: string;
  timezone: string;
  locale: string;
  lastRecordedExit: string | null;
  errorText: (field: AfterTradeField) => string | undefined;
  /** Close answers that need attention right now, for the Closing details row. */
  closingErrorCount: number;
  formatMoney: (minor: string) => string;
  apply: (update: (current: AfterTradeDraft) => AfterTradeDraft) => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const c = useTranslations('trades.create.recording.contractEntry');
  const [editor, setEditor] = useState<Editor>(null);
  const outcomeRow = useRef<HTMLButtonElement>(null);
  const closingRow = useRef<HTMLButtonElement>(null);
  const { closing } = validation;

  const outcomeLabel =
    draft.outcome === 'win'
      ? a('result.win')
      : draft.outcome === 'break_even'
        ? a('result.breakEven')
        : draft.outcome === 'loss'
          ? a('result.loss')
          : null;

  /*
    WHAT THE CLOSE ROW SAYS: the way it closed, then what it made — only ever
    a figure the answers hold, never a running total named as the result.
  */
  const fullClosePnl =
    draft.closeMode === 'all_at_once' && validation.finalPnlMinor !== null
      ? signedMoney(validation.finalPnlMinor, formatMoney)
      : null;
  const recordedExits = draft.exits.filter(meaningfulExit).length;
  const closingValue =
    draft.closeMode === 'unanswered'
      ? null
      : draft.closeMode === 'all_at_once'
        ? r('closing.allAtOnce')
        : draft.partsResult === 'each_exit'
          ? recordedExits === 0
            ? r('closing.eachExitNone')
            : r('closing.eachExit', { count: recordedExits })
          : draft.partsResult === 'total_only'
            ? r('closing.totalOnly')
            : r('closing.inParts');
  // The figure the close made reads on the second line, so the row never truncates it.
  const closingSupport =
    draft.closeMode === 'all_at_once'
      ? fullClosePnl
      : draft.closeMode !== 'in_parts'
        ? null
        : draft.partsResult === 'total_only'
          ? validation.finalPnlMinor === null
            ? null
            : r('closing.stated', { amount: signedMoney(validation.finalPnlMinor, formatMoney) })
          : draft.partsResult === 'each_exit' && validation.finalPnlMinor !== null
            ? signedMoney(validation.finalPnlMinor, formatMoney)
            : null;

  return (
    <div data-trader-result-step="" className="flex min-w-0 flex-col gap-3">
      {/* 1 — OUTCOME: the trader's own call. */}
      <div className="flex min-w-0 flex-col gap-2">
        <TradeLauncherRow
          id={TRADER_RESULT_IDS.outcomeRow}
          rowRef={outcomeRow}
          label={r('outcomeLabel')}
          marker={<RequirementBadge level="required" className="ml-auto" />}
          value={outcomeLabel}
          placeholder={c('notAnswered')}
          editLabel={a('trade.editAria', { field: r('outcomeLabel') })}
          icon={Flag}
          answered={outcomeLabel !== null}
          onOpen={() => setEditor('outcome')}
          buttonData={{ 'data-result-row': 'outcome', 'data-outcome': draft.outcome ?? '' }}
        />
        {/* A choice against the P&L sign is allowed; it is said once, quietly. */}
        {outcomeContradicts ? (
          <Notice>
            {draft.outcome === 'win' ? a('result.winNegative') : a('result.lossPositive')}
          </Notice>
        ) : null}
      </div>

      {/* 2 — CLOSING DETAILS: how it closed, and what the close made. */}
      <TradeLauncherRow
        id={TRADER_RESULT_IDS.closingRow}
        rowRef={closingRow}
        label={r('closingLabel')}
        marker={<RequirementBadge level="required" className="ml-auto" />}
        value={closingValue}
        support={closingSupport}
        placeholder={c('notAnswered')}
        error={
          closingErrorCount === 0 ? undefined : c('summary.hasErrors', { count: closingErrorCount })
        }
        editLabel={a('trade.editAria', { field: r('closingLabel') })}
        icon={Layers}
        answered={closingValue !== null}
        onOpen={() => setEditor('closing')}
        buttonData={{
          'data-result-row': 'closing',
          'data-close-mode': draft.closeMode,
          'data-parts-result': draft.partsResult,
        }}
      />

      {/* 3 — FINAL EXIT TIME: when it finally closed — its own launcher. */}
      <FinalExitTimeRow
        id={TRADER_RESULT_IDS.exitTime}
        label={a('times.exit')}
        value={draft.exitedAt}
        timezone={timezone}
        locale={locale}
        error={errorText('exitedAt')}
        lastRecordedExit={lastRecordedExit}
        onChange={(exitedAt) => apply((current) => ({ ...current, exitedAt }))}
      />

      {/* THE RESULT AT A GLANCE — read back from the answers above, never typed. */}
      <TradeResultSummary validation={validation} formatMoney={formatMoney} />

      <TradeAdaptiveOverlay
        open={editor === 'outcome'}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
        title={r('outcomeLabel')}
        description={r('outcomeEditor')}
        hideDescription
        closeLabel={a('trade.close')}
        size="compact"
        returnFocusRef={outcomeRow}
      >
        {/*
          ONE QUESTION, ONE ANSWER: choosing it is the whole interaction, as
          Direction's is — written to the draft, and the sheet closes on the
          same tap; focus returns to the Outcome row. Buttons, not radios, so
          the arrow keys never commit an answer while the trader looks.
        */}
        <div data-outcome-editor="" className="flex min-w-0 flex-col gap-3">
          <TradeChoiceList
            label={r('outcomeLabel')}
            columns={3}
            emphasis="accent"
            value={draft.outcome}
            onChoose={(outcome) => {
              apply((current) => setOutcome(current, outcome));
              setEditor(null);
            }}
            options={[
              { value: 'win', label: a('result.win') },
              { value: 'break_even', label: a('result.breakEven') },
              { value: 'loss', label: a('result.loss') },
            ]}
          />
          <Helper>{a('result.outcomeHintShort')}</Helper>
          {draft.outcome === null ? null : (
            <div>
              <InlineAction
                ariaLabel={a('result.removeOutcomeAria')}
                onClick={() => {
                  apply((current) => setOutcome(current, null));
                  setEditor(null);
                }}
              >
                {c('removeAnswer')}
              </InlineAction>
            </div>
          )}
        </div>
      </TradeAdaptiveOverlay>

      <ClosingDetailsEditor
        open={editor === 'closing'}
        draft={draft}
        closing={closing}
        finalPnlMinor={validation.finalPnlMinor}
        currency={currency}
        errorText={errorText}
        formatMoney={formatMoney}
        returnFocusRef={closingRow}
        apply={apply}
        onClose={() => setEditor(null)}
      />
    </div>
  );
}

/**
 * THE TRADE RESULT, READ BACK: Net P&L and Trader R, with one short line for
 * why a figure is not there yet — or where the one that is came from.
 */
function TradeResultSummary({
  validation,
  formatMoney,
}: {
  validation: Pick<AfterTradeValidation, 'closing' | 'finalPnlMinor' | 'actualR'>;
  formatMoney: (minor: string) => string;
}) {
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const a = useTranslations('trades.create.recording.contractAfter');
  const res = useTranslations('trades.create.recording.contractAfter.close.result');
  const { closing, finalPnlMinor, actualR } = validation;
  const pnl = finalPnlMinor === null ? null : signedMoney(finalPnlMinor, formatMoney);
  const traderR = actualR.status === 'known' ? formatR(actualR.value) : null;
  const footnote =
    finalPnlMinor === null
      ? [
          closing.recordedSoFarMinor === null
            ? null
            : res('recordedSoFar', {
                amount: signedMoney(closing.recordedSoFarMinor, formatMoney),
              }),
          closing.mode === 'in_parts' &&
          closing.partsResult === 'each_exit' &&
          closing.exitCount === 0
            ? r('exits.waitingForExits')
            : res(closingWaitingKey(closing)),
        ]
          .filter((part) => part !== null)
          .join(' ')
      : actualR.status === 'unavailable'
        ? a(`result.unavailable.${actualR.reason}`)
        : closing.source === 'stated_total'
          ? res('fromStatedTotal')
          : closing.source === 'exit_legs'
            ? res('fromExits')
            : res('fromFullClose');
  return (
    <SummaryCard
      title={r('summary.title')}
      data={{ 'data-result-summary': finalPnlMinor === null ? 'waiting' : 'final' }}
      footnote={footnote}
    >
      <SummaryLine
        label={r('summary.netPnl')}
        value={pnl ?? '—'}
        data="netPnl"
        muted={pnl === null}
      />
      <SummaryLine
        label={r('summary.traderR')}
        value={traderR ?? '—'}
        data="traderR"
        muted={traderR === null}
      />
    </SummaryCard>
  );
}

/**
 * CLOSING DETAILS — one focused editor, asked in order: how the trade closed;
 * for a close in parts, how its result is recorded; then only that way's
 * answers. Recorded exit by exit, the exits are a list, and each opens in
 * this same editor on its own, with a way back to the list.
 *
 * EVERY KEYSTROKE IS ALREADY IN THE DRAFT, so Done, X, Escape and the
 * backdrop all keep what was typed. An exit opened and left without a single
 * answer holds nothing to keep, so it is not left behind as an empty row.
 */
function ClosingDetailsEditor({
  open,
  draft,
  closing,
  finalPnlMinor,
  currency,
  errorText,
  formatMoney,
  returnFocusRef,
  apply,
  onClose,
}: {
  open: boolean;
  draft: AfterTradeDraft;
  closing: AfterTradeValidation['closing'];
  finalPnlMinor: string | null;
  currency: string;
  errorText: (field: AfterTradeField) => string | undefined;
  formatMoney: (minor: string) => string;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  apply: (update: (current: AfterTradeDraft) => AfterTradeDraft) => void;
  onClose: () => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const c = useTranslations('trades.create.recording.contractEntry');
  const [view, setView] = useState<ClosingView>({ kind: 'overview' });
  const openId = view.kind === 'exit' ? view.id : null;
  const listed = listedExits(draft.exits, openId);
  const exitIndex = openId === null ? -1 : listed.findIndex((item) => item.id === openId);
  const exit = exitIndex === -1 ? null : (listed[exitIndex] ?? null);
  const finalExit = exit !== null && exitIndex === listed.length - 1;

  /** Leaves an exit's own view; an exit with no answers is not kept as an empty row. */
  function leaveExit(focus: 'row' | 'add' | 'none') {
    if (view.kind !== 'exit') return;
    const id = view.id;
    const shown = draft.exits.find((item) => item.id === id);
    const kept = shown !== undefined && meaningfulExit(shown);
    if (!kept) {
      apply((current) => {
        const found = current.exits.find((item) => item.id === id);
        return found === undefined || meaningfulExit(found) ? current : removeExit(current, id);
      });
    }
    setView({ kind: 'overview' });
    if (focus === 'none') return;
    requestAnimationFrame(() =>
      document
        .getElementById(focus === 'row' && kept ? exitRowId(id) : TRADER_RESULT_IDS.addExit)
        ?.focus(),
    );
  }

  function close() {
    leaveExit('none');
    onClose();
  }

  function openExit(id: string) {
    setView({ kind: 'exit', id });
    requestAnimationFrame(() => document.getElementById(TRADER_RESULT_IDS.exitBack)?.focus());
  }

  function recordExit() {
    const id = generateId();
    apply((current) => addExit(current, id));
    openExit(id);
  }

  const number = exitIndex + 1;
  const title =
    exit === null
      ? r('closingLabel')
      : finalExit
        ? r('exits.finalExit')
        : a('exits.exitNumber', { number });
  const description = exit === null ? r('closingEditor') : r('exits.editor');

  return (
    <TradeAdaptiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={title}
      description={description}
      closeLabel={a('trade.close')}
      size="focused"
      returnFocusRef={returnFocusRef}
      footer={
        <div className="flex min-w-0 flex-wrap-reverse items-center justify-between gap-3">
          {exit === null ? (
            draft.closeMode === 'unanswered' ? (
              <span />
            ) : (
              // Clearing the close answer keeps every way's answers, as it always has.
              <InlineAction
                ariaLabel={a('close.removeAria')}
                onClick={() => apply((current) => setCloseMode(current, 'unanswered'))}
              >
                {c('removeAnswer')}
              </InlineAction>
            )
          ) : (
            <InlineAction
              ariaLabel={a('exits.removeAria', { number })}
              onClick={() => {
                const id = exit.id;
                apply((current) => removeExit(current, id));
                setView({ kind: 'overview' });
                requestAnimationFrame(() =>
                  document.getElementById(TRADER_RESULT_IDS.addExit)?.focus(),
                );
              }}
            >
              {a('exits.remove')}
            </InlineAction>
          )}
          <Button type="button" onClick={() => (exit === null ? close() : leaveExit('row'))}>
            {a('trade.done')}
          </Button>
        </div>
      }
    >
      {exit === null ? (
        <div data-closing-editor="" className="flex min-w-0 flex-col gap-5">
          <ChoiceGroup
            idPrefix={TRADER_RESULT_IDS.closeMode}
            legend={a('close.question')}
            value={draft.closeMode === 'unanswered' ? null : draft.closeMode}
            status={c('notAnswered')}
            emphasis="accent"
            onChange={(mode) => apply((current) => setCloseMode(current, mode))}
            options={[
              {
                value: 'all_at_once',
                label: a('close.allAtOnce'),
                description: r('allAtOnceDescription'),
              },
              {
                value: 'in_parts',
                label: a('close.inParts'),
                description: r('inPartsDescription'),
              },
            ]}
          />

          {draft.closeMode === 'all_at_once' ? (
            <div data-full-close="" className="flex min-w-0 flex-col gap-3">
              <TextField
                id={exitInputId(FULL_CLOSE_EXIT_ID, 'pnl')}
                label={a('close.pnl')}
                value={draft.fullClose.pnl}
                onChange={(pnl) => apply((current) => updateFullClose(current, { pnl }))}
                suffix={currency}
                inputMode="decimal"
                size="lead"
                figure
                hint={r('statedTotalHint')}
                error={errorText(exitField(FULL_CLOSE_EXIT_ID, 'pnl'))}
              />
              <MoreDetails
                id="after-full-close-details"
                recorded={[draft.fullClose.price, draft.fullClose.reason]}
                hasError={errorText(exitField(FULL_CLOSE_EXIT_ID, 'price')) !== undefined}
              >
                <TextField
                  id={exitInputId(FULL_CLOSE_EXIT_ID, 'price')}
                  label={a('exits.price')}
                  value={draft.fullClose.price}
                  onChange={(price) => apply((current) => updateFullClose(current, { price }))}
                  inputMode="decimal"
                  figure
                  labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
                  error={errorText(exitField(FULL_CLOSE_EXIT_ID, 'price'))}
                />
                <TextField
                  id={exitInputId(FULL_CLOSE_EXIT_ID, 'reason')}
                  label={a('exits.reason')}
                  value={draft.fullClose.reason}
                  onChange={(reason) => apply((current) => updateFullClose(current, { reason }))}
                />
              </MoreDetails>
            </div>
          ) : null}

          {draft.closeMode === 'in_parts' ? (
            <ChoiceGroup
              idPrefix={TRADER_RESULT_IDS.partsResult}
              legend={r('partsQuestion')}
              value={draft.partsResult === 'unanswered' ? null : draft.partsResult}
              status={c('notAnswered')}
              compact
              emphasis="accent"
              onChange={(mode) => apply((current) => setPartsResult(current, mode))}
              options={[
                {
                  value: 'total_only',
                  label: r('totalOnly'),
                  description: r('totalOnlyDescription'),
                },
                {
                  value: 'each_exit',
                  label: r('eachExit'),
                  description: r('eachExitDescription'),
                },
              ]}
            />
          ) : null}

          {draft.closeMode === 'in_parts' && draft.partsResult === 'total_only' ? (
            <TextField
              id={TRADER_RESULT_IDS.statedTotal}
              label={a('close.statedTotal')}
              value={draft.statedTotal}
              onChange={(value) => apply((current) => setStatedTotal(current, value))}
              suffix={currency}
              inputMode="decimal"
              size="lead"
              figure
              hint={r('statedTotalHint')}
              error={errorText('finalPnl')}
            />
          ) : null}

          {draft.closeMode === 'in_parts' && draft.partsResult === 'each_exit' ? (
            <ExitList
              draft={draft}
              closing={closing}
              currency={currency}
              errorText={errorText}
              formatMoney={formatMoney}
              finalPnlMinor={finalPnlMinor}
              onOpen={openExit}
              onAdd={recordExit}
            />
          ) : null}
        </div>
      ) : (
        <ExitEditor
          exit={exit}
          currency={currency}
          errorText={errorText}
          onBack={() => leaveExit('row')}
          onChange={(patch) => {
            const id = exit.id;
            apply((current) => updateExit(current, id, patch));
          }}
        />
      )}
    </TradeAdaptiveOverlay>
  );
}

/**
 * The exits the list shows, in order: every exit with something in it, and
 * the one being edited. An empty exit holds nothing to show or save.
 */
function listedExits(
  exits: readonly AfterTradeExitDraft[],
  openId: string | null,
): readonly AfterTradeExitDraft[] {
  return exits.filter((exit) => meaningfulExit(exit) || exit.id === openId);
}

/**
 * "RECORD EACH EXIT" — an ordered list of what each exit made. The last one
 * is the Final exit: adding an exit makes the new one final, removing the
 * last makes the one before it final, and nobody is asked to choose. The
 * exits' total reads beneath them once every one has its P&L.
 */
function ExitList({
  draft,
  closing,
  currency,
  errorText,
  formatMoney,
  finalPnlMinor,
  onOpen,
  onAdd,
}: {
  draft: AfterTradeDraft;
  closing: AfterTradeValidation['closing'];
  currency: string;
  errorText: (field: AfterTradeField) => string | undefined;
  formatMoney: (minor: string) => string;
  finalPnlMinor: string | null;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const c = useTranslations('trades.create.recording.contractEntry');
  const exits = listedExits(draft.exits, null);
  return (
    <section
      aria-labelledby="after-exit-list-title"
      data-exit-list=""
      className="flex min-w-0 flex-col gap-3"
    >
      <h3 id="after-exit-list-title" className="text-foreground text-sm font-semibold">
        {r('exits.title')}
      </h3>
      {exits.length === 0 ? (
        <p className="text-muted-foreground text-sm">{r('exits.none')}</p>
      ) : (
        <ol className="flex min-w-0 flex-col gap-2">
          {exits.map((exit, index) => {
            const final = index === exits.length - 1;
            return (
              <li key={exit.id} className="min-w-0">
                <ExitRow
                  exit={exit}
                  label={
                    final ? r('exits.finalExit') : a('exits.exitNumber', { number: index + 1 })
                  }
                  final={final}
                  number={index + 1}
                  currency={currency}
                  errors={
                    (['pnl', 'exitedAt', 'price'] as const).filter(
                      (part) => errorText(exitField(exit.id, part)) !== undefined,
                    ).length
                  }
                  formatMoney={formatMoney}
                  onOpen={() => onOpen(exit.id)}
                  hasErrorsLabel={(count) => c('summary.hasErrors', { count })}
                  editLabel={
                    final ? r('exits.editFinalAria') : r('exits.editAria', { number: index + 1 })
                  }
                />
              </li>
            );
          })}
        </ol>
      )}
      {exits.length === 0 ? null : (
        <div
          data-exit-total={finalPnlMinor === null ? 'waiting' : 'final'}
          className="flex min-w-0 items-baseline justify-between gap-3 px-1 text-sm"
        >
          <span className="text-muted-foreground">{r('summary.netPnl')}</span>
          <span
            className={cn(
              'tabular-nums',
              finalPnlMinor === null ? 'text-subtle-foreground' : 'text-foreground font-semibold',
            )}
          >
            {finalPnlMinor === null ? '—' : signedMoney(finalPnlMinor, formatMoney)}
          </span>
        </div>
      )}
      {exits.length > 0 && closing.missingPnl ? (
        <p className="text-muted-foreground px-1 text-xs">{r('exits.everyPnl')}</p>
      ) : null}
      <div className="flex min-w-0 flex-col gap-1">
        <div>
          <Button
            id={TRADER_RESULT_IDS.addExit}
            type="button"
            variant="outline"
            onClick={onAdd}
            disabled={!canAddExit(draft)}
          >
            <Plus aria-hidden="true" />
            {r('exits.add')}
          </Button>
        </div>
        {canAddExit(draft) ? null : (
          <p className="text-muted-foreground text-xs">
            {a('exits.limitReached', { limit: HISTORICAL_EXIT_LIMIT })}
          </p>
        )}
      </div>
    </section>
  );
}

/** One exit in the list: which exit it is, and what it made. The row opens it. */
function ExitRow({
  exit,
  label,
  final,
  number,
  currency,
  errors,
  formatMoney,
  onOpen,
  hasErrorsLabel,
  editLabel,
}: {
  exit: AfterTradeExitDraft;
  label: string;
  final: boolean;
  number: number;
  currency: string;
  errors: number;
  formatMoney: (minor: string) => string;
  onOpen: () => void;
  hasErrorsLabel: (count: number) => string;
  editLabel: string;
}) {
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const pnl = exit.pnl.trim();
  return (
    <button
      type="button"
      id={exitRowId(exit.id)}
      data-exit-row={number}
      data-final-exit={final ? '' : undefined}
      aria-label={editLabel}
      onClick={onOpen}
      className={cn(
        'bg-muted/50 hover:bg-muted focus-visible:ring-ring flex min-h-14 w-full min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none',
        errors > 0 ? 'border-destructive' : 'border-transparent',
      )}
    >
      <span className="min-w-0 flex-1">
        <span data-exit-label="" className="text-foreground block text-sm font-semibold">
          {label}
        </span>
        <span
          className={cn(
            'block truncate text-sm tabular-nums',
            pnl === '' ? 'text-subtle-foreground' : 'text-muted-foreground',
          )}
        >
          {pnl === '' ? r('exits.pnlMissing') : pnlText(pnl, currency, formatMoney)}
        </span>
        {errors > 0 ? (
          <span className="text-destructive block text-xs">{hasErrorsLabel(errors)}</span>
        ) : null}
      </span>
      <ChevronRight className="text-subtle-foreground size-5 shrink-0" aria-hidden="true" />
    </button>
  );
}

/** A typed exit P&L, signed when it parses — shown as typed when it does not. */
function pnlText(typed: string, currency: string, formatMoney: (minor: string) => string): string {
  const parsed = parseTradeMoneyInput(typed, currency, { allowNegative: true, allowZero: true });
  return parsed.ok ? signedMoney(parsed.value, formatMoney) : `${typed} ${currency}`;
}

/**
 * One exit's own view: what it made, and — one tap away — when, at what
 * price and why. Its place in the list says whether it is the Final exit;
 * nothing about the share of the position is asked. A share or scope an older
 * draft carries stays in the draft untouched, and is neither shown nor sent.
 */
function ExitEditor({
  exit,
  currency,
  errorText,
  onBack,
  onChange,
}: {
  exit: AfterTradeExitDraft;
  currency: string;
  errorText: (field: AfterTradeField) => string | undefined;
  onBack: () => void;
  onChange: (patch: Partial<Omit<AfterTradeExitDraft, 'id'>>) => void;
}): ReactNode {
  const a = useTranslations('trades.create.recording.contractAfter');
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const c = useTranslations('trades.create.recording.contractEntry');
  const prefix = (part: string) => exitInputId(exit.id, part);
  return (
    <div data-exit-editor={exit.id} className="flex min-w-0 flex-col gap-4">
      <div>
        <Button
          id={TRADER_RESULT_IDS.exitBack}
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground -ml-3"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" />
          {r('exits.back')}
        </Button>
      </div>
      <TextField
        id={prefix('pnl')}
        label={a('exits.pnl')}
        value={exit.pnl}
        onChange={(pnl) => onChange({ pnl })}
        suffix={currency}
        inputMode="decimal"
        size="lead"
        figure
        hint={r('statedTotalHint')}
        error={errorText(exitField(exit.id, 'pnl'))}
      />
      <MoreDetails
        id={prefix('details')}
        recorded={[exit.exitedAt, exit.price, exit.reason]}
        hasError={
          errorText(exitField(exit.id, 'exitedAt')) !== undefined ||
          errorText(exitField(exit.id, 'price')) !== undefined
        }
      >
        <TextField
          id={prefix('exitedAt')}
          type="datetime-local"
          label={a('exits.time')}
          value={exit.exitedAt}
          onChange={(exitedAt) => onChange({ exitedAt })}
          figure
          error={errorText(exitField(exit.id, 'exitedAt'))}
        />
        <TextField
          id={prefix('price')}
          label={a('exits.price')}
          value={exit.price}
          onChange={(price) => onChange({ price })}
          inputMode="decimal"
          figure
          labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
          error={errorText(exitField(exit.id, 'price'))}
        />
        <TextField
          id={prefix('reason')}
          label={a('exits.reason')}
          value={exit.reason}
          onChange={(reason) => onChange({ reason })}
        />
      </MoreDetails>
    </div>
  );
}

/**
 * "ADD MORE DETAILS" — optional answers kept one tap away. A quiet toggle,
 * not another card. Folding it never clears a value: what was typed stays in
 * the draft, and the toggle says how many details it holds. It opens by
 * itself when it holds something already, and stays open while a value in
 * it needs attention, so an error is never hidden behind it.
 */
function MoreDetails({
  id,
  recorded,
  hasError,
  children,
}: {
  id: string;
  recorded: readonly string[];
  hasError: boolean;
  children: ReactNode;
}) {
  const r = useTranslations('trades.create.recording.contractAfter.resultStep');
  const count = recorded.filter((value) => value.trim() !== '').length;
  const [open, setOpen] = useState(count > 0);
  const shown = open || hasError;
  const panelId = `${useId()}-panel`;
  return (
    <div data-more-details={shown ? 'open' : 'closed'} className="flex min-w-0 flex-col gap-3">
      <button
        type="button"
        id={id}
        aria-expanded={shown}
        aria-controls={panelId}
        disabled={hasError}
        onClick={() => setOpen((current) => !current)}
        className="text-primary-text focus-visible:ring-ring -mx-1 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-1 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 disabled:cursor-default disabled:hover:no-underline"
      >
        {shown ? (
          <ChevronDown aria-hidden="true" className="size-4 rotate-180" />
        ) : count > 0 ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <Plus aria-hidden="true" className="size-4" />
        )}
        {shown ? r('details.hide') : count > 0 ? r('details.show', { count }) : r('details.add')}
      </button>
      <div id={panelId} hidden={!shown} className="flex min-w-0 flex-col gap-4">
        {children}
      </div>
    </div>
  );
}
