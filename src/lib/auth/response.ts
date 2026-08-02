const SENSITIVE_RESPONSE_KEYS = new Set([
  'token',
  'sessionToken',
  'accessToken',
  'refreshToken',
  'idToken',
  'password',
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_RESPONSE_KEYS.has(key))
      .map(([key, child]) => [key, redact(child)]),
  );
}

/** Keep auth credentials cookie-only even if the upstream library includes them in JSON. */
export async function redactAuthResponse(response: Response): Promise<Response> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return response;
  }

  const text = await response.text();
  if (text === '') return new Response(null, response);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return new Response(text, response);
  }

  const sourceHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = sourceHeaders.getSetCookie?.();
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  if (setCookies !== undefined) {
    headers.delete('set-cookie');
    for (const cookie of setCookies) headers.append('set-cookie', cookie);
  }
  return new Response(JSON.stringify(redact(parsed)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
