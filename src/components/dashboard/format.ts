import { formatMoney, type Money } from '@/lib/money';
import { formatInstant, parseInstant, TIME_ZONES } from '@/lib/time';

/**
 * Display helpers for the demo dashboard.
 *
 * The timezone is fixed here because there is no user profile yet. A real
 * account resolves it from the user's IANA timezone, never from the server
 * and never from the browser (CLAUDE.md §7) — so the constant is a stand-in
 * for a lookup, not a decision to ignore timezones. The dashboard says which
 * zone it is displaying, which is what a real account will have to do too.
 */
export const DEMO_TIME_ZONE = TIME_ZONES.BANGKOK;

/**
 * Both primitives return a Result rather than throwing, so failure has to be
 * handled here. Rendering an em-dash is the right answer: a fixture with a
 * malformed timestamp is a bug to notice in review, not a reason to blank the
 * whole dashboard with an error boundary.
 */
export function formatTradeDate(iso: string): string {
  const instant = parseInstant(iso);
  if (!instant.ok) {
    return '—';
  }

  const formatted = formatInstant(instant.value, DEMO_TIME_ZONE, { style: 'datetime' });
  return formatted.ok ? formatted.value : '—';
}

/** `+$320.00` / `-$80.00` — the sign is always explicit on a P&L figure. */
export function formatNet(net: Money): string {
  return formatMoney(net, { style: 'symbol', signDisplay: 'always' });
}

/** `+1.60R` / `-0.40R`, from the stored four-decimal string. */
export function formatR(value: string): string {
  const numeric = Number(value);
  const sign = numeric > 0 ? '+' : '';
  return `${sign}${numeric.toFixed(2)}R`;
}

export function toneForR(value: string): 'positive' | 'negative' | 'neutral' {
  const numeric = Number(value);
  if (numeric > 0) return 'positive';
  if (numeric < 0) return 'negative';
  return 'neutral';
}
