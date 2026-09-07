import type { Metadata } from 'next';

import { AfterTradeForm } from '@/components/prototype/add-trade/after-trade-form';

export const metadata: Metadata = { title: 'Prototype · Fully closed' };

/**
 * The FULLY CLOSED recording path — internally `AFTER_TRADE`, and the route
 * keeps that name because the domain concept has not changed.
 *
 * `?exits=1` opens the multiple-exits editor with its recorded legs collapsed to
 * summary rows; `?edit=<id>` additionally opens one as the active editor;
 * `?filled=1` renders a part-finished draft. All three exist because these are
 * states of a REAL recording screen and only one of them is reachable by
 * navigation alone.
 */
export default async function AfterTradePrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const edit = params['edit'];
  return (
    <AfterTradeForm
      exits={params['exits'] === '1'}
      activeExit={typeof edit === 'string' && edit !== '' ? edit : null}
      filled={params['filled'] === '1'}
    />
  );
}
