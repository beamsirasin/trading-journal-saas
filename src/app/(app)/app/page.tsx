import type { Metadata } from 'next';

import { DemoDashboard } from '@/components/dashboard/demo-dashboard';
import { PageHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';

export const metadata: Metadata = {
  title: 'Overview',
};

/**
 * Application overview.
 *
 * Renders the same `DemoDashboard` as the public `/demo` route, from one
 * component. Two copies of "the dashboard" — a polished marketing one and a
 * thinner in-app one — is how a demo starts promising something the product
 * does not deliver.
 *
 * NO AUTHENTICATION GUARDS THIS ROUTE. That is a Phase 02 concern and is
 * recorded as an open risk in the phase document; it is safe today only
 * because the page holds fixtures rather than anyone's data.
 */
export default function AppOverviewPage() {
  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader
        title="Overview"
        description="How much of your strategy's edge actually reached the account."
      />
      <DemoDashboard />
    </Container>
  );
}
