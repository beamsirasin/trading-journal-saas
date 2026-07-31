import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { TRIAL_DAYS } from '@/config/plans';
import { DemoAuthForm } from '@/components/forms/demo-auth-form';
import { Container } from '@/components/shell/container';

export const metadata: Metadata = {
  title: 'Create your account',
  description: `Start a ${TRIAL_DAYS}-day free trial of Trading OS. No card required.`,
  alternates: { canonical: '/register' },
  robots: { index: false, follow: false },
};

const TRIAL_POINTS = [
  `${TRIAL_DAYS} days, free`,
  'No card required',
  'Every plan feature unlocked during the trial',
  'Manual journal — no broker connection needed',
];

export default function RegisterPage() {
  return (
    <Container className="py-16 sm:py-24">
      <div className="mx-auto grid w-full max-w-4xl gap-12 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-page-title text-balance">Start your free trial</h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              This page is a design preview. Authentication is not implemented, so nothing you type
              is sent or stored.
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {TRIAL_POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2.5 text-sm">
                <Check className="text-positive mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="text-muted-foreground leading-relaxed">{point}</span>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground border-border border-l-2 pl-4 text-xs leading-relaxed">
            Payment processing is not connected to this product. When billing ships, prices will be
            published before anything can be charged.
          </p>
        </div>

        {/*
          `max-w-md mx-auto` below `lg`: the two columns stack there, and this
          div would otherwise take the full grid-track width — around 700px
          at a tablet viewport — stretching every input far wider than the
          same fields render on `/login`. `lg:max-w-none lg:mx-0` lifts the
          cap once the two-column layout is active, where the `max-w-4xl`
          grid already keeps the column near 416px.
        */}
        <div className="mx-auto flex w-full max-w-md flex-col lg:mx-0 lg:max-w-none">
          <DemoAuthForm mode="register" />

          <p className="text-muted-foreground mt-8 text-center text-sm">
            Already have an account?{' '}
            <Link href="/login" className="text-primary underline underline-offset-4">
              Log in
            </Link>
          </p>
        </div>
      </div>
    </Container>
  );
}
