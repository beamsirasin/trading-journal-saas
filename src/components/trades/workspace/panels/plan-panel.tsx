'use client';

import { useTranslations } from 'next-intl';

import { CONFIDENCE_LEVELS, confidenceLevelKey } from '@/lib/trades/constants';
import { cn } from '@/lib/utils';
import type { TradeCreateStrategyOption, TradeDetail } from '@/server/dal/trades';
import { AssignClassificationDialog } from '@/components/trades/trade-classification-actions';
import { formatPlannedRr } from '@/components/trades/trade-format';
import { SystemSection } from '@/components/trades/trade-system-section';
import {
  Fact,
  FactGrid,
  PanelEmpty,
  PanelSection,
} from '@/components/trades/workspace/panel-primitives';
import { Badge } from '@/components/ui/badge';

/**
 * PLAN — everything that was known or intended BEFORE the position was
 * entered, plus the counterfactual the system itself would have produced.
 *
 * WHY THE SYSTEM RESULT LIVES HERE AND NOT IN EXECUTION. The System axis is
 * not something the trader did; it is what the strategy's own rules would have
 * returned had they been followed exactly (CLAUDE.md section 1). It belongs
 * with the plan it is derived from, on the opposite side of the page from what
 * the trader actually did — which is precisely the separation this product
 * exists to make legible. It is also why the Review column's "Needs system
 * result" state opens this tab.
 *
 * `SystemSection` is reused verbatim rather than reimplemented: it already
 * owns the System Plan prices, the Money-vs-Price plan basis disclosure, the
 * System Outcome, and every mutation that changes them. A second rendering of
 * the same fields in a sheet would be a second place for them to drift.
 */
export function TradePlanPanel({
  trade,
  timezone,
  locale,
  canWrite,
  classificationOptions,
}: {
  trade: TradeDetail;
  timezone: string;
  locale: string;
  canWrite: boolean;
  classificationOptions: readonly TradeCreateStrategyOption[];
}) {
  const t = useTranslations('trades.workspace.details');
  const tTrades = useTranslations('trades');

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection title={t('groups.classification')}>
        {trade.strategyName === null ? (
          <div className="flex flex-col gap-3">
            <PanelEmpty
              title={t('empty.classification.title')}
              description={t('empty.classification.description')}
            />
            {canWrite ? (
              <div>
                <AssignClassificationDialog trade={trade} strategies={classificationOptions} />
              </div>
            ) : null}
          </div>
        ) : (
          <FactGrid>
            <Fact
              label={tTrades('field.strategy')}
              value={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {trade.strategyName}
                  {trade.strategyIsArchived ? (
                    <Badge className="px-2 py-0.5">{tTrades('common.archived')}</Badge>
                  ) : null}
                </span>
              }
            />
            <Fact
              label={tTrades('field.setup')}
              value={
                trade.setupName === null ? null : (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {trade.setupName}
                    {trade.setupIsArchived ? (
                      <Badge className="px-2 py-0.5">{tTrades('common.archived')}</Badge>
                    ) : null}
                  </span>
                )
              }
            />
            <Fact label={tTrades('field.timeframe')} value={trade.timeframe} />
            <Fact label={tTrades('field.session')} value={trade.session} />
          </FactGrid>
        )}
      </PanelSection>

      <ConfidenceBlock trade={trade} />

      <PanelSection title={t('groups.plannedReward')}>
        <FactGrid>
          <Fact
            label={tTrades('field.plannedR')}
            value={formatPlannedRr(trade.plannedR)}
            hint={t('hints.plannedRr')}
            tone="neutral"
          />
        </FactGrid>
      </PanelSection>

      <SetupChecklist trade={trade} />

      <PanelSection title={tTrades('field.entryReason')}>
        {trade.confirmationNotes === null ? (
          <p className="text-muted-foreground text-sm">{tTrades('common.notSet')}</p>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{trade.confirmationNotes}</p>
        )}
      </PanelSection>

      {/*
        The System Plan's own prices, the plan basis, the System Outcome and
        every action that resolves it — owned entirely by the existing section.
      */}
      <div className="border-border border-t pt-5">
        <SystemSection trade={trade} timezone={timezone} locale={locale} canWrite={canWrite} />
      </div>
    </div>
  );
}

