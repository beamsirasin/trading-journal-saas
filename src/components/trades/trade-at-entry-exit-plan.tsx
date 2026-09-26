'use client';

import { GitBranch, Route } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { TradeCreateExitPlanOption, TradeCreateOptions } from '@/server/dal/trades';
import { Button } from '@/components/ui/button';

import {
  activeClassification,
  chooseCustomExitPlan,
  chooseNoExitRule,
  chooseSavedExitPlan,
  closeExitPlanEditor,
  commitCustomExitPlanText,
  openExitPlanEditor,
  removeExitPlanAnswer,
  resolveExitPlan,
  restoreStrategyDefault,
  setExitPlanEditorView,
  updateExitPlanEditor,
  type AtEntryDraft,
  type ExitPlanEditorSession,
} from './at-entry-draft';
import { TradeAdaptiveOverlay } from './trade-adaptive-overlay';
import { InlineAction, Notice, RadioMark, StateText, Tag } from './trade-at-entry-controls';
import {
  ExitPlanLibrary,
  newExitPlanLibraryForm,
  type ExitPlanLibraryForm,
} from './trade-at-entry-exit-plan-library';
import { TradeLauncherRow } from './trade-launcher-row';

/**
 * THE EXIT PLAN — five visual states that must not collapse.
 *
 *   not recorded   neutral words, and the ways to record one
 *   inherited      dashed "From Strategy" tag and a sentence saying so
 *   saved          the plan's name, the trader's own choice
 *   customized     "Customized for this trade", with where it came from
 *   no rule        the explicit answer "No defined exit rule"
 *
 * BROWSING IS STATE-NEUTRAL. The editor works on a session (`at-entry-draft`):
 * opening it, looking through the choices or the Customize view, and closing
 * with Done, X, Escape or an outside click commits only a real change. Discard
 * changes always restores what was there. Inheritance already applying is
 * never offered back as a redundant "Use this plan".
 */
