'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';

import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';

import {
  createAtEntryDraft,
  type AtEntryDraft,
  type ClassificationDraft,
  type ContextDraft,
  type ExitPlanDraft,
  type TargetDraft,
} from './at-entry-draft';
import {
  ChoiceGroup,
  InlineAction,
  Notice,
  StateText,
  Tag,
  TextField,
} from './trade-at-entry-controls';
import { AtEntryExitPlan } from './trade-at-entry-exit-plan';
import { FoldedGroup, GroupCard } from './trade-recording-step-parts';

/** The recording moment this step is shown in. It decides defaults and wording, never meaning. */
export type PlanRiskMode = 'at_entry' | 'after_trade';

/** Every input this step owns. Each host maps these onto its own draft fields. */
export type PlanRiskField =
  'risk' | 'targetProfit' | 'targetPrice' | 'entryPrice' | 'stopPrice' | 'positionSize';

/** Every DOM id the step renders: its inputs, the Target choice and the price group's toggle. */
export type PlanStepId = PlanRiskField | 'targetState' | 'priceContextToggle';

export type PriceContextValues = Pick<ContextDraft, 'entryPrice' | 'stopPrice' | 'positionSize'>;

/** The one Classification that can supply nothing: no Strategy, so no default to inherit. */
const NO_CLASSIFICATION: ClassificationDraft = createAtEntryDraft('').classification;

/**
 * PLAN & RISK — canonical lifecycle Step 2, one component for both recording
 * moments (Add Trade contract §3–§5; UX Rules §8.1–§8.7, §11.4–§11.6, §12.6).
 *
 * WHAT IT HOLDS, AND WHAT IT DOES NOT. Risk at Entry (the 1R baseline), the
 * Target, the Exit Plan, and price levels folded away as context. Actual Risk
 * is not this step's question and Strategy is not this step's answer: a host
 * that asks Actual Risk beside Risk at Entry passes its own control in
 * `riskFollowUp`, and the Strategy lives in Step 3.
 *
 * IT OWNS NO SEMANTICS. Every change goes back through the host's own draft
 * transitions (`at-entry-draft` or `after-trade-draft`), so the two draft
 * models stay separate and each keeps its own validation. This step only
 * renders the answers and the errors and notices the host's validation found.
 *
 * WHAT THE MODE DECIDES.
 * - At Entry: Risk at Entry is required to Save Open Trade, and the Exit Plan
 *   may be inherited — visibly, "From Strategy" — from the host's
 *   Classification (contract §5). The Exit Plan is read in full.
 * - After Trade: Risk at Entry is optional, and NOTHING IS INHERITED. The step
 *   does not accept a Classification in this mode at all, so no Strategy
 *   default can reach a historical Trade (contract §5, §7). The Exit Plan
 *   reads as one line with recall wording, as the host's plan step did.
 *
 * MONEY IS THE RESULT; PRICE IS CONTEXT. The TP price stays inside the Target
 * it describes, and Entry, SL and size fold into a group that says it is
 * context. None of them derives a figure here.
 */
