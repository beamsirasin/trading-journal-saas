'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * A SAVE KEY THAT ALREADY BELONGS TO A DIFFERENT REQUEST (contract §23).
 *
 * The server found a Trade under this draft's Save key, created from different
 * answers — another tab, or an earlier Save whose answer never arrived before
 * the trader kept editing. Nothing was written and nothing was overwritten, so
 * the draft stays exactly as it is, and the trader chooses:
 *
 * - "Open saved trade" — navigation; the draft is kept (UX Rules §5.3).
 * - "Save this draft as a new trade" — an explicit new Save key, only on this
 *   press. The key is never regenerated silently.
 */
export function TradeSaveReplayConflict({
  existingTradeId,
  pending,
  onSaveAsNew,
}: {
  existingTradeId: string;
  pending: boolean;
  onSaveAsNew: () => void;
}) {
  const t = useTranslations('trades.create.replay');
  return (
    <section
      role="alert"
      data-save-replay-conflict=""
      className="border-warning/40 bg-warning/5 flex min-w-0 flex-col gap-3 rounded-lg border px-4 py-3"
    >
      <div className="flex min-w-0 items-start gap-2">
        <CircleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-foreground text-sm font-semibold">{t('conflictTitle')}</h2>
          <p className="text-muted-foreground text-sm">{t('conflictDescription')}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/app/trades?trade=${existingTradeId}`}>{t('openSaved')}</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={pending}
          onClick={onSaveAsNew}
          data-save-as-new=""
        >
          {t('saveAsNew')}
        </Button>
      </div>
    </section>
  );
}

/**
 * AN HONEST REPLAY (contract §23): these exact answers had already been saved
 * by an earlier Save whose answer never arrived. The draft is cleared as after
 * any confirmed Save, but the trader is told nothing new was created.
 */
export function TradeAlreadySaved({
  headingRef,
  onOpen,
}: {
  headingRef: RefObject<HTMLHeadingElement | null>;
  onOpen: () => void;
}) {
  const t = useTranslations('trades.create.replay');
  return (
    <section
      data-save-already-saved=""
      className="bg-card border-border shadow-card mx-auto flex w-full max-w-xl min-w-0 flex-col gap-4 rounded-xl border px-5 py-6 sm:px-7"
    >
      <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-1">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-foreground text-xl font-semibold outline-none"
        >
          {t('alreadyTitle')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('alreadyDescription')}</p>
      </div>
      <div>
        <Button type="button" size="lg" className="min-h-12" onClick={onOpen}>
          {t('openTrade')}
        </Button>
      </div>
    </section>
  );
}
