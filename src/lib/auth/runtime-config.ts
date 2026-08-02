export type RuntimeEnvironment = 'development' | 'test' | 'production';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname);
}

export function resolveAuthBaseUrl(
  configured: string | undefined,
  environment: RuntimeEnvironment,
): string {
  if (configured === undefined || configured === '') {
    if (environment === 'production') {
      throw new Error('BETTER_AUTH_URL is required in production.');
    }
    return 'http://localhost:3000';
  }

  const url = new URL(configured);
  if (
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'BETTER_AUTH_URL must be an origin without credentials, a path, query, or hash.',
    );
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackUrl(url))) {
    throw new Error('BETTER_AUTH_URL must use HTTPS (HTTP is allowed only for loopback testing).');
  }
  return url.origin;
}

export function resolveTrustedOrigins(
  configured: string | undefined,
  environment: RuntimeEnvironment,
): string[] {
  if (configured === undefined || configured.trim() === '') {
    return [];
  }

  return configured.split(',').map((rawOrigin) => {
    const candidate = rawOrigin.trim();
    if (candidate.includes('*')) {
      throw new Error('BETTER_AUTH_TRUSTED_ORIGINS does not allow wildcard origins.');
    }

    const url = new URL(candidate);
    if (
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.username ||
      url.password
    ) {
      throw new Error(
        'Every BETTER_AUTH_TRUSTED_ORIGINS entry must be an origin without credentials, a path, query, or hash.',
      );
    }
    if (
      url.protocol !== 'https:' &&
      !(environment !== 'production' && url.protocol === 'http:' && isLoopbackUrl(url))
    ) {
      throw new Error('Trusted auth origins must use HTTPS outside local development and tests.');
    }
    return url.origin;
  });
}

export function shouldUseSecureCookies(baseUrl: string): boolean {
  return new URL(baseUrl).protocol === 'https:';
}
