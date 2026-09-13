'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { Link, useRouter } from '@/i18n/navigation';

/** One shared, guarded way back to the recording-timing choice. */
export function TradeRecordingModeChange({ isDirty }: { isDirty: boolean }) {
  const t = useTranslations('trades');
  const tMode = useTranslations('trades.create.mode');
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isDirty) {
    return (
      <Link
        href="/app/trades/new"
        data-recording-mode-change=""
        className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
      >
        {tMode('change')}
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        data-recording-mode-change=""
        onClick={() => setConfirmOpen(true)}
        className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
      >
        {tMode('change')}
      </button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tMode('changeConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{tMode('changeConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lifecycle.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                router.push('/app/trades/new');
              }}
            >
              {tMode('changeConfirm.continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
