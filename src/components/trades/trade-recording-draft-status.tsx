'use client';

import { History, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

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
import { Link } from '@/i18n/navigation';

import { recordingDraftSymbol, type RecordingMode } from './recording-draft';
import {
  loadRecordingDraft,
  removeRecordingDraft,
  type RecordingDraftScope,
} from './recording-draft-storage';

export type RecordingDraftNotice =
  | 'recovered'
  | 'unrecoverable'
  | 'not_durable'
  /** Another tab wrote a different version of this draft. */
  | 'changed_elsewhere'
  /** Another tab saved or discarded this draft. */
  | 'removed_elsewhere'
  | null;

/**
 * THE ONE PLACE A TRADER SEES THE DRAFT ITSELF (UX Rules §5.4, §5.6).
 *
 * - After a reload or a return it says the draft was restored, and offers the
 *   one destructive way out.
 * - A stored draft that could not be read is named honestly; nothing was filled
 *   in from it.
 * - When this browser cannot keep drafts, it says so, so a reload is never
 *   trusted to recover work it will not.
 * - When another tab changed or removed the same draft, it says so, and offers
 *   to load the other tab's latest version instead of overwriting it.
 * - "Discard draft" is always behind a confirmation that says what is removed
 *   and what is not. Nothing else on the page destroys the draft.
 */
export function RecordingDraftStatus({
  notice,
  hasWork,
  onDismissNotice,
  onDiscard,
  onLoadLatest,
}: {
  notice: RecordingDraftNotice;
  hasWork: boolean;
  onDismissNotice: () => void;
  onDiscard: () => void;
  onLoadLatest?: () => void;
}) {
  const t = useTranslations('trades.create.draft');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (notice === null && !hasWork) return null;

  const message =
    notice === 'recovered'
      ? t('recovered')
      : notice === 'unrecoverable'
        ? t('unrecoverable')
        : notice === 'not_durable'
          ? t('notDurable')
          : notice === 'changed_elsewhere'
            ? t('changedElsewhere')
            : notice === 'removed_elsewhere'
              ? t('removedElsewhere')
              : null;

  return (
    <div
      data-recording-draft-status={notice ?? 'working'}
      className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm"
    >
      {message === null ? null : (
        <p role="status" className="text-foreground flex min-w-0 items-start gap-2">
          {notice === 'recovered' ? (
            <History className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          )}
          <span className="min-w-0">{message}</span>
        </p>
      )}
      {notice === 'changed_elsewhere' && onLoadLatest !== undefined ? (
        <button
          type="button"
          data-recording-draft-load-latest=""
          onClick={onLoadLatest}
          className="text-primary focus-visible:ring-ring min-h-11 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {t('loadLatest')}
        </button>
      ) : null}
      {notice === 'unrecoverable' || notice === 'removed_elsewhere' ? (
        <button
          type="button"
          onClick={onDismissNotice}
          className="text-primary focus-visible:ring-ring min-h-11 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {t('dismiss')}
        </button>
      ) : null}
      {hasWork ? (
        <button
          type="button"
          data-recording-draft-discard=""
          onClick={() => setConfirmOpen(true)}
          className="text-destructive focus-visible:ring-ring min-h-11 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {t('discard')}
        </button>
      ) : null}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmOpen(false);
                onDiscard();
              }}
            >
              {t('discardConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * ON THE RECORDING CHOICE, A KEPT DRAFT IS NAMED (UX Rules §5.4).
 *
 * Leaving Add Trade never destroys the Recording Draft, so arriving back at the
 * choice says one exists, what it is, and offers to continue it or to discard
 * it. Choosing either mode card still opens the same draft in that mode.
 */
export function RecordingDraftResumeNotice({ draftScope }: { draftScope: RecordingDraftScope }) {
  const t = useTranslations('trades.create.draft');
  const tMode = useTranslations('trades.create.mode');
  const [draft, setDraft] = useState<{
    readonly mode: RecordingMode;
    readonly symbol: string | null;
  } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { ownerKey, workspaceKey } = draftScope;

  useEffect(() => {
    const loaded = loadRecordingDraft({ ownerKey, workspaceKey }, new Date());
    if (loaded.status !== 'recovered') return;
    const { envelope } = loaded;
    // Browser storage is only readable after hydration; this effect is that read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft({ mode: envelope.activeMode, symbol: recordingDraftSymbol(envelope) });
  }, [ownerKey, workspaceKey]);

  if (draft === null) return null;

  return (
    <section
      data-recording-draft-resume=""
      aria-labelledby="recording-draft-resume-title"
      className="border-border bg-card flex min-w-0 flex-col gap-2 rounded-lg border px-4 py-3"
    >
      <h2 id="recording-draft-resume-title" className="text-foreground text-sm font-semibold">
        {t('resume.title')}
      </h2>
      <p className="text-muted-foreground text-sm">
        {t('resume.description', {
          symbol: draft.symbol ?? t('resume.noSymbol'),
          mode: tMode(`${draft.mode}.title`),
        })}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href={`/app/trades/new?timing=${draft.mode}`}
          className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {t('resume.continue')}
        </Link>
        <button
          type="button"
          data-recording-draft-discard=""
          onClick={() => setConfirmOpen(true)}
          className="text-destructive focus-visible:ring-ring min-h-11 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
        >
          {t('discard')}
        </button>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                removeRecordingDraft({ ownerKey, workspaceKey });
                setConfirmOpen(false);
                setDraft(null);
              }}
            >
              {t('discardConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
