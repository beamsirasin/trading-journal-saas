'use client';

import { CircleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';

import { generateId } from '@/lib/identifiers';
import { recordContractExitAction } from '@/server/actions/trades';
import type { TradeDetail } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/navigation';

import {
  adoptRecordedExits,
  buildClosePayload,
  createCloseTradeDraft,
  firstCloseErrorField,
  lastRecordedExitTime,
  serverErrorField,
  setCompleteness,
  setFinalPnl,
  setOutcome,
  updateLeg,
  validateCloseDraft,
  type CloseErrorCode,
  type CloseErrors,
  type CloseField,
  type CloseScope,
  type CloseTradeContext,
  type CloseTradeDraft,
} from './close-trade-draft';
import {
  closeBasisMatches,
  loadCloseTask,
  removeCloseTask,
  saveCloseTask,
  type CloseDraftBasis,
  type CloseDraftScope,
  type CloseDraftSubmission,
} from './close-trade-draft-storage';
import { ChoiceGroup, Helper, InlineAction, Notice } from './trade-at-entry-controls';
import { TradeEntryDetails } from './trade-entry-details';
import {
  ActualRReadoutRow,
  ExitDiscrepancyNotice,
  exitLegFieldId,
  ExitLegFields,
  ExitTimeField,
  FinalPnlField,
  RecordedExitsList,
  TraderOutcomeField,
} from './trade-exit-result-step';
import { tradeMoneyInputValue } from './trade-form-values';
import { formatTradeInstant, formatTradeMoney } from './trade-format';
import { FoldedGroup, GroupCard } from './trade-recording-step-parts';

const LEG_PREFIX = 'close-leg';
const FINAL_TIME_ID = 'close-finalExitedAt';
const FINAL_PNL_ID = 'close-finalPnl';
const HISTORY_TOGGLE_ID = 'close-history-toggle';

/** The control a blocked Save focuses for each field — always one that exists. */
function fieldTargetId(field: CloseField): string {
  switch (field) {
    case 'finalExitedAt':
      return FINAL_TIME_ID;
    case 'finalPnl':
      return FINAL_PNL_ID;
    case 'leg.exitedAt':
      return exitLegFieldId(LEG_PREFIX, 'exitedAt');
    case 'leg.pnl':
      return exitLegFieldId(LEG_PREFIX, 'pnl');
    case 'leg.closedPercent':
      return exitLegFieldId(LEG_PREFIX, 'closedPercent');
    case 'leg.price':
      return exitLegFieldId(LEG_PREFIX, 'price');
  }
}

const PRECISE_TIME_CODES: ReadonlySet<string> = new Set([
  'exit_time_before_entry',
  'exit_time_in_future',
  'final_exit_before_recorded_exit',
]);

/**
 * CANONICAL STAGE 5 — EXIT & RESULT for an Open contract Trade (Close
 * Existing Open Trade; Add Trade contract §10–§12, UX Rules §20).
 *
 * THE ENTRY ACTION CHOSE THE SCOPE. "Record partial exit" arrives as Part and
 * "Close trade" as All Remaining; neither asks again.
 *
 * - PART shows one exit leg — time, P&L for this exit, % closed, price as
 *   context, reason — and nothing whole-trade. Saving leaves the trade Open.
 * - ALL REMAINING reads as the result: final exit date & time, Final Net P&L
 *   (authoritative), Actual R (derived only), and the trader's own Win / BE /
 *   Loss. The exit history — earlier legs, this closing leg, whether it is
 *   every exit — is supporting evidence, folded beneath. Post-Trade Emotion is
 *   not here: it is After-Trade Context (stage 6).
 *
 * Both write through the one canonical action, `recordContractExitAction`.
 */
export function TradeCloseForm({
  trade,
  scope,
  timezone,
  draftScope = null,
}: {
  trade: TradeDetail;
  scope: CloseScope;
  timezone: string;
  /** Where this close's unsaved answers persist; null keeps them in memory only. */
  draftScope?: CloseDraftScope | null;
}) {
  const locale = useLocale();
  const s = useTranslations('trades.stage5');
  const tErrors = useTranslations('trades.errors');
  const a = useTranslations('trades.create.recording.contractAfter');
  const c = useTranslations('trades.create.recording.contractEntry');
  const router = useRouter();
  const [draft, setDraft] = useState<CloseTradeDraft>(() => createCloseTradeDraft(scope));
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<CloseErrors>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // One Save key per request content: a retry of the same answers replays safely,
  // and the key persists with the draft so a reload does not mint a new one.
  const lastSubmission = useRef<CloseDraftSubmission | null>(null);
  // The Trade state the restored answers were given against.
  const draftBasis = useRef<CloseDraftBasis | null>(null);
  const [hydrated, setHydrated] = useState(draftScope === null);
  const [draftNotice, setDraftNotice] = useState<'none' | 'restored' | 'stale'>('none');
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const finalTimeRow = useRef<HTMLButtonElement | null>(null);
  const legTimeRow = useRef<HTMLButtonElement | null>(null);

  const allRemaining = scope === 'all_remaining';
  const currency = trade.tradingAccountBaseCurrency;
  // `now` is read on every render, so a time set with "Use now" never reads as future.
  const context: CloseTradeContext = {
    currency,
    timezone,
    now: new Date(),
    enteredAt: trade.enteredAt,
    riskMinor: trade.plannedRiskMinor,
    exits: trade.exits,
  };
  const validation = validateCloseDraft(draft, context);
  const lastExit = lastRecordedExitTime(context);
  const tradeHref = `/app/trades?trade=${trade.tradeId}&tab=execution`;
  const currentBasis: CloseDraftBasis = {
    status: trade.status,
    exitIds: trade.exits.map((exit) => exit.exitId),
  };
  // Whether there is anything to discard: the answers alone decide it.
  const pristine = JSON.stringify(draft) === JSON.stringify(createCloseTradeDraft(scope));

  /*
    RESTORE ONCE, AFTER HYDRATION. The server renders a blank form (it cannot
    read this browser's storage); the saved answers arrive on mount. A task
    whose basis no longer matches the Trade is restored but held: it cannot be
    submitted until the trader confirms the answers still apply.
  */
  const tradeKey = draftScope?.tradeKey;
  useEffect(() => {
    if (draftScope === null) return;
    const task = loadCloseTask(draftScope, scope, new Date());
    if (task !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft({ scope, ...task.exitResult });
      lastSubmission.current = task.submission;
      draftBasis.current = task.basis;
      setDraftNotice(closeBasisMatches(task.basis, currentBasis) ? 'restored' : 'stale');
    }
    setHydrated(true);
    // Once per Trade and task; the basis is read as it stood at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tradeKey, scope]);

  /** Writes the task as it stands; a pristine task is removed rather than stored. */
  function persist(next: CloseTradeDraft, submission: CloseDraftSubmission | null) {
    if (draftScope === null) return;
    const now = new Date();
    const blank = JSON.stringify(next) === JSON.stringify(createCloseTradeDraft(scope));
    if (blank && submission === null) {
      removeCloseTask(draftScope, scope, now);
      return;
    }
    const { scope: _scope, ...exitResult } = next;
    saveCloseTask(
      draftScope,
      scope,
      { basis: draftBasis.current ?? currentBasis, exitResult, submission },
      { symbol: trade.symbol, now },
    );
  }

  useEffect(() => {
    if (!hydrated) return;
    persist(draft, lastSubmission.current);
    // Written on every answer change; `persist` reads refs and props only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, hydrated]);

  function keepRestoredAnswers() {
    // The answers now stand against the Trade as it is; the Save key is kept.
    draftBasis.current = currentBasis;
    setDraftNotice('none');
    setFormMessage(null);
    persist(draft, lastSubmission.current);
  }

  function discardAnswers() {
    if (draftScope !== null) removeCloseTask(draftScope, scope, new Date());
    lastSubmission.current = null;
    draftBasis.current = null;
    setDraft(createCloseTradeDraft(scope));
    setAttempted(false);
    setServerErrors({});
    setFormMessage(null);
    setDraftNotice('none');
    setConfirmingDiscard(false);
  }

  function apply(update: (current: CloseTradeDraft) => CloseTradeDraft) {
    setDraft(update);
    setServerErrors({});
    setFormMessage(null);
  }

  const visibleErrors: CloseErrors = attempted
    ? { ...validation.errors, ...serverErrors }
    : serverErrors;
  const errorText = (field: CloseField): string | undefined => {
    const code: CloseErrorCode | undefined = visibleErrors[field];
    if (code === undefined) return undefined;
    return PRECISE_TIME_CODES.has(code) ? tErrors(code) : s(`errors.${code}`);
  };
  const errorCount = Object.keys(visibleErrors).length;
  const legInHistory = allRemaining;
  const legErrorCount = (
    ['leg.exitedAt', 'leg.pnl', 'leg.closedPercent', 'leg.price'] as const
  ).filter((field) => visibleErrors[field] !== undefined).length;

  function focusField(field: CloseField) {
    const inHistory = legInHistory && field.startsWith('leg.');
    if (inHistory) setHistoryOpen(true);
    const target = fieldTargetId(field);
    // After the fold has opened, so the control is on screen when it is focused.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = document.getElementById(target);
        element?.focus();
        element?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }),
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    setFormMessage(null);
    // Answers given against a different Trade state are never sent unconfirmed.
    if (draftNotice === 'stale') {
      setFormMessage(s('draft.staleBlocked'));
      requestAnimationFrame(() => document.getElementById('close-draft-keep')?.focus());
      return;
    }
    const current = validateCloseDraft(draft, { ...context, now: new Date() });
    const blocked = firstCloseErrorField(current.errors);
    if (blocked !== null) {
      focusField(blocked);
      return;
    }
    const body = JSON.stringify(
      buildClosePayload(draft, context, { tradeId: trade.tradeId, mutationKey: '' }),
    );
    const key =
      lastSubmission.current !== null && lastSubmission.current.body === body
        ? lastSubmission.current.key
        : generateId();
    lastSubmission.current = { key, body };
    // Stored before sending: a reload mid-flight re-sends under the same key.
    persist(draft, lastSubmission.current);
    const payload = buildClosePayload(draft, context, {
      tradeId: trade.tradeId,
      mutationKey: key,
    });
    startTransition(async () => {
      const result = await recordContractExitAction(payload);
      if (result.ok) {
        if (draftScope !== null) removeCloseTask(draftScope, scope, new Date());
        router.push(tradeHref, { scroll: false });
        router.refresh();
        return;
      }
      const code = result.error.code;
      if (code === 'mutation_replay_conflict') {
        setFormMessage(s('page.conflict'));
        return;
      }
      const field = serverErrorField(code, draft, context);
      if (field !== null) {
        setServerErrors({
          [field]: PRECISE_TIME_CODES.has(code)
            ? (code as CloseErrorCode)
            : code === 'invalid_closed_bps'
              ? allRemaining
                ? 'percent_over_total'
                : 'part_closes_position'
              : code === 'exit_history_not_adoptable'
                ? 'exit_history_not_adoptable'
                : 'not_accepted',
        });
        focusField(field);
        return;
      }
      setFormMessage(tErrors(code));
    });
  }

  const legFields = (
    <ExitLegFields
      idPrefix={LEG_PREFIX}
      leg={draft.leg}
      currency={currency}
      timezone={timezone}
      locale={locale}
      timeLabel={s('time.legLabel')}
      timeRowRef={legTimeRow}
      lastRecordedExit={lastExit}
      errors={{
        exitedAt: errorText('leg.exitedAt'),
        pnl: errorText('leg.pnl'),
        closedPercent: errorText('leg.closedPercent'),
        price: errorText('leg.price'),
      }}
      onChange={(patch) => apply((current) => updateLeg(current, patch))}
    />
  );

  const hasHistory =
    trade.exits.length > 0 || Object.values(draft.leg).some((value) => value.trim() !== '');
  const subtotal =
    validation.exitSubtotalMinor === null
      ? null
      : (formatTradeMoney(validation.exitSubtotalMinor, currency) ?? validation.exitSubtotalMinor);
  const subtotalBlocked =
    !allRemaining || validation.canAdoptExitSubtotal || draft.finalPnlAdopted
      ? null
      : subtotal !== null && draft.completeness !== 'complete'
        ? s('pnl.needsComplete', { amount: subtotal })
        : null;
  const discrepancy =
    allRemaining &&
    draft.completeness === 'complete' &&
    validation.exitSubtotalMinor !== null &&
    validation.finalPnlMinor !== null &&
    validation.exitSubtotalMinor !== validation.finalPnlMinor;

  const remaining =
    trade.closedBps !== null && trade.closedBps > 0 && trade.remainingBps !== null
      ? trade.remainingBps
      : null;

  return (
    <form
      noValidate
      onSubmit={submit}
      data-close-form={scope}
      className="flex min-w-0 flex-1 flex-col gap-4"
    >
      {/* WHICH TRADE, IN ONE LINE: what is being closed, and what is known about it. */}
      <dl
        data-close-context=""
        className="border-border bg-muted/30 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-4"
      >
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">
            {trade.direction === 'long' ? c('direction.long') : c('direction.short')}
          </dt>
          <dd className="text-foreground truncate font-semibold">{trade.symbol}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{s('page.context.entered')}</dt>
          <dd className="text-foreground truncate tabular-nums">
            {formatTradeInstant(trade.enteredAt, timezone, locale) ?? s('page.context.notRecorded')}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">{s('page.context.riskAtEntry')}</dt>
          <dd className="text-foreground truncate tabular-nums">
            {formatTradeMoney(trade.plannedRiskMinor, currency) ?? s('page.context.notRecorded')}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground text-xs">
            {remaining === null ? s('page.context.open') : s('page.context.partiallyClosed')}
          </dt>
          <dd className="text-foreground truncate tabular-nums">
            {remaining === null
              ? a('exits.summaryCount', { count: trade.exits.length })
              : s('page.context.remaining', { percent: remaining / 100 })}
          </dd>
        </div>
      </dl>

      <TradeEntryDetails trade={trade} />

      {draftNotice === 'none' ? null : (
        <div data-close-draft={draftNotice} className="flex min-w-0 flex-col gap-2">
          <Notice>{draftNotice === 'stale' ? s('draft.stale') : s('draft.restored')}</Notice>
          {draftNotice === 'stale' ? (
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 px-1">
              <Button
                id="close-draft-keep"
                type="button"
                variant="outline"
                size="sm"
                onClick={keepRestoredAnswers}
              >
                {s('draft.keep')}
              </Button>
              <InlineAction onClick={discardAnswers}>{s('draft.discard')}</InlineAction>
            </div>
          ) : null}
        </div>
      )}

      {allRemaining ? (
        <>
          {/* 1–3 — WHEN IT CLOSED, WHAT IT CAME TO, AND WHAT THAT IS IN R */}
          <GroupCard filled data-close-result="">
            <ExitTimeField
              id={FINAL_TIME_ID}
              rowRef={finalTimeRow}
              label={s('time.finalLabel')}
              value={draft.finalExitedAt}
              timezone={timezone}
              locale={locale}
              error={errorText('finalExitedAt')}
              lastRecordedExit={lastExit}
              onChange={(finalExitedAt) => apply((current) => ({ ...current, finalExitedAt }))}
            />
            <FinalPnlField
              id={FINAL_PNL_ID}
              value={draft.finalPnl}
              currency={currency}
              error={errorText('finalPnl')}
              source={
                draft.finalPnl.trim() === '' ? null : draft.finalPnlAdopted ? 'adopted' : 'typed'
              }
              adoptable={validation.canAdoptExitSubtotal}
              subtotal={subtotal}
              subtotalBlocked={subtotalBlocked}
              onChange={(finalPnl) => apply((current) => setFinalPnl(current, finalPnl))}
              onAdopt={() => {
                if (validation.exitSubtotalMinor === null) return;
                const text = tradeMoneyInputValue(validation.exitSubtotalMinor, currency);
                apply((current) => adoptRecordedExits(current, text));
              }}
            />
            <ActualRReadoutRow readout={validation.actualR} />
          </GroupCard>

          {/* 4 — THE TRADER'S OWN CALL, always in view */}
          <GroupCard title={s('page.sections.outcome')}>
            <TraderOutcomeField
              idPrefix="close-outcome"
              value={draft.outcome}
              contradicts={validation.outcomeContradictsPnl}
              onChange={(outcome) => apply((current) => setOutcome(current, outcome))}
            />
          </GroupCard>

          {/* 5 — EXIT HISTORY: supporting evidence, never the result */}
          <FoldedGroup
            id={HISTORY_TOGGLE_ID}
            title={s('history.title')}
            summary={
              legErrorCount > 0 ? (
                <span className="text-destructive inline-flex min-w-0 items-center gap-1.5">
                  <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
                  {c('summary.hasErrors', { count: legErrorCount })}
                </span>
              ) : trade.exits.length === 0 ? (
                s('history.summaryEmpty')
              ) : (
                s('history.summaryCount', { count: trade.exits.length })
              )
            }
            open={historyOpen || legErrorCount > 0}
            onToggle={() => setHistoryOpen((open) => !open)}
          >
            <div className="flex min-w-0 flex-col gap-5 pb-3">
              <Helper>{s('history.description')}</Helper>
              {trade.exits.length === 0 ? null : (
                <RecordedExitsList
                  exits={trade.exits}
                  currency={currency}
                  timezone={timezone}
                  locale={locale}
                />
              )}
              <section
                aria-labelledby="close-leg-heading"
                className="border-border flex min-w-0 flex-col gap-4 rounded-md border px-3 py-3 sm:px-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <h3 id="close-leg-heading" className="text-foreground text-sm font-semibold">
                    {s('history.closingLeg')}
                  </h3>
                  <p className="text-muted-foreground text-xs">{s('history.closingLegHint')}</p>
                </div>
                {legFields}
              </section>
              {hasHistory ? (
                <ChoiceGroup
                  idPrefix="close-completeness"
                  legend={a('exits.completeness')}
                  value={draft.completeness === 'unanswered' ? null : draft.completeness}
                  status={c('notAnswered')}
                  columns={3}
                  compact
                  aside={
                    <InlineAction
                      ariaLabel={a('exits.removeCompletenessAria')}
                      onClick={() => apply((current) => setCompleteness(current, 'unanswered'))}
                    >
                      {c('removeAnswer')}
                    </InlineAction>
                  }
                  onChange={(value) => apply((current) => setCompleteness(current, value))}
                  options={[
                    { value: 'complete', label: a('exits.complete') },
                    { value: 'incomplete', label: a('exits.incomplete') },
                    { value: 'unknown', label: a('exits.unknown') },
                  ]}
                />
              ) : null}
              {discrepancy && subtotal !== null && validation.finalPnlMinor !== null ? (
                <ExitDiscrepancyNotice>
                  {a('exits.discrepancy', {
                    subtotal,
                    final:
                      formatTradeMoney(validation.finalPnlMinor, currency) ??
                      validation.finalPnlMinor,
                  })}
                </ExitDiscrepancyNotice>
              ) : null}
            </div>
          </FoldedGroup>
        </>
      ) : (
        <>
          {/* PART — ONE EXIT LEG, and nothing that belongs to the whole trade */}
          <GroupCard filled title={s('page.sections.exit')} data-close-leg="">
            {legFields}
          </GroupCard>
          {trade.exits.length === 0 ? null : (
            <FoldedGroup
              id={HISTORY_TOGGLE_ID}
              title={s('history.title')}
              summary={s('history.summaryCount', { count: trade.exits.length })}
              open={historyOpen}
              onToggle={() => setHistoryOpen((open) => !open)}
            >
              <div className="pb-3">
                <RecordedExitsList
                  exits={trade.exits}
                  currency={currency}
                  timezone={timezone}
                  locale={locale}
                />
              </div>
            </FoldedGroup>
          )}
        </>
      )}

      {/* THE ACTION: docked on a phone, beside the way back on a wide screen */}
      <div
        data-close-actions=""
        className="border-border bg-background sticky bottom-0 z-10 -mx-4 mt-auto flex min-w-0 flex-col gap-2 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:border-t-0 sm:px-0"
      >
        <p aria-live="polite" role="status" className="text-sm empty:hidden">
          {formMessage !== null ? (
            <span className="text-destructive">{formMessage}</span>
          ) : attempted && errorCount > 0 ? (
            <span className="text-destructive inline-flex items-center gap-1.5">
              <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
              {s('page.attention', { count: errorCount })}
            </span>
          ) : (
            ''
          )}
        </p>
        {pristine || draftNotice === 'stale' ? null : confirmingDiscard ? (
          <div
            data-close-discard-confirm=""
            className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
          >
            <span className="text-foreground">{s('draft.discardQuestion')}</span>
            <InlineAction onClick={discardAnswers}>{s('draft.discardConfirm')}</InlineAction>
            <InlineAction onClick={() => setConfirmingDiscard(false)}>
              {s('draft.discardCancel')}
            </InlineAction>
          </div>
        ) : (
          <div>
            <InlineAction onClick={() => setConfirmingDiscard(true)}>
              {s('draft.discard')}
            </InlineAction>
          </div>
        )}
        <div className="flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button asChild variant="ghost" size="lg" className="min-h-12">
            <Link href={tradeHref}>{s('page.backToTrade')}</Link>
          </Button>
          <Button
            type="submit"
            size="lg"
            className="min-h-12"
            disabled={pending}
            data-close-submit={scope}
          >
            {pending
              ? s(allRemaining ? 'page.closingTrade' : 'page.recordingPartial')
              : s(allRemaining ? 'page.closeTrade' : 'page.recordPartial')}
          </Button>
        </div>
      </div>
    </form>
  );
}
