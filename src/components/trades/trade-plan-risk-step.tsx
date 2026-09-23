'use client';

import { Crosshair, DollarSign, Waves } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode, type RefObject } from 'react';

import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import {
  createAtEntryDraft,
  resolveExitPlan,
  type AtEntryDraft,
  type ClassificationDraft,
  type ContextDraft,
  type ExitPlanDraft,
  type RiskStateDraft,
  type TargetDraft,
} from './at-entry-draft';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import {
  ChoiceGroup,
  Helper,
  InlineAction,
  Notice,
  StateText,
  Tag,
  TextField,
} from './trade-at-entry-controls';
import { AtEntryExitPlan } from './trade-at-entry-exit-plan';
import { TradeLauncherRow } from './trade-launcher-row';
import { TradePlannedSummary } from './trade-planned-summary';

/** The recording moment this step is shown in. It decides defaults and wording, never meaning. */
export type PlanRiskMode = 'at_entry' | 'after_trade';

/** Every input this step owns. Each host maps these onto its own draft fields. */
export type PlanRiskField =
  'risk' | 'targetProfit' | 'targetPrice' | 'entryPrice' | 'stopPrice' | 'positionSize';

/** Every DOM id the step renders: its rows, its inputs and the Target choice. */
export type PlanStepId =
  | PlanRiskField
  | 'riskState'
  | 'targetState'
  | 'riskRow'
  | 'targetRow'
  | 'exitPlanRow'
  | 'priceRow';

export type PriceContextValues = Pick<ContextDraft, 'entryPrice' | 'stopPrice' | 'positionSize'>;

/** The one Classification that can supply nothing: no Strategy, so no default to inherit. */
const NO_CLASSIFICATION: ClassificationDraft = createAtEntryDraft('').classification;

/**
 * PLAN & RISK — canonical lifecycle Step 2, one component for both recording
 * moments (Add Trade contract §3–§5; UX Rules §8.1–§8.7, §11.4–§11.6, §12.6,
 * §20.4).
 *
 * READ FIRST, EDIT ON PURPOSE. Four launcher rows — Risk at Entry, Target,
 * Exit Plan, Price context — each reading back what is recorded and opening
 * the one editor that records it, the way Step 1 and every later stage are
 * read. A step that is four open forms asks a trader to scan controls; a step
 * that is four rows lets them read the plan and then change one thing.
 *
 * IT DESCRIBES THE PLAN, AND NOTHING THAT HAPPENED (contract decisions 53,
 * 54). The risk decision (Defined Risk with its 1R, or No Defined Risk), the
 * Target, the Exit Plan, and price levels as context. **Actual Risk is not
 * here**: what the position really carried is an execution fact, asked with
 * the rest of the entry's execution context in Step 4. Strategy is not this
 * step's answer either; it lives in Step 3.
 *
 * RISK IS A DECISION, NOT A FIGURE THE FORM EXTRACTS. Unanswered, Defined and
 * No Defined Risk are three different things, and a trader who had no 1R says
 * so rather than inventing one. A recorded SL price decides none of them: it
 * says where a stop would sit, never whether a 1R was decided (§2, §3, §8).
 * Stop Method is no longer captured (decision 54); stored values stay history.
 *
 * IT OWNS NO SEMANTICS. Every change goes back through the host's own draft
 * transitions (`at-entry-draft` or `after-trade-draft`), so the two draft
 * models stay separate and each keeps its own validation. This step only
 * renders the answers and the errors and notices the host's validation found.
 *
 * WHAT THE MODE DECIDES.
 * - At Entry: Risk at Entry is required to Save Open Trade, and the Exit Plan
 *   may be inherited — visibly, "From Strategy" — from the host's
 *   Classification (contract §5).
 * - After Trade: Risk at Entry is optional, and NOTHING IS INHERITED. The step
 *   does not accept a Classification in this mode at all, so no Strategy
 *   default can reach a historical Trade (contract §5, §7).
 *
 * A BLOCKED SAVE LANDS ON THE ROW, not on a control the trader cannot see: the
 * row carries the error and opens the editor holding it, which is how Step 1
 * has always handled answers that live in editors.
 *
 * MONEY IS THE RESULT; PRICE IS CONTEXT. The TP price stays inside the Target
 * it describes, and Entry, SL and size are one row that says it is context.
 * None of them derives a figure here.
 */
