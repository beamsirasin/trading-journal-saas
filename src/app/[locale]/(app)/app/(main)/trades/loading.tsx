import { Container } from '@/components/shell/container';

export default function TradesLoading() {
  return (
    <Container width="wide" className="flex animate-pulse flex-col gap-6 py-8" aria-busy="true">
      <div className="bg-muted h-9 w-48 rounded" />
      <div className="bg-muted h-16 w-full rounded" />
      <div className="bg-muted h-80 w-full rounded-lg" />
    </Container>
  );
}
