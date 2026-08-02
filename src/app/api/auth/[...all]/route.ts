import { toNextJsHandler } from 'better-auth/next-js';

import { redactAuthResponse } from '@/lib/auth/response';
import { getAuth } from '@/lib/auth/server';

/**
 * Mounts every Better Auth endpoint (`/api/auth/sign-in/email`,
 * `/api/auth/callback/google`, …) at this one catch-all route.
 *
 * `getAuth()` is called INSIDE each handler, not at module scope. Next.js
 * imports route modules during `next build`'s route-collection step even
 * for dynamic routes, and `getAuth()` transitively calls `getDb()` — calling
 * it eagerly here would open a database client during the build, exactly
 * what `docs/architecture.md` §9 and the Phase 00b build canary forbid.
 * `toNextJsHandler` itself is cheap (it only builds two closures), so
 * calling it per-request costs nothing worth avoiding.
 */
export async function GET(request: Request): Promise<Response> {
  return redactAuthResponse(await toNextJsHandler(getAuth()).GET(request));
}

export async function POST(request: Request): Promise<Response> {
  return redactAuthResponse(await toNextJsHandler(getAuth()).POST(request));
}
