import type { Metadata } from 'next';

import { AtEntryForm } from '@/components/prototype/add-trade/at-entry-form';

export const metadata: Metadata = { title: 'Prototype · At entry' };

/**
 * Prototypes 6 and 7: the At Entry short path, desktop and mobile.
 *
 * `?expand=1` renders the same form with its optional sections answered, so the
 * collapsed-summary treatment can be judged beside the empty one.
 */
export default async function AtEntryPrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <AtEntryForm prefilled={params['expand'] === '1'} />;
}
