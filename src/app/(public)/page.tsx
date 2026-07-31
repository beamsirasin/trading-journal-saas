import { Container } from '@/components/shell/container';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Public placeholder. Its only jobs are to prove the toolchain renders and to
 * state the product thesis.
 *
 * Deliberately shows no numbers. Plausible-looking sample metrics on a trading
 * product read as real performance, and there is no data behind this page.
 * Placeholders stay as em-dashes until Phase 06 computes something true.
 */

const foundations = [
  'Next.js 16 · App Router · React 19',
  'TypeScript strict, with noUncheckedIndexedAccess',
  'Tailwind CSS 4 · semantic design tokens',
  'Money in integer minor units · exact, never floating point',
  'UTC storage with IANA timezone conversion',
  'Vitest · React Testing Library · Playwright',
];

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="text-positive mt-0.5 size-4 shrink-0"
    >
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="relative isolate">
      {/* Restrained ambient wash — decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="bg-primary/10 absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full blur-3xl" />
        <div className="bg-brand/10 absolute top-32 -right-32 size-[28rem] rounded-full blur-3xl" />
      </div>

      <Container className="flex flex-col gap-12 py-16 sm:py-24">
        <header className="animate-rise flex flex-col items-start gap-5">
          <Badge variant="brand">Phase 00b · Core primitives</Badge>

          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Trading OS
          </h1>

          <p className="text-muted-foreground max-w-2xl text-lg leading-relaxed text-pretty">
            A trading journal that separates{' '}
            <span className="text-foreground font-medium">system performance</span> from{' '}
            <span className="text-foreground font-medium">trader execution</span> — so you know
            whether to fix the strategy or fix the discipline.
          </p>
        </header>

        <section
          aria-labelledby="attribution-heading"
          className="animate-rise flex flex-col gap-4"
          style={{ animationDelay: '80ms' }}
        >
          <h2
            id="attribution-heading"
            className="text-muted-foreground text-sm font-medium tracking-wide"
          >
            The question this product answers
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>System performance</CardTitle>
                <CardDescription>
                  What the strategy would have returned if its rules had been followed exactly.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground font-mono text-3xl" aria-label="No data yet">
                  —
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  Awaiting the calculation engine
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Trader performance</CardTitle>
                <CardDescription>
                  What actually happened, after real entries, exits, costs and mistakes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground font-mono text-3xl" aria-label="No data yet">
                  —
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  Awaiting the calculation engine
                </p>
              </CardContent>
            </Card>
          </div>

          <p className="text-muted-foreground text-sm">
            The gap between those two numbers is the entire product. No trades have been recorded
            yet, so there is nothing to compare.
          </p>
        </section>

        <section
          aria-labelledby="foundation-heading"
          className="animate-rise"
          style={{ animationDelay: '160ms' }}
        >
          <Card>
            <CardHeader>
              <CardTitle id="foundation-heading">Foundations in place</CardTitle>
              <CardDescription>
                This page renders, which means the toolchain below is wired correctly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
                {foundations.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckIcon />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      </Container>
    </div>
  );
}
