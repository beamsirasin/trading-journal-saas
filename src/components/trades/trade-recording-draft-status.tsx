'use client';

import { History, Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
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
 *
 * `compact` (After Trade) says the two routine states — restored, and simply
 * working — as ONE quiet row instead of a sentence and a second line: the
 * restore icon and a short muted phrase, with a quiet destructive Discard at
 * the far end. The warnings (not restored, not durable, changed or removed in
 * another tab) keep their full sentences in every mode: they ask the trader to
 * do something, and a phrase too short to say what would hide that.
 */
export function RecordingDraftStatus({
  notice,
  hasWork,
  onDismissNotice,
  onDiscard,
  onLoadLatest,
  compact = false,
  discardElsewhere = false,
}: {
  notice: RecordingDraftNotice;
  hasWork: boolean;
  onDismissNotice: () => void;
  onDiscard: () => void;
  onLoadLatest?: () => void;
  compact?: boolean;
  /**
   * With nothing to say but "you can discard this", the page has placed
   * Discard in its own header instead (`DiscardDraftAction`), so this row
   * would be a whole section for one word. Only the plain working state steps
   * aside: a restored draft or a warning still speaks here.
   */
  discardElsewhere?: boolean;
}) {
  const t = useTranslations('trades.create.draft');
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (notice === null && !hasWork) return null;
  if (notice === null && discardElsewhere) return null;

  const confirm = (
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
  );

  if (compact && (notice === 'recovered' || notice === null)) {
    return (
      <div
        data-recording-draft-status={notice ?? 'working'}
        /*
          ONE ROW, AND NO TALLER THAN ITS TAP TARGET NEEDS. Discard keeps a
          44px hit area, but the row gives back 8px above and below so the
          step below moves up instead of starting under a 44px band of air.
        */
        className="-my-2 flex min-h-11 min-w-0 items-center justify-between gap-3 text-sm"
      >
        {notice === 'recovered' ? (
          <p role="status" className="text-muted-foreground flex min-w-0 items-center gap-1.5">
            <History className="size-4 shrink-0" aria-hidden="true" />
            {/*
              The long phrase where the row has room, the short one where it
              does not — never a wrapped block. Only one is ever displayed, so
              only one is ever read.
            */}
            <span className="min-w-0 truncate min-[360px]:hidden">{t('recoveredShort')}</span>
            <span className="hidden min-w-0 truncate min-[360px]:inline">
              {t('recoveredCompact')}
            </span>
          </p>
        ) : (
          <span />
        )}
        {hasWork ? (
          <DiscardDraftAction
            onDiscard={onDiscard}
            short={notice === 'recovered'}
            className="-mr-2 px-2"
          />
        ) : null}
      </div>
    );
  }

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
      {confirm}
    </div>
  );
}

/**
 * THE ONE DESTRUCTIVE WAY OUT, WHEREVER IT SITS. A quiet destructive text
 * action behind the same confirmation as every other Discard — so moving it
 * into a header row changes where it is, never what it does. Its accessible
 * name is always "Discard draft"; a short visible "Discard" is part of that
 * name, so voice control still finds it. Keeps a 44px tap height.
 */
export function DiscardDraftAction({
  onDiscard,
  short = false,
  className,
}: {
  onDiscard: () => void;
  short?: boolean;
  className?: string;
}) {
  const t = useTranslations('trades.create.draft');
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-recording-draft-discard=""
        aria-label={t('discard')}
        onClick={() => setConfirmOpen(true)}
        className={cn(
          'text-destructive/85 hover:text-destructive focus-visible:ring-ring inline-flex min-h-11 shrink-0 items-center rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2',
          className,
        )}
      >
        {short ? t('discardShort') : t('discard')}
      </button>
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
    </>
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
