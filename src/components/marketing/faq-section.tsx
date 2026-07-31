import { ChevronDown } from 'lucide-react';

import { TRIAL_DAYS } from '@/config/plans';

import { Section, SectionIntro } from './section';

/**
 * FAQ.
 *
 * Built on native `<details>`/`<summary>` rather than an accordion component.
 * The native element is keyboard operable, exposes correct expanded state to
 * assistive tech, works with JavaScript disabled, and is searchable by the
 * browser's find-in-page — which a JS accordion with hidden panels is not.
 * A Radix Accordion would add a client component and a dependency to
 * reimplement all of that slightly worse.
 *
 * Answers state the MVP scope as it actually is. Every "no" here is a real
 * limitation (CLAUDE.md §9), and softening one into "not yet" would be an
 * implied roadmap commitment.
 */

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

const FAQ: readonly FaqItem[] = [
  {
    question: 'Why is journal entry manual?',
    answer:
      'Because the number the product is built around does not exist anywhere else. A broker feed knows what you filled; it does not know what your strategy told you to do. That counterfactual only exists in your head, so it has to be typed in. Automating the half that can be automated would not remove the step that matters.',
  },
  {
    question: 'Can I import trades from my broker?',
    answer:
      'No. There is no broker API integration, no MT4 or MT5 synchronisation, and no CSV import. Trades are entered by hand. This is a deliberate scope decision for this release, not a feature in progress.',
  },
  {
    question: 'What is System Performance?',
    answer:
      'The result the strategy would have produced if its rules had been followed exactly — scored from your planned entry, your planned stop, and the exit the rules define. It answers the question "does this strategy have an edge at all?", independently of how well you traded it.',
  },
  {
    question: 'What is Trader Performance?',
    answer:
      'The result your actual decisions produced — real entry, real stop, real exit, and real costs including commission, fees and swap. Compared with system performance it shows how much of the strategy’s edge survived contact with you.',
  },
  {
    question: 'Can I attach TradingView charts?',
    answer:
      'You can paste the URL of a TradingView chart onto any trade, and the journal keeps it with that trade. It is a stored link, not an integration: nothing is read from TradingView, no chart images are captured, and no TradingView account is connected.',
  },
  {
    question: 'Is there a free trial?',
    answer: `Yes — ${TRIAL_DAYS} days, starting at first login, with no card required. Payment processing is not connected to the product yet, so nothing can be charged.`,
  },
  {
    question: 'Can I use it on my phone?',
    answer:
      'Yes. Logging a trade is designed for a phone, since that is usually where you are when you close one. The heavier analytics are designed for a desktop screen and stay readable on a tablet; wide tables scroll inside their own area rather than forcing the page sideways.',
  },
  {
    question: 'Does it use AI to analyse my trades?',
    answer:
      'No. There is no AI analysis in this product. The metrics are defined formulas, documented in the repository and covered by tests, so you can check exactly how any number was produced.',
  },
];

export function FaqSection() {
  return (
    <Section id="faq" labelledBy="faq-title" width="prose">
      <div className="flex flex-col gap-10">
        <SectionIntro
          eyebrow="Questions"
          title="What this product does and does not do"
          titleId="faq-title"
        />

        <ul className="flex flex-col gap-3">
          {FAQ.map((item) => (
            <li key={item.question}>
              <details className="group border-border bg-card rounded-lg border">
                <summary className={cnSummary}>
                  {/*
                    A heading inside the summary, following the ARIA authoring
                    practice for disclosures: the native element supplies the
                    button semantics and expanded state, and the heading makes
                    each question reachable by heading navigation. h3 sits
                    correctly under the section's h2.
                  */}
                  <h3 className="text-foreground font-medium">{item.question}</h3>
                  <ChevronDown
                    aria-hidden="true"
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                  />
                  {/* The default triangle is removed in CSS by the class
                      below; hiding it there alone leaves a stray marker in
                      some browsers, hence the explicit ::-webkit rule. */}
                </summary>
                <p className="text-muted-foreground px-5 pb-5 text-sm leading-relaxed">
                  {item.answer}
                </p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const cnSummary = [
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4',
  'rounded-lg text-left',
  'focus-visible:outline-ring',
  '[&::-webkit-details-marker]:hidden',
].join(' ');
