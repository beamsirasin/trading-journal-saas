'use client';

import { ArrowLeft, BarChart3, Check, Clock } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { useKeyboardObscuringViewport } from '../add-trade/form-primitives';
import { PrototypeShell } from '../prototype-shell';
import {
  CAPTURED_NOW,
  contextSummary,
  issueCount,
  journalSummary,
  PILOT_ACCOUNT,
  PILOT_TIMEZONE,
  priceNotice,
  saveRequirements,
  seedDraft,
  targetRText,
  validateDraft,
  type PilotDraft,
  type PilotState,
} from './at-entry-pilot-model';
import { ExitPlanBlock } from './exit-plan-pilot';
import { ConfidenceRail, EmotionChoices, StrategyFields } from './journal-pilot';
import {
  ChoiceGroup,
  Disclosure,
  GroupHeading,
  Helper,
  InlineAction,
  Legend,
  Notice,
  PilotInput,
  PilotTextarea,
  PilotTheme,
  RADIUS,
  RequirementRow,
  StateText,
  Tag,
} from './pilot-surface';

const RECENT_SYMBOLS = ['XAUUSD', 'NAS100', 'EURUSD'] as const;

/**
 * AT ENTRY — VISUAL PILOT (design validation, not production).
 *
 * The moment question is "What am I doing and why?". The page answers it in
 * reading order: the trade, then risk and plan, then the trader's read on it,
 * then optional context. One capture plane; groups separated by space and a
 * group title; one primary action. Nothing is persisted.
 */
