import type { Metadata } from 'next';

import type { PrototypeLocale } from '@/components/prototype/copy';
import type { JournalQuery } from '@/components/prototype/query';
import type { DetailTab } from '@/components/prototype/trade-log/trade-details-panel';
import { TradeLogScreen } from '@/components/prototype/trade-log/trade-log-screen';

export const metadata: Metadata = { title: 'Prototype · Trade Log' };

/**
 * Prototypes 1–4: the redesigned Trade Log at every width, plus Trade details.
 *
 * One route, three compositions and one detail panel — because that is what the
 * product would be. Resizing the window is the review: the seven-column table
 * gives way to multi-line journal rows and then to the mobile list at the
 * content widths the specification names, and the detail drawer becomes a
 * full-screen sheet at 1,200px.
 *
 * THE SCOPE IS RESOLVED HERE, ON THE SERVER, rather than read from
 * `window.location` after mount. A client-side read renders one frame of the
 * default journal before correcting itself, which is invisible to a person and
 * very visible to a screenshot.
 *
 *   ?trade=<id>    open that trade's details
 *   ?tab=review    which detail tab it opens on
 *   ?lang=th       render the journal in Thai
 *   ?account=all   both accounts, so the mixed-currency summary is reachable
 *   ?state=open    the Open state's own summary
 *   ?strategy=…    a deep-linked refinement, so the applied chips are reachable
 *   ?q=…           a deep-linked search
 */
export default async function TradeLogPrototypePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string): string | null => {
    const value = params[key];
    return typeof value === 'string' ? value : null;
  };

  const demoState = one('demo');
  const demo =
    demoState === 'loading' || demoState === 'error' || demoState === 'first-use'
      ? demoState
      : null;

  const state = one('state');
  const account = one('account');
  const strategy = one('strategy');
  const search = one('q');
  const tab = one('tab');

  const initialQuery: Partial<JournalQuery> = {
    ...(state === 'open' || state === 'closed' || state === 'all' ? { state } : {}),
    ...(account === 'all' ? { account: 'all' as const } : {}),
    ...(strategy === null ? {} : { strategy }),
    ...(search === null ? {} : { search }),
  };

  return (
    <TradeLogScreen
      locale={one('lang') === 'th' ? ('th' satisfies PrototypeLocale) : 'en'}
      initialQuery={initialQuery}
      initialTradeId={one('trade')}
      demo={demo}
      initialTab={tab === 'execution' || tab === 'review' ? (tab satisfies DetailTab) : 'overview'}
    />
  );
}
