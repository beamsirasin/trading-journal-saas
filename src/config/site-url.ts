/** Environment values that may identify the deployed public origin. */
export interface SiteUrlEnvironment {
  readonly NEXT_PUBLIC_APP_URL?: string | undefined;
  readonly VERCEL_URL?: string | undefined;
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
}

/**
 * Resolves the origin used by canonical and Open Graph metadata.
 *
 * `NEXT_PUBLIC_APP_URL` is the portable, documented source of truth. Vercel
 * variables are convenience fallbacks for unconfigured previews, never the
 * primary configuration path; a plain VPS only needs the standard variable.
 */
export function resolveSiteUrl(environment: SiteUrlEnvironment): URL {
  const configured = environment.NEXT_PUBLIC_APP_URL;
  if (configured !== undefined && configured !== '') {
    return new URL(configured);
  }

  const vercelHost = environment.VERCEL_URL ?? environment.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelHost !== undefined && vercelHost !== '') {
    return new URL(vercelHost.startsWith('http') ? vercelHost : `https://${vercelHost}`);
  }

  return new URL('http://localhost:3000');
}