export function AtEntryPilot({
  initialState,
  figures,
}: {
  initialState: PilotState;
  figures: 'tabular' | 'mono';
}) {
  const seed = useMemo(() => seedDraft(initialState), [initialState]);
  const [draft, setDraft] = useState<PilotDraft>(seed.draft);
  const [attempted, setAttempted] = useState(seed.attempted);
  const [contextOpen, setContextOpen] = useState(seed.contextOpen);
  const [journalOpen, setJournalOpen] = useState(seed.journalOpen);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const keyboardOpen = useKeyboardObscuringViewport();
  const ids = { trade: useId(), plan: useId(), journal: useId(), context: useId() };

  const issues = validateDraft(draft);
  const shown = attempted ? issues : pickImmediate(issues, draft);
  const requirements = saveRequirements(draft);
  const remaining = requirements.filter((item) => !item.done).length;
  const notice = priceNotice(draft);
  const targetR = targetRText(draft);
  const update = (patch: Partial<PilotDraft>) => setDraft((current) => ({ ...current, ...patch }));

  function save() {
    setAttempted(true);
    if (issueCount(issues) > 0) {
      setSavedMessage(null);
      requestAnimationFrame(() => document.getElementById('pilot-save-status')?.focus());
      return;
    }
    setSavedMessage('Pilot only: this would save an open trade. Nothing was written.');
  }

  const statusLine =
    attempted && issueCount(issues) > 0
      ? `${issueCount(issues)} ${issueCount(issues) === 1 ? 'thing needs' : 'things need'} attention before saving`
      : remaining === 0
        ? 'Ready to save. Everything else can wait.'
        : `${remaining} of 4 needed to save`;

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <PilotTheme figures={figures}>
        <div className="mx-auto w-full max-w-[70rem] px-4 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8 lg:pb-16">
          {/* A compact flow header: a way back, the title, the recording situation. */}
          <header className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground -ml-3"
              >
                <ArrowLeft aria-hidden="true" />
                Trades
              </Button>
            </div>
            <h1 className="text-foreground text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
              Record an open trade
            </h1>
            <p className="text-muted-foreground flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span>At entry: the position is still open.</span>
              <InlineAction onClick={() => {}}>Recording a closed trade instead?</InlineAction>
            </p>
          </header>

          <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start lg:gap-8">
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
              className={cn(
                'bg-card border-border shadow-card flex min-w-0 flex-col border',
                RADIUS.surface,
              )}
            >
              {/* 1 — THE TRADE */}
              <section
                aria-labelledby={ids.trade}
                className="flex min-w-0 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6"
              >
                <GroupHeading id={ids.trade} title="The trade" />

                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 text-sm">
                    <span className="text-muted-foreground">Account </span>
                    <span className="text-foreground font-semibold">{PILOT_ACCOUNT.name}</span>
                    <span className="text-muted-foreground">
                      {' '}
                      {PILOT_ACCOUNT.mode}, {PILOT_ACCOUNT.currency}
                    </span>
                  </p>
                  <InlineAction onClick={() => {}} ariaLabel="Change account">
                    Change
                  </InlineAction>
                </div>

                <div className="grid min-w-0 gap-5 min-[560px]:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-2">
                    <PilotInput
                      id="pilot-symbol"
                      label="Symbol"
                      value={draft.symbol}
                      onChange={(symbol) => update({ symbol: symbol.toUpperCase() })}
                      placeholder="e.g. XAUUSD"
                      autoCapitalize="characters"
                      error={shown.symbol}
                    />
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-muted-foreground text-sm">Recent</span>
                      {RECENT_SYMBOLS.map((symbol) => (
                        <InlineAction
                          key={symbol}
                          onClick={() => update({ symbol })}
                          ariaLabel={`Use ${symbol}`}
                        >
                          {symbol}
                        </InlineAction>
                      ))}
                    </div>
                  </div>
                  <ChoiceGroup
                    legend="Direction"
                    value={draft.direction}
                    onChange={(direction) => update({ direction })}
                    error={shown.direction}
                    compact
                    options={[
                      { value: 'long', label: 'Long' },
                      { value: 'short', label: 'Short' },
                    ]}
                  />
                </div>

                <EntryTimeField draft={draft} onChange={(entryTime) => update({ entryTime })} />
              </section>

              {/* 2 — RISK AND PLAN */}
              <section
                aria-labelledby={ids.plan}
                className="border-border flex min-w-0 flex-col gap-6 border-t px-4 py-5 sm:px-6 sm:py-6"
              >
                <GroupHeading id={ids.plan} title="Risk and plan" />

                <div className="flex min-w-0 flex-col gap-3">
                  <PilotInput
                    id="pilot-risk"
                    label="Risk at entry"
                    value={draft.risk}
                    onChange={(risk) => update({ risk })}
                    suffix={PILOT_ACCOUNT.currency}
                    inputMode="decimal"
                    size="lead"
                    figure
                    hint="The most this whole position stands to lose at your stop. This is your 1R."
                    error={shown.risk}
                  />
                  <ActualRiskLine
                    draft={draft}
                    onChange={(actualRisk) => update({ actualRisk })}
                    error={shown.actualRisk}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-3">
                  <ChoiceGroup
                    legend="Target"
                    value={draft.target}
                    status="Not answered"
                    onChange={(target) => update({ target })}
                    error={shown.target}
                    options={[
                      {
                        value: 'fixed',
                        label: 'Fixed target',
                        description: 'A profit amount, a TP price, or both',
                      },
                      {
                        value: 'none',
                        label: 'No fixed target',
                        description: 'You will close on a rule or judgement',
                      },
                    ]}
                  />
                  {draft.target === 'fixed' ? (
                    <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
                      <PilotInput
                        id="pilot-target-profit"
                        label="Target profit"
                        value={draft.targetProfit}
                        onChange={(targetProfit) => update({ targetProfit })}
                        suffix={PILOT_ACCOUNT.currency}
                        inputMode="decimal"
                        figure
                        error={shown.targetProfit}
                      />
                      <PilotInput
                        id="pilot-tp-price"
                        label="TP price"
                        value={draft.tpPrice}
                        onChange={(tpPrice) => update({ tpPrice })}
                        inputMode="decimal"
                        figure
                        labelAside={<Tag tone="context">Price context</Tag>}
                        error={shown.tpPrice}
                      />
                    </div>
                  ) : null}
                  {targetR === null ? null : (
                    <p className="text-muted-foreground text-sm">
                      Reaching your target would be{' '}
                      <span className="text-foreground pilot-figure font-semibold">+{targetR}</span>
                      .
                    </p>
                  )}
                </div>

                <ExitPlanBlock draft={draft} onChange={setDraft} />
              </section>

              {/* 3 — YOUR READ ON THIS TRADE (core analytical data, optional to save) */}
              <section
                aria-labelledby={ids.journal}
                className="border-border flex min-w-0 flex-col gap-5 border-t px-4 py-5 sm:px-6 sm:py-6"
              >
                <GroupHeading
                  id={ids.journal}
                  title="Why you are taking it"
                  description="Not needed to save. These answers build your Strategy and Psychology insights."
                  aside={
                    <span className="text-muted-foreground hidden items-center gap-1.5 text-sm lg:inline-flex">
                      <BarChart3 className="size-4" aria-hidden="true" />
                      Used in analytics
                    </span>
                  }
                />
                <Disclosure
                  id="pilot-journal-toggle"
                  title={journalOpen ? 'Hide these questions' : 'Answer these now'}
                  summary={journalSummary(draft)}
                  open={journalOpen}
                  onToggle={() => setJournalOpen((open) => !open)}
                  openFromDesktop
                  className="-mx-1"
                >
                  <JournalFields draft={draft} onChange={setDraft} />
                </Disclosure>
              </section>

              {/* 4 — CONTEXT */}
              <section className="border-border min-w-0 border-t px-2 py-3 sm:px-3">
                <Disclosure
                  id={ids.context}
                  title="Trade idea, chart and price levels"
                  summary={contextSummary(draft)}
                  open={contextOpen}
                  onToggle={() => setContextOpen((open) => !open)}
                >
                  <div className="flex min-w-0 flex-col gap-4 pb-3">
                    <PilotTextarea
                      id="pilot-reason"
                      label="Why this trade"
                      value={draft.reason}
                      onChange={(reason) => update({ reason })}
                      placeholder="What you see, and why it is worth the risk."
                    />
                    <PilotInput
                      id="pilot-chart"
                      label="Chart link"
                      value={draft.chartUrl}
                      onChange={(chartUrl) => update({ chartUrl })}
                      inputMode="url"
                      placeholder="https://www.tradingview.com/x/…"
                    />
                    <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-2">
                      <PilotInput
                        id="pilot-timeframe"
                        label="Timeframe"
                        value={draft.timeframe}
                        onChange={(timeframe) => update({ timeframe })}
                        placeholder="15m"
                      />
                      <PilotInput
                        id="pilot-session"
                        label="Session"
                        value={draft.session}
                        onChange={(session) => update({ session })}
                        placeholder="London"
                      />
                    </div>
                    <div className="flex min-w-0 flex-col gap-3">
                      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-foreground text-sm font-medium">Price levels</p>
                        <StateText>Context only, never used to calculate results</StateText>
                      </div>
                      <div className="grid min-w-0 gap-4 min-[560px]:grid-cols-3">
                        <PilotInput
                          id="pilot-entry-price"
                          label="Entry price"
                          value={draft.entryPrice}
                          onChange={(entryPrice) => update({ entryPrice })}
                          inputMode="decimal"
                          figure
                          error={shown.entryPrice}
                        />
                        <PilotInput
                          id="pilot-stop-price"
                          label="SL price"
                          value={draft.stopPrice}
                          onChange={(stopPrice) => update({ stopPrice })}
                          inputMode="decimal"
                          figure
                          error={shown.stopPrice}
                        />
                        <PilotInput
                          id="pilot-size"
                          label="Size"
                          value={draft.size}
                          onChange={(size) => update({ size })}
                          inputMode="decimal"
                          figure
                        />
                      </div>
                      {notice === null ? null : <Notice tone="warning">{notice}</Notice>}
                    </div>
                    <PilotTextarea
                      id="pilot-notes"
                      label="Notes"
                      value={draft.notes}
                      onChange={(notes) => update({ notes })}
                    />
                  </div>
                </Disclosure>
              </section>

              {/* Mobile / tablet: one docked action bar that yields to the keyboard. */}
              <div
                data-pilot-action-bar={keyboardOpen ? 'inline' : 'docked'}
                className={cn(
                  'border-border bg-card flex min-w-0 items-center gap-3 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden',
                  keyboardOpen
                    ? 'rounded-b-xl'
                    : 'sticky bottom-0 z-20 rounded-b-xl shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.45)]',
                )}
              >
                <p
                  className="text-muted-foreground min-w-0 flex-1 text-sm leading-snug"
                  aria-live="polite"
                >
                  {savedMessage ?? statusLine}
                </p>
                <Button type="submit" size="lg" className="min-h-12 shrink-0">
                  Save open trade
                </Button>
              </div>
            </form>

            {/* Desktop: the save panel stays in view beside a long form. */}
            <aside
              aria-label="Save"
              className="hidden lg:sticky lg:top-[calc(var(--shell-header-height)+1.5rem)] lg:block"
            >
              <div
                className={cn(
                  'bg-card border-border shadow-card flex flex-col gap-4 border p-5',
                  RADIUS.surface,
                )}
              >
                <div>
                  <h2 className="text-foreground text-base font-semibold">Needed to save</h2>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    Everything else can be added now or later.
                  </p>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {requirements.map((item) => (
                    <RequirementRow key={item.key} label={item.label} done={item.done} />
                  ))}
                </ul>
                <Button type="button" size="lg" className="min-h-12 w-full" onClick={save}>
                  Save open trade
                </Button>
                <p
                  id="pilot-save-status"
                  tabIndex={-1}
                  aria-live="polite"
                  className={cn(
                    'text-sm outline-none',
                    attempted && issueCount(issues) > 0
                      ? 'text-destructive'
                      : 'text-muted-foreground',
                  )}
                >
                  {savedMessage ??
                    (attempted && issueCount(issues) > 0
                      ? statusLine
                      : 'You can record exits and review this trade later.')}
                </p>
              </div>
            </aside>
          </div>
        </div>
      </PilotTheme>
    </PrototypeShell>
  );
}

