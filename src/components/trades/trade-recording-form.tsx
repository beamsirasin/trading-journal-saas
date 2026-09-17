'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { generateId } from '@/lib/identifiers';
import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';

import type { AfterTradeDraft } from './after-trade-draft';
import type { AtEntryDraft } from './at-entry-draft';
import {
  createRecordingDraft,
  recordingDraftHasWork,
  switchRecordingMode,
  type RecordingDraftEnvelope,
} from './recording-draft';
import {
  loadRecordingDraft,
  removeRecordingDraft,
  saveRecordingDraft,
  type RecordingDraftScope,
} from './recording-draft-storage';
import { TradeAfterTradeForm } from './trade-after-trade-form';
import { TradeAtEntryForm } from './trade-at-entry-form';
import { RecordingDraftStatus, type RecordingDraftNotice } from './trade-recording-draft-status';

export interface TradeRecordingFormProps {
  options: TradeCreateOptions;
  timing: RecordingTiming;
  activeTradingAccountId?: string | null;
  timezone: string;
  /** Server-derived, opaque: whose draft this is and in which workspace. */
  draftScope: RecordingDraftScope;
}

interface GateState {
  readonly envelope: RecordingDraftEnvelope;
  readonly notice: RecordingDraftNotice;
  readonly hasWork: boolean;
  /** Bumped when the draft is discarded, so the form remounts from a fresh draft. */
  readonly generation: number;
}

export function defaultTradingAccountId(
  options: TradeCreateOptions,
  activeTradingAccountId: string | null,
): string {
  return (
    (activeTradingAccountId !== null &&
    options.tradingAccounts.some((item) => item.tradingAccountId === activeTradingAccountId)
      ? activeTradingAccountId
      : undefined) ??
    (options.tradingAccounts.length === 1 ? options.tradingAccounts[0]!.tradingAccountId : '')
  );
}

/**
 * THE PRODUCTION RECORDING-MODE BOUNDARY, AND THE OWNER OF THE RECORDING DRAFT.
 *
 * The mode travels in the URL. The draft does not: it is ONE Add Trade
 * Recording Draft for this user and workspace (`recording-draft.ts`), kept in
 * this browser, so arriving in a mode opens that mode's section of the same
 * draft. Arriving in the other mode than the draft was last in is a mode switch
 * — navigation, never discard — and only the values the carry rules allow cross.
 *
 * The draft is read after hydration, because only the browser has it; until
 * then a short loading state stands in for the form rather than a pristine
 * form that the recovered draft would immediately replace.
 *
 * Type → Draft: every change is written as it happens. Save → Persist: the
 * draft is removed only after the server confirms the Trade. Discard → Destroy:
 * only the explicit, confirmed discard removes it early.
 */
