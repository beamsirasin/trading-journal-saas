import { ArrowRight, PlayCircle } from 'lucide-react';
import Link from 'next/link';

import { TRIAL_DAYS } from '@/config/plans';
import { Container } from '@/components/shell/container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { ProductPreview } from './product-preview';

/**
 * Hero.
 *
 * The claim is narrow on purpose. The product does not promise better
 * returns; it promises to tell you which of two very different problems you
 * have. Overclaiming here would be the easiest thing to do and the fastest
 * way to make the rest of the page dishonest.
 *
 * Nothing is said about broker imports, MT4/MT5, CSV, or AI. Those are
 * explicitly out of MVP scope (CLAUDE.md §9) and advertising them would be a
 * false capability claim.
 *
 * Entrance motion is a short CSS `animate-rise` with a small stagger, not a
 * Motion sequence: content must not be gated behind an animation, and the
 * global reduced-motion rule collapses it to nothing.
 */
export function Hero() {
  return (
    <div className="relative isolate overflow-hidden">
      {/*
        A restrained ambient wash. Two soft radial fields, no particles, no
        animation, no grid overlay — it reads as depth rather than decoration
        and costs nothing to render.
      */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-primary/10 absolute -top-48 left-1/2 size-[42rem] -translate-x-1/2 rounded-full blur-3xl" />
        <div className="bg-brand/8 absolute top-24 -right-40 size-[30rem] rounded-full blur-3xl" />
      </div>

      <Container className="py-16 sm:py-20 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div className="animate-rise flex flex-col items-start gap-6">
            <Badge variant="brand">Attribution, not bookkeeping</Badge>

            <h1 className="text-display text-balance">Know whether it was the strategy or you.</h1>

            <p className="text-muted-foreground max-w-xl text-lg leading-relaxed text-pretty">
              Most journals record what happened, so they can only ever show profit and loss.
              Trading OS records what <em className="text-foreground not-italic">should</em> have
              happened too — then measures the distance between them.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="min-h-11">
                <Link href="/register">
                  Preview registration
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>

              <Button asChild variant="outline" size="lg" className="min-h-11">
                <Link href="/demo" prefetch={false}>
                  <PlayCircle className="size-4" aria-hidden="true" />
                  See the demo dashboard
                </Link>
              </Button>
            </div>

            <p className="text-muted-foreground text-sm">
              Planned {TRIAL_DAYS}-day trial · no card required · registration is not live yet
            </p>
          </div>

          <div className="animate-rise min-w-0" style={{ animationDelay: '120ms' }}>
            <ProductPreview />
          </div>
        </div>
      </Container>
    </div>
  );
}
