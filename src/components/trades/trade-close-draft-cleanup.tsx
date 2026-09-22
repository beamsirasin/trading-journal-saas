'use client';

import { useEffect } from 'react';

import { removeCloseDraft, type CloseDraftScope } from './close-trade-draft-storage';

/**
 * Removes a Trade's Exit & Result drafts once it can no longer be closed. Its
 * Stage 6 answers stay, for the After-Trade Context of the Closed Trade.
 * Renders nothing.
 */
export function CloseDraftCleanup({ scope }: { scope: CloseDraftScope }) {
  const { ownerKey, workspaceKey, tradeKey } = scope;
  useEffect(() => {
    removeCloseDraft({ ownerKey, workspaceKey, tradeKey }, new Date());
  }, [ownerKey, workspaceKey, tradeKey]);
  return null;
}
