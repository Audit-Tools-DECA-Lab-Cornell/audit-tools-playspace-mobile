import { unregisterAuditBackgroundTaskAsync } from "lib/audit/background-sync";
import { clearAuthSession } from "lib/auth/storage";
import { deleteLocalScreenshot, readPendingBugReports } from "lib/bug-report/queue";
import { createModuleLogger } from "lib/logger";
import { selectAccountPurgeKeys } from "lib/account/deletion-plan";
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
    // have to be read before the queue that holds them is deleted.
    deleteQueuedBugReportScreenshots();

    const { accountScopedKeys, signedInAccountKeys } = selectAccountPurgeKeys(storage.getAllKeys(), userId);
    for (const key of [...accountScopedKeys, ...signedInAccountKeys]) {
        try {
            storage.remove(key);
        } catch (error) {
            log.withError(error).error("failed to remove a stored key during account deletion");
        }
    }

    resetInMemoryStores();

    // The signed-in credentials go last: until this resolves the session is
    // still usable, which keeps a mid-purge crash recoverable rather than
    // stranding the app in a half-signed-in state.
    await clearAuthSession();
}

/**
 * Delete screenshot files attached to bug reports that never got sent.
 * Best-effort: an orphaned file is harmless, and a failure here must not stop
 * the rest of the purge.
 */
function deleteQueuedBugReportScreenshots(): void {
    try {
        for (const report of readPendingBugReports()) {
            if (typeof report.screenshotLocalUri === "string" && report.screenshotLocalUri.length > 0) {
                deleteLocalScreenshot(report.screenshotLocalUri);
            }
        }
    } catch (error) {
        log.withError(error).error("failed to remove queued bug report screenshots during account deletion");
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
