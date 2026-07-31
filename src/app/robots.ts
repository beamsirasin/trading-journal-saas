import type { MetadataRoute } from 'next';

/**
 * Robots policy for the current development stage.
 *
 * Disallows everything. The site is a design preview: figures are fictional,
 * authentication does not exist, and nothing can be purchased. A crawler
 * indexing it now would surface an unfinished product as though it were a
 * commercial one, and search engines are slow to forget.
 *
 * This mirrors `robots: { index: false }` in the root layout on purpose —
 * the meta tag governs pages a crawler has already fetched, this file governs
 * whether it fetches them. Neither one implies the other.
 *
 * Opening the site up is a single deliberate change here plus the layout,
 * made when the product is actually ready.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
