'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { generateId } from '@/lib/identifiers';
import type { RecordingTiming } from '@/lib/trades/recording-timing';
import type { TradeCreateOptions } from '@/server/dal/trades';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import type { AfterTradeDraft } from './after-trade-draft';
import type { AtEntryDraft } from './at-entry-draft';
import {
  createRecordingDraft,
  inactiveModeWork,
  parseRecordingDraft,
  recordingDraftHasWork,
  switchRecordingMode,
  type InactiveModeWorkItem,
  type RecordingDraftEnvelope,
} from './recording-draft';
import {
  loadRecordingDraft,
  recordingDraftStorageKey,
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
  /** Bumped when the draft is discarded or reloaded, so the form remounts from it. */
  readonly generation: number;
}

/** What each mode's form is given to save honestly (contract §23). */
export interface RecordingSaveControls {
  /**
   * Asked before a Save: resolves `false` when the trader chose to keep
   * editing rather than lose inactive-mode answers the saved Trade cannot hold.
   */
  readonly confirmBeforeSave: () => Promise<boolean>;
  /**
   * "Save this draft as a new trade" after a replay conflict: an explicit,
   * trader-chosen new Save key, persisted in the draft before it is used.
   */
  readonly rotateMutationKey: () => string;
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
 * draft is removed only after the server confirms the Trade, and only after
 * the trader agreed to lose any answer in the other mode that the saved Trade
 * cannot hold. Discard → Destroy: only the explicit, confirmed discard removes
 * it early.
 *
 * ANOTHER TAB ON THE SAME DRAFT. Every tab keeps its own copy in memory, so a
 * `storage` event tells this tab when another one changed or removed the
 * stored draft. The server's replay check (the Save key plus a fingerprint of
 * what was said) is what stops a stale tab from being told it saved something
 * it did not; this notice is what tells the trader before they find out.
 */
export function TradeRecordingForm({
  options,
  timing,
  activeTradingAccountId = null,
  timezone,
  draftScope,
}: TradeRecordingFormProps) {
  const t = useTranslations('trades.create.draft');
  const [state, setState] = useState<GateState | null>(null);
  const envelopeRef = useRef<RecordingDraftEnvelope | null>(null);
  const defaultAccount = defaultTradingAccountId(options, activeTradingAccountId);
  const { ownerKey, workspaceKey } = draftScope;
  const [pendingConfirm, setPendingConfirm] = useState<{
    readonly items: readonly InactiveModeWorkItem[];
    readonly resolve: (proceed: boolean) => void;
  } | null>(null);

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

  useEffect(() => {
    const storageKey = recordingDraftStorageKey({ ownerKey, workspaceKey });
    function onStorage(event: StorageEvent) {
      // Only another tab's write to THIS user's draft in THIS workspace.
      if (event.key !== storageKey && event.key !== null) return;
      const current = envelopeRef.current;
      if (current === null) return;
      let notice: RecordingDraftNotice;
      if (event.key === null || event.newValue === null) {
        notice = 'removed_elsewhere';
      } else {
        const parsed = parseRecordingDraft(event.newValue, new Date());
        if (parsed.status !== 'recovered') return;
        if (JSON.stringify(parsed.envelope) === JSON.stringify(current)) return;
        notice = 'changed_elsewhere';
      }
      setState((previous) => previous && { ...previous, notice });
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [ownerKey, workspaceKey]);

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

  const confirmBeforeSave = useCallback((): Promise<boolean> => {
    const current = envelopeRef.current;
    const items = current === null ? [] : inactiveModeWork(current);
    if (items.length === 0) return Promise.resolve(true);
    return new Promise((resolve) => setPendingConfirm({ items, resolve }));
  }, []);

  const rotateMutationKey = useCallback((): string => {
    const key = generateId();
    const current = envelopeRef.current;
    if (current !== null) {
      const next = { ...current, mutationKey: key, updatedAt: new Date().toISOString() };
      persist(next);
      setState((previous) => previous && { ...previous, envelope: next });
    }
    return key;
  }, [persist]);

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

  /** "Load the latest version" after another tab changed the draft. */
  const loadLatest = useCallback(() => {
    const now = new Date();
    const loaded = loadRecordingDraft({ ownerKey, workspaceKey }, now);
    if (loaded.status !== 'recovered') return;
    const envelope = switchRecordingMode(loaded.envelope, timing, {
      defaultTradingAccountId: defaultAccount,
      now,
    });
    envelopeRef.current = envelope;
    setState((current) => ({
      envelope,
      notice: null,
      hasWork: recordingDraftHasWork(envelope, defaultAccount),
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
      // After Trade's step flow starts high on a phone; its routine draft states are one row.
      compact={timing === 'after_trade'}
      notice={state.notice}
      hasWork={state.hasWork}
      onDismissNotice={() => setState((current) => current && { ...current, notice: null })}
      onDiscard={discard}
      onLoadLatest={loadLatest}
    />
  );
  // The Save key is NOT part of the form's identity: rotating it for "Save as
  // a new trade" must never remount the form mid-Save.
  const key = String(state.generation);
  const saveControls: RecordingSaveControls = { confirmBeforeSave, rotateMutationKey };

  const closeConfirm = (proceed: boolean) => {
    pendingConfirm?.resolve(proceed);
    setPendingConfirm(null);
  };
  const confirmDialog = (
    <AlertDialog
      open={pendingConfirm !== null}
      onOpenChange={(open) => {
        if (!open) closeConfirm(false);
      }}
    >
      <AlertDialogContent data-inactive-mode-confirm="">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('inactive.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('inactive.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="text-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
          {(pendingConfirm?.items ?? []).map((item) => (
            <li key={item.kind} data-inactive-item={item.kind}>
              {item.kind === 'exits'
                ? t('inactive.items.exits', { count: item.count })
                : t(`inactive.items.${item.kind}`)}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => closeConfirm(false)}>
            {t('inactive.keep')}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => closeConfirm(true)}
          >
            {t('inactive.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (timing === 'after_trade') {
    return (
      // `flex-1` so the step flow's docked action bar reaches the bottom of a
      // phone screen rather than stopping under short content.
      <div className="flex w-full min-w-0 flex-1 flex-col gap-3">
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
          saveControls={saveControls}
        />
        {confirmDialog}
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
        saveControls={saveControls}
      />
      {confirmDialog}
    </div>
  );
}
