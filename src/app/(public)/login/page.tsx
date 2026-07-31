import type { Metadata } from 'next';
import Link from 'next/link';

import { DemoAuthForm } from '@/components/forms/demo-auth-form';
import { Container } from '@/components/shell/container';

export const metadata: Metadata = {
  title: 'Log in',
  description: 'Log in to Trading OS.',
  alternates: { canonical: '/login' },
  // A sign-in page has no business in an index even once it works.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-page-title">Log in</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            This page is a design preview. Authentication is not implemented, so nothing you type is
            sent or stored.
          </p>
        </div>

        <DemoAuthForm mode="login" />

        <p className="text-muted-foreground mt-8 text-center text-sm">
          No account yet?{' '}
          <Link href="/register" className="text-primary underline underline-offset-4">
            Create one
          </Link>
        </p>
      </div>
    </Container>
  );
}
