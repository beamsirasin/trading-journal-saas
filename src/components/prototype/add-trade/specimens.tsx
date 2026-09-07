'use client';

import { useState, type ReactNode } from 'react';

import { PrototypeShell } from '../prototype-shell';
import { ConfidenceControl } from './confidence-control';
import { EmotionsControl } from './emotions-control';
import { ExitsEditor } from './exits-editor';
import { Field } from './form-primitives';

/**
 * SPECIMEN PAGES.
 *
 * Two controls in this redesign have several states that matter and only one of
 * which can be photographed at a time — the exits editor across three
 * completion states, and confidence across recorded/unrecorded. A form
 * screenshot shows whichever state that form happens to be in; these pages show
 * them side by side so a reviewer can judge the SET rather than a sample.
 *
 * They are a review surface, not a product screen, so they carry a heading per
 * specimen. Nothing else about the controls differs from how the forms mount
 * them — the same components, the same props.
 */

function Specimen({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h2 className="text-foreground text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-0.5 mb-3 text-sm leading-relaxed">{description}</p>
      {children}
    </section>
  );
}

export function ExitsSpecimenScreen() {
  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <div className="mx-auto w-full max-w-[760px] px-4 pt-8 pb-16 sm:px-6">
        <h1 className="text-foreground text-2xl leading-8 font-semibold tracking-tight">Exits</h1>
        <p className="text-muted-foreground mt-1 mb-8 text-sm">
          Initial risk 100.00 USD for the whole position. Percentages are of the original position;
          each amount is that leg&apos;s own total.
        </p>

        <div className="flex min-w-0 flex-col gap-10">
          <Specimen
            title="Ordinary full close"
            description="One leg, 100%, one result. No percentage arithmetic for a reader who simply closed the trade."
          >
            <ExitsEditor
              variant="after-trade"
              initialRows={[
                { id: 'f1', percent: '100.00', amount: '200.00', at: '7 Sep 2026, 14:32' },
              ]}
            />
          </Specimen>

          <Specimen
            title="Two partial exits, remainder unrecorded"
            description="The example from the specification: 40% at +80.00 and 60% at −30.00 is +50.00 USD and +0.50R — the amounts are summed, never weighted a second time. Here the second leg is still blank, so the total is short of 100% and the editor says so."
          >
            <ExitsEditor
              variant="after-trade"
              initialRows={[
                { id: 'g1', percent: '40.00', amount: '80.00', at: '5 Sep 2026, 13:44' },
                { id: 'g2', percent: '', amount: '', at: '' },
              ]}
            />
          </Specimen>

          <Specimen
            title="Two partial exits on a position that is still open"
            description="65% recorded across two legs against a 100.00 USD initial risk. The result is labelled realized so far, and the remaining 35% is offered as an explicit action rather than filled in."
          >
            <ExitsEditor
              variant="open-position"
              initialRows={[
                { id: 'h1', percent: '25.00', amount: '-40.00', at: '1 Sep 2026, 12:02' },
                { id: 'h2', percent: '40.00', amount: '-80.00', at: '1 Sep 2026, 16:30' },
                { id: 'h3', percent: '', amount: '', at: '' },
              ]}
            />
          </Specimen>
        </div>
      </div>
    </PrototypeShell>
  );
}

export function EntryContextSpecimenScreen() {
  const [unrecorded, setUnrecorded] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<number | null>(75);
  const [neutral, setNeutral] = useState<number | null>(50);

  const [untouched, setUntouched] = useState<readonly string[] | null>(null);
  const [none, setNone] = useState<readonly string[] | null>([]);
  const [chosen, setChosen] = useState<readonly string[] | null>(['Calm', 'Focused']);

  return (
    <PrototypeShell active="trades" chrome="desktop-only">
      <div className="mx-auto w-full max-w-[760px] px-4 pt-8 pb-16 sm:px-6">
        <h1 className="text-foreground text-2xl leading-8 font-semibold tracking-tight">
          Entry context
        </h1>
        <p className="text-muted-foreground mt-1 mb-8 text-sm">
          Confidence has five discrete states and a real null. Emotions distinguish never-answered
          from an explicit &ldquo;none of these&rdquo;.
        </p>

        <div className="flex min-w-0 flex-col gap-10">
          <Specimen
            title="Confidence · not recorded"
            description="The resting state. Nothing is preselected — Neutral is an answer meaning 50, not the absence of one — and the caption says so in words rather than leaving an empty rail to be read as 'very low'."
          >
            <div className="border-border bg-card rounded-lg border p-5">
              <ConfidenceControl value={unrecorded} onChange={setUnrecorded} />
            </div>
          </Specimen>

          <Specimen
            title="Confidence · High"
            description="The selected step is taller and carries the accent; the steps below it are filled, which is what makes the ordering readable without reading all five labels. Clear returns to null."
          >
            <div className="border-border bg-card rounded-lg border p-5">
              <ConfidenceControl value={recorded} onChange={setRecorded} />
            </div>
          </Specimen>

          <Specimen
            title="Confidence · Neutral, recalled after the trade"
            description="The same control, said differently. After Trade adds the hindsight note rather than introducing a second control that could drift from this one."
          >
            <div className="border-border bg-card rounded-lg border p-5">
              <ConfidenceControl
                value={neutral}
                onChange={setNeutral}
                label="How confident were you at entry?"
                hint="Recalled after the trade."
              />
            </div>
          </Specimen>

          <Specimen
            title="Emotions · never answered"
            description="Opening the section is not an answer. This is the state the current form silently converts into 'no emotions', which is what makes an analytics population of browsed trades indistinguishable from answered ones."
          >
            <div className="border-border bg-card rounded-lg border p-5">
              <EmotionsControl value={untouched} onChange={setUntouched} />
            </div>
          </Specimen>

          <Specimen
            title="Emotions · explicitly none of these"
            description="A deliberate, separate, mutually exclusive choice — visually distinct from the state above, and stored as a real answer."
          >
            <div className="border-border bg-card rounded-lg border p-5">
              <EmotionsControl value={none} onChange={setNone} />
            </div>
          </Specimen>

          <Specimen
            title="Emotions · selected"
            description="Multi-select, no valence colour and no score. Deselecting the last chip returns to never-answered rather than silently becoming 'none'."
          >
            <div className="border-border bg-card flex flex-col gap-6 rounded-lg border p-5">
              <EmotionsControl value={chosen} onChange={setChosen} />
              <Field label="Why did you take this trade?" optional>
                {(id) => (
                  <textarea
                    id={id}
                    rows={3}
                    defaultValue="Third push out of the London range with the 4H trend. Waited for the 15m close rather than anticipating."
                    className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full rounded-md border px-3 py-2 text-base outline-none focus-visible:ring-[3px]"
                  />
                )}
              </Field>
            </div>
          </Specimen>
        </div>
      </div>
    </PrototypeShell>
  );
}
