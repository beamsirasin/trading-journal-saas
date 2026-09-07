'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

import { PROTOTYPE_STRATEGIES, PROTOTYPE_TIMEZONE } from '../fixtures';
import { PrototypeShell } from '../prototype-shell';
import { ConfidenceControl } from './confidence-control';
import { EmotionsControl } from './emotions-control';
import { ExitsEditor } from './exits-editor';
import {
  BasisSwitch,
  ChoiceGroup,
  ComputedResult,
  CoreGroup,
  CoreSurface,
  Field,
  FieldPair,
  FormFooter,
  FormShell,
  OptionalSection,
  TextField,
} from './form-primitives';

/**
 * AFTER TRADE — actual first, and the plan is optional beneath it.
 *
 * THIS IS THE STRUCTURAL CHANGE THE REDESIGN IS FOR. The current form requires
 * a plan basis and plan values in BOTH recording paths, so a trader writing up
 * a trade from three weeks ago has to invent a planned risk before the form will
 * accept what actually happened — and then type the real risk again below it.
 * That is how a journal starts collecting fiction. Here the first thing the page
 * asks for is the result, and "Add original plan" is a closed row under it.
 *
 * WHAT THE ORDER SAYS. Identity, times, then Actual result, in money by
 * default: initial risk and net realized P&L, which is two numbers a broker
 * statement can answer directly. The computed line beneath them states the
 * canonical outcome — `+2.00R · Win` — as an ANSWER, not as another question:
 * the engine classifies the result, the trader does not choose it.
 *
 * A MISSING PLAN IS NOT PUNISHED. There is no empty plan column beside the
 * actual figures, no "Planned R —" placeholder, and no warning. Planned R is
 * simply unavailable for a trade that was never planned on paper, and the
 * journal says so later rather than the form complaining now.
 *
 * THE SYSTEM RESULT DEFAULTS TO REVIEW LATER and is never seeded from the exit.
 * An exit price says where the position closed; it does not say which of the
 * strategy's rules would have fired first, and letting the form guess is how a
 * counterfactual quietly becomes a copy of the actual.
 */
