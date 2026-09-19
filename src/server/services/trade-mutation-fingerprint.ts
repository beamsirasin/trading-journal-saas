import 'server-only';

import { createHash } from 'node:crypto';

import {
  canonicalCreateRequest,
  type MutationFingerprintPath,
} from '@/lib/trades/mutation-fingerprint';

/**
 * The stored fingerprint of a create request: SHA-256 of its canonical form
 * (`src/lib/trades/mutation-fingerprint.ts`). Compared, never interpreted.
 */
export function tradeMutationFingerprint(path: MutationFingerprintPath, input: object): string {
  return createHash('sha256')
    .update(canonicalCreateRequest(path, input as Readonly<Record<string, unknown>>))
    .digest('hex');
}
