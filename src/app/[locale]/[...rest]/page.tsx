import { notFound } from 'next/navigation';

/**
 * Catch-all for any path under a locale segment that no real route matches.
 *
 * Without this file, an unmatched path like `/en/this-does-not-exist` never
 * enters the `[locale]` route tree at all — Next.js falls back to its own
 * generic, unstyled, English-only root `_not-found` boundary instead of the
 * translated `src/app/[locale]/not-found.tsx`, silently breaking the
 * "not-found is translated" requirement for the one page a visitor reaches
 * by mistyping a URL. `notFound()` here throws into the nearest `not-found`
 * boundary, which is this segment's own translated one — whether or not the
 * locale segment itself is valid, since the parent layout already redirects
 * or 404s an invalid locale before this ever renders.
 */
export default function CatchAll() {
  notFound();
}