/**
 * CONFIDENCE — how sure the trader was BEFORE entering, and nothing else.
 *
 * IT IS NEVER DERIVED FROM THE OUTCOME. This reads the persisted
 * `trades.confidence` and renders the product's own five-step vocabulary
 * (`CONFIDENCE_LEVELS`: Very Low / Low / Neutral / High / Very High, locked to
 * the exact steps 0/25/50/75/100 the database CHECK constraint enforces).
 * There is no second confidence model here and no inference of one — a winning
 * Trade entered with Low confidence stays Low, which is the entire reason the
 * field is worth capturing.
 *
 * The five steps are drawn as a track rather than printed as "50%", because
 * the number is an encoding of a position on a scale, not a measurement of
 * anything. The label is what the trader chose; the track is where it sits.
 */
function ConfidenceBlock({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades.workspace.details');
  const tTrades = useTranslations('trades');

  if (trade.confidence === null) {
    return (
      <PanelSection title={tTrades('field.confidence')} description={t('confidenceMeaning')}>
        <PanelEmpty
          title={t('empty.confidence.title')}
          description={t('empty.confidence.description')}
        />
      </PanelSection>
    );
  }

  // Captured before the closure below, so the narrowing survives into it —
  // a non-null assertion inside the map would be asserting exactly what the
  // guard above already proved.
  const confidence = trade.confidence;
  const activeKey = confidenceLevelKey(confidence);

  return (
    <PanelSection title={tTrades('field.confidence')} description={t('confidenceMeaning')}>
      <p data-trade-confidence={trade.confidence} className="text-foreground text-sm font-semibold">
        {tTrades(`create.confidence.level.${activeKey}`)}
      </p>
      {/*
        The scale is decorative reinforcement of the label above, so it is
        hidden from assistive technology entirely rather than announced as five
        unlabelled cells.
      */}
      <div aria-hidden="true" className="flex min-w-0 gap-1">
        {CONFIDENCE_LEVELS.map((level) => (
          <span
            key={level.key}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              level.value <= confidence ? 'bg-primary' : 'bg-muted',
            )}
          />
        ))}
      </div>
    </PanelSection>
  );
}

/**
 * The Setup Checklist, preserving the domain's THREE-state truth exactly as
 * the DAL reports it: recorded (this Trade has its own immutable snapshot),
 * not_configured (the pinned Setup Version genuinely had no conditions), and
 * not_recorded (conditions existed but no answer was ever captured, or there
 * is no Setup at all). Collapsing the last two into "0%" would invent a
 * failure out of an absence.
 */
function SetupChecklist({ trade }: { trade: TradeDetail }) {
  const t = useTranslations('trades.workspace.details');
  const tTrades = useTranslations('trades');

  if (trade.setupConditionState !== 'recorded') {
    return (
      <PanelSection title={tTrades('detail.sections.conditions')}>
        <p className="text-muted-foreground text-sm">
          {trade.setupConditionState === 'not_configured'
            ? tTrades('create.conditions.notConfigured')
            : tTrades('lifecycle.reflection.notRecorded')}
        </p>
      </PanelSection>
    );
  }

  const met = trade.setupConditionChecks.filter((check) => check.checkStatus === 'met').length;
  const total = trade.setupConditionChecks.length;

  return (
    <PanelSection title={tTrades('detail.sections.conditions')}>
      <p className="text-sm font-medium">{t('checklistCount', { met, total })}</p>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {trade.setupConditionChecks.map((check) => (
          <li
            key={check.conditionKey}
            className="border-border flex min-w-0 items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <span className="min-w-0 break-words">{check.label}</span>
            <Badge
              variant={check.checkStatus === 'met' ? 'positive' : 'negative'}
              className="shrink-0 px-2 py-0.5"
            >
              {tTrades(`detail.conditions.${check.checkStatus === 'met' ? 'met' : 'notMet'}`)}
            </Badge>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
}
