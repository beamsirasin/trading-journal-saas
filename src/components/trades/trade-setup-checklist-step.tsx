'use client';

import { Compass, GitBranch, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { TradeCreateSetupOption, TradeCreateStrategyOption } from '@/server/dal/trades';

import type { RecalledConditionStatus } from './after-trade-draft';
import type { AnswerState, ConditionStatus } from './at-entry-draft';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { ChoiceGroup, Helper, InlineAction, Notice, StateText } from './trade-at-entry-controls';
import { TradeChoiceList } from './trade-choice-list';
import { TradeLauncherRow } from './trade-launcher-row';
import { GroupCard } from './trade-recording-step-parts';

/** The recording moment this step is shown in. It decides wording and options, never meaning. */
export type SetupChecklistMode = 'at_entry' | 'after_trade';

/** The explicit "No strategy" / "No setup" answer in a choice list. */
const NONE = '__none';

/**
 * The Classification as the host resolved it against the offered options. The
 * host's own draft module resolves it (`activeClassification` or
 * `activeAfterTradeClassification`, and `staleSelections`); this step only
 * reads it.
 */
export interface SetupChecklistClassification {
  readonly strategyAnswer: AnswerState;
  readonly strategy: TradeCreateStrategyOption | null;
  readonly setupAnswer: AnswerState;
  readonly setup: TradeCreateSetupOption | null;
  /** A chosen Strategy or Setup that is no longer offered: kept, shown, and never read as Unanswered. */
  readonly stale: { readonly strategy: boolean; readonly setup: boolean };
}

/**
 * WHAT DIFFERS BY MODE, TYPED SO IT CANNOT BE MIXED UP.
 * - At Entry: conditions are Met / Not Met / Unanswered, and the Exit Plan the
 *   selected Strategy currently supplies is announced here (contract §5).
 * - After Trade: conditions may also be Don't remember (contract §8), and no
 *   Exit Plan announcement exists — nothing is inherited retrospectively.
 */
type ModeProps =
  | {
      readonly mode: 'at_entry';
      readonly conditionAnswers: Readonly<Record<string, ConditionStatus>>;
      readonly onCondition: (conditionKey: string, status: ConditionStatus | null) => void;
      /** The inherited Exit Plan's name while the Exit Plan is inherited; `null` otherwise. */
      readonly inheritedExitPlanName: string | null;
    }
  | {
      readonly mode: 'after_trade';
      readonly conditionAnswers: Readonly<Record<string, RecalledConditionStatus>>;
      readonly onCondition: (conditionKey: string, status: RecalledConditionStatus | null) => void;
    };

/**
 * SETUP & CHECKLIST — canonical lifecycle Step 3, one component for both
 * recording moments (Add Trade contract §7–§8; UX Rules §8.4, §11.6–§11.7,
 * §12.6–§12.7, §20.8, §20.10).
 *
 * THREE QUESTIONS, NEVER MERGED. Strategy, then the Setup that belongs to it,
 * then that Setup's conditions. Strategy and Setup each read as a launcher row
 * that opens one focused editor; choosing IS the answer, as in Step 1. The
 * conditions are answered in place, every one visible at once, because a
 * checklist is read by scanning it.
 *
 * EVERY ANSWER KEEPS ITS OWN STATE. Unanswered, No strategy / No setup and a
 * selection are three answers, and a condition's Unanswered, Not met and Don't
 * remember are three more. Each returns to Unanswered only through a named
 * "Remove answer". No Setup is a complete answer with its own plain sentence,
 * not an empty screen.
 *
 * IT OWNS NO SEMANTICS. Every change goes through the host's draft transitions,
 * so the draft models stay separate. The step never touches the Exit Plan: in
 * At Entry the host's own inheritance rule may change it when the Strategy
 * changes, and this step says so where the Strategy is chosen.
 */
export function TradeSetupChecklistStep(
  props: {
    /** Prefix for DOM ids: `<prefix>-strategy` and `<prefix>-setup` are the rows a blocked Save focuses. */
    readonly idPrefix: string;
    readonly strategies: readonly TradeCreateStrategyOption[];
    readonly classification: SetupChecklistClassification;
    readonly onSelectStrategy: (strategyId: string) => void;
    readonly onNoStrategy: () => void;
    readonly onRemoveStrategy: () => void;
    readonly onSelectSetup: (setupId: string) => void;
    readonly onNoSetup: () => void;
    readonly onRemoveSetup: () => void;
  } & ModeProps,
) {
  const {
    idPrefix,
    strategies,
    classification,
    onSelectStrategy,
    onNoStrategy,
    onRemoveStrategy,
    onSelectSetup,
    onNoSetup,
    onRemoveSetup,
  } = props;
  const c = useTranslations('trades.create.recording.contractEntry');
  const a = useTranslations('trades.create.recording.contractAfter');
  const s = useTranslations('trades.create.recording.setupStep');
  const [editor, setEditor] = useState<'strategy' | 'setup' | null>(null);
  const strategyRow = useRef<HTMLButtonElement>(null);
  const setupRow = useRef<HTMLButtonElement>(null);
  const { strategy, setup, strategyAnswer, setupAnswer, stale } = classification;
  const setupAvailable = strategy !== null;

  const strategyValue = stale.strategy
    ? c('strategy.unavailableOption')
    : strategyAnswer === 'none'
      ? c('strategy.none')
      : (strategy?.name ?? null);
  const setupValue = !setupAvailable
    ? null
    : stale.setup
      ? c('strategy.unavailableOption')
      : setupAnswer === 'none'
        ? c('strategy.noSetup')
        : (setup?.name ?? null);
  const setupPlaceholder =
    strategyAnswer === 'none' ? s('setupNotApplicable') : c('strategy.setupNeedsStrategy');

  // At Entry only: the plan the Strategy is supplying, said where the Strategy is chosen.
  const inheritedPlan =
    props.mode === 'at_entry' && strategy !== null ? props.inheritedExitPlanName : null;

  const close = () => setEditor(null);

  return (
    <div data-setup-checklist-step={props.mode} className="flex min-w-0 flex-col gap-4">
      <p className="text-muted-foreground text-sm">{s('description')}</p>

      <div className="grid min-w-0 gap-2.5 min-[560px]:grid-cols-2 lg:gap-3">
        <TradeLauncherRow
          id={`${idPrefix}-strategy`}
          rowRef={strategyRow}
          label={c('strategy.label')}
          value={strategyValue}
          placeholder={c('strategy.notAnswered')}
          editLabel={a('trade.editAria', { field: c('strategy.label') })}
          icon={Compass}
          answered={strategyAnswer !== 'unanswered' || stale.strategy}
          onOpen={() => setEditor('strategy')}
          buttonData={{
            'data-classification': 'strategy',
            'data-answer': stale.strategy ? 'unavailable' : strategyAnswer,
          }}
        />
        <TradeLauncherRow
          id={`${idPrefix}-setup`}
          rowRef={setupRow}
          label={c('strategy.setup')}
          value={setupValue}
          placeholder={setupAvailable ? c('strategy.notAnswered') : setupPlaceholder}
          editLabel={a('trade.editAria', { field: c('strategy.setup') })}
          icon={Layers}
          answered={setupAvailable && (setupAnswer !== 'unanswered' || stale.setup)}
          disabled={!setupAvailable}
          onOpen={() => setEditor('setup')}
          buttonData={{
            'data-classification': 'setup',
            'data-answer': !setupAvailable
              ? 'unavailable_without_strategy'
              : stale.setup
                ? 'unavailable'
                : setupAnswer,
          }}
        />
      </div>

      {stale.strategy || stale.setup ? (
        <p role="alert" data-classification-unavailable="" className="text-warning text-sm">
          {stale.strategy ? c('strategy.strategyUnavailable') : c('strategy.setupUnavailable')}
        </p>
      ) : null}

      {/*
        THE INHERITED EXIT PLAN, ANNOUNCED WHERE IT IS CAUSED. Choosing a
        Strategy may change an Exit Plan that is still inherited, on a step the
        trader is not looking at; this line says so here, politely, as it
        happens (UX Rules §20.8). Record Closed never renders it.
      */}
      <div aria-live="polite" className="min-w-0">
        {inheritedPlan === null || strategy === null ? null : (
          <div data-inherited-exit-plan="">
            <Notice
              icon={
                <GitBranch
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
              }
            >
              {c('strategy.suppliesExitPlan', { strategy: strategy.name, plan: inheritedPlan })}
            </Notice>
          </div>
        )}
      </div>

      <Checklist {...props} s={s} c={c} a={a} />

      {/* Strategy: one focused editor; the choice is the commit. */}
      <TradeAdaptiveOverlay
        open={editor === 'strategy'}
        onOpenChange={(open) => (open ? undefined : close())}
        title={c('strategy.label')}
        description={s('strategyEditor')}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={strategyRow}
      >
        <div data-strategy-editor="" className="flex min-w-0 flex-col gap-3">
          {strategies.length === 0 ? (
            <p className="text-muted-foreground text-sm">{s('noStrategiesYet')}</p>
          ) : (
            <TradeChoiceList
              label={c('strategy.label')}
              value={
                strategyAnswer === 'selected' && !stale.strategy
                  ? (strategy?.strategyId ?? null)
                  : null
              }
              onChoose={(strategyId) => {
                onSelectStrategy(strategyId);
                close();
              }}
              options={strategies.map((item) => ({ value: item.strategyId, label: item.name }))}
            />
          )}
          {/* The explicit None, apart from the list: an answer, not one more Strategy. */}
          <div className="border-border border-t pt-3">
            <TradeChoiceList
              label={c('strategy.none')}
              value={strategyAnswer === 'none' ? NONE : null}
              onChoose={() => {
                onNoStrategy();
                close();
              }}
              options={[{ value: NONE, label: c('strategy.none') }]}
            />
          </div>
          {strategyAnswer === 'unanswered' && !stale.strategy ? null : (
            <div>
              <InlineAction
                ariaLabel={c('strategy.removeStrategyAria')}
                onClick={() => {
                  onRemoveStrategy();
                  close();
                }}
              >
                {c('removeAnswer')}
              </InlineAction>
            </div>
          )}
        </div>
      </TradeAdaptiveOverlay>

      {/* Setup: the Setups of the chosen Strategy only — a Setup belongs to it. */}
      <TradeAdaptiveOverlay
        open={editor === 'setup' && strategy !== null}
        onOpenChange={(open) => (open ? undefined : close())}
        title={c('strategy.setup')}
        description={s('setupEditor', { strategy: strategy?.name ?? '' })}
        closeLabel={a('trade.close')}
        size="focused"
        returnFocusRef={setupRow}
      >
        <div data-setup-editor="" className="flex min-w-0 flex-col gap-3">
          {strategy === null || strategy.setups.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {s('noSetupsYet', { strategy: strategy?.name ?? '' })}
            </p>
          ) : (
            <TradeChoiceList
              label={c('strategy.setup')}
              value={setupAnswer === 'selected' && !stale.setup ? (setup?.setupId ?? null) : null}
              onChoose={(setupId) => {
                onSelectSetup(setupId);
                close();
              }}
              options={strategy.setups.map((item) => ({ value: item.setupId, label: item.name }))}
            />
          )}
          <div className="border-border border-t pt-3">
            <TradeChoiceList
              label={c('strategy.noSetup')}
              value={setupAnswer === 'none' ? NONE : null}
              onChoose={() => {
                onNoSetup();
                close();
              }}
              options={[{ value: NONE, label: c('strategy.noSetup') }]}
            />
          </div>
          {setupAnswer === 'unanswered' && !stale.setup ? null : (
            <div>
              <InlineAction
                ariaLabel={c('strategy.removeSetupAria')}
                onClick={() => {
                  onRemoveSetup();
                  close();
                }}
              >
                {c('removeAnswer')}
              </InlineAction>
            </div>
          )}
        </div>
      </TradeAdaptiveOverlay>
    </div>
  );
}

