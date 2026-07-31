import { NextResponse } from 'next/server';

/**
 * Liveness probe.
 *
 * Answers exactly one question: is the application process serving requests?
 * It deliberately does NOT check the database. Liveness and readiness are
 * different signals — if this returned unhealthy on a database blip, an
 * orchestrator would restart a process that was working fine, turning a
 * recoverable outage into a restart loop. A `/api/ready` endpoint that checks
 * dependencies belongs in Phase 12.
 *
 * The response is deliberately free of environment values, versions of
 * internal dependencies, hostnames, and paths: a public health endpoint is
 * reconnaissance surface, and "it responded" is all an external caller needs.
 */

/** Never prerendered or cached — a cached health check reports the past. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface HealthResponse {
  readonly status: 'ok';
}

export function GET(): NextResponse<HealthResponse> {
  const body: HealthResponse = { status: 'ok' };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
