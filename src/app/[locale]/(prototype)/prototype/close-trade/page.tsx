import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CloseTradeForm } from '@/components/prototype/add-trade/close-trade-form';
import type { MoneyOutcome } from '@/components/prototype/add-trade/form-primitives';
import { findTrade } from '@/components/prototype/fixtures';

export const metadata: Metadata = { title: 'Prototype · Close trade' };

const OUTCOMES: readonly MoneyOutcome[] = ['profit', 'loss', 'break_even'];

/**
 * Closing a position the journal ALREADY HOLDS.
 *
 * Deliberately its own route rather than a mode of `log-trade`: that flow
 * reconstructs a trade nothing knows about, and this one carries an existing
 * record forward. Sharing a route would have meant one screen deciding, on
 * every field, whether it was asking or reminding.
 *
 *   ?trade=<id>    which open position is being closed (required)
 *   ?part=1        opens on the partial branch — how Record exit arrives here
 *   ?outcome=…     profit | loss | break_even, to seed the result state
 *   ?amount=…      the magnitude that goes with it
 *   ?percent=…     seeds the OPTIONAL fraction, for the safe-remainder state
 *   ?prior=1       pretends an earlier exit exists whose fraction was never
 *                  recorded, so the unknowable-allocation case can be reviewed
 */
export default async function CloseTradePrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | null => {
    const value = params[key];
    return typeof value === 'string' ? value : null;
  };

  const trade = findTrade(one('trade'));
  if (trade === null) notFound();

  const outcome = OUTCOMES.find((candidate) => candidate === one('outcome'));
  const amount = one('amount');

  const percent = one('percent');

  return (
    <CloseTradeForm
      trade={trade}
      partial={one('part') === '1'}
      priorUnknownExit={one('prior') === '1'}
      {...(percent === null ? {} : { seedPercent: percent })}
      {...(outcome === undefined
        ? {}
        : { seed: { outcome, amount: outcome === 'break_even' ? '' : (amount ?? '') } })}
    />
  );
}
