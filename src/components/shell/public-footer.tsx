import { Container } from './container';

export function PublicFooter() {
  return (
    <footer className="border-border mt-auto border-t">
      <Container className="text-muted-foreground flex flex-col gap-2 py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>Trading OS — a journal that separates system performance from execution.</p>
        <p className="text-xs">
          Journaling and analytics only. Not financial advice, and past performance does not
          indicate future results.
        </p>
      </Container>
    </footer>
  );
}