export function TradePlanRiskStep({
  mode,
  ids,
  currency,
  risk,
  target,
  exitPlan,
  classification,
  priceContext,
  options,
  errorText,
  notices,
  riskFollowUp = null,
  targetR = null,
  onRiskChange,
  onTargetStateChange,
  onTargetValueChange,
  onExitPlanChange,
  onPriceContextChange,
  onLibraryChanged,
}: {
  mode: PlanRiskMode;
  /**
   * The DOM id of each input, and of the price group's toggle. The host keeps
   * its own ids so a blocked Save still focuses the same control it did.
   */
  ids: Readonly<Record<PlanStepId, string>>;
  currency: string;
  /** Risk at Entry as typed; '' is not recorded, never zero. */
  risk: string;
  target: TargetDraft;
  exitPlan: ExitPlanDraft;
  /**
   * At Entry only: the Classification an inherited Exit Plan comes from. It is
   * read, never written — choosing a Strategy is Step 3's job.
   */
  classification?: ClassificationDraft;
  priceContext: PriceContextValues;
  options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  errorText: (field: PlanRiskField) => string | undefined;
  /** The host validation's non-blocking price notices. */
  notices: { readonly stopWrongSide: boolean; readonly targetWrongSide: boolean };
  /** The host's own follow-up to Risk at Entry (After Trade's Actual Risk). */
  riskFollowUp?: ReactNode;
  /** At Entry's "reaching your target would be …R", already formatted; `null` shows nothing. */
  targetR?: string | null;
  onRiskChange: (risk: string) => void;
  onTargetStateChange: (state: TargetDraft['state']) => void;
  onTargetValueChange: (field: 'profit' | 'price', value: string) => void;
  onExitPlanChange: (exitPlan: ExitPlanDraft) => void;
  onPriceContextChange: (patch: Partial<PriceContextValues>) => void;
  onLibraryChanged: (plans: readonly TradeCreateExitPlanOption[]) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const atEntry = mode === 'at_entry';

  /*
    THE EXIT PLAN READS A DRAFT-SHAPED VIEW. Its transitions change only the
    Exit Plan answer and read the Classification only to find a Strategy
    default, so the view carries exactly those two things — and in After Trade
    the Classification is the empty one, whatever the host holds.
  */
  const exitPlanView: AtEntryDraft = {
    ...createAtEntryDraft(''),
    exitPlan,
    classification: atEntry ? (classification ?? NO_CLASSIFICATION) : NO_CLASSIFICATION,
  };

  return (
    <div data-plan-risk-step={mode} className="flex min-w-0 flex-col gap-4">
      {/* 1 — RISK AT ENTRY: the intended 1R, the baseline both R figures share. */}
      <GroupCard
        title={a('steps.cards.risk')}
        aside={
          atEntry ? (
            <span className="text-muted-foreground text-xs font-medium">{a('steps.required')}</span>
          ) : (
            <StateText>{a('steps.optional')}</StateText>
          )
        }
      >
        <TextField
          id={ids.risk}
          label={atEntry ? c('risk.label') : a('risk.label')}
          value={risk}
          onChange={onRiskChange}
          suffix={currency}
          inputMode="decimal"
          figure
          hint={atEntry ? c('risk.hint') : a('risk.hint')}
          error={errorText('risk')}
        />
        {riskFollowUp}
      </GroupCard>

      {/* 2 — TARGET: Unanswered, Fixed (with a value) or No Fixed Target. */}
      <GroupCard
        title={c('target.legend')}
        aside={
          target.state === 'unanswered' ? (
            <StateText>{c('notAnswered')}</StateText>
          ) : (
            <InlineAction
              ariaLabel={c('target.removeAria')}
              onClick={() => onTargetStateChange('unanswered')}
            >
              {c('removeAnswer')}
            </InlineAction>
          )
        }
      >
        <div className="flex min-w-0 flex-col gap-3">
          <ChoiceGroup
            idPrefix={ids.targetState}
            legend={c('target.legend')}
            hideLegend
            value={target.state === 'unanswered' ? null : target.state}
            onChange={onTargetStateChange}
            options={[
              {
                value: 'fixed',
                label: c('target.fixed'),
                description: c('target.fixedDescription'),
              },
              {
                value: 'no_fixed',
                label: c('target.noFixed'),
                description: c('target.noFixedDescription'),
              },
            ]}
          />
          {/* Values typed under a Fixed Target are kept, only hidden, while it is not Fixed. */}
          {target.state === 'fixed' ? (
            <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
              <TextField
                id={ids.targetProfit}
                label={c('target.profit')}
                value={target.profit}
                onChange={(value) => onTargetValueChange('profit', value)}
                suffix={currency}
                inputMode="decimal"
                figure
                error={errorText('targetProfit')}
              />
              <TextField
                id={ids.targetPrice}
                label={c('target.price')}
                value={target.price}
                onChange={(value) => onTargetValueChange('price', value)}
                inputMode="decimal"
                figure
                labelAside={<Tag tone="context">{c('target.priceContext')}</Tag>}
                error={errorText('targetPrice')}
              />
            </div>
          ) : null}
          {targetR === null ? null : (
            <p className="text-muted-foreground text-sm">{c('target.reachR', { r: targetR })}</p>
          )}
        </div>
      </GroupCard>

      {/* 3 — EXIT PLAN: the rule, separate from the Target's objective. */}
      <AtEntryExitPlan
        draft={exitPlanView}
        options={options}
        collapsible={!atEntry}
        onChange={(next) => onExitPlanChange(next.exitPlan)}
        onLibraryChanged={onLibraryChanged}
        {...(atEntry
          ? {}
          : {
              copy: {
                notRecordedHint: a('exitPlan.notRecordedHint'),
                editorDescription: a('exitPlan.editorDescription'),
              },
            })}
      />

      {/* 4 — PRICE CONTEXT, folded: never a result, and it says so. */}
      <PriceContextGroup
        ids={ids}
        values={priceContext}
        errorText={errorText}
        notices={notices}
        onChange={onPriceContextChange}
      />
    </div>
  );
}

/**
 * Entry, SL and size, folded behind a summary of their own values. A group
 * holding an error opens itself: nothing that stops a Save is folded away.
 */
function PriceContextGroup({
  ids,
  values,
  errorText,
  notices,
  onChange,
}: {
  ids: Readonly<Record<PlanStepId, string>>;
  values: PriceContextValues;
  errorText: (field: PlanRiskField) => string | undefined;
  notices: { readonly stopWrongSide: boolean; readonly targetWrongSide: boolean };
  onChange: (patch: Partial<PriceContextValues>) => void;
}) {
  const cx = useTranslations('trades.create.recording.contractEntry.context');
  const a = useTranslations('trades.create.recording.contractAfter');
  const summary = useTranslations('trades.create.recording.contractEntry.summary');
  const [open, setOpen] = useState(false);
  const errors = (['entryPrice', 'stopPrice', 'positionSize'] as const).filter(
    (field) => errorText(field) !== undefined,
  ).length;
  const parts = [
    values.entryPrice.trim() === '' ? '' : `${cx('entryPrice')} ${values.entryPrice.trim()}`,
    values.stopPrice.trim() === '' ? '' : `${cx('stopPrice')} ${values.stopPrice.trim()}`,
    values.positionSize.trim() === '' ? '' : `${cx('size')} ${values.positionSize.trim()}`,
  ].filter((part) => part !== '');

  return (
    <FoldedGroup
      id={ids.priceContextToggle}
      title={a('steps.groups.price')}
      summary={
        errors > 0 ? (
          <span className="text-destructive inline-flex min-w-0 items-center gap-1.5">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            {summary('hasErrors', { count: errors })}
          </span>
        ) : parts.length === 0 ? (
          summary('contextEmpty')
        ) : (
          parts.join(' · ')
        )
      }
      open={open || errors > 0}
      onToggle={() => setOpen((current) => !current)}
    >
      <div data-price-context="" className="flex min-w-0 flex-col gap-3 pb-2">
        {/* Price is context, and the group says so where it is entered. */}
        <StateText>{cx('pricesHint')}</StateText>
        <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-3">
          <TextField
            id={ids.entryPrice}
            label={cx('entryPrice')}
            value={values.entryPrice}
            onChange={(entryPrice) => onChange({ entryPrice })}
            inputMode="decimal"
            figure
            error={errorText('entryPrice')}
          />
          <TextField
            id={ids.stopPrice}
            label={cx('stopPrice')}
            value={values.stopPrice}
            onChange={(stopPrice) => onChange({ stopPrice })}
            inputMode="decimal"
            figure
            error={errorText('stopPrice')}
          />
          <TextField
            id={ids.positionSize}
            label={cx('size')}
            value={values.positionSize}
            onChange={(positionSize) => onChange({ positionSize })}
            inputMode="decimal"
            figure
            error={errorText('positionSize')}
          />
        </div>
        {notices.stopWrongSide ? <Notice>{cx('stopWrongSide')}</Notice> : null}
        {notices.targetWrongSide ? <Notice>{cx('targetWrongSide')}</Notice> : null}
      </div>
    </FoldedGroup>
  );
}