type Translate = ReturnType<typeof useTranslations>;

/**
 * THE CHECKLIST, ALWAYS SAYING WHERE IT STANDS. Before there is a Setup to
 * check, the card says what would make one — or, for No strategy and No setup,
 * that there is nothing to check, which is a complete answer. With a Setup,
 * every condition is on screen with its own multi-state answer.
 */
function Checklist(
  props: {
    readonly idPrefix: string;
    readonly classification: SetupChecklistClassification;
    readonly s: Translate;
    readonly c: Translate;
    readonly a: Translate;
  } & ModeProps,
) {
  const { idPrefix, classification, s, c, a } = props;
  const { strategy, setup, strategyAnswer, setupAnswer, stale } = classification;
  const conditions = setup?.conditions ?? [];
  const answered = conditions.filter(
    (condition) => props.conditionAnswers[condition.conditionKey] !== undefined,
  ).length;

  // An answer whose source went away is explained by the alert above and resolved on its row.
  if (stale.strategy || stale.setup) return null;

  const state: string | null =
    strategyAnswer === 'none'
      ? s('checklistNoStrategy')
      : strategy === null
        ? s('checklistNeedsStrategy')
        : setupAnswer === 'none'
          ? s('checklistNoSetup')
          : setup === null
            ? s('checklistNeedsSetup')
            : conditions.length === 0
              ? s('checklistEmpty')
              : null;

  return (
    <GroupCard
      title={c('strategy.conditions')}
      aside={
        conditions.length === 0 ? null : (
          <StateText>{c('summary.conditions', { answered, total: conditions.length })}</StateText>
        )
      }
      data-checklist-state={state === null ? 'conditions' : 'message'}
    >
      {state !== null ? (
        <p data-checklist-message="" className="text-muted-foreground text-sm">
          {state}
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <Helper>
            {props.mode === 'at_entry' ? c('strategy.conditionsHint') : a('conditions.hint')}
          </Helper>
          <ul className="divide-border mt-1 flex min-w-0 flex-col divide-y">
            {conditions.map((condition) => {
              const remove = (
                <InlineAction
                  ariaLabel={c('strategy.removeConditionAria', { condition: condition.label })}
                  onClick={() => props.onCondition(condition.conditionKey, null)}
                >
                  {c('removeAnswer')}
                </InlineAction>
              );
              return (
                <li key={condition.conditionKey} className="min-w-0 py-3">
                  {props.mode === 'at_entry' ? (
                    <ChoiceGroup
                      idPrefix={`${idPrefix}-condition-${condition.conditionKey}`}
                      legend={condition.label}
                      value={props.conditionAnswers[condition.conditionKey] ?? null}
                      compact
                      status={c('notAnswered')}
                      aside={remove}
                      onChange={(status) => props.onCondition(condition.conditionKey, status)}
                      options={[
                        { value: 'met', label: c('strategy.met') },
                        { value: 'not_met', label: c('strategy.notMet') },
                      ]}
                    />
                  ) : (
                    <ChoiceGroup
                      idPrefix={`${idPrefix}-condition-${condition.conditionKey}`}
                      legend={condition.label}
                      value={props.conditionAnswers[condition.conditionKey] ?? null}
                      compact
                      columns={3}
                      status={c('notAnswered')}
                      aside={remove}
                      onChange={(status) => props.onCondition(condition.conditionKey, status)}
                      options={[
                        { value: 'met', label: c('strategy.met') },
                        { value: 'not_met', label: c('strategy.notMet') },
                        { value: 'unknown', label: a('conditions.dontRemember') },
                      ]}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </GroupCard>
  );
}
