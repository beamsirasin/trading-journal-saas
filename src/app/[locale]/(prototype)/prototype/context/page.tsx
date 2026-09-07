import type { Metadata } from 'next';

import { EntryContextSpecimenScreen } from '@/components/prototype/add-trade/specimens';

export const metadata: Metadata = { title: 'Prototype · Entry context' };

/** Prototype 11: confidence across its five discrete states, and emotions across its three. */
export default function ContextPrototypePage() {
  return <EntryContextSpecimenScreen />;
}
