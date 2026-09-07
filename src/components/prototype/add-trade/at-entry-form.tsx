'use client';

import { Check } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

import { PROTOTYPE_STRATEGIES, PROTOTYPE_TIMEZONE } from '../fixtures';
import { PrototypeShell } from '../prototype-shell';
import { ConfidenceControl } from './confidence-control';
import { emotionLabel, EmotionsControl } from './emotions-control';
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
  TextField,
} from './form-primitives';
import { OptionalDetails, OptionalEntry } from './optional-details';

/**
 * AT ENTRY — the short path, made to look short.
 *
 * FOUR FACTS AND ONE NUMBER. Account, symbol, direction, entry time, initial
 * risk. Everything else on this page is either computed from those or is a
 * closed row the reader may ignore entirely. The form's PERCEIVED length is the
 * thing being designed here: a trader logging a position they have just opened
 * is doing it in the thirty seconds before the market moves again, and a page
 * that opens looking like a questionnaire gets abandoned regardless of how few
 * fields are actually required.
 *
 * "OPENING MATCHES THIS PLAN" IS STATED, NOT ASSUMED. In money mode the initial
 * risk is both the planned risk and the risk actually taken, and that identity
 * is exactly the kind of thing a form silently relies on and a reader never
 * learns. It is a visible rule with a visible escape: "Opening differs from
 * plan" reveals the actual figures inline and LEAVES the plan above them, so
 * the two remain distinguishable rather than one overwriting the other.
 *
 * NO MISSING-FIELD CHECKLIST BEFORE THE FIRST SAVE. Validation happens on
 * submission and on blur for malformed values; it does not stand beside the
 * form narrating what has not been typed yet.
 */
