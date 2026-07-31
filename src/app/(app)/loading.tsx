import { Container } from '@/components/shell/container';

/**
 * Route-level loading boundary.
 *
 * The skeleton mirrors the real page's layout so that content swapping in
 * does not shift anything. A spinner would be less work and worse: it tells
 * the user nothing about what is arriving.
 */
export default function AppLoading() {
  return (
    <Container width="wide" className="py-8">
      <div className="flex animate-pulse flex-col gap-6" aria-hidden="true">
        <div className="flex flex-col gap-2">
          <div className="bg-muted h-8 w-48 rounded-md" />
          <div className="bg-muted h-4 w-72 rounded-md" />
        </div>
        <div className="border-border bg-card flex flex-col gap-4 rounded-lg border p-6">
          <div className="bg-muted h-5 w-40 rounded-md" />
          <div className="bg-muted h-4 w-full max-w-xl rounded-md" />
          <div className="bg-muted h-4 w-full max-w-md rounded-md" />
        </div>
      </div>
      <span className="sr-only" role="status">
        Loading
      </span>
    </Container>
  );
}
