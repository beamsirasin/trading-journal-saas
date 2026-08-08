import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { TradeDetail as TradeDetailModel } from '@/server/dal/trades';
import { formatR, formatTradeInstant, formatTradeMoney } from '@/components/trades/trade-format';
import { TradeOutcomeBadge } from '@/components/trades/trade-outcome-badge';
import { SystemStatusBadge, TradeStatusBadge } from '@/components/trades/trade-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[minmax(130px,0.7fr)_1fr] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="min-w-0 text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="border-border bg-card rounded-lg border p-4 sm:p-5">
      <h3 id={id} className="text-card-title mb-3">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function TradeDetail({
  trade,
  timezone,
  locale,
}: {
  trade: TradeDetailModel;
  timezone: string;
  locale: string;
}) {
  const t = useTranslations('trades');
  const instant = (value: string | null) => formatTradeInstant(value, timezone, locale) ?? '—';
  const money = (value: string | null) =>
    formatTradeMoney(value, trade.tradingAccountBaseCurrency) ?? '—';
  const ruleGroups = {
    strategy: trade.ruleChecks.filter((rule) => rule.scope === 'strategy'),
    setup: trade.ruleChecks.filter((rule) => rule.scope === 'setup'),
  };

  return (
    <article className="flex min-w-0 flex-col gap-5" aria-labelledby="trade-detail-heading">
      <Button asChild variant="ghost" className="w-fit lg:hidden">
        <Link href="/app/trades">
          <ArrowLeft aria-hidden="true" /> {t('detail.back')}
        </Link>
      </Button>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">{t(`direction.${trade.direction}`)}</p>
          <h2 id="trade-detail-heading" className="text-2xl font-semibold tracking-tight">
            {trade.symbol}
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {trade.strategyName} · {trade.setupName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TradeStatusBadge status={trade.status} />
          <SystemStatusBadge status={trade.systemStatus} />
        </div>
      </header>

      <Section id="trade-overview" title={t('detail.sections.overview')}>
        <dl className="divide-border divide-y">
          <DetailRow label={t('field.account')} value={trade.tradingAccountName} />
          <DetailRow label={t('field.strategy')} value={trade.strategyName} />
          <DetailRow label={t('field.version')} value={trade.strategyVersionNumber} />
          <DetailRow label={t('field.setup')} value={trade.setupName} />
          <DetailRow
            label={t('field.executionStatus')}
            value={<TradeStatusBadge status={trade.status} />}
          />
          <DetailRow
            label={t('field.systemStatus')}
            value={<SystemStatusBadge status={trade.systemStatus} />}
          />
          <DetailRow label={t('field.createdAt')} value={instant(trade.createdAt)} />
          {trade.enteredAt === null ? null : (
            <DetailRow label={t('field.enteredAt')} value={instant(trade.enteredAt)} />
          )}
          {trade.exitedAt === null ? null : (
            <DetailRow label={t('field.exitedAt')} value={instant(trade.exitedAt)} />
          )}
        </dl>
      </Section>

      <Section id="trade-plan" title={t('detail.sections.plan')}>
        <dl className="divide-border divide-y">
          <DetailRow label={t('field.entry')} value={trade.plannedEntry} />
          <DetailRow label={t('field.stop')} value={trade.plannedStop} />
          <DetailRow label={t('field.target')} value={trade.plannedTarget ?? t('common.notSet')} />
          <DetailRow
            label={t('field.positionSize')}
            value={trade.plannedPositionSize ?? t('common.notSet')}
          />
          <DetailRow
            label={t('field.plannedR')}
            value={formatR(trade.plannedR) ?? t('common.notAvailable')}
          />
          {trade.timeframe === null ? null : (
            <DetailRow label={t('field.timeframe')} value={trade.timeframe} />
          )}
          {trade.session === null ? null : (
            <DetailRow label={t('field.session')} value={trade.session} />
          )}
          {trade.confidence === null ? null : (
            <DetailRow label={t('field.confidence')} value={`${trade.confidence}/5`} />
          )}
          {trade.confirmationNotes === null ? null : (
            <DetailRow label={t('field.confirmationNotes')} value={trade.confirmationNotes} />
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
          {trade.notes === null ? null : <DetailRow label={t('field.notes')} value={trade.notes} />}
        </dl>
      </Section>

      <Section id="trade-execution" title={t('detail.sections.execution')}>
        {trade.status === 'planned' || trade.status === 'canceled' ? (
          <p className="text-muted-foreground text-sm">{t('detail.notOpened')}</p>
        ) : (
          <dl className="divide-border divide-y">
            <DetailRow label={t('field.actualEntry')} value={trade.actualEntry ?? '—'} />
            <DetailRow label={t('field.initialStop')} value={trade.actualInitialStop ?? '—'} />
            {trade.actualPositionSize === null ? null : (
              <DetailRow label={t('field.actualPositionSize')} value={trade.actualPositionSize} />
            )}
            <DetailRow label={t('field.initialRisk')} value={money(trade.actualInitialRiskMinor)} />
            {trade.actualExit === null ? null : (
              <DetailRow label={t('field.exit')} value={trade.actualExit} />
            )}
            {trade.grossPnlMinor === null ? null : (
              <DetailRow label={t('field.grossPnl')} value={money(trade.grossPnlMinor)} />
            )}
            <DetailRow label={t('field.commission')} value={money(trade.commissionMinor)} />
            <DetailRow label={t('field.fees')} value={money(trade.feesMinor)} />
            <DetailRow label={t('field.swap')} value={money(trade.swapMinor)} />
            {trade.netPnlMinor === null ? null : (
              <DetailRow label={t('field.netPnl')} value={money(trade.netPnlMinor)} />
            )}
            <DetailRow
              label={t('field.actualR')}
              value={formatR(trade.actualR) ?? t('common.notAvailable')}
            />
            <DetailRow
              label={t('field.traderOutcome')}
              value={<TradeOutcomeBadge outcome={trade.traderOutcome} />}
            />
            <DetailRow label={t('field.enteredAt')} value={instant(trade.enteredAt)} />
            {trade.exitedAt === null ? null : (
              <DetailRow label={t('field.exitedAt')} value={instant(trade.exitedAt)} />
            )}
          </dl>
        )}
      </Section>

      <Section id="trade-system" title={t('detail.sections.system')}>
        {trade.systemStatus === 'pending' ? (
          <p className="text-muted-foreground text-sm">{t('detail.systemPending')}</p>
        ) : trade.systemStatus === 'no_trade' ? (
          <p className="text-muted-foreground text-sm">{t('detail.systemNoTrade')}</p>
        ) : (
          <dl className="divide-border divide-y">
            <DetailRow label={t('field.exit')} value={trade.systemExitPrice ?? '—'} />
            <DetailRow label={t('field.systemExitedAt')} value={instant(trade.systemExitedAt)} />
            <DetailRow
              label={t('field.systemExitReason')}
              value={
                trade.systemExitReason === null ? '—' : t(`systemReason.${trade.systemExitReason}`)
              }
            />
            <DetailRow label={t('field.systemCostR')} value={formatR(trade.systemCostR) ?? '—'} />
            <DetailRow
              label={t('field.systemR')}
              value={formatR(trade.systemR) ?? t('common.notAvailable')}
            />
            <DetailRow
              label={t('field.systemOutcome')}
              value={<TradeOutcomeBadge outcome={trade.systemOutcome} />}
            />
          </dl>
        )}
      </Section>

      <Section id="trade-rules" title={t('detail.sections.rules')}>
        {trade.ruleChecks.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('detail.noRules')}</p>
        ) : (
          <div className="grid gap-5">
            {(['strategy', 'setup'] as const).map((scope) =>
              ruleGroups[scope].length === 0 ? null : (
                <div key={scope}>
                  <h4 className="mb-2 font-semibold">{t(`detail.ruleGroups.${scope}`)}</h4>
                  <ul className="grid gap-2">
                    {ruleGroups[scope].map((rule) => (
                      <li key={rule.ruleKey} className="bg-muted/30 rounded-md p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <span className="font-medium">{rule.title}</span>
                          <Badge>{t(`ruleStatus.${rule.checkStatus}`)}</Badge>
                        </div>
                        <div className="text-muted-foreground mt-2 flex flex-wrap gap-2 text-xs">
                          <span>{rule.category}</span>
                          {rule.isRequired ? <span>· {t('detail.required')}</span> : null}
                          {rule.isPreTradeCheck ? <span>· {t('detail.preTrade')}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </Section>

      <Section id="trade-mistakes" title={t('detail.sections.mistakes')}>
        {trade.mistakes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('detail.noMistakes')}</p>
        ) : (
          <ul className="grid gap-2">
            {trade.mistakes.map((mistake) => (
              <li key={mistake.key} className="bg-muted/30 rounded-md p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{mistake.label}</span>
                  <Badge>{t(`severity.${mistake.severityAtTime}`)}</Badge>
                </div>
                {mistake.note === null ? null : (
                  <p className="text-muted-foreground mt-2 text-sm">{mistake.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </article>
  );
}