export function AtEntryExitPlan({
  draft,
  options,
  onChange,
  onLibraryChanged,
  copy,
  presentation = 'section',
  rowId = 'exit-plan-row',
  rowLabel,
  rowEditLabel,
  rowMarker = null,
}: {
  draft: AtEntryDraft;
  options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  onChange: (next: AtEntryDraft) => void;
  onLibraryChanged: (plans: readonly TradeCreateExitPlanOption[]) => void;
  /** Wording for a historical reconstruction (After Trade); At Entry's own by default. */
  copy?: { readonly notRecordedHint: string; readonly editorDescription: string };
  /**
   * `row` reads the state as one launcher row that opens the states and their
   * actions in a focused sheet — Plan & Risk's reading (UX Rules §20.4).
   * Every state, snapshot, action and validation stays exactly as it is;
   * only where they are read changes.
   */
  presentation?: 'section' | 'row';
  rowId?: string;
  rowLabel?: string;
  rowEditLabel?: string;
  /** The row's requirement badge (decision 59), decided by the host from the Target answer. */
  rowMarker?: ReactNode;
}) {
  const t = useTranslations('trades.create.recording.contractEntry.exitPlan');
  const c = useTranslations('trades.create.recording.contractEntry');
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const [session, setSession] = useState<ExitPlanEditorSession | null>(null);
  const [customBaseId, setCustomBaseId] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  // Library management state lives here, outside the overlay, so closing the
  // editor never loses a plan the trader was part-way through writing.
  const [managing, setManaging] = useState(false);
  const [libraryForm, setLibraryForm] = useState<ExitPlanLibraryForm | null>(null);
  /** Only the row reading uses these: its own sheet, and the row to return to. */
  const [stateSheet, setStateSheet] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  /*
    THE TWO OVERLAYS NEVER STACK. Choosing a plan from inside the state sheet
    replaces it rather than opening a second layer over it — two sheets deep on
    a phone is a trap — and closing the chooser brings the state sheet back
    exactly where the trader left it.
  */
  const reopenStateSheet = useRef(false);

  const { resolved, strategyDefault } = resolveExitPlan(draft, options);
  const strategyName = activeClassification(draft, options).strategy?.name ?? '';
  const hasPreservedCustom =
    draft.exitPlan.customText.trim() !== '' && resolved.status !== 'customized';

  function openEditor(
    view: 'choose' | 'customize',
    trigger: HTMLElement,
    base: TradeCreateExitPlanOption | null = null,
  ) {
    if (stateSheet) {
      reopenStateSheet.current = true;
      setStateSheet(false);
    }
    lastTrigger.current = trigger;
    setManaging(libraryForm !== null);
    setSession(setExitPlanEditorView(openExitPlanEditor(draft), view));
    if (resolved.status === 'customized') {
      setCustomBaseId(draft.exitPlan.customBaseId);
      setCustomText(draft.exitPlan.customText);
    } else {
      setCustomBaseId(base?.exitPlanId ?? null);
      setCustomText(base?.instructions ?? draft.exitPlan.customText);
    }
  }

  function closeEditor(intent: 'keep' | 'discard') {
    if (session === null) return;
    const next = closeExitPlanEditor(session, intent);
    if (next !== draft) onChange(next);
    setSession(null);
    if (reopenStateSheet.current) {
      // The sheet it came from takes the focus back with it.
      reopenStateSheet.current = false;
      setStateSheet(true);
      return;
    }
    requestAnimationFrame(() => {
      const trigger = lastTrigger.current;
      if (trigger !== null && trigger.isConnected) trigger.focus();
      else headingRef.current?.focus();
    });
  }

  const basePlan =
    resolved.status === 'inherited' || resolved.status === 'saved' ? resolved.plan : null;

  /** The state in one line, for a row or a collapsed reading of it. */
  const stateSummary =
    resolved.status === 'not_recorded'
      ? t('notRecorded')
      : resolved.status === 'no_rule'
        ? t('noRule')
        : resolved.status === 'unavailable'
          ? t('unavailable')
          : resolved.status === 'customized'
            ? t('customized')
            : resolved.plan.name;
  /**
   * WHERE THE PLAN CAME FROM, never a judgement on it. Inheritance and the
   * plan a customization started from are facts the row can state; every
   * other state says nothing here rather than inventing a second line.
   */
  const rowSupport =
    resolved.status === 'inherited'
      ? t('fromStrategy', { name: strategyName })
      : resolved.status === 'customized' && resolved.base !== null
        ? t('basedOn', { name: resolved.base.name })
        : null;

  const headerRow = (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      {presentation === 'row' ? (
        <span aria-hidden="true" />
      ) : (
        <h3
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="text-foreground text-sm font-medium outline-none"
        >
          {t('title')}
        </h3>
      )}
      {resolved.status === 'not_recorded' ? (
        presentation === 'row' ? null : (
          <StateText>{c('notAnswered')}</StateText>
        )
      ) : (
        <InlineAction
          ariaLabel={t('removeAria')}
          onClick={() => onChange(removeExitPlanAnswer(draft))}
        >
          {c('removeAnswer')}
        </InlineAction>
      )}
    </div>
  );

  const body = (
    <div
      data-exit-plan-state={resolved.status}
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-md border px-4 py-3',
        resolved.status === 'inherited' ? 'border-control-border border-dashed' : 'border-border',
      )}
    >
      {resolved.status === 'not_recorded' ? (
        <p className="text-muted-foreground text-sm">
          {copy?.notRecordedHint ?? t('notRecordedHint')}
        </p>
      ) : resolved.status === 'no_rule' ? (
        <p className="text-foreground text-sm font-semibold">{t('noRule')}</p>
      ) : resolved.status === 'unavailable' ? (
        <div data-exit-plan-unavailable="" className="flex min-w-0 flex-col gap-1" role="alert">
          <p className="text-foreground text-sm font-semibold">{t('unavailable')}</p>
          <p className="text-muted-foreground text-sm">{t('unavailableHint')}</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Route className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <p className="text-foreground min-w-0 text-sm font-semibold break-words">
              {resolved.status === 'customized' ? t('customized') : resolved.plan.name}
            </p>
            {resolved.status === 'inherited' ? (
              <Tag tone="inherited" icon={<GitBranch className="size-3" aria-hidden="true" />}>
                {t('fromStrategy', { name: strategyName })}
              </Tag>
            ) : null}
          </div>
          {resolved.status === 'customized' && resolved.base !== null ? (
            <p className="text-muted-foreground text-sm">
              {t('basedOn', { name: resolved.base.name })}
            </p>
          ) : null}
          <p className="text-muted-foreground line-clamp-3 text-sm leading-relaxed break-words">
            {resolved.status === 'customized' ? resolved.instructions : resolved.plan.instructions}
          </p>
          {resolved.status === 'inherited' ? (
            <Notice
              icon={
                <GitBranch
                  className="text-muted-foreground mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
              }
            >
              {t('inheritedNotice', { strategy: strategyName })}
            </Notice>
          ) : null}
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        {resolved.status === 'not_recorded' ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(event) => openEditor('choose', event.currentTarget)}
            >
              {t('choose')}
            </Button>
            <InlineAction onClick={() => onChange(chooseNoExitRule(draft))}>
              {t('noRule')}
            </InlineAction>
          </>
        ) : resolved.status === 'unavailable' ? (
          <InlineAction onClick={(event) => openEditor('choose', event.currentTarget)}>
            {t('chooseAnother')}
          </InlineAction>
        ) : resolved.status === 'inherited' ? (
          <>
            <InlineAction
              onClick={(event) => openEditor('customize', event.currentTarget, basePlan)}
            >
              {t('customize')}
            </InlineAction>
            <InlineAction onClick={(event) => openEditor('choose', event.currentTarget)}>
              {t('chooseAnother')}
            </InlineAction>
          </>
        ) : (
          <>
            <InlineAction onClick={(event) => openEditor('choose', event.currentTarget)}>
              {t('change')}
            </InlineAction>
            {resolved.status === 'no_rule' ? null : (
              <InlineAction
                onClick={(event) => openEditor('customize', event.currentTarget, basePlan)}
              >
                {resolved.status === 'customized' ? t('editWording') : t('customize')}
              </InlineAction>
            )}
          </>
        )}
        {hasPreservedCustom ? (
          <InlineAction onClick={() => onChange(chooseCustomExitPlan(draft))}>
            {t('useCustom')}
          </InlineAction>
        ) : null}
        {strategyDefault !== null && resolved.status !== 'inherited' ? (
          <InlineAction onClick={() => onChange(restoreStrategyDefault(draft))}>
            {t('useDefault')}
          </InlineAction>
        ) : null}
      </div>
    </div>
  );

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2">
      {presentation === 'row' ? (
        <>
          <h3 id={headingId} ref={headingRef} tabIndex={-1} className="sr-only outline-none">
            {t('title')}
          </h3>
          <TradeLauncherRow
            id={rowId}
            rowRef={rowRef}
            label={rowLabel ?? t('title')}
            marker={rowMarker}
            value={resolved.status === 'not_recorded' ? null : stateSummary}
            support={rowSupport}
            placeholder={t('notRecorded')}
            editLabel={rowEditLabel ?? t('title')}
            icon={Route}
            answered={resolved.status !== 'not_recorded'}
            onOpen={() => setStateSheet(true)}
            buttonData={{ 'data-exit-plan-row': resolved.status }}
          />
          {/*
            A chosen plan that went away blocks Save. The row says so where it
            is read, so the reason is never hidden behind a tap.
          */}
          {resolved.status === 'unavailable' ? (
            <p data-exit-plan-unavailable="" role="alert" className="text-destructive text-sm">
              {t('unavailableHint')}
            </p>
          ) : null}
          <TradeAdaptiveOverlay
            open={stateSheet}
            onOpenChange={(next) => {
              if (!next) setStateSheet(false);
            }}
            title={t('title')}
            description={copy?.editorDescription ?? t('editorDescription')}
            closeLabel={t('close')}
            size="focused"
            returnFocusRef={rowRef}
            footer={
              <div className="flex min-w-0 justify-end">
                <Button type="button" onClick={() => setStateSheet(false)}>
                  {t('done')}
                </Button>
              </div>
            }
          >
            <div className="flex min-w-0 flex-col gap-2">
              {headerRow}
              {body}
            </div>
          </TradeAdaptiveOverlay>
        </>
      ) : (
        <>
          {headerRow}
          {body}
        </>
      )}

      <ExitPlanEditor
        session={session}
        options={options}
        customText={customText}
        onClose={closeEditor}
        onView={(view) => setSession((current) => current && setExitPlanEditorView(current, view))}
        onChooseSaved={(plan) =>
          setSession(
            (current) =>
              current &&
              updateExitPlanEditor(current, (working) =>
                chooseSavedExitPlan(working, plan.exitPlanId, options),
              ),
          )
        }
        onChooseNoRule={() =>
          setSession((current) => current && updateExitPlanEditor(current, chooseNoExitRule))
        }
        onCustomText={(text) => {
          setCustomText(text);
          setSession(
            (current) =>
              current && {
                ...current,
                working: commitCustomExitPlanText(current.original, text, customBaseId, options),
              },
          );
        }}
        strategyName={strategyName}
        editorDescription={copy?.editorDescription ?? t('editorDescription')}
        managing={managing}
        libraryForm={libraryForm}
        onLibraryForm={setLibraryForm}
        onLibraryChanged={onLibraryChanged}
        onManage={(next, startForm) => {
          setManaging(next);
          if (startForm) setLibraryForm(newExitPlanLibraryForm());
        }}
      />
    </section>
  );
}