/** Issues that speak before a save attempt: only malformed values the trader already typed. */
function pickImmediate(issues: ReturnType<typeof validateDraft>, draft: PilotDraft) {
  const immediate: Record<string, string> = {};
  const typed: Record<string, string> = {
    risk: draft.risk,
    targetProfit: draft.targetProfit,
    tpPrice: draft.tpPrice,
    entryPrice: draft.entryPrice,
    stopPrice: draft.stopPrice,
    actualRisk: draft.actualRisk.kind === 'different' ? draft.actualRisk.amount : '',
  };
  for (const [key, message] of Object.entries(issues)) {
    if ((typed[key] ?? '').trim() !== '') immediate[key] = message;
  }
  return immediate as ReturnType<typeof validateDraft>;
}

function EntryTimeField({
  draft,
  onChange,
}: {
  draft: PilotDraft;
  onChange: (value: PilotDraft['entryTime']) => void;
}) {
  const time = draft.entryTime;
  const isDefault = time?.origin === 'default';
  const hintId = 'pilot-entry-time-hint';
  return (
    <fieldset className="min-w-0" aria-describedby={hintId}>
      <Legend
        aside={
          isDefault ? (
            <Tag tone="default" icon={<Clock className="size-3" aria-hidden="true" />}>
              Set automatically to now
            </Tag>
          ) : time === null ? (
            <StateText>Not set</StateText>
          ) : null
        }
      >
        Entry time
      </Legend>
      <div className="mb-1.5 grid min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
        <input
          type="date"
          aria-label="Entry date"
          value={time?.date ?? ''}
          onChange={(event) =>
            onChange({ date: event.target.value, time: time?.time ?? '', origin: 'confirmed' })
          }
          className={cn(
            'bg-background border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/40 pilot-figure min-h-11 w-full min-w-0 border px-3 text-base outline-none focus-visible:ring-[3px]',
            RADIUS.control,
            isDefault && 'border-dashed',
          )}
        />
        <input
          type="time"
          aria-label="Entry time of day"
          value={time?.time ?? ''}
          onChange={(event) =>
            onChange({
              date: time?.date ?? CAPTURED_NOW.date,
              time: event.target.value,
              origin: 'confirmed',
            })
          }
          className={cn(
            'bg-background border-input text-foreground focus-visible:border-ring focus-visible:ring-ring/40 pilot-figure min-h-11 w-full min-w-0 border px-3 text-base outline-none focus-visible:ring-[3px]',
            RADIUS.control,
            isDefault && 'border-dashed',
          )}
        />
      </div>
      <Helper id={hintId}>
        {PILOT_TIMEZONE}. Opened earlier? Change it, or clear it if you are not sure.
      </Helper>
      <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
        {isDefault && time !== null ? (
          <InlineAction onClick={() => onChange({ ...time, origin: 'confirmed' })}>
            This time is right
          </InlineAction>
        ) : null}
        {time === null ? (
          <InlineAction onClick={() => onChange({ ...CAPTURED_NOW, origin: 'confirmed' })}>
            Use now
          </InlineAction>
        ) : (
          <InlineAction onClick={() => onChange(null)}>Clear time</InlineAction>
        )}
      </div>
    </fieldset>
  );
}

