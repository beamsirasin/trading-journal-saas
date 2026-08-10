export type SessionAgentLabel =
  | 'chrome_windows'
  | 'chrome_macos'
  | 'chrome_android'
  | 'edge_windows'
  | 'firefox'
  | 'safari_macos'
  | 'safari_ios'
  | 'browser'
  | 'other';

/** Conservative presentation only: returns no raw UA, device name, or location. */
export function describeSessionAgent(userAgent: string | null): SessionAgentLabel {
  if (userAgent === null || userAgent.length === 0) return 'other';
  if (/Edg\//.test(userAgent) && /Windows/.test(userAgent)) return 'edge_windows';
  if (/(CriOS|Chrome)\//.test(userAgent) && /Android/.test(userAgent)) return 'chrome_android';
  if (/(CriOS|Chrome)\//.test(userAgent) && /Windows/.test(userAgent)) return 'chrome_windows';
  if (/(CriOS|Chrome)\//.test(userAgent) && /Mac OS X/.test(userAgent)) return 'chrome_macos';
  if (/FxiOS\/|Firefox\//.test(userAgent)) return 'firefox';
  if (/CriOS\/|EdgiOS\/|OPiOS\//.test(userAgent)) return 'browser';
  if (/Safari\//.test(userAgent) && /(iPhone|iPad)/.test(userAgent)) return 'safari_ios';
  if (/Safari\//.test(userAgent) && /Mac OS X/.test(userAgent)) return 'safari_macos';
  return /Mozilla\//.test(userAgent) ? 'browser' : 'other';
}
