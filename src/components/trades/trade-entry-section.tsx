import { ExternalLink, ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { confidenceLevelKey } from '@/lib/trades/constants';
import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { DetailRow, SectionTitle, SubSection } from '@/components/trades/trade-detail-primitives';
import { TradeEmotionsEditor } from '@/components/trades/trade-reflection-editor';
import { Badge } from '@/components/ui/badge';

/** The full Setup Checklist item list — moved verbatim from the former "Entry Snapshot" section. */
function SetupConditionsDetail({
  trade,
  t,
}: {
  trade: TradeDetailModel;
  t: ReturnType<typeof useTranslations<'trades'>>;
}) {
  if (trade.setupConditionState === 'not_recorded') {
    return <p className="text-muted-foreground text-sm">{t('lifecycle.reflection.notRecorded')}</p>;
  }
  if (trade.setupConditionState === 'not_configured') {
    return <p className="text-muted-foreground text-sm">{t('create.conditions.notConfigured')}</p>;
  }

  const met = trade.setupConditionChecks.filter((check) => check.checkStatus === 'met').length;
  const total = trade.setupConditionChecks.length;
  const percentage = total === 0 ? 0 : Math.round((met / total) * 100);

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">
        {t('create.conditions.adherence', { met, total, percentage })}
      </p>
      <ul className="grid gap-2">
        {trade.setupConditionChecks.map((check) => (
          <li
            key={check.conditionKey}
            className="border-border flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
          >
            <span>{check.label}</span>
            <Badge variant={check.checkStatus === 'met' ? 'positive' : 'negative'}>
              {t(`detail.conditions.${check.checkStatus === 'met' ? 'met' : 'notMet'}`)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function checklistSummary(
  trade: TradeDetailModel,
  t: ReturnType<typeof useTranslations<'trades'>>,
) {
  if (trade.setupConditionState === 'not_recorded') return t('lifecycle.reflection.notRecorded');
  if (trade.setupConditionState === 'not_configured') return t('create.conditions.notConfigured');
  return t('detail.overview.checklistCount', {
    met: trade.setupConditionChecks.filter((check) => check.checkStatus === 'met').length,
    total: trade.setupConditionChecks.length,
  });
}

function emotionSummary(trade: TradeDetailModel, t: ReturnType<typeof useTranslations<'trades'>>) {
  if (trade.emotionsRecordedAt === null) return t('lifecycle.reflection.notRecorded');
  if (trade.emotions.length === 0) return t('lifecycle.reflection.noneSelected');
  return trade.emotions.map((emotion) => t(`emotions.${emotion.key}`)).join(' · ');
}

/**
 * ENTRY SNAPSHOT — Phase 15E. Answers "what did I know, see and feel at
 * entry?" Scan-friendly summary first (brief §22), full detail behind a
 * native `<details>` disclosure (a real semantic expand control, not a
 * decorative accordion). Preserves entry-time truth exactly (brief §23):
 * `not_recorded`/`not_configured`/NULL-vs-0/empty-vs-never-recorded all stay
 * byte-for-byte the same distinctions the current domain model already
 * makes — nothing here reinterprets or invents history. Operational Plan
 * values and correction now live in Actual; this section retains only the
 * contextual evidence captured around entry.
 */
export function EntrySnapshotSection({
  trade,
  canWrite,
}: {
  trade: TradeDetailModel;
  canWrite: boolean;
}) {
  const t = useTranslations('trades');
  return (
    <section aria-labelledby="trade-entry-heading" className="grid gap-5">
      <SectionTitle id="trade-entry-heading">{t('detail.sections.entrySnapshot')}</SectionTitle>

      <dl className="divide-border divide-y">
        <DetailRow label={t('detail.sections.conditions')} value={checklistSummary(trade, t)} />
        <DetailRow
          label={t('field.confidence')}
          value={
            trade.confidence === null
              ? t('common.notSet')
              : `${trade.confidence}% · ${t(`create.confidence.level.${confidenceLevelKey(trade.confidence)}`)}`
          }
        />
        <DetailRow label={t('lifecycle.reflection.emotions')} value={emotionSummary(trade, t)} />
        <DetailRow
          label={t('field.entryReason')}
          value={
            trade.confirmationNotes === null
              ? t('common.notSet')
              : t('lifecycle.reflection.recorded')
          }
        />
        <DetailRow
          label={t('field.chartAttachment')}
          value={
            trade.hasChartAttachment || trade.tradingviewUrl !== null
              ? t('lifecycle.reflection.recorded')
              : t('common.notSet')
          }
        />
      </dl>

      <details className="group">
        <summary className="text-primary flex min-h-11 w-fit cursor-pointer items-center text-sm font-medium underline-offset-4 hover:underline">
          {t('detail.overview.showDetails')}
        </summary>
        <div className="grid gap-6 pt-4">
          <SubSection title={t('detail.sections.conditions')}>
            <SetupConditionsDetail trade={trade} t={t} />
          </SubSection>

          <SubSection title={t('lifecycle.reflection.emotions')}>
            <TradeEmotionsEditor
              tradeId={trade.tradeId}
              emotions={trade.emotions}
              emotionCatalog={trade.emotionCatalog}
              emotionsRecorded={trade.emotionsRecordedAt !== null}
              canWrite={canWrite}
            />
          </SubSection>

          <SubSection title={t('field.entryReason')}>
            {trade.confirmationNotes === null ? (
              <p className="text-muted-foreground text-sm">{t('common.notSet')}</p>
            ) : (
              <p className="text-sm">{trade.confirmationNotes}</p>
            )}
          </SubSection>

          <SubSection id="trade-entry-plan" title={t('create.sections.context')}>
            <dl className="divide-border divide-y">
              {trade.timeframe === null ? null : (
                <DetailRow label={t('field.timeframe')} value={trade.timeframe} />
              )}
              {trade.session === null ? null : (
                <DetailRow label={t('field.session')} value={trade.session} />
              )}
              {trade.tradingviewUrl === null ? null : (
                <DetailRow
                  label={t('field.tradingViewUrl')}
                  value={
                    <a
                      href={trade.tradingviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex min-h-11 items-center gap-1 underline-offset-4 hover:underline"
                    >
                      {t('detail.openChart')} <ExternalLink className="size-4" aria-hidden="true" />
                    </a>
                  }
                />
              )}
              {!trade.hasChartAttachment ? null : (
                <DetailRow
                  label={t('field.chartAttachment')}
                  value={
                    <div className="flex flex-col items-start gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by our own authenticated, private-storage-backed route, never a static/remote host next/image could optimize. */}
                      <img
                        src={`/api/trades/${trade.tradeId}/chart-attachment`}
                        alt={t('detail.chartImageAlt')}
                        className="border-border max-h-64 w-auto rounded-md border object-contain"
                      />
                      <a
                        href={`/api/trades/${trade.tradeId}/chart-attachment`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex min-h-11 items-center gap-1 text-xs underline-offset-4 hover:underline"
                      >
                        {t('detail.openChartImage')}{' '}
                        <ImageIcon className="size-4" aria-hidden="true" />
                      </a>
                    </div>
                  }
                />
              )}
              {trade.notes === null ? null : (
                <DetailRow label={t('field.notes')} value={trade.notes} />
              )}
            </dl>
          </SubSection>
        </div>
      </details>
    </section>
  );
}
