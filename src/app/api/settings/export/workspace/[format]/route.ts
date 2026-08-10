import { NextResponse } from 'next/server';

import type { WorkspaceExportFormat } from '@/lib/export/workspace-export';
import { UnauthenticatedError } from '@/server/auth/dal';
import { WorkspaceExportAccessError } from '@/server/dal/workspace-export';
import { prepareCurrentWorkspaceExport } from '@/server/services/workspace-export';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type RouteParams = { format: string };

function errorResponse(
  status: number,
  code:
    | 'invalid_format'
    | 'unauthenticated'
    | 'owner_required'
    | 'export_unavailable'
    | 'unexpected_error',
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function hasErrorName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === name;
}

function exportAccessCode(error: unknown): string | null {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<RouteParams> },
): Promise<Response> {
  const { format: rawFormat } = await params;
  if (rawFormat !== 'json' && rawFormat !== 'csv') {
    return errorResponse(400, 'invalid_format');
  }
  const format: WorkspaceExportFormat = rawFormat;

  try {
    const artifact = await prepareCurrentWorkspaceExport(format);
    const responseBody =
      typeof artifact.body === 'string' ? artifact.body : Uint8Array.from(artifact.body).buffer;
    return new Response(responseBody, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': artifact.contentType,
        'Content-Disposition': `attachment; filename="${artifact.filename}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError || hasErrorName(error, 'UnauthenticatedError')) {
      return errorResponse(401, 'unauthenticated');
    }
    if (
      error instanceof WorkspaceExportAccessError ||
      hasErrorName(error, 'WorkspaceExportAccessError')
    ) {
      return exportAccessCode(error) === 'owner_required'
        ? errorResponse(403, 'owner_required')
        : errorResponse(404, 'export_unavailable');
    }
    return errorResponse(500, 'unexpected_error');
  }
}
