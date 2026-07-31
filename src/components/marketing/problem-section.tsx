import { cn } from '@/lib/utils';

import { Section, SectionIntro } from './section';

/**
 * The problem, and the insight that follows from it.
 *
 * Leads with the uncomfortable case rather than the flattering one: a
 * profitable trade taken against the rules is a worse outcome than a losing
 * trade taken correctly, because the profitable one teaches the trader to
 * repeat the mistake. That claim is the reason the schema stores system and
 * trader outcome as independent fields, so the marketing page and the data
 * model are making the same argument.
 */

interface Quadrant {
  readonly system: 'win' | 'loss';
  readonly trader: 'win' | 'loss';
  readonly title: string;
  readonly body: string;
  readonly emphasis: boolean;
}

const QUADRANTS: readonly Quadrant[] = [
  {
    system: 'win',
    trader: 'win',
    title: 'Followed a good signal',
    body: 'The setup worked and you took it as written. Repeatable, and the least interesting cell.',
    emphasis: false,
  },
  {
    system: 'win',
    trader: 'loss',
    title: 'A working system, damaged',
    body: 'The strategy was right and execution gave it back. Changing the strategy here would be the worst possible response.',
    emphasis: true,
  },
  {
    system: 'loss',
    trader: 'win',
    title: 'Paid for breaking the rules',
    body: 'You made money by deviating. A journal that only tracks profit congratulates you, and you learn exactly the wrong lesson.',
    emphasis: true,
  },
  {
    system: 'loss',
    trader: 'loss',
    title: 'Followed a bad signal',
    body: 'You did your job and the strategy did not. This is the cell that justifies changing the system.',
    emphasis: false,
  },
];

const EXAMPLES = [
  {
    result: '+$320',
    resultTone: 'positive' as const,
    headline: 'Profitable, and badly executed',
    body: 'You entered late, moved the stop, and closed early. The rules were worth 3R. You captured 0.4R and the account still went up.',
  },
  {
    result: '−$200',
    resultTone: 'negative' as const,
    headline: 'A loss, and perfectly executed',
    body: 'The setup failed at its planned stop. Nothing went wrong that you control. This is the cost of doing business, not a mistake.',
  },
  {
    result: '?',
    resultTone: 'neutral' as const,
    headline: 'Which one is the problem?',
    body: 'Profit and loss cannot tell you. It reports the same number whether you followed the plan or abandoned it.',
  },
];

export function ProblemSection() {
  return (
    <Section id="the-problem" labelledBy="the-problem-title" tone="surface">
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow="The problem"
          title="Profit does not prove the trade was correct"
          titleId="the-problem-title"
          description="Two traders can end the month at the same balance while doing completely different things. One is running a system. The other is being rescued by luck. A journal that records only outcomes cannot separate them."
        />

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {EXAMPLES.map((example) => (
            <li
              key={example.headline}
              className="bg-card border-border flex flex-col gap-3 rounded-lg border p-5"
            >
              <span
                className={cn(
                  'numeric text-2xl font-semibold',
                  example.resultTone === 'positive' && 'text-positive',
                  example.resultTone === 'negative' && 'text-negative',
                  example.resultTone === 'neutral' && 'text-muted-foreground',
                )}
              >
                {example.result}
              </span>
              <h3 className="text-card-title">{example.headline}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{example.body}</p>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h3 className="text-card-title">Every trade lands in one of four cells</h3>
            <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
              System outcome and trader outcome are recorded separately, so the two diagonals stay
              visible instead of collapsing into a single profit figure.
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {QUADRANTS.map((quadrant) => (
              <li
                key={quadrant.title}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-5',
                  quadrant.emphasis ? 'border-brand/40 bg-brand/5' : 'border-border bg-card',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CellTag axis="System" outcome={quadrant.system} />
                  <CellTag axis="Trader" outcome={quadrant.trader} />
                </div>
                <h4 className="text-foreground font-semibold">{quadrant.title}</h4>
                <p className="text-muted-foreground text-sm leading-relaxed">{quadrant.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

/**
 * The axis name is always spoken, never implied by position or colour — "Win"
 * on its own is ambiguous when two different axes both use the word.
 */
function CellTag({ axis, outcome }: { axis: string; outcome: 'win' | 'loss' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        outcome === 'win'
          ? 'border-positive/30 bg-positive/10 text-positive'
          : 'border-negative/30 bg-negative/10 text-negative',
      )}
    >
      {axis} {outcome === 'win' ? 'win' : 'loss'}
    </span>
  );
}