export function TradeRecordingForm({
  options,
  timing,
  activeTradingAccountId = null,
  timezone,
  draftScope,
}: TradeRecordingFormProps) {
  const [state, setState] = useState<GateState | null>(null);
  const envelopeRef = useRef<RecordingDraftEnvelope | null>(null);
  const defaultAccount = defaultTradingAccountId(options, activeTradingAccountId);
  const { ownerKey, workspaceKey } = draftScope;

  useEffect(() => {
    const scope = { ownerKey, workspaceKey };
    const now = new Date();
    const loaded = loadRecordingDraft(scope, now);
    let envelope: RecordingDraftEnvelope;
    let notice: RecordingDraftNotice = null;
    if (loaded.status === 'recovered') {
      envelope = switchRecordingMode(loaded.envelope, timing, {
        defaultTradingAccountId: defaultAccount,
        now,
      });
      if (recordingDraftHasWork(envelope, defaultAccount)) notice = 'recovered';
      if (envelope !== loaded.envelope) saveRecordingDraft(scope, envelope);
    } else {
      envelope = createRecordingDraft({
        mode: timing,
        tradingAccountId: defaultAccount,
        mutationKey: generateId(),
        now,
      });
      if (loaded.status === 'unrecoverable') notice = 'unrecoverable';
    }
    envelopeRef.current = envelope;
    // Reading browser storage is the synchronisation this effect exists for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      envelope,
      notice,
      hasWork: recordingDraftHasWork(envelope, defaultAccount),
      generation: 0,
    });
  }, [ownerKey, workspaceKey, timing, defaultAccount]);

  const persist = useCallback(
    (next: RecordingDraftEnvelope) => {
      envelopeRef.current = next;
      const scope = { ownerKey, workspaceKey };
      const hasWork = recordingDraftHasWork(next, defaultAccount);
      let durable = true;
      if (hasWork) durable = saveRecordingDraft(scope, next);
      else if (loadRecordingDraft(scope, new Date()).status === 'recovered') {
        // The trader emptied everything they had entered: there is no work left
        // to keep. An unreadable stored draft is left for its own notice.
        removeRecordingDraft(scope);
      }
      setState((current) => {
        if (current === null) return current;
        const notice: RecordingDraftNotice = !durable
          ? 'not_durable'
          : current.notice === 'not_durable'
            ? null
            : current.notice;
        return current.hasWork === hasWork && current.notice === notice
          ? current
          : { ...current, hasWork, notice };
      });
    },
    [ownerKey, workspaceKey, defaultAccount],
  );

  const onAtEntryChange = useCallback(
    (atEntry: AtEntryDraft) => {
      const current = envelopeRef.current;
      if (current === null) return;
      persist({ ...current, atEntry, updatedAt: new Date().toISOString() });
    },
    [persist],
  );

  const onAfterTradeChange = useCallback(
    (afterTrade: AfterTradeDraft) => {
      const current = envelopeRef.current;
      if (current === null) return;
      persist({ ...current, afterTrade, updatedAt: new Date().toISOString() });
    },
    [persist],
  );

  /** Only after the server has confirmed the Trade. */
  const onSaved = useCallback(() => {
    removeRecordingDraft({ ownerKey, workspaceKey });
  }, [ownerKey, workspaceKey]);

  const discard = useCallback(() => {
    removeRecordingDraft({ ownerKey, workspaceKey });
    const envelope = createRecordingDraft({
      mode: timing,
      tradingAccountId: defaultAccount,
      mutationKey: generateId(),
      now: new Date(),
    });
    envelopeRef.current = envelope;
    setState((current) => ({
      envelope,
      notice: null,
      hasWork: false,
      generation: (current?.generation ?? 0) + 1,
    }));
  }, [ownerKey, workspaceKey, timing, defaultAccount]);

  if (state === null) {
    return (
      <div
        data-recording-draft-loading=""
        aria-busy="true"
        className="bg-muted/40 h-64 w-full animate-pulse rounded-xl motion-reduce:animate-none"
      />
    );
  }

  const status = (
    <RecordingDraftStatus
      notice={state.notice}
      hasWork={state.hasWork}
      onDismissNotice={() => setState((current) => current && { ...current, notice: null })}
      onDiscard={discard}
    />
  );
  const key = `${state.envelope.mutationKey}:${state.generation}`;

  if (timing === 'after_trade') {
    return (
      <div className="flex w-full min-w-0 flex-col gap-3">
        {status}
        <TradeAfterTradeForm
          key={key}
          options={options}
          activeTradingAccountId={activeTradingAccountId}
          timezone={timezone}
          initialDraft={state.envelope.afterTrade}
          mutationKey={state.envelope.mutationKey}
          onDraftChange={onAfterTradeChange}
          onSaved={onSaved}
        />
      </div>
    );
  }
  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {status}
      <TradeAtEntryForm
        key={key}
        options={options}
        activeTradingAccountId={activeTradingAccountId}
        timezone={timezone}
        initialDraft={state.envelope.atEntry}
        mutationKey={state.envelope.mutationKey}
        onDraftChange={onAtEntryChange}
        onSaved={onSaved}
      />
    </div>
  );
}
