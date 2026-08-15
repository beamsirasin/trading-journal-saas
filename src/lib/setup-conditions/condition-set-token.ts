import 'server-only';

import { createHash } from 'node:crypto';

/**
 * Opaque optimistic-concurrency token for the Setup Version whose Conditions
 * were rendered to the user. It is never used as authority: createTrade
 * resolves the current Version under lock and only compares this token.
 */
export function createConditionSetToken(setupVersionId: string): string {
  return createHash('sha256').update(`setup-condition-set:${setupVersionId}`).digest('hex');
}
