'use client';

import { useEffect } from 'react';

import { removeCloseDraft, type CloseDraftScope } from './close-trade-draft-storage';

/** Removes a Trade's close draft once the Trade can no longer be closed. Renders nothing. */
export function CloseDraftCleanup({ scope }: { scope: CloseDraftScope }) {
  const { ownerKey, workspaceKey, tradeKey } = scope;
  useEffect(() => {
    removeCloseDraft({ ownerKey, workspaceKey, tradeKey });
  }, [ownerKey, workspaceKey, tradeKey]);
  return null;
}
