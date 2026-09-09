import type { Metadata } from 'next';

import { AfterTradeForm } from '@/components/prototype/add-trade/after-trade-form';

export const metadata: Metadata = { title: 'Prototype · Fully closed' };

/**
 * The FULLY CLOSED recording path — internally `AFTER_TRADE`, and the route
 * keeps that name because the domain concept has not changed.
 *
 * NO PARAMETER RENDERS A DEFAULT-FILLED TRADE. The bare route is what a trader
 * actually opens: everything unrecorded, no timestamp, no outcome selected. The
 * parameters exist because these are states of a REAL recording screen and none
 * of them is reachable by navigation alone.
 *
 * `?exits=1` opens the exit-details disclosure with recorded legs collapsed to
 * summary rows; `?edit=<id>` additionally opens one as the active editor;
 * `?filled=1` renders a part-finished draft, and together with `?exits=1` gives
 * the case this pass exists for — an authoritative whole-trade result standing
 * beside a supporting exit history that does not add up to it.
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
