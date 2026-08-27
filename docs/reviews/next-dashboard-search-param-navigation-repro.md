# Next.js same-pathname search-param navigation — isolated reproduction

This note is intentionally separate from TradeChemist production code. It
captures the smallest reproduction shape for an upstream Next.js report; the
Dashboard document-navigation workaround does not depend on resolving it.

## Environment

- Next.js `16.2.12`
- React `19.2.4`
- App Router
- Locale-prefixed route in the product: `/[locale]/app` (observed as `/en/app`)

## Minimal app

Create a fresh App Router application pinned to Next `16.2.12`. Give one page
an async server component so its search parameters select server-rendered
content, and render several Next `<Link>` controls whose destinations keep the
same pathname and change only the query:

```tsx
// app/app/page.tsx
import Link from 'next/link';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = '90d' } = await searchParams;
  return (
    <main>
      <p data-range={range}>{range}</p>
      <Link href="/app?range=30d">30D</Link>
      <Link href="/app?range=90d">90D</Link>
      <Link href="/app?range=all">All</Link>
    </main>
  );
}
```

Build and run the production server. Start each attempt with a full document
load of `/app?range=90d`, wait for hydration, then click `30D` exactly once.
Repeat from a fresh document load. For parity with the product observation,
also repeat after a document reload while a query-selected client dialog is
mounted, then click another same-pathname query link once.

## Observed product behaviour

On `/en/app?...` → `/en/app?...`, the click is received and an RSC request can
finish with HTTP 200, yet the client router intermittently does not commit:
the address bar and rendered server state remain at the source URL. In other
runs the client aborts that RSC request without any superseding navigation.
The initial full-load/reload condition makes the failure especially easy to
observe around query-selected overlays.

Opening the exact destination URL as a direct document navigation succeeds
consistently. Browser Back/Forward and pathname-changing Next navigations also
commit reliably. Those controls separate the issue from destination URL
serialization and from server-side data loading.

## Expected behaviour

One click on a same-pathname search-param link should commit the destination
URL and its returned server-component tree exactly once, including when the
source page was reached by a full reload.
