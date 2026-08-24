'use client';

import { Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { MutationDenialReason } from '@/lib/entitlements/resolve';
import { cn } from '@/lib/utils';
import type { CreateStrategyData } from '@/server/actions/strategies';
import type { StrategyListItem } from '@/server/dal/strategies';
import { EmptyState } from '@/components/product/empty-state';
import { StrategyDetail, type StrategyDetailView } from '@/components/strategies/strategy-detail';
import { StrategyFormDialog } from '@/components/strategies/strategy-form';
import { StrategyList } from '@/components/strategies/strategy-list';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';

/**
 * The interactive shell behind `/app/strategies` — Strategy list, selected
 * Strategy detail, and every create/edit/archive/restore mutation, following
 * the same single-shared-client-component posture as
 * `AccountsManager`: one place to own pending/feedback state and
 * `router.refresh()` after a mutation, rather than independent islands
 * guessing at each other's effects.
 *
 * Selection is the `?strategy=<uuid>` URL search param, resolved server-side
 * in `page.tsx` (`StrategyIdSchema.safeParse`) — this component never fetches
 * Strategy data itself (the DAL is `server-only`); it only navigates.
 */
export function StrategiesManager({
  strategies,
  selectedStrategy,
  selectedStrategyId,
  canWrite,
  writeBlockReason,
}: {
  strategies: readonly StrategyListItem[];
  selectedStrategy: StrategyDetailView | null;
  selectedStrategyId: string | null;
  canWrite: boolean;
  writeBlockReason: MutationDenialReason | null;
}) {
  const t = useTranslations('strategies');
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );
  const hasSelection = selectedStrategyId !== null;

  function handleMutated(key: string) {
    setFeedback({ tone: 'success', message: t(`feedback.${key}` as Parameters<typeof t>[0]) });
    router.refresh();
  }

  function handleCreateStrategySuccess(data: CreateStrategyData) {
    setFeedback({
      tone: 'success',
      message: t(
        data.alreadyCreated ? 'feedback.strategyAlreadyCreated' : 'feedback.strategyCreated',
      ),
    });
    router.push(`/app/strategies?strategy=${data.strategyId}`);
  }

  function handleBack() {
    router.push('/app/strategies');
  }

  return (
    <div className="flex flex-col gap-6">
      {feedback === null ? null : (
        <div
          role="status"
          aria-live="polite"
          className={
            feedback.tone === 'success'
              ? 'border-positive/25 bg-positive/10 text-positive rounded-lg border p-4 text-sm font-medium'
              : 'border-destructive/25 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm font-medium'
          }
        >
          {feedback.message}
        </div>
      )}

      {canWrite || writeBlockReason === null ? null : (
        <div
          role="status"
          className="border-warning/30 bg-warning/10 rounded-lg border p-4 text-sm"
        >
          <span className="text-foreground">
            {t(`errors.${writeBlockReason}` as Parameters<typeof t>[0])}
          </span>
        </div>
      )}

      {strategies.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('noStrategiesTitle')}
          description={t('noStrategiesDescription')}
          action={
            canWrite ? (
              <StrategyFormDialog
                mode="create"
                trigger={<Button>{t('createStrategy')}</Button>}
                onSuccess={handleCreateStrategySuccess}
              />
            ) : null
          }
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
          <div className={cn('flex flex-col gap-4', hasSelection && 'hidden lg:flex')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-card-title">{t('listHeading')}</h2>
              {canWrite ? (
                <StrategyFormDialog
                  mode="create"
                  trigger={<Button size="sm">{t('createStrategy')}</Button>}
                  onSuccess={handleCreateStrategySuccess}
                />
              ) : null}
            </div>
            <StrategyList strategies={strategies} selectedStrategyId={selectedStrategyId} />
          </div>

          <div className={cn('min-w-0', !hasSelection && 'hidden lg:block')}>
            {selectedStrategy === null ? (
              <div className="border-border bg-card hidden rounded-lg border border-dashed p-12 text-center lg:block">
                <p className="text-muted-foreground text-sm">{t('selectStrategyPrompt')}</p>
              </div>
            ) : (
              <StrategyDetail
                strategy={selectedStrategy}
                canWrite={canWrite}
                writeBlockReason={writeBlockReason}
                onMutated={handleMutated}
                onBack={handleBack}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
