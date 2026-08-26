import { LEGACY_SYSTEM_MIGRATION } from './theme-contract';

/**
 * The pre-paint theme bootstrap: one blocking inline script, rendered from the
 * SERVER.
 *
 * WHY THIS IS NOT IN `ThemeProvider`. It was, and that was a bug. A `<script>`
 * element rendered by a CLIENT component is inert on any client render — React
 * creates the node through `document.createElement`, which never executes
 * script content — and React 19 says so out loud: "Encountered a script tag
 * while rendering React component. Scripts inside React components are never
 * executed when rendering on the client." A pre-paint script that silently
 * stops running the moment React renders it on the client is worse than no
 * migration at all, because it fails exactly when someone changes how the
 * shell mounts and nothing tells them.
 *
 * Rendered from a server component, the script is part of the HTML the browser
 * PARSES. It is a classic inline script with no `async`/`defer`, so the parser
 * stops, executes it, and only then continues — which is what "pre-paint"
 * means concretely. React never creates this node on the client: server
 * components do not re-render there, and hydration matches the existing DOM
 * rather than constructing it.
 *
 * WHERE IT GOES. First child of `<body>`, in every root layout — before
 * `ThemeProvider`, and therefore before next-themes' own inline script, which
 * the provider renders further down the same document. Both are parser-blocking
 * and run in document order, so this one has always finished rewriting a legacy
 * value by the time next-themes reads storage. That ordering is the entire
 * contract; `e2e/theme.spec.ts` asserts it against the served HTML rather than
 * trusting the file layout to preserve it.
 *
 * It is deliberately NOT in `<head>` and deliberately not `next/script`. Next's
 * metadata API owns `<head>`, and `next/script`'s `beforeInteractive` strategy
 * gives Next licence to move the tag — which is the one property this cannot
 * afford to lose.
 *
 * There are TWO root layouts (`[locale]/layout.tsx` and `admin/layout.tsx`),
 * each with its own `<html>`/`<body>`, and both mount `ThemeProvider`. This
 * component exists so the bootstrap is one declaration used twice rather than
 * two copies of an easily-skewed string.
 */
export function ThemeBootstrap() {
  return (
    <script
      // The class the sibling script below will set is not known until this
      // has run, so the server's `<html>` and the client's first frame can
      // legitimately differ. Both root layouts already carry
      // `suppressHydrationWarning` on `<html>` for the same reason.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: LEGACY_SYSTEM_MIGRATION }}
    />
  );
}
