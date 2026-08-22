import { useTranslations } from 'next-intl';

import type {
  TradeCreateStrategyOption,
  TradeDetail as TradeDetailModel,
} from '@/server/dal/trades';
import { AssignClassificationDialog } from '@/components/trades/trade-classification-actions';
import {
  ArchivedBadge,
  DetailRow,
  SectionTitle,
} from '@/components/trades/trade-detail-primitives';
import { TradeSectionLink } from '@/components/trades/trade-section-nav';

/**
 * "Captured at entry" vs "Added after entry" (Phase 14C §6) — truthfully
 * derived from `strategy_assigned_at`/`setup_assigned_at` relative to
 * `entered_at`, never a raw timestamp. Shown only once the Trade has
 * actually been Opened — before that, "entry" hasn't happened yet, so
 * neither label would mean anything.
 */
function ClassificationTiming({
  assignedAt,
  enteredAt,
  t,
}: {
  assignedAt: string | null;
  enteredAt: string | null;
  t: ReturnType<typeof useTranslations<'trades'>>;
}) {
  if (enteredAt === null || assignedAt === null) return null;
  const capturedAtEntry = new Date(assignedAt).getTime() <= new Date(enteredAt).getTime();
  return (
    <span className="text-muted-foreground block text-xs">
      {capturedAtEntry
        ? t('lifecycle.classification.capturedAtEntry')
        : t('lifecycle.classification.addedAfterEntry')}
    </span>
  );
}

/**
 * Setup Checklist existence/status only (brief §20) — never the complete
 * Entry Snapshot detail, which stays exclusively in Entry Snapshot. `[View
 * Entry Snapshot]` is the one deep link, never a duplicate render of the
 * checklist items themselves.
 */
function SetupChecklistSummary({
  trade,
  t,
}: {
  trade: TradeDetailModel;
  t: ReturnType<typeof useTranslations<'trades'>>;
}) {
  if (trade.setupName === null) return null;

  const summary =
    trade.setupConditionState === 'not_recorded'
      ? t('lifecycle.reflection.notRecorded')
      : trade.setupConditionState === 'not_configured'
        ? t('create.conditions.notConfigured')
        : t('detail.overview.checklistCount', {
            met: trade.setupConditionChecks.filter((check) => check.checkStatus === 'met').length,
            total: trade.setupConditionChecks.length,
          });

  return (
    <div className="grid gap-2 pt-2">
      <DetailRow label={t('detail.sections.conditions')} value={summary} />
      <TradeSectionLink
        tradeId={trade.tradeId}
        section="entry"
        className="text-primary min-h-11 w-fit content-center text-sm font-medium underline-offset-4 hover:underline"
      >
        {t('detail.overview.viewEntrySnapshot')}
      </TradeSectionLink>
    </div>
  );
}

/**
 * STRATEGY & SETUP — Phase 15E. Answers "what framework did this Trade
 * belong to?" Late classification is valid, never a journal failure (brief
 * §17-18); the sole action here is `AssignClassificationDialog`, relocated
 * from its existing inline position (unchanged — already colocated
 * correctly before this phase). Version pinning/coherence is entirely the
 * service's job (`assignTradeClassificationAction`) — this section only
 * ever displays what the service has already resolved, never recomputes it.
 */
export function StrategySetupSection({
  trade,
  canWrite,
  classificationOptions,
}: {
  trade: TradeDetailModel;
  canWrite: boolean;
  classificationOptions: readonly TradeCreateStrategyOption[];
}) {
  const t = useTranslations('trades');
  const archivedLabel = t('common.archived');

  return (
    <section aria-labelledby="trade-strategy-heading" className="grid gap-4">
      <SectionTitle id="trade-strategy-heading">{t('detail.sections.classification')}</SectionTitle>

      {trade.strategyName === null ? (
        <div className="grid gap-3">
          <p className="text-muted-foreground text-sm">{t('common.notAssigned')}</p>
          <p className="text-muted-foreground text-sm">{t('lifecycle.classification.laterHint')}</p>
          {canWrite ? (
            <div>
              <AssignClassificationDialog trade={trade} strategies={classificationOptions} />
            </div>
          ) : null}
        </div>
      ) : (
        <dl className="divide-border divide-y">
          <DetailRow
            label={t('field.strategy')}
            value={
              <span className="inline-flex flex-wrap items-center gap-2">
                {trade.strategyName}
                <ArchivedBadge show={trade.strategyIsArchived} label={archivedLabel} />
              </span>
            }
          />
          {trade.strategyVersionNumber === null ? null : (
            <DetailRow label={t('field.version')} value={trade.strategyVersionNumber} />
          )}
          <DetailRow
            label={t('field.setup')}
            value={
              trade.setupName === null ? (
                <div className="grid gap-2">
                  <span>{t('common.notAssigned')}</span>
                  {canWrite ? (
                    <div>
                      <AssignClassificationDialog
                        trade={trade}
                        strategies={classificationOptions}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {trade.setupName}
                  <ArchivedBadge show={trade.setupIsArchived} label={archivedLabel} />
                </span>
              )
            }
          />
          <ClassificationTiming
            assignedAt={trade.strategyAssignedAt}
            enteredAt={trade.enteredAt}
            t={t}
          />
          {trade.setupName === null ? null : (
            <ClassificationTiming
              assignedAt={trade.setupAssignedAt}
              enteredAt={trade.enteredAt}
              t={t}
            />
          )}
        </dl>
      )}

      <SetupChecklistSummary trade={trade} t={t} />
    </section>
  );
}