export function AfterTradeForm() {
  const [basis, setBasis] = useState<'money' | 'price'>('money');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [direction, setDirection] = useState<'long' | 'short' | null>('long');
  const [risk, setRisk] = useState('200.00');
  const [pnl, setPnl] = useState('400.00');
  const [negative, setNegative] = useState(false);
  const [multipleExits, setMultipleExits] = useState(false);

  const [planOpen, setPlanOpen] = useState(false);
  const [plannedReward, setPlannedReward] = useState('');
  const [strategy, setStrategy] = useState<string | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [emotions, setEmotions] = useState<readonly string[] | null>(null);
  const [systemOutcome, setSystemOutcome] = useState('review_later');

  const riskNumber = Number(risk);
  const pnlNumber = Number(pnl) * (negative ? -1 : 1);
  const actualR =
    Number.isFinite(riskNumber) && riskNumber > 0 && Number.isFinite(pnlNumber) && pnl !== ''
      ? pnlNumber / riskNumber
      : null;
  // Break-even is a tolerance band, never an equality test against zero.
  const outcome =
    actualR === null
      ? null
      : Math.abs(actualR) <= 0.05
        ? 'Break-even'
        : actualR > 0
          ? 'Win'
          : 'Loss';

  const strategySummary =
    strategy === null ? null : setup === null ? strategy : `${strategy} / ${setup}`;
  const contextParts = [
    confidence === null
      ? null
      : `${['Very low', 'Low', 'Neutral', 'High', 'Very high'][confidence / 25] ?? ''} confidence`,
    emotions === null ? null : emotions.length === 0 ? 'None of these' : emotions.join(', '),
  ].filter((part): part is string => part !== null && part !== '');

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <FormShell
        situation="After trade · Position is closed"
        onChangeSituation={() => {
          window.location.href = '../log-trade';
        }}
        footer={
          <FormFooter
            action="Save closed trade"
            helper="You can add the plan, the strategy and the system result later."
            sticky
          />
        }
      >
        <CoreSurface>
          <CoreGroup>
            <Field label="Account" suffix="USD">
              {(id) => (
                <select
                  id={id}
                  defaultValue="Live · FTMO 100K"
                  className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                >
                  <option>Live · FTMO 100K</option>
                  <option>Personal · Thai broker</option>
                </select>
              )}
            </Field>

            <FieldPair>
              <TextField label="Symbol" value={symbol} onChange={setSymbol} placeholder="XAUUSD" />
              <Field label="Direction">
                {() => (
                  <ChoiceGroup
                    legend="Direction"
                    value={direction}
                    onChange={setDirection}
                    options={[
                      { value: 'long', label: 'Long' },
                      { value: 'short', label: 'Short' },
                    ]}
                  />
                )}
              </Field>
            </FieldPair>

            {/*
              THE TIMEZONE IS STATED ONCE, ABOVE BOTH FIELDS (spec §I).

              It was on each field's own label row, which on a 390px screen put
              "Asia/Bangkok · GMT+7" on the page twice within 150 vertical
              pixels, saying the same thing about two fields that could not
              possibly be in different zones.
            */}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-subtle-foreground text-xs">Times in {PROTOTYPE_TIMEZONE}</p>
              <FieldPair>
                <Field label="Entry time">
                  {(id) => (
                    // Deliberately blank on arrival. A historical trade silently
                    // dated today is a wrong record that looks like a right one.
                    <Input id={id} type="datetime-local" className="numeric text-base" />
                  )}
                </Field>
                <Field label="Exit time">
                  {(id) => <Input id={id} type="datetime-local" className="numeric text-base" />}
                </Field>
              </FieldPair>
            </div>
          </CoreGroup>

          <div className="border-border border-t pt-5">
            <CoreGroup
              title="Actual result"
              description="What actually happened. This is all a closed trade needs."
            >
              <BasisSwitch value={basis} onChange={setBasis} />

              {basis === 'money' ? (
                <FieldPair>
                  <TextField
                    label="Initial risk"
                    suffix="USD"
                    value={risk}
                    onChange={setRisk}
                    inputMode="decimal"
                    numeric
                    hint="The amount you initially risked on this trade."
                  />
                  <Field
                    label="Net realized P&L"
                    suffix="USD"
                    hint="Profit or loss after all costs. Costs are not subtracted again."
                  >
                    {(id) => (
                      <div className="flex min-w-0 items-center gap-2">
                        {/* A visible sign control, because a phone's decimal
                            keypad frequently has no minus key — and a journal
                            that cannot record a loss on a phone is not a
                            journal. It stays synchronised with a typed sign and
                            preserves an explicit zero. */}
                        <button
                          type="button"
                          onClick={() => setNegative((current) => !current)}
                          aria-pressed={negative}
                          aria-label={negative ? 'Negative — a loss' : 'Positive — a profit'}
                          className={cn(
                            'focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md border text-sm outline-none focus-visible:ring-2',
                            negative
                              ? 'border-negative/40 bg-negative/10 text-negative'
                              : 'border-positive/40 bg-positive/10 text-positive',
                          )}
                        >
                          {negative ? (
                            <Minus className="size-4" aria-hidden="true" />
                          ) : (
                            <Plus className="size-4" aria-hidden="true" />
                          )}
                        </button>
                        <Input
                          id={id}
                          value={pnl}
                          inputMode="decimal"
                          onChange={(event) => setPnl(event.target.value)}
                          className="numeric text-base"
                        />
                      </div>
                    )}
                  </Field>
                </FieldPair>
              ) : (
                <FieldPair>
                  <TextField label="Actual entry" value="" onChange={() => {}} numeric />
                  <TextField label="Initial stop" value="" onChange={() => {}} numeric />
                  <TextField label="Exit price" value="" onChange={() => {}} numeric />
                  <TextField label="Position size" optional value="" onChange={() => {}} numeric />
                </FieldPair>
              )}

              {actualR !== null && outcome !== null ? (
                <ComputedResult
                  tone={
                    outcome === 'Win' ? 'positive' : outcome === 'Loss' ? 'negative' : 'neutral'
                  }
                >
                  <span className="text-muted-foreground">Actual result</span>
                  <span
                    className={cn(
                      'numeric text-base font-semibold',
                      outcome === 'Win'
                        ? 'text-positive'
                        : outcome === 'Loss'
                          ? 'text-negative'
                          : 'text-foreground',
                    )}
                  >
                    {actualR > 0 ? '+' : ''}
                    {actualR.toFixed(2)}R
                  </span>
                  <span className="text-foreground font-medium">· {outcome}</span>
                </ComputedResult>
              ) : null}

              <div>
                <button
                  type="button"
                  aria-expanded={multipleExits}
                  onClick={() => setMultipleExits((current) => !current)}
                  className="text-primary focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                >
                  {multipleExits ? 'Use a single result' : 'Multiple exits'}
                </button>
                {multipleExits ? (
                  <div className="mt-3">
                    <ExitsEditor variant="after-trade" />
                  </div>
                ) : null}
              </div>
            </CoreGroup>
          </div>
        </CoreSurface>

        {/*
          THE PLAN, BELOW THE RESULT AND CLOSED. Its summary reads "Not
          recorded" rather than sitting empty, because "I never wrote one down"
          is a legitimate and common answer that the form should be able to
          leave alone.
        */}
        <OptionalSection
          title="Add original plan"
          summary={planOpen && plannedReward !== '' ? `Target reward ${plannedReward} USD` : null}
        >
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Only what you actually planned before the trade. Nothing here is filled in from the
              result above.
            </p>
            <FieldPair>
              <TextField label="Planned risk" suffix="USD" value="" onChange={() => {}} numeric />
              <TextField
                label="Target reward"
                suffix="USD"
                value={plannedReward}
                onChange={(value) => {
                  setPlannedReward(value);
                  setPlanOpen(true);
                }}
                numeric
              />
            </FieldPair>
          </div>
        </OptionalSection>

        <OptionalSection title="Strategy" summary={strategySummary}>
          <div className="flex min-w-0 flex-col gap-4">
            <Field label="Strategy">
              {(id) => (
                <select
                  id={id}
                  value={strategy ?? ''}
                  onChange={(event) => {
                    setStrategy(event.target.value === '' ? null : event.target.value);
                    setSetup(null);
                  }}
                  className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                >
                  <option value="">Not assigned</option>
                  {PROTOTYPE_STRATEGIES.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {strategy === null ? null : (
              <Field label="Setup">
                {(id) => (
                  <select
                    id={id}
                    value={setup ?? ''}
                    onChange={(event) =>
                      setSetup(event.target.value === '' ? null : event.target.value)
                    }
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                  >
                    <option value="">Not assigned</option>
                    {(
                      PROTOTYPE_STRATEGIES.find((item) => item.name === strategy)?.setups ?? []
                    ).map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
          </div>
        </OptionalSection>

        <OptionalSection
          title="Entry context"
          summary={contextParts.length === 0 ? null : contextParts.join(' · ')}
          note="Recorded after the trade"
        >
          <div className="flex min-w-0 flex-col gap-6">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Recalled after the result was known. Stored as recalled, never presented as though it
              was captured at entry.
            </p>
            <ConfidenceControl value={confidence} onChange={setConfidence} />
            <EmotionsControl value={emotions} onChange={setEmotions} />
          </div>
        </OptionalSection>

        <OptionalSection title="Notes and chart" summary={null}>
          <Field label="Anything else to remember?" optional>
            {(id) => (
              <textarea
                id={id}
                rows={3}
                className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
              />
            )}
          </Field>
        </OptionalSection>

        <OptionalSection
          title="Add system result"
          summary={systemOutcome === 'review_later' ? null : 'Resolved'}
          note="Review later"
        >
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-muted-foreground text-xs leading-relaxed">
              What the strategy&apos;s own rules would have produced. Nothing here is selected from
              your exit price.
            </p>
            <Field label="System outcome">
              {(id) => (
                <select
                  id={id}
                  value={systemOutcome}
                  onChange={(event) => setSystemOutcome(event.target.value)}
                  className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                >
                  <option value="review_later">Review later</option>
                  <option value="target">Target reached</option>
                  <option value="stop">Stop reached</option>
                  <option value="break_even">Break-even rule</option>
                  <option value="other">Other rule-based exit</option>
                  <option value="no_trade">System would not enter</option>
                </select>
              )}
            </Field>
            {systemOutcome === 'target' ? (
              <p className="text-muted-foreground text-xs leading-relaxed">
                Target reached needs a recorded target. Add an original plan above to resolve it
                numerically, or choose another outcome.
              </p>
            ) : null}
          </div>
        </OptionalSection>
      </FormShell>
    </PrototypeShell>
  );
}
