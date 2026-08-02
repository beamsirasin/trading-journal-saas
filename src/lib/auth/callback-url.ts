/**
 * Validates a `callbackUrl` query parameter before it is used to redirect a
 * browser anywhere. `src/proxy.ts` only ever writes a same-origin path into
 * this parameter, but once it exists in a URL it is attacker-writable —
 * anyone can link to `/en/login?callbackUrl=https://evil.example`. This is
 * the actual open-redirect defence: never the fact that the proxy behaves
 * itself.
 *
 * A string starting with a single `/` (not `//`) is always resolved as a
 * same-origin path by both browser navigation and `new URL(path, origin)` —
 * that is sufficient on its own. Checking for `://` anywhere in the string
 * would be both redundant and wrong: a legitimate relative path can carry a
 * query value that happens to contain `://` (e.g. `/search?url=http://x`)
 * without that making the path itself unsafe to navigate to.
 */
export function safeCallbackPath(candidate: string | null | undefined): string | null {
  if (candidate === null || candidate === undefined || candidate === '') {
    return null;
  }
  if (!candidate.startsWith('/') || candidate.startsWith('//')) {
    return null;
  }
  return candidate;
}
