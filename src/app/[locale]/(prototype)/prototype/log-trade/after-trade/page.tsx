import type { Metadata } from 'next';

import { AfterTradeForm } from '@/components/prototype/add-trade/after-trade-form';

export const metadata: Metadata = { title: 'Prototype · After trade' };

/** Prototypes 8 and 9: the actual-first After Trade path, desktop and mobile. */
export default function AfterTradePrototypePage() {
  return <AfterTradeForm />;
}
