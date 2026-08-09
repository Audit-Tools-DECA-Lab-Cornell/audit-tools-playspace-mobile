import { unregisterAuditBackgroundTaskAsync } from "lib/audit/background-sync";
import { clearAuthSession } from "lib/auth/storage";
import { deleteLocalScreenshot, readPendingBugReports } from "lib/bug-report/queue";
import { createModuleLogger } from "lib/logger";
import {
    partitionEntriesByOwner,
    selectAccountPurgeKeys,
    SHARED_QUEUE_KEYS,
    type AccountOwnedEntry,
} from "lib/account/deletion-plan";
import { mmkvStorage } from "lib/storage/mmkv";
import { useNotificationsStore } from "stores/notifications-store";
import { usePlacesStore } from "stores/places-store";
import { usePlayspaceAuditStore } from "stores/audit-store";

const log = createModuleLogger("account-purge");

/**
 * Minimal storage surface the purge needs. Injectable so the sweep can be
 * exercised against a plain map.
 */
export interface AccountPurgeStorage {
    getAllKeys(): string[];
    remove(key: string): void;
    getString(key: string): string | undefined;
    set(key: string, value: string): void;
}

/**
 * Erase everything the deleted account left on this device.
 *
 * ONLY call this after the server has confirmed the deletion. It is deliberately
 * not reachable from any failure path: if the request did not succeed, the
 * account still exists and its local work must stay exactly where it is.
 *
 * The sweep is targeted, never wholesale. Keys are selected by the deleted
 * account's id, so a second auditor who has used the same device keeps their
 * queued submissions and drafts intact.
 *
 * @param userId Account that was deleted.
 * @param storage Storage handle; defaults to the shared on-device store.
 */
export async function purgeLocalAccountData(userId: string, storage: AccountPurgeStorage = mmkvStorage): Promise<void> {
    // Stop background sync first so nothing rewrites a key after it is removed.
    await unregisterAuditBackgroundTaskAsync().catch(() => undefined);

    // Detaches the auto-save observer and drops the in-memory audit state; the
    // key sweep below removes the snapshot and anything queued beside it.
    await usePlayspaceAuditStore.getState().clearStoredState(userId);

    // Screenshot files live outside the key-value store, so their references
    // have to be read before the queue that holds them is rewritten.
    deleteOwnedBugReportScreenshots(userId);

    const { accountScopedKeys, sessionCacheKeys } = selectAccountPurgeKeys(storage.getAllKeys(), userId);
    for (const key of [...accountScopedKeys, ...sessionCacheKeys]) {
        try {
            storage.remove(key);
        } catch (error) {
            log.withError(error).error("failed to remove a stored key during account deletion");
        }
    }

    pruneSharedQueues(userId, storage);

    resetInMemoryStores();

    // The signed-in credentials go last: until this resolves the session is
    // still usable, which keeps a mid-purge crash recoverable rather than
    // stranding the app in a half-signed-in state.
    await clearAuthSession();
}

/**
 * Delete screenshot files attached to unsent reports **this account** filed.
 *
 * Another auditor's screenshots are left on disk: the queue is shared across
 * sign-outs, and their report still needs its attachment. Best-effort - an
 * orphaned file is harmless, and a failure here must not stop the purge.
 */
function deleteOwnedBugReportScreenshots(userId: string): void {
    try {
        const { owned } = partitionEntriesByOwner(readPendingBugReports(), userId);
        for (const report of owned) {
            if (typeof report.screenshotLocalUri === "string" && report.screenshotLocalUri.length > 0) {
                deleteLocalScreenshot(report.screenshotLocalUri);
            }
        }
    } catch (error) {
        log.withError(error).error("failed to remove queued bug report screenshots during account deletion");
    }
}

/**
 * Remove this account's entries from the queues that outlive sign-out, leaving
 * every other auditor's untouched.
 *
 * These keys are rewritten rather than deleted. On a shared field device the bug
 * report queue, its draft, and the submit-failure notices can all hold unsent
 * work belonging to someone who simply signed out - destroying it would be
 * irreversible and is not this operation's to do.
 */
function pruneSharedQueues(userId: string, storage: AccountPurgeStorage): void {
    pruneSharedList(SHARED_QUEUE_KEYS.bugReportQueue, userId, storage);
    pruneSharedList(SHARED_QUEUE_KEYS.submitFailureNotifications, userId, storage);
    pruneSharedRecord(SHARED_QUEUE_KEYS.bugReportDraft, userId, storage);
}

/** Rewrite a stored array, dropping only the deleted account's entries. */
function pruneSharedList(key: string, userId: string, storage: AccountPurgeStorage): void {
    try {
        const raw = storage.getString(key);
        if (raw === undefined) {
            return;
        }
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return;
        }
        const { retained } = partitionEntriesByOwner(parsed as AccountOwnedEntry[], userId);
        if (retained.length === parsed.length) {
            return;
        }
        if (retained.length === 0) {
            storage.remove(key);
            return;
        }
        storage.set(key, JSON.stringify(retained));
    } catch (error) {
        log.withError(error).error(`failed to prune ${key} during account deletion`);
    }
}

/** Remove a single stored object only when the deleted account owns it. */
function pruneSharedRecord(key: string, userId: string, storage: AccountPurgeStorage): void {
    try {
        const raw = storage.getString(key);
        if (raw === undefined) {
            return;
        }
        const parsed = JSON.parse(raw) as AccountOwnedEntry;
        if (parsed !== null && typeof parsed === "object" && parsed.accountId === userId) {
            storage.remove(key);
        }
    } catch (error) {
        log.withError(error).error(`failed to prune ${key} during account deletion`);
    }
}

/**
 * Drop cached account data still held in memory, so nothing from the deleted
 * account can render before the app returns to the sign-in screen.
 */
function resetInMemoryStores(): void {
    usePlacesStore.setState({ places: [], dashboardSummary: null, isLoading: false, errorMessage: null });
    useNotificationsStore.setState({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: null,
        panelOpen: false,
    });
}
