import { Section, SectionIntro } from './section';

/**
 * How it works.
 *
 * Describes manual entry honestly and does not mention broker import, MT4/MT5
 * sync, CSV upload, or OCR anywhere — all four are explicitly out of MVP
 * scope (CLAUDE.md §9), and a workflow diagram implying otherwise would be a
 * capability claim the product cannot meet.
 *
 * Step 4 is the one that makes the rest work, and it is also the one a trader
 * is most likely to skip. The wording is deliberately neutral — recording a
 * mistake has to feel like data collection, not a confession, or the data
 * stops being honest and the attribution built on it becomes worthless.
 */

interface Step {
  readonly title: string;
  readonly body: string;
}

const STEPS: readonly Step[] = [
  {
    title: 'Record the trade',
    body: 'Instrument, direction, planned entry, planned stop, planned target, and what actually filled. Typed in by you — a couple of minutes per trade.',
  },
  {
    title: 'Paste a TradingView chart link',
    body: 'Attach the URL of your marked-up chart so the setup is there when you review it later. A link, not an integration: nothing is read from TradingView.',
  },
  {
    title: 'Pick the strategy version',
    body: 'Trades attach to a specific version of a playbook. When you change the rules, past trades stay scored against the rules that were live at the time.',
  },
  {
    title: 'Say whether you followed the rules',
    body: 'Tag any deviations from a fixed list — moved stop, exited early, oversized, chased entry. This is the input the whole comparison rests on.',
  },
  {
    title: 'Compare system with actual',
    body: 'The journal scores the trade twice: what the rules would have produced, and what your decisions produced. Both in R, side by side.',
  },
  {
    title: 'Watch the pattern, not the trade',
    body: 'One trade tells you nothing. A meaningful sample can show which mistake costs the most R, whether the strategy has held up, and whether discipline is improving.',
  },
];

export function WorkflowSection() {
  return (
    <Section id="how-it-works" labelledBy="how-it-works-title" tone="surface">
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow="How it works"
          title="Six steps, entered by hand, on purpose"
          titleId="how-it-works-title"
          description="Manual entry is not a limitation waiting to be fixed. The counterfactual — what the rules would have done — does not exist in any broker feed. Only you know it, so only you can record it."
        />

        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="border-border bg-card text-brand numeric flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold"
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <h3 className="text-card-title">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
