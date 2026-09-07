import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * THE PROTOTYPE BOUNDARY — development only, and enforced rather than
 * documented.
 *
 * Everything under `/prototype` is a VISUAL PROTOTYPE of the redesigned Trade
 * Log and Add Trade surfaces. It renders fixture data, it is wired to no
 * mutation, no server action and no database, and it is not part of the
 * product. `notFound()` under a production `NODE_ENV` is what keeps that true
 * in a deployed build rather than only in the commit message: the routes are
 * absent from production, not merely unlinked from it.
 *
 * A route GROUP (`(prototype)`) rather than a top-level segment, deliberately.
 * `/admin` sits outside `[locale]` and needed its own branch in `proxy.ts` to
 * escape next-intl's locale prefixing; putting the prototype inside `[locale]`
 * means it inherits the existing locale, font and theme providers and needs no
 * change to the routing layer at all. The brief forbids touching production
 * routing, and this is how that promise is kept.
 *
 * Deliberately no chrome of its own: each prototype screen renders the shell it
 * is being judged inside, and the gallery renders none.
 */
export default function PrototypeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }
  return children;
}
