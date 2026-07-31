import type { Metadata } from 'next';

import { Container } from '@/components/shell/container';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Dashboard',
};

/**
 * Placeholder route so the shell has something to frame and the e2e tests
 * have a real page to navigate to. No dashboard widgets — those arrive in
 * Phase 08, once there is data worth showing.
 */
export default function AppHomePage() {
  return (
    <Container width="wide" className="py-8">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The application shell. No product features are implemented yet.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Nothing to show yet</CardTitle>
            <CardDescription>
              Attribution analytics need trades to compare. Trade capture arrives in Phase 07 and
              the dashboard in Phase 08 — this route exists so the shell, navigation and theming can
              be verified now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground grid gap-2 text-sm">
              <li>Navigation, header and mobile drawer are functional.</li>
              <li>Theme preference persists and follows the OS by default.</li>
              <li>Money and time primitives are available to later phases.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
