import {
  BarChart3,
  BookOpen,
  LineChart,
  ListChecks,
  Smartphone,
  Target,
  type LucideIcon,
} from 'lucide-react';

import { Section, SectionIntro } from './section';

/**
 * Feature overview.
 *
 * Six capabilities, all of which are in the MVP scope defined by
 * docs/product-spec.md §4. AI analysis is absent because it is explicitly out
 * of scope, and listing it as "coming" on a pricing-adjacent page is how a
 * roadmap item quietly becomes a promise.
 */

interface Feature {
  readonly Icon: LucideIcon;
  readonly title: string;
  readonly body: string;
}

const FEATURES: readonly Feature[] = [
  {
    Icon: BookOpen,
    title: 'Fast manual journal',
    body: 'A keyboard-friendly entry form built for the two minutes after you close a position, not for a data-entry shift.',
  },
  {
    Icon: LineChart,
    title: 'TradingView chart links',
    body: 'Attach the URL of your annotated chart to any trade. Your markup, kept with the trade that produced it.',
  },
  {
    Icon: Target,
    title: 'Strategy playbooks',
    body: 'Write the rules down and version them. Trades stay scored against the version that was live when you took them.',
  },
  {
    Icon: BarChart3,
    title: 'System vs trader analytics',
    body: 'Win rate, average R, expectancy, profit factor, total R and max drawdown — computed twice, compared directly.',
  },
  {
    Icon: ListChecks,
    title: 'Mistake and discipline tracking',
    body: 'Tag deviations from a fixed taxonomy and see them ranked by cost in R, not by how often they happen.',
  },
  {
    Icon: Smartphone,
    title: 'Works on the phone',
    body: 'Analytics are built for a desktop screen. Logging a trade is built for the one in your hand.',
  },
];

export function FeaturesSection() {
  return (
    <Section id="features" labelledBy="features-title">
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow="What you get"
          title="A small product that does one thing properly"
          titleId="features-title"
          description="No broker connections, no imports, no automated analysis. Everything here exists to support one comparison, and nothing is included because a competitor has it."
        />

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <li
              key={title}
              className="bg-card border-border hover:border-brand/40 flex flex-col gap-3 rounded-lg border p-5 transition-colors"
            >
              <span className="bg-brand/10 text-brand flex size-10 items-center justify-center rounded-lg">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="text-card-title">{title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>

        <p className="text-muted-foreground border-border max-w-3xl border-l-2 pl-4 text-sm leading-relaxed">
          Not included, and not planned for this release: broker API connections, MT4 and MT5
          synchronisation, CSV import, screenshot OCR, and automated AI analysis.
        </p>
      </div>
    </Section>
  );
}
