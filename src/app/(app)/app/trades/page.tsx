import { Plus } from 'lucide-react';
import type { Metadata } from 'next';

import { DEMO_TRADES } from '@/lib/demo';
import { TradesTable } from '@/components/dashboard/trades-table';
import { DemoBadge, DemoDataNotice } from '@/components/product/demo-badge';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Trades',
};

/**
 * The journal.
 *
 * A preview of the list surface with real demo rows, so the responsive
 * behaviour — table on desktop, record cards on mobile — can be reviewed now
 * rather than discovered during Phase 08.
 *
 * "Log a trade" is disabled rather than opening an empty form. A form that
 * cannot save is a worse experience than a button that explains itself, and
 * `aria-describedby` makes the explanation reach a screen reader instead of
 * only appearing beside it.
 */
export default function TradesPage() {
  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader
        title="Trades"
        description="Every trade scored twice — once against the strategy's rules, once against what you actually did."
        meta={<DemoBadge />}
        actions={
          <Button className="min-h-11" disabled aria-describedby="log-trade-note">
            <Plus className="size-4" aria-hidden="true" />
            Log a trade
          </Button>
        }
      />

      <p id="log-trade-note" className="text-muted-foreground -mt-4 text-sm">
        Trade entry arrives with the journal release. This page is a layout preview.
      </p>

      <DemoDataNotice />

      <section aria-labelledby="all-trades" className="flex flex-col gap-4">
        <SectionHeader
          id="all-trades"
          title={`${DEMO_TRADES.length} closed trades`}
          description="Newest first. Both outcome columns are stored fields, never inferred from profit."
        />
        <TradesTable trades={DEMO_TRADES} />
      </section>
    </Container>
  );
}
