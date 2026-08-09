import { AnalyticsSkeleton } from '@/components/analytics/analytics-page';
import { Container } from '@/components/shell/container';

export default function AnalyticsLoading() {
  return (
    <Container width="wide" className="flex min-w-0 flex-col gap-8 py-8">
      <div className="bg-muted h-10 w-52 animate-pulse rounded-md" aria-hidden="true" />
      <AnalyticsSkeleton />
    </Container>
  );
}