function ActualRiskLine({
  draft,
  onChange,
  error,
}: {
  draft: PilotDraft;
  onChange: (value: PilotDraft['actualRisk']) => void;
  error?: string | undefined;
}) {
  if (draft.actualRisk.kind === 'matched') {
    return (
      <p className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <Check className="text-foreground size-4" aria-hidden="true" />
          <span className="text-foreground">Your actual risk matched this amount.</span>
        </span>
        <InlineAction onClick={() => onChange({ kind: 'different', amount: '' })}>
          It was different
        </InlineAction>
      </p>
    );
  }
  const amount = draft.actualRisk.amount;
  return (
    <div className="border-border flex min-w-0 flex-col gap-2 border-l-2 pl-4">
      <PilotInput
        id="pilot-actual-risk"
        label="Actual risk"
        value={amount}
        onChange={(next) => onChange({ kind: 'different', amount: next })}
        suffix={PILOT_ACCOUNT.currency}
        inputMode="decimal"
        figure
        labelAside={
          amount.trim() === '' ? <StateText>Different, amount not known</StateText> : null
        }
        hint="Not sure of the exact amount? Leave it blank. It stays recorded as different."
        error={error}
      />
      <div>
        <InlineAction onClick={() => onChange({ kind: 'matched' })}>
          It matched after all
        </InlineAction>
      </div>
    </div>
  );
}

function JournalFields({
  draft,
  onChange,
}: {
  draft: PilotDraft;
  onChange: (next: PilotDraft) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-2">
      <StrategyFields draft={draft} onChange={onChange} />
      <div className="border-border border-t pt-5">
        <ConfidenceRail
          value={draft.confidence}
          onChange={(confidence) => onChange({ ...draft, confidence })}
        />
      </div>
      <div className="border-border border-t pt-5">
        <EmotionChoices
          value={draft.emotions}
          onChange={(emotions) => onChange({ ...draft, emotions })}
        />
      </div>
    </div>
  );
}