function ExitPlanEditor({
  session,
  options,
  customText,
  strategyName,
  editorDescription,
  onClose,
  onView,
  onChooseSaved,
  onChooseNoRule,
  onCustomText,
  managing,
  libraryForm,
  onLibraryForm,
  onManage,
  onLibraryChanged,
}: {
  session: ExitPlanEditorSession | null;
  options: Pick<TradeCreateOptions, 'strategies' | 'exitPlans'>;
  customText: string;
  strategyName: string;
  editorDescription: string;
  onClose: (intent: 'keep' | 'discard') => void;
  onView: (view: 'choose' | 'customize') => void;
  onChooseSaved: (plan: TradeCreateExitPlanOption) => void;
  onChooseNoRule: () => void;
  onCustomText: (text: string) => void;
  managing: boolean;
  libraryForm: ExitPlanLibraryForm | null;
  onLibraryForm: (form: ExitPlanLibraryForm | null) => void;
  onManage: (managing: boolean, startForm: boolean) => void;
  onLibraryChanged: (plans: readonly TradeCreateExitPlanOption[]) => void;
}) {
  const t = useTranslations('trades.create.recording.contractEntry.exitPlan');
  const name = useId();
  const open = session !== null;
  const working = session === null ? null : resolveExitPlan(session.working, options);
  const customizing = session?.view === 'customize';
  const selectedKey = customizing
    ? 'custom'
    : working === null
      ? ''
      : working.resolved.status === 'inherited' || working.resolved.status === 'saved'
        ? `plan:${working.resolved.plan.exitPlanId}`
        : working.resolved.status === 'customized'
          ? 'custom'
          : working.resolved.status === 'no_rule'
            ? 'no_rule'
            : '';
  const strategyId =
    session !== null && session.working.classification.strategy === 'selected'
      ? session.working.classification.strategyId
      : null;

  const inUseIds =
    working === null
      ? []
      : [
          working.resolved.status === 'inherited' || working.resolved.status === 'saved'
            ? working.resolved.plan.exitPlanId
            : working.resolved.status === 'customized'
              ? (working.resolved.base?.exitPlanId ?? null)
              : null,
          working.strategyDefault?.exitPlanId ?? null,
        ].filter((id): id is string => id !== null);

  const choices = [
    ...options.exitPlans.map((plan) => ({
      key: `plan:${plan.exitPlanId}`,
      title: plan.name,
      detail: plan.instructions,
      tag:
        plan.strategyId !== null && plan.strategyId === strategyId
          ? t('defaultFor', { strategy: strategyName })
          : null,
      apply: () => onChooseSaved(plan),
    })),
    {
      key: 'custom',
      title: t('writeOwn'),
      detail: t('writeOwnDescription'),
      tag: null,
      apply: () => onView('customize'),
    },
    {
      key: 'no_rule',
      title: t('noRule'),
      detail: t('noRuleDescription'),
      tag: null,
      apply: onChooseNoRule,
    },
  ];

  return (
    <TradeAdaptiveOverlay
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose('keep');
      }}
      title={t('title')}
      description={editorDescription}
      closeLabel={t('close')}
      footer={
        <div className="flex min-w-0 flex-wrap-reverse items-center justify-between gap-3">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => onClose('discard')}
          >
            {t('discard')}
          </Button>
          <Button type="button" onClick={() => onClose('keep')}>
            {t('done')}
          </Button>
        </div>
      }
    >
      {managing ? (
        <ExitPlanLibrary
          options={options}
          strategyId={strategyId}
          strategyName={strategyName}
          inUseIds={inUseIds}
          form={libraryForm}
          onForm={onLibraryForm}
          onBack={() => onManage(false, false)}
          onLibraryChanged={onLibraryChanged}
        />
      ) : (
        <>
          <fieldset className="flex min-w-0 flex-col gap-2" data-exit-plan-editor="">
            <legend className="sr-only">{t('title')}</legend>
            {options.exitPlans.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t('emptyLibrary')}{' '}
                <InlineAction onClick={() => onManage(true, true)}>{t('createFirst')}</InlineAction>
              </p>
            ) : null}
            {choices.map((choice) => {
              const checked = selectedKey === choice.key;
              const id = `${name}-${choice.key}`;
              return (
                <div key={choice.key} className="min-w-0">
                  <input
                    type="radio"
                    id={id}
                    name={name}
                    checked={checked}
                    onChange={choice.apply}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={id}
                    className={cn(
                      'peer-focus-visible:ring-ring flex min-h-12 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2',
                      checked
                        ? 'border-foreground/60 bg-accent'
                        : 'border-control-border bg-background hover:bg-accent',
                    )}
                  >
                    <RadioMark checked={checked} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-foreground text-sm font-semibold break-words">
                          {choice.title}
                        </span>
                        {choice.tag === null ? null : <Tag tone="context">{choice.tag}</Tag>}
                      </span>
                      <span className="text-muted-foreground mt-0.5 block text-sm break-words">
                        {choice.detail}
                      </span>
                    </span>
                  </label>
                </div>
              );
            })}
          </fieldset>
          {customizing || options.exitPlans.length === 0 ? null : (
            <div className="mt-3">
              <InlineAction onClick={() => onManage(true, false)}>{t('manage')}</InlineAction>
            </div>
          )}
          {customizing ? (
            <div className="mt-4 flex min-w-0 flex-col gap-1.5">
              <label
                htmlFor={`${name}-instructions`}
                className="text-foreground text-sm font-medium"
              >
                {t('customLabel')}
              </label>
              <textarea
                id={`${name}-instructions`}
                value={customText}
                rows={4}
                placeholder={t('customPlaceholder')}
                aria-describedby={`${name}-instructions-hint`}
                onChange={(event) => onCustomText(event.target.value)}
                className="bg-background border-control-border text-foreground placeholder:text-subtle-foreground focus-visible:border-ring focus-visible:ring-ring/40 min-h-28 w-full rounded-md border px-3 py-2.5 text-base outline-none focus-visible:ring-[3px]"
              />
              <p id={`${name}-instructions-hint`} className="text-muted-foreground text-sm">
                {t('customHint')}
              </p>
              <div>
                <InlineAction onClick={() => onView('choose')}>{t('backToChoices')}</InlineAction>
              </div>
            </div>
          ) : null}
        </>
      )}
    </TradeAdaptiveOverlay>
  );
}