export function AtEntryForm({
  /**
   * The "already answered" review state, reachable at `?expand=1`.
   *
   * A PROP RESOLVED ON THE SERVER, not a mount effect that fills the fields in
   * afterwards — the effect version rendered the empty form first and then
   * populated it, which is a cascading render React's lint rule rejects and a
   * race a screenshot can lose.
   */
  prefilled = false,
}: {
  prefilled?: boolean;
}) {
  const [basis, setBasis] = useState<'money' | 'price'>('money');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [direction, setDirection] = useState<'long' | 'short' | null>('long');
  const [risk, setRisk] = useState('200.00');
  const [reward, setReward] = useState('1000.00');
  const [differs, setDiffers] = useState(false);
  const [actualRisk, setActualRisk] = useState('');

  const [strategy, setStrategy] = useState<string | null>(prefilled ? 'Elliott Wave' : null);
  const [setup, setSetup] = useState<string | null>(prefilled ? 'Wave 3 Continuation' : null);
  const [confidence, setConfidence] = useState<number | null>(prefilled ? 75 : null);
  const [emotions, setEmotions] = useState<readonly string[] | null>(prefilled ? ['Calm'] : null);
  const [entryReason, setEntryReason] = useState(
    prefilled ? 'Third push out of the London range, with the 4H trend.' : '',
  );
  const [notes, setNotes] = useState(
    prefilled ? 'Watching for the New York open to extend it.' : '',
  );

  const riskNumber = Number(risk);
  const rewardNumber = Number(reward);
  const plannedR =
    Number.isFinite(riskNumber) && riskNumber > 0 && Number.isFinite(rewardNumber) && reward !== ''
      ? rewardNumber / riskNumber
      : null;

  const strategySummary =
    strategy === null ? null : setup === null ? strategy : `${strategy} / ${setup}`;
  const contextParts = [
    confidence === null
      ? null
      : `${['Very low', 'Low', 'Neutral', 'High', 'Very high'][confidence / 25] ?? ''} confidence`,
    emotions === null
      ? null
      : emotions.length === 0
        ? 'None of these'
        : emotions.map(emotionLabel).join(', '),
  ].filter((part): part is string => part !== null && part !== '');
  const notesSummary = notes.trim() === '' ? null : 'Note added';

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <FormShell
        situation="At entry · Position is open"
        onChangeSituation={() => {
          window.location.href = '../log-trade';
        }}
        footer={
          <FormFooter
            action="Save open trade"
            helper="You can add exits and review later."
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
                  className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-md border px-3 text-base outline-none focus-visible:ring-[3px]"
                  defaultValue="Live · FTMO 100K"
                >
                  <option>Live · FTMO 100K</option>
                  <option>Personal · Thai broker</option>
                </select>
              )}
            </Field>

            <FieldPair>
              <TextField
                label="Symbol"
                value={symbol}
                onChange={setSymbol}
                placeholder="XAUUSD"
                hint="Recently used: XAUUSD, NAS100, EURUSD"
              />
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

            <Field label="Entered at" suffix={PROTOTYPE_TIMEZONE}>
              {(id) => (
                <div className="flex min-w-0 items-center gap-2">
                  {/* Initialised ONCE, to now. It does not advance while the
                      reader types, opens a section or switches basis. */}
                  <Input
                    id={id}
                    type="datetime-local"
                    defaultValue="2026-09-07T14:32"
                    className="numeric text-base"
                  />
                  <button
                    type="button"
                    className="border-border hover:bg-accent focus-visible:ring-ring h-11 shrink-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
                  >
                    Now
                  </button>
                </div>
              )}
            </Field>
          </CoreGroup>

          <div className="border-border border-t pt-5">
            <CoreGroup title="Your plan">
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
                  <TextField
                    label="Target reward"
                    suffix="USD"
                    optional
                    value={reward}
                    onChange={setReward}
                    inputMode="decimal"
                    numeric
                  />
                </FieldPair>
              ) : (
                <FieldPair>
                  <TextField label="Planned entry" value="" onChange={() => {}} numeric />
                  <TextField label="Planned stop" value="" onChange={() => {}} numeric />
                </FieldPair>
              )}

              {/* Shown only once it MEANS something — never as an empty frame
                  saying "not enough yet". */}
              {plannedR !== null ? (
                <ComputedResult>
                  <span className="text-muted-foreground">Planned reward</span>
                  <span className="numeric text-foreground text-base font-semibold">
                    {plannedR.toFixed(2)}R
                  </span>
                  <span className="text-muted-foreground">· 1R = {riskNumber.toFixed(2)} USD</span>
                </ComputedResult>
              ) : null}

              {/*
                ONE LINE, NOT A PANEL.

                This was a dashed box carrying a check icon, a two-sentence
                explanation and a disclosure button — roughly 100px asserting
                that nothing unusual had happened. On the SHORT path, the path
                whose entire claim is that it looks short, the largest single
                element was the one saying there was nothing to do.

                The rule is now a sentence with the escape beside it, and the
                explanation appears only once the reader has asked for it by
                activating Change — which is the moment the distinction between
                a plan and an opening starts to matter.
              */}
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <Check className="text-positive size-4 shrink-0" aria-hidden="true" />
                <span className="text-muted-foreground">Opening matches plan</span>
                <span className="text-subtle-foreground" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  aria-expanded={differs}
                  onClick={() => setDiffers((current) => !current)}
                  className={cn(
                    'text-primary focus-visible:ring-ring relative rounded-sm font-medium',
                    'underline-offset-4 outline-none hover:underline focus-visible:ring-2',
                    'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                  )}
                >
                  Change
                </button>
              </div>

              {differs ? (
                <div className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 rounded-md border p-3">
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    In money mode your initial risk is recorded as both the planned risk and the
                    risk you actually took. Enter the real opening risk here to separate them; the
                    plan above is kept as it was.
                  </p>
                  <TextField
                    label="Actual initial risk"
                    suffix="USD"
                    value={actualRisk}
                    onChange={setActualRisk}
                    inputMode="decimal"
                    numeric
                  />
                </div>
              ) : null}
            </CoreGroup>
          </div>
        </CoreSurface>

        <OptionalDetails description="None of this is required to save">
          <OptionalEntry title="Strategy" summary={strategySummary} defaultOpen={prefilled}>
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
          </OptionalEntry>

          <OptionalEntry
            title="Entry context"
            summary={contextParts.length === 0 ? null : contextParts.join(' · ')}
          >
            <div className="flex min-w-0 flex-col gap-6">
              <ConfidenceControl value={confidence} onChange={setConfidence} />
              <EmotionsControl value={emotions} onChange={setEmotions} />
              <Field label="Why did you take this trade?" optional>
                {(id) => (
                  <textarea
                    id={id}
                    rows={3}
                    value={entryReason}
                    onChange={(event) => setEntryReason(event.target.value)}
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
                  />
                )}
              </Field>
            </div>
          </OptionalEntry>

          <OptionalEntry title="Notes and chart" summary={notesSummary}>
            <div className="flex min-w-0 flex-col gap-4">
              <Field label="Anything else to remember?" optional>
                {(id) => (
                  <textarea
                    id={id}
                    rows={3}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
                  />
                )}
              </Field>
              <TextField
                label="Chart link"
                optional
                value=""
                onChange={() => {}}
                placeholder="https://www.tradingview.com/x/…"
              />
            </div>
          </OptionalEntry>
        </OptionalDetails>
      </FormShell>
    </PrototypeShell>
  );
}
