import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TRIAL_DAYS } from '@/config/plans';
import { DemoDashboard } from '@/components/dashboard/demo-dashboard';
import { DemoBadge } from '@/components/product/demo-badge';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Demo dashboard',
  description:
    'A working attribution dashboard filled with fictional demo data, showing how system performance and trader performance are compared.',
  alternates: { canonical: '/demo' },
  openGraph: {
    title: 'Demo dashboard · Trading OS',
    description: 'See the system-versus-trader comparison on a fictional account.',
    url: '/demo',
    type: 'website',
  },
};

/**
 * Public demo.
 *
 * Renders exactly the same `DemoDashboard` the application shell renders at
 * `/app`, so a visitor is not shown a marketing mock-up that the product does
 * not match. The only difference is the surrounding chrome and the call to
 * action below it.
 */
export default function DemoPage() {
  return (
    <Container width="wide" className="flex flex-col gap-8 py-10 sm:py-12">
      <PageHeader
        title="Demo dashboard"
        description="A fictional account with 90 closed trades. Change the range and the account to see the surface respond; every figure is a fixture, not a calculation."
        meta={<DemoBadge />}
        actions={
          <>
            <Button asChild className="min-h-11">
              <Link href="/register">
                Start {TRIAL_DAYS}-day free trial
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="min-h-11">
              <Link href="/#how-it-works">How it works</Link>
            </Button>
          </>
        }
      />

      <DemoDashboard />
    </Container>
  );
}
