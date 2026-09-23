'use client';

import { Compass, Layers, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { TradeCreateSetupOption, TradeCreateStrategyOption } from '@/server/dal/trades';

import type { RecalledConditionStatus } from './after-trade-draft';
import type { AnswerState, ConditionStatus } from './at-entry-draft';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { Helper, InlineAction, RadioMark, StateText } from './trade-at-entry-controls';
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

  /*
    WHAT EACH ROW CAN ADD BENEATH ITS ANSWER — a fact about the answer's
    context, never an answer of its own:
      Strategy  the Exit Plan it currently supplies (At Entry, while still
                inherited), or that the workspace has no Strategies yet.
      Setup     that the chosen Strategy has no Setups yet.
    "No strategies" and "no setups" are valid states of a workspace, stated
    plainly; No strategy / No setup stay one tap away in the editor.
  */
  const strategySupport =
    inheritedPlan !== null
      ? s('exitPlanFromStrategy', { plan: inheritedPlan })
      : strategies.length === 0 && strategyAnswer === 'unanswered' && !stale.strategy
        ? s('noStrategiesRow')
        : null;
  const setupSupport =
    strategy !== null && strategy.setups.length === 0 && setupAnswer === 'unanswered'
      ? s('noSetupsYet', { strategy: strategy.name })
      : null;

  const close = () => setEditor(null);

  return (
    <div data-setup-checklist-step={props.mode} className="flex min-w-0 flex-col gap-3">
      {/* STRATEGY, THEN SETUP — one column, read top to bottom as Step 2 is. */}
      <TradeLauncherRow
        id={`${idPrefix}-strategy`}
        rowRef={strategyRow}
        label={c('strategy.label')}
        value={strategyValue}
        support={strategySupport}
        supportWraps
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
        support={setupSupport}
        supportWraps
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

      {stale.strategy || stale.setup ? (
        <p role="alert" data-classification-unavailable="" className="text-warning text-sm">
          {stale.strategy ? c('strategy.strategyUnavailable') : c('strategy.setupUnavailable')}
        </p>
      ) : null}

      {/*
        THE INHERITED EXIT PLAN, ANNOUNCED WHERE IT IS CAUSED. Choosing a
        Strategy may change an Exit Plan that is still inherited, on a step the
        trader is not looking at (UX Rules §20.8). It is SEEN on the Strategy
        row, under the name that causes it, and HEARD here: the row's button is
        named by its edit label, so its support line is never read on a change.
        Record Closed never renders either.
      */}
      <div aria-live="polite" className="sr-only">
        {inheritedPlan === null || strategy === null ? null : (
          <p data-inherited-exit-plan="">
            {c('strategy.suppliesExitPlan', { strategy: strategy.name, plan: inheritedPlan })}
          </p>
        )}
      </div>

      <div className="mt-1 min-w-0">
        <Checklist {...props} s={s} c={c} a={a} />
      </div>

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
 * check, one quiet line says what would make one — or, for No strategy, No
 * setup and a workspace or Strategy with nothing to choose, that there is
 * nothing to check, which is a complete state and not an error. With a Setup,
 * every condition is on screen at once, as one list, each with its own
 * multi-state answer.
 */
function Checklist(
  props: {
    readonly idPrefix: string;
    readonly strategies: readonly TradeCreateStrategyOption[];
    readonly classification: SetupChecklistClassification;
    readonly s: Translate;
    readonly c: Translate;
    readonly a: Translate;
  } & ModeProps,
) {
  const { idPrefix, strategies, classification, s, c, a } = props;
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
        ? strategies.length === 0
          ? s('checklistNoStrategies')
          : null
        : setupAnswer === 'none'
          ? s('checklistNoSetup')
          : setup === null
            ? strategy.setups.length === 0
              ? s('checklistNoSetups', { strategy: strategy.name })
              : s('checklistNeedsSetup')
            : conditions.length === 0
              ? s('checklistEmpty')
              : null;

  /*
    NOTHING CHOSEN YET SAYS NOTHING HERE. The disabled Setup row already says
    "Choose a strategy first"; a second line repeating it is noise.
  */
  if (state === null && setup === null) return null;

  if (state !== null) {
    return (
      <div
        data-checklist-state="message"
        className="text-muted-foreground flex min-w-0 items-start gap-2.5 px-1 text-sm"
      >
        <ListChecks className="text-subtle-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p data-checklist-message="" className="min-w-0">
          {state}
        </p>
      </div>
    );
  }

  const removeAria = (label: string) => c('strategy.removeConditionAria', { condition: label });

  return (
    <GroupCard
      title={c('strategy.conditions')}
      aside={
        <StateText>{c('summary.conditions', { answered, total: conditions.length })}</StateText>
      }
      data-checklist-state="conditions"
    >
      <div className="-mt-2 flex min-w-0 flex-col">
        <Helper>
          {props.mode === 'at_entry' ? c('strategy.conditionsHint') : a('conditions.hint')}
        </Helper>
        <ul className="divide-border mt-2 flex min-w-0 flex-col divide-y">
          {conditions.map((condition) =>
            props.mode === 'at_entry' ? (
              <ConditionRow
                key={condition.conditionKey}
                idPrefix={`${idPrefix}-condition-${condition.conditionKey}`}
                label={condition.label}
                value={props.conditionAnswers[condition.conditionKey] ?? null}
                onChange={(status) => props.onCondition(condition.conditionKey, status)}
                options={[
                  { value: 'met', label: c('strategy.met') },
                  { value: 'not_met', label: c('strategy.notMet') },
                ]}
                notAnswered={c('notAnswered')}
                removeLabel={c('removeAnswer')}
                removeAria={removeAria(condition.label)}
              />
            ) : (
              <ConditionRow
                key={condition.conditionKey}
                idPrefix={`${idPrefix}-condition-${condition.conditionKey}`}
                label={condition.label}
                value={props.conditionAnswers[condition.conditionKey] ?? null}
                onChange={(status) => props.onCondition(condition.conditionKey, status)}
                options={[
                  { value: 'met', label: c('strategy.met') },
                  { value: 'not_met', label: c('strategy.notMet') },
                  { value: 'unknown', label: a('conditions.dontRemember') },
                ]}
                notAnswered={c('notAnswered')}
                removeLabel={c('removeAnswer')}
                removeAria={removeAria(condition.label)}
              />
            ),
          )}
        </ul>
      </div>
    </GroupCard>
  );
}

/**
 * ONE CONDITION, ONE ROW OF A LIST — not a form of its own.
 *
 * The condition's words sit on the left with its state beneath them: "Not
 * answered", or once answered the named Remove answer that returns it to
 * Unanswered (never to Not met). The answers sit on the right, so down the
 * whole list they form one column a trader can scan. A short condition shares
 * its line with them; a long one takes the full width and they move beneath
 * it, still on the right — the text is never squeezed into a narrow column.
 *
 * A CHOICE GROUP, NOT A SEGMENTED CONTROL (DESIGN.md "Choices"). Every option
 * is neutral at rest, so an unanswered condition shows nothing selected; the
 * chosen one carries the radio marker, a stronger weight and the active
 * surface, so it survives greyscale. The radios are native, named by the
 * condition, and moved between with the arrow keys.
 *
 * Record Closed's third answer, Don't remember, does not fit beside a
 * condition on a phone, so there the three answers share one full-width row.
 */
function ConditionRow<T extends string>({
  idPrefix,
  label,
  value,
  onChange,
  options,
  notAnswered,
  removeLabel,
  removeAria,
}: {
  idPrefix: string;
  label: string;
  value: T | null;
  onChange: (value: T | null) => void;
  options: readonly { value: T; label: string }[];
  notAnswered: string;
  removeLabel: string;
  removeAria: string;
}) {
  const name = useId();
  const labelId = `${idPrefix}-label`;
  const three = options.length === 3;
  // How wide a row must be before its words and its answers sit side by side.
  const wide = three ? 'lg' : 'md';
  return (
    <li className="@container/condition min-w-0 py-3 last:pb-0">
      <fieldset
        aria-labelledby={labelId}
        data-condition-answer={value ?? 'unanswered'}
        className="min-w-0"
      >
        {/*
          ONE SHAPE FOR EVERY ROW. On a phone the words take the full width and
          the state and the answers share the line beneath — state on the left,
          answers on the right — whatever the length of the words. From a wider
          row the words and state sit beside the answers. Record Closed's three
          answers take their own full-width line until the row is wide enough.
        */}
        <div
          className={cn(
            'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2',
            wide === 'md' ? '@[34rem]/condition:gap-x-6' : '@[40rem]/condition:gap-x-6',
          )}
        >
          <p
            id={labelId}
            className={cn(
              'text-foreground col-span-2 text-sm leading-5 font-medium break-words',
              wide === 'md'
                ? '@[34rem]/condition:col-span-1 @[34rem]/condition:self-end'
                : '@[40rem]/condition:col-span-1 @[40rem]/condition:self-end',
            )}
          >
            {label}
          </p>
          <div
            className={cn(
              'col-start-1 flex min-h-5 min-w-0 items-center',
              three && 'col-span-2',
              wide === 'md'
                ? '@[34rem]/condition:row-start-2 @[34rem]/condition:self-start'
                : '@[40rem]/condition:col-span-1 @[40rem]/condition:row-start-2 @[40rem]/condition:self-start',
            )}
          >
            {value === null ? (
              <span data-condition-state="" className="text-subtle-foreground text-[0.8125rem]">
                {notAnswered}
              </span>
            ) : (
              <button
                type="button"
                aria-label={removeAria}
                onClick={() => onChange(null)}
                className={cn(
                  'text-muted-foreground hover:text-foreground focus-visible:ring-ring relative rounded-sm text-left text-[0.8125rem] underline-offset-4 outline-none hover:underline focus-visible:ring-2',
                  'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                )}
              >
                {removeLabel}
              </button>
            )}
          </div>
          <div
            className={cn(
              'min-w-0 gap-2',
              three
                ? 'col-span-2 grid grid-cols-3 @[40rem]/condition:col-span-1 @[40rem]/condition:col-start-2 @[40rem]/condition:row-span-2 @[40rem]/condition:row-start-1 @[40rem]/condition:flex'
                : 'col-start-2 flex justify-end @[34rem]/condition:row-span-2 @[34rem]/condition:row-start-1',
            )}
          >
            {options.map((option) => {
              const id = `${idPrefix}-${option.value}`;
              const checked = value === option.value;
              return (
                <div key={option.value} className="min-w-0">
                  <input
                    type="radio"
                    id={id}
                    name={name}
                    value={option.value}
                    checked={checked}
                    onChange={() => onChange(option.value)}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={id}
                    data-option-selected={checked ? 'true' : undefined}
                    className={cn(
                      'flex h-full min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none',
                      /*
                        THREE ANSWERS ON A PHONE STACK THE MARKER ABOVE THE WORD,
                        as Confidence's steps do, so "Don't remember" wraps only
                        at its space and never mid-word, down to a 360px phone.
                      */
                      three &&
                        'flex-col justify-center gap-1 px-1.5 py-2 text-center @[40rem]/condition:flex-row @[40rem]/condition:justify-start @[40rem]/condition:gap-2 @[40rem]/condition:px-3 @[40rem]/condition:py-1.5 @[40rem]/condition:text-left',
                      'peer-focus-visible:ring-ring peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                      checked
                        ? 'border-foreground/60 bg-accent text-foreground font-semibold'
                        : 'border-control-border bg-background hover:bg-accent text-foreground font-medium',
                    )}
                  >
                    <RadioMark checked={checked} />
                    {/*
                      The word keeps its selected width at rest — a bold,
                      invisible, zero-height copy drawn by CSS reserves it — so
                      choosing an answer never nudges its neighbours or the
                      column of answers. The copy is not text: the label's name
                      stays exactly the word.
                    */}
                    <span
                      data-label={option.label}
                      className={cn(
                        'inline-flex min-w-0 flex-col',
                        'after:invisible after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)] after:select-none',
                        three
                          ? 'text-[0.8125rem] leading-4 @[40rem]/condition:text-sm @[40rem]/condition:leading-5'
                          : 'whitespace-nowrap',
                      )}
                    >
                      {option.label}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      </fieldset>
    </li>
  );
}
