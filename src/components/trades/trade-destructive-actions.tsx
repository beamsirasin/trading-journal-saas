'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { cancelTradeAction, softDeleteTradeAction } from '@/server/actions/trades';
import { actionErrorCode, ActionFeedback } from '@/components/trades/trade-action-form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

export function CancelTradeControl({ tradeId }: { tradeId: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  function confirm() {
    setFeedback(null);
    startTransition(async () => {
      const result = await cancelTradeAction({ tradeId });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(t(`errors.${code}`));
      router.refresh();
    });
  }
  return (
    <div className="grid gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline">{t('lifecycle.cancelTrade.action')}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('lifecycle.cancelTrade.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('lifecycle.cancelTrade.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lifecycle.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={confirm}>
              {pending ? t('lifecycle.common.saving') : t('lifecycle.cancelTrade.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionFeedback message={feedback} />
    </div>
  );
}

export function DeleteTradeControl({ tradeId }: { tradeId: string }) {
  const t = useTranslations('trades');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  function confirm() {
    setFeedback(null);
    startTransition(async () => {
      const result = await softDeleteTradeAction({ tradeId });
      const code = actionErrorCode(result);
      if (code !== null) return setFeedback(t(`errors.${code}`));
      router.replace('/app/trades');
      router.refresh();
    });
  }
  return (
    <div className="grid gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">{t('lifecycle.delete.action')}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('lifecycle.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('lifecycle.delete.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('lifecycle.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={pending}
              onClick={confirm}
            >
              {pending ? t('lifecycle.delete.deleting') : t('lifecycle.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ActionFeedback message={feedback} />
    </div>
  );
}
