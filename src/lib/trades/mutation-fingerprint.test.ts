import { describe, expect, it } from 'vitest';

import { canonicalCreateRequest } from './mutation-fingerprint';

const request = {
  mutationKey: '018f0000-0000-7000-8000-0000000000aa',
  symbol: 'XAUUSD',
  direction: 'long',
  plannedRiskMinor: 5000n,
  enteredAt: new Date('2026-09-18T01:02:03.000Z'),
  enteredAtSource: 'trader',
  exits: [{ exitReason: 'target', realizedPnlMinor: -100n }],
  notes: undefined,
};

describe('canonicalCreateRequest', () => {
  it('is the same text for the same request, whatever the key order', () => {
    const reordered = Object.fromEntries(Object.entries(request).reverse());
    expect(canonicalCreateRequest('at_entry', reordered)).toBe(
      canonicalCreateRequest('at_entry', request),
    );
  });

  it('ignores the Save key and upload handle, and an absent field', () => {
    const other = {
      ...request,
      mutationKey: '018f0000-0000-7000-8000-0000000000bb',
      chartAttachmentStorageKey: 'uploads/x',
    };
    expect(canonicalCreateRequest('at_entry', other)).toBe(
      canonicalCreateRequest('at_entry', request),
    );
  });

  it('differs when any answer differs', () => {
    const base = canonicalCreateRequest('completed', request);
    expect(canonicalCreateRequest('completed', { ...request, plannedRiskMinor: 5001n })).not.toBe(
      base,
    );
    expect(
      canonicalCreateRequest('completed', {
        ...request,
        exits: [{ exitReason: 'target', realizedPnlMinor: -101n }],
      }),
    ).not.toBe(base);
    expect(canonicalCreateRequest('completed', { ...request, notes: 'edited' })).not.toBe(base);
  });

  it('differs between recording paths for identical fields', () => {
    expect(canonicalCreateRequest('at_entry', request)).not.toBe(
      canonicalCreateRequest('completed', request),
    );
  });

  it('ignores the clock reading of an untouched "now" entry time, never a trader-entered one', () => {
    const now = { ...request, enteredAtSource: 'default_now' };
    const later = { ...now, enteredAt: new Date('2026-09-18T01:05:00.000Z') };
    expect(canonicalCreateRequest('at_entry', later)).toBe(canonicalCreateRequest('at_entry', now));
    const traderLater = { ...request, enteredAt: new Date('2026-09-18T01:05:00.000Z') };
    expect(canonicalCreateRequest('at_entry', traderLater)).not.toBe(
      canonicalCreateRequest('at_entry', request),
    );
  });
});
