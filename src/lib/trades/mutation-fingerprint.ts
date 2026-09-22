/**
 * WHAT A CREATE REQUEST SAID, AS ONE STABLE STRING (Add Trade contract §23).
 *
 * A Save key (`mutation_key`) makes a retry safe: the same key never creates a
 * second Trade. On its own it cannot tell an honest retry from a different
 * request that happens to reuse the key — a second tab on the same draft, an
 * edit made after a Save whose answer was lost, or the other recording mode.
 * Answering those with the first Trade reports a Save that never happened and
 * loses the trader's newer work.
 *
 * So the service stores what the committed request said and compares every
 * replay against it. This module is the pure half: it turns a create request
 * into canonical JSON — keys sorted, `undefined` dropped, `bigint` and `Date`
 * written as strings — so the same request always produces the same text.
 * Hashing lives on the server (`trade-mutation-fingerprint.ts`).
 *
 * THE PATH IS PART OF WHAT WAS SAID. An At Entry request and a Save Closed
 * Trade request with identical fields are different requests.
 *
 * WHAT IS LEFT OUT, AND WHY:
 * - `mutationKey` — it is the identity being checked, not content.
 * - `chartAttachmentStorageKey` — an upload handle, reissued by each attempt;
 *   the answers are what the replay must match.
 * - An `enteredAt` whose source is `default_now` — At Entry's untouched "now"
 *   follows the clock until Save (contract §6), so an honest retry a minute
 *   later carries a different instant. The source itself stays in the
 *   fingerprint; only the clock reading is not content.
 */

export type MutationFingerprintPath =
  'at_entry' | 'completed' | 'exit_part' | 'exit_final' | 'after_trade_context';

const OMITTED_KEYS = new Set(['mutationKey', 'chartAttachmentStorageKey']);

function canonical(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) continue;
      result[key] = canonical(entry);
    }
    return result;
  }
  return value;
}

export function canonicalCreateRequest(
  path: MutationFingerprintPath,
  input: Readonly<Record<string, unknown>>,
): string {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (OMITTED_KEYS.has(key)) continue;
    content[key] = value;
  }
  if (content.enteredAtSource === 'default_now') delete content.enteredAt;
  return JSON.stringify(canonical({ path, request: content }));
}
