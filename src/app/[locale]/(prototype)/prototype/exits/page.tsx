import type { Metadata } from 'next';

import { ExitsSpecimenScreen } from '@/components/prototype/add-trade/specimens';

export const metadata: Metadata = { title: 'Prototype · Exits' };

/** Prototype 10: the exits editor across its three completion states. */
export default function ExitsPrototypePage() {
  return <ExitsSpecimenScreen />;
}
