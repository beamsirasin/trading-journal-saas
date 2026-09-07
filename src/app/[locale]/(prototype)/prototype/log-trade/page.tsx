import type { Metadata } from 'next';

import { EntryChoiceScreen } from '@/components/prototype/add-trade/entry-choice';

export const metadata: Metadata = { title: 'Prototype · Log a trade' };

/** Prototype 5: the opening choice — two directly actionable cards, no Continue gate. */
export default function LogTradePrototypePage() {
  return <EntryChoiceScreen />;
}
