'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { TradeDetail } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { InlineAction } from './trade-at-entry-controls';
import { formatTradeMoney } from './trade-format';

/**
 * STEPS 1–4, READ ONLY, FROM THE CLOSE FLOW (UX Rules §20.5).
 *
 * Close Existing Open Trade keeps the Trade's entry context — Plan & Risk,
 * Setup & Checklist, Entry Context & Evidence — as preserved, read-only
 * context. It does not render the four stages inline: one quiet action under
 * the compact summary opens a focused sheet that lists what was recorded, with
 * no control to change it. Editing stays on the Trade itself, where it keeps
 * its capture origin and revision metadata.
 *
 * Unanswered reads as "Not answered" and an explicit None as "None"; nothing
 * missing is shown as a negative (contract §24).
 */
export function TradeEntryDetails({ trade }: { trade: TradeDetail }) {
  const e = useTranslations('trades.stage5.entry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const money = (minor: string | null) =>
    minor === null ? null : formatTradeMoney(minor, trade.tradingAccountBaseCurrency);
  const notAnswered = e('notAnswered');

  const met = trade.setupConditionChecks.filter((check) => check.checkStatus === 'met').length;
  const rows: readonly { readonly key: string; readonly label: string; readonly value: string }[] =
    [
      {
        key: 'strategy',
        label: e('strategy'),
        value: trade.strategyName ?? (trade.noStrategy ? e('noStrategy') : notAnswered),
      },
      {
        key: 'setup',
        label: e('setup'),
        value: trade.setupName ?? (trade.noSetup ? e('noSetup') : notAnswered),
      },
      {
        key: 'conditions',
        label: e('conditions'),
        value:
          trade.setupConditionConfiguredCount === null ||
          trade.setupConditionConfiguredCount === 0 ||
          trade.setupConditionChecks.length === 0
            ? notAnswered
            : e('conditionsMet', { met, total: trade.setupConditionConfiguredCount }),
      },
      {
        key: 'riskAtEntry',
        label: e('riskAtEntry'),
        value: money(trade.plannedRiskMinor) ?? notAnswered,
      },
      /*
        ACTUAL RISK IS HISTORY ONLY (contract decision 56). It is no longer
        asked, so a Trade without an answer shows no line for it at all; one
        recorded before the retirement still reads back what was said.
      */
      ...(trade.actualRiskAnswer === null
        ? []
        : [
            {
              key: 'actualRisk',
              label: e('actualRisk'),
              value:
                trade.actualRiskAnswer === 'matched'
                  ? a('actualRisk.matched')
                  : trade.actualRiskAnswer === 'unknown'
                    ? a('actualRisk.unknown')
                    : [a('actualRisk.different'), money(trade.actualInitialRiskMinor)]
                        .filter((part): part is string => part !== null)
                        .join(' · '),
            },
          ]),
      {
        key: 'target',
        label: e('target'),
        value:
          trade.targetState === 'no_fixed'
            ? e('targetNone')
            : trade.targetState === 'fixed'
              ? [money(trade.plannedRewardMinor), trade.targetPrice]
                  .filter((part): part is string => part !== null)
                  .join(' · ') || e('targetFixed')
              : notAnswered,
      },
      {
        key: 'exitPlan',
        label: e('exitPlan'),
        value: trade.exitPlanName ?? trade.exitPlanInstructions ?? notAnswered,
      },
      {
        key: 'confidence',
        label: e('confidence'),
        value: trade.confidence === null ? notAnswered : `${trade.confidence}%`,
      },
      {
        key: 'emotions',
        label: e('emotions'),
        value:
          trade.emotionsRecordedAt === null
            ? notAnswered
            : trade.emotions.length === 0
              ? e('none')
              : trade.emotions.map((emotion) => emotion.label).join(', '),
      },
      { key: 'timeframe', label: e('timeframe'), value: trade.timeframe ?? notAnswered },
      { key: 'session', label: e('session'), value: trade.session ?? notAnswered },
      { key: 'reason', label: e('reason'), value: trade.confirmationNotes ?? notAnswered },
      { key: 'notes', label: e('notes'), value: trade.notes ?? notAnswered },
    ];

  return (
    <div data-entry-details="" className="-mt-2 px-1">
      <InlineAction onClick={() => setOpen(true)} buttonRef={trigger}>
        {e('open')}
      </InlineAction>
      <TradeAdaptiveOverlay
        open={open}
        onOpenChange={setOpen}
        title={e('title')}
        description={e('description')}
        closeLabel={e('close')}
        size="focused"
        returnFocusRef={trigger}
        footer={
          <div className="flex justify-end">
            <Button type="button" size="lg" className="min-h-12" onClick={() => setOpen(false)}>
              {e('done')}
            </Button>
          </div>
        }
      >
        <dl data-entry-details-list="" className="divide-border flex min-w-0 flex-col divide-y">
          {rows.map((row) => (
            <div
              key={row.key}
              data-entry-detail={row.key}
              className="flex min-w-0 flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4"
            >
              <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
              <dd
                className={
                  row.value === notAnswered
                    ? 'text-subtle-foreground min-w-0 text-sm break-words sm:text-right'
                    : 'text-foreground min-w-0 text-sm break-words sm:text-right'
                }
              >
                {row.value}
              </dd>
            </div>
          ))}
          <div
            data-entry-detail="chart"
            className="flex min-w-0 flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4"
          >
            <dt className="text-muted-foreground shrink-0 text-sm">{e('chart')}</dt>
            <dd className="min-w-0 text-sm break-all sm:text-right">
              {trade.tradingviewUrl === null ? (
                <span className="text-subtle-foreground">{notAnswered}</span>
              ) : (
                <a
                  href={trade.tradingviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {trade.tradingviewUrl}
                </a>
              )}
            </dd>
          </div>
        </dl>
      </TradeAdaptiveOverlay>
    </div>
  );
}
