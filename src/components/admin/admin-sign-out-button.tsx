'use client';

import { useState, useTransition } from 'react';

import { signOut } from '@/lib/auth/client';
import {
  clearOwnerRecordingDrafts,
  ownerRecordingDrafts,
} from '@/components/trades/recording-draft-storage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

import { adminCopy } from './admin-copy';

/**
 * Deliberately not `AccountMenu` (`src/components/shell/account-menu.tsx`)
 * — that component is `next-intl`-coupled (`useTranslations`, the
 * locale-aware router) and workspace-name-aware, neither of which belongs
 * in the EN-only, tenant-independent admin shell. `signOut()` itself
 * (`@/lib/auth/client`) is a plain Better Auth client call with no such
 * coupling, so it is safe to reuse directly.
 *
 * THE DRAFT RULE IS THE PRODUCT'S, NOT THIS SHELL'S (UX Rules §5.11). An
 * explicit sign-out clears this user's local Add Trade drafts, and warns
 * first, naming what will be lost — wherever the operator signs out from.
 * The mechanism is shared with the product shell down to the storage helpers
 * (`recording-draft-storage.ts`); only the copy is this shell's own, because
 * `/admin` is EN-only by contract. Nothing is removed until the session has
 * actually ended, and only this owner's drafts are touched.
 */
export function AdminSignOutButton({ draftOwnerKey }: { draftOwnerKey: string }) {
  const [isPending, startTransition] = useTransition();
  const [draftsAtRisk, setDraftsAtRisk] = useState<readonly (string | null)[] | null>(null);

  function signOutNow() {
    setDraftsAtRisk(null);
    startTransition(async () => {
      const result = await signOut();
      if (!result.error) clearOwnerRecordingDrafts(draftOwnerKey);
      // Plain browser navigation, not `next/navigation`'s router: signing
      // out of the admin shell should land on the canonical, locale-prefixed
      // login page, the same destination `src/proxy.ts`'s unauthenticated
      // `/admin` redirect uses.
      window.location.assign('/en/login');
    });
  }

  function handleSignOut() {
    const drafts = ownerRecordingDrafts(draftOwnerKey, new Date());
    if (drafts.length > 0) {
      setDraftsAtRisk(drafts.map((draft) => draft.symbol));
      return;
    }
    signOutNow();
  }

  const copy = adminCopy.shell.signOutDraft;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="min-h-11"
        onClick={handleSignOut}
        disabled={isPending}
      >
        {adminCopy.shell.signOut}
      </Button>
      <AlertDialog
        open={draftsAtRisk !== null}
        onOpenChange={(next) => {
          if (!next) setDraftsAtRisk(null);
        }}
      >
        <AlertDialogContent data-sign-out-draft-warning="">
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.description.replace(
                '{items}',
                (draftsAtRisk ?? []).map((symbol) => symbol ?? copy.unnamed).join(', '),
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.stay}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={signOutNow}
            >
              {copy.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
