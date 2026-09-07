import type { Metadata } from 'next';

import { AtEntryForm } from '@/components/prototype/add-trade/at-entry-form';

export const metadata: Metadata = { title: 'Prototype · Still open' };

/**
 * The STILL OPEN recording path — internally `AT_ENTRY`, and the route keeps
 * that name because the domain concept has not changed. Only what the reader is
 * shown has.
 *
 * `?filled=1` renders a part-finished draft so the populated journaling
 * summaries can be judged beside the empty ones.
 */
export default async function AtEntryPrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <AtEntryForm filled={params['filled'] === '1'} />;
}
