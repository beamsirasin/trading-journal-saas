/**
 * WHERE THE RECORDING DRAFT LIVES: this browser's `localStorage`.
 *
 * Durable across reload, remount and an accidental tab refresh on the same
 * browser and device, which is exactly what contract §23 requires — and no
 * further: nothing is synced and nothing reaches the server until Save.
 *
 * KEY: `tradechemist:recording-draft:<ownerKey>:<workspaceKey>`. Both parts are
 * opaque hashes the server derives from the signed-in user and the active
 * workspace (`src/server/trades/recording-draft-scope.ts`), so the key carries
 * no raw database id, one user's draft is never read under another user's key
 * on a shared browser, and a workspace's draft never surfaces in another
 * workspace. The payload carries its own schema version, so the key never has
 * to change when the schema does.
 *
 * FAILS SAFE. Storage can be unavailable (private mode, quota, blocked site
 * data). Every access is guarded: an unreadable or unwritable store behaves as
 * "no draft", never as a crash, and a stored value that cannot be understood is
 * reported unrecoverable rather than guessed at.
 */
import {
  parseRecordingDraft,
  serializeRecordingDraft,
  type ParsedRecordingDraft,
  type RecordingDraftEnvelope,
} from './recording-draft';

export interface RecordingDraftScope {
  /** Opaque, server-derived hash of the signed-in user. */
  readonly ownerKey: string;
  /** Opaque, server-derived hash of the active workspace. */
  readonly workspaceKey: string;
}

const PREFIX = 'tradechemist:recording-draft:';

export function recordingDraftStorageKey(scope: RecordingDraftScope): string {
  return `${PREFIX}${scope.ownerKey}:${scope.workspaceKey}`;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type LoadedRecordingDraft = { readonly status: 'none' } | ParsedRecordingDraft;

export function loadRecordingDraft(scope: RecordingDraftScope, now: Date): LoadedRecordingDraft {
  const store = storage();
  if (store === null) return { status: 'none' };
  let raw: string | null;
  try {
    raw = store.getItem(recordingDraftStorageKey(scope));
  } catch {
    return { status: 'none' };
  }
  if (raw === null) return { status: 'none' };
  const parsed = parseRecordingDraft(raw, now);
  if (parsed.status === 'expired') removeRecordingDraft(scope);
  return parsed;
}

/** Returns whether the write reached durable storage. */
export function saveRecordingDraft(
  scope: RecordingDraftScope,
  envelope: RecordingDraftEnvelope,
): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    store.setItem(recordingDraftStorageKey(scope), serializeRecordingDraft(envelope));
    return true;
  } catch {
    return false;
  }
}

export function removeRecordingDraft(scope: RecordingDraftScope): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(recordingDraftStorageKey(scope));
  } catch {
    // Nothing further to do: an unwritable store holds nothing we can clear.
  }
}

function ownerKeys(store: Storage, ownerKey: string): string[] {
  const keys: string[] = [];
  const ownerPrefix = `${PREFIX}${ownerKey}:`;
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null && key.startsWith(ownerPrefix)) keys.push(key);
  }
  return keys;
}

/**
 * What an explicit sign-out would destroy for this user, across every workspace
 * on this browser: the symbol of each readable draft (or `null` when it has
 * none yet), and one entry per draft that exists but cannot be read — that is
 * still the user's unsaved work and still worth the warning.
 */
export function ownerRecordingDrafts(
  ownerKey: string,
  now: Date,
): readonly { readonly symbol: string | null }[] {
  const store = storage();
  if (store === null) return [];
  try {
    return ownerKeys(store, ownerKey).flatMap((key) => {
      const raw = store.getItem(key);
      if (raw === null) return [];
      const parsed = parseRecordingDraft(raw, now);
      if (parsed.status === 'expired') return [];
      if (parsed.status === 'unrecoverable') return [{ symbol: null }];
      const { envelope } = parsed;
      const symbol =
        envelope.activeMode === 'at_entry'
          ? envelope.atEntry?.symbol
          : envelope.afterTrade?.values.symbol;
      const trimmed = symbol?.trim().toUpperCase() ?? '';
      return [{ symbol: trimmed === '' ? null : trimmed }];
    });
  } catch {
    return [];
  }
}

/** Explicit sign-out: removes this user's drafts in every workspace, and nobody else's. */
export function clearOwnerRecordingDrafts(ownerKey: string): void {
  const store = storage();
  if (store === null) return;
  try {
    for (const key of ownerKeys(store, ownerKey)) store.removeItem(key);
  } catch {
    // An unwritable store holds nothing we can clear.
  }
}