export function TradePlanRiskStep({
  mode,
  ids,
  currency,
  riskState,
  risk,
  target,
  exitPlan,
  classification,
  priceContext,
  options,
  errorText,
  notices,
  targetR = null,
  plannedRR = null,
  onRiskChange,
  onRiskStateChange,
  onTargetStateChange,
  onTargetValueChange,
  onExitPlanChange,
  onPriceContextChange,
  onLibraryChanged,
}: {
  mode: PlanRiskMode;
  /**
   * The DOM id of each row and each input. The host keeps its own ids so a
   * blocked Save still focuses the same control it did.
   */
  ids: Readonly<Record<PlanStepId, string>>;
  currency: string;
  /** The explicit risk decision; the amount below belongs to 'defined' alone. */
  riskState: RiskStateDraft;
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
  /** At Entry's "reaching your target would be …R", already formatted; `null` shows nothing. */
  targetR?: string | null;
  /** The plan's reward-to-risk as `1:2`; `null` when it is not knowable. */
  plannedRR?: string | null;
  onRiskChange: (risk: string) => void;
  onRiskStateChange: (riskState: RiskStateDraft) => void;
  onTargetStateChange: (state: TargetDraft['state']) => void;
  onTargetValueChange: (field: 'profit' | 'price', value: string) => void;
  onExitPlanChange: (exitPlan: ExitPlanDraft) => void;
  onPriceContextChange: (patch: Partial<PriceContextValues>) => void;
  onLibraryChanged: (plans: readonly TradeCreateExitPlanOption[]) => void;
}) {
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const cx = useTranslations('trades.create.recording.contractEntry.context');
  const rows = useTranslations('trades.create.recording.planRows');
  const atEntry = mode === 'at_entry';

  const [editor, setEditor] = useState<'risk' | 'target' | 'price' | null>(null);
  const riskRow = useRef<HTMLButtonElement>(null);
  const targetRow = useRef<HTMLButtonElement>(null);
  const priceRow = useRef<HTMLButtonElement>(null);

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

  /*
    WHAT THE ROW SAYS ABOUT RISK. No Defined Risk is an answer and reads as
    one; Defined Risk reads its amount; Unanswered reads the neutral
    placeholder, never "no risk" (§2, §8).
  */
  const riskAmount = risk.trim() === '' ? null : `${risk.trim()} ${currency}`;
  const riskValue =
    riskState === 'no_defined'
      ? rows('risk.noDefined')
      : riskState === 'defined'
        ? riskAmount
        : null;

  const targetValue =
    target.state === 'unanswered'
      ? null
      : target.state === 'no_fixed'
        ? c('target.noFixed')
        : target.profit.trim() === ''
          ? c('target.fixed')
          : rows('target.fixed', { amount: `${target.profit.trim()} ${currency}` });

  /*
    WHAT ELSE THE TARGET HOLDS. At Entry's money-based R when the host derived
    one, and otherwise the TP price if there is one — a recorded answer the
    row would otherwise hide. Never a line about what is missing: an
    unrecorded TP price is an unanswered question, not a defect to report.
  */
  const targetSupport =
    targetR !== null
      ? c('target.reachR', { r: targetR })
      : target.state === 'fixed' && target.price.trim() !== ''
        ? values(c('target.price'), target.price)
        : null;

  const priceParts = [
    values(cx('entryPrice'), priceContext.entryPrice),
    values(cx('stopPrice'), priceContext.stopPrice),
    values(cx('size'), priceContext.positionSize),
  ].filter((part) => part !== null);

  const priceError = errorText('entryPrice') ?? errorText('stopPrice') ?? errorText('positionSize');

  /*
    THE EXIT PLAN IN ONE PHRASE, resolved exactly as its own row resolves it —
    an inherited or chosen plan by name, an explicit No Defined Exit Rule by
    its answer, and nothing at all when none is recorded.
  */
  const exitPlanResolved = resolveExitPlan(exitPlanView, options).resolved;
  const exitPlanLabel =
    exitPlanResolved.status === 'saved' || exitPlanResolved.status === 'inherited'
      ? exitPlanResolved.plan.name
      : exitPlanResolved.status === 'customized'
        ? c('exitPlan.customized')
        : exitPlanResolved.status === 'no_rule'
          ? c('exitPlan.noRule')
          : null;

  return (
    <div data-plan-risk-step={mode} className="flex min-w-0 flex-col gap-3">
      {/* 1 — RISK AT ENTRY: the intended 1R, the baseline both R figures share. */}
      <TradeLauncherRow
        id={ids.riskRow}
        rowRef={riskRow}
        label={rows('risk.label')}
        marker={
          atEntry ? (
            <span className="text-muted-foreground text-xs font-medium">{a('steps.required')}</span>
          ) : (
            <StateText>{a('steps.optional')}</StateText>
          )
        }
        value={riskValue}
        support={riskState === 'defined' && riskAmount !== null ? rows('risk.oneR') : null}
        placeholder={c('notAnswered')}
        error={errorText('risk')}
        editLabel={a('trade.editAria', { field: rows('risk.label') })}
        icon={DollarSign}
        answered={riskValue !== null}
        onOpen={() => setEditor('risk')}
        buttonData={{ 'data-plan-row': 'risk', 'data-risk-state': riskState }}
      />

      {/* 2 — TARGET: Unanswered, Fixed (with a value) or No Fixed Target. */}
      <TradeLauncherRow
        id={ids.targetRow}
        rowRef={targetRow}
        label={c('target.legend')}
        value={targetValue}
        support={targetSupport}
        placeholder={c('notAnswered')}
        error={errorText('targetProfit') ?? errorText('targetPrice')}
        editLabel={a('trade.editAria', { field: c('target.legend') })}
        icon={Crosshair}
        answered={target.state !== 'unanswered'}
        onOpen={() => setEditor('target')}
        buttonData={{ 'data-plan-row': 'target', 'data-target-state': target.state }}
      />

      {/* 3 — EXIT PLAN: the rule, separate from the Target's objective. */}
      <AtEntryExitPlan
        draft={exitPlanView}
        options={options}
        presentation="row"
        rowId={ids.exitPlanRow}
        rowEditLabel={a('trade.editAria', { field: c('exitPlan.title') })}
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

      {/*
        THE PLAN AT A GLANCE, read-only and secondary to the rows above: every
        value here is answered in one of them (decision 54).
      */}
      <TradePlannedSummary
        riskState={riskState}
        risk={risk}
        currency={currency}
        target={target}
        plannedRR={plannedRR}
        exitPlanLabel={exitPlanLabel}
      />

      {/* 4 — PRICE CONTEXT: never a result, and it says so where it is entered. */}
      <TradeLauncherRow
        id={ids.priceRow}
        rowRef={priceRow}
        label={a('steps.groups.price')}
        marker={<StateText>{a('steps.optional')}</StateText>}
        value={priceParts.length === 0 ? null : priceParts.join(' · ')}
        placeholder={c('summary.contextEmpty')}
        error={priceError}
        editLabel={a('trade.editAria', { field: a('steps.groups.price') })}
        icon={Waves}
        answered={priceParts.length > 0}
        onOpen={() => setEditor('price')}
        buttonData={{ 'data-plan-row': 'price' }}
      />

      {/* HOW RISK WAS DECIDED — the question first, the amount only if it applies. */}
      <PlanEditor
        open={editor === 'risk'}
        title={rows('risk.label')}
        description={rows('risk.question')}
        returnFocusRef={riskRow}
        onClose={() => setEditor(null)}
      >
        <ChoiceGroup
          idPrefix={ids.riskState}
          legend={rows('risk.question')}
          hideLegend
          value={riskState === 'unanswered' ? null : riskState}
          status={c('notAnswered')}
          onChange={(value) => onRiskStateChange(value)}
          aside={
            riskState === 'unanswered' ? null : (
              <InlineAction
                ariaLabel={rows('risk.removeAria')}
                onClick={() => onRiskStateChange('unanswered')}
              >
                {c('removeAnswer')}
              </InlineAction>
            )
          }
          options={[
            { value: 'defined', label: rows('risk.defined') },
            { value: 'no_defined', label: rows('risk.noDefined') },
          ]}
        />
        {riskState === 'defined' ? (
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
        ) : riskState === 'no_defined' ? (
          // Said plainly once, where the answer was given: this Trade has no 1R.
          <Helper>{rows('risk.noDefinedHint')}</Helper>
        ) : null}
      </PlanEditor>

      {/* THE TARGET, WITH ITS TP PRICE: one objective, read together. */}
      <PlanEditor
        open={editor === 'target'}
        title={c('target.legend')}
        description={c('target.fixedDescription')}
        returnFocusRef={targetRow}
        onClose={() => setEditor(null)}
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
        <ChoiceGroup
          idPrefix={ids.targetState}
          legend={c('target.legend')}
          hideLegend
          value={target.state === 'unanswered' ? null : target.state}
          onChange={onTargetStateChange}
          options={[
            { value: 'fixed', label: c('target.fixed'), description: c('target.fixedDescription') },
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
      </PlanEditor>

      {/* ENTRY, SL AND SIZE: context, and the editor says so before the fields. */}
      <PlanEditor
        open={editor === 'price'}
        title={a('steps.groups.price')}
        description={cx('pricesHint')}
        returnFocusRef={priceRow}
        onClose={() => setEditor(null)}
      >
        <div data-price-context="" className="flex min-w-0 flex-col gap-3">
          <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-3">
            <TextField
              id={ids.entryPrice}
              label={cx('entryPrice')}
              value={priceContext.entryPrice}
              onChange={(entryPrice) => onPriceContextChange({ entryPrice })}
              inputMode="decimal"
              figure
              error={errorText('entryPrice')}
            />
            <TextField
              id={ids.stopPrice}
              label={cx('stopPrice')}
              value={priceContext.stopPrice}
              onChange={(stopPrice) => onPriceContextChange({ stopPrice })}
              inputMode="decimal"
              figure
              error={errorText('stopPrice')}
            />
            <TextField
              id={ids.positionSize}
              label={cx('size')}
              value={priceContext.positionSize}
              onChange={(positionSize) => onPriceContextChange({ positionSize })}
              inputMode="decimal"
              figure
              error={errorText('positionSize')}
            />
          </div>
          {notices.stopWrongSide ? <Notice>{cx('stopWrongSide')}</Notice> : null}
          {notices.targetWrongSide ? <Notice>{cx('targetWrongSide')}</Notice> : null}
        </div>
      </PlanEditor>
    </div>
  );
}

/** `Label value`, or nothing at all when the value was not recorded. */
function values(label: string, value: string): string | null {
  return value.trim() === '' ? null : `${label} ${value.trim()}`;
}

/**
 * One row's editor: the same focused overlay every other stage opens, with a
 * Done that closes it. Every keystroke is already in the host's draft, so
 * Done, X, Escape and the backdrop all keep what was typed.
 */
function PlanEditor({
  open,
  title,
  description,
  aside = null,
  returnFocusRef,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  aside?: ReactNode;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const a = useTranslations('trades.create.recording.contractAfter');
  return (
    <TradeAdaptiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
      closeLabel={a('trade.close')}
      size="focused"
      returnFocusRef={returnFocusRef}
      footer={
        <div className="flex min-w-0 justify-end">
          <Button type="button" onClick={onClose}>
            {a('trade.done')}
          </Button>
        </div>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {aside === null ? null : <div className="flex min-w-0 justify-end">{aside}</div>}
        {children}
      </div>
    </TradeAdaptiveOverlay>
  );
}
