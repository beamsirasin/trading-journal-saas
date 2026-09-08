import type { Metadata } from 'next';

import { AtEntryForm } from '@/components/prototype/add-trade/at-entry-form';

export const metadata: Metadata = { title: 'Prototype · Still open' };

/**
 * The STILL OPEN recording path — internally `AT_ENTRY`, and the route keeps
 * that name because the domain concept has not changed. Only what the reader is
 * shown has.
 *
 * `?filled=1` renders a part-finished draft so the populated journaling
 * summaries can be judged beside the empty ones. `?risk=` and `?target=` seed
 * the baseline, so the worked example — 10 risked, 20 targeted, +2.00R — can be
 * photographed without anyone typing it.
 */
export default async function AtEntryPrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  const risk = one('risk');
  const target = one('target');

  return (
    <AtEntryForm
      filled={params['filled'] === '1'}
      {...(risk === undefined ? {} : { seedRisk: risk })}
      {...(target === undefined ? {} : { seedTarget: target })}
    />
  );
}
