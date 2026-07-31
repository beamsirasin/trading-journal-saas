import type { Metadata } from 'next';
import Link from 'next/link';

import { DemoAuthForm } from '@/components/forms/demo-auth-form';
import { Container } from '@/components/shell/container';

export const metadata: Metadata = {
  title: 'Login preview',
  description: 'Preview the planned Trading OS login flow. Authentication is not live.',
  alternates: { canonical: '/login' },
  // A sign-in page has no business in an index even once it works.
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <Container width="prose" className="flex flex-col items-center py-16 sm:py-24">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-2">
          <h1 className="text-page-title">Login preview</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            This page is a design preview. Authentication is not implemented, so nothing you type is
            sent or stored.
          </p>
        </div>

        <DemoAuthForm mode="login" />

        <p className="text-muted-foreground mt-8 text-center text-sm">
          No account yet?{' '}
          <Link
            href="/register"
            className="text-primary inline-flex min-h-11 min-w-11 items-center justify-center underline underline-offset-4"
          >
            Preview registration
          </Link>
        </p>
      </div>
    </Container>
  );
}
