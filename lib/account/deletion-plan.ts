import { isAuditStateKeyForUser } from "lib/audit/storage-keys";
import { submitOutboxUserKeyPrefix } from "lib/audit/outbox/outbox-keys";
import { DELETION_CONFIRMATION_WORD, type AccountDeletionPreview } from "lib/account/deletion-types";

/**
 * Pure decision logic behind account deletion: whether the auditor may proceed,
 * which plain-language explanation they see if not, and exactly which on-device
 * storage keys a confirmed deletion is allowed to remove.
 *
 * No React Native, storage, or network imports, so every branch is unit
 * testable in the node environment.
 */

/** Why deletion is unavailable right now. */
export type DeletionBlockReason =
    /** Work finished on this device has not reached the server yet. */
    | "LOCAL_PENDING_UPLOADS"
    /** The server is still waiting on a submission from this account. */
    | "PENDING_SUBMISSION_DELIVERY"
    /** The account is its organisation's main contact. */
    | "PRIMARY_MANAGER_TRANSFER_REQUIRED"
    /** Other server-side work must be handed over first. */
    | "PERSONAL_ACCOUNT_HAS_DEPENDENCIES"
    /** Refused for a reason this app version does not recognise. */
    | "UNAVAILABLE";

export type DeletionGate =
    | { readonly kind: "ready" }
    | { readonly kind: "blocked"; readonly reason: DeletionBlockReason; readonly pendingUploadCount: number };

interface ResolveDeletionGateArgs {
    readonly preview: AccountDeletionPreview;
    /**
     * Finished audits still queued on this device (queued/in-flight submit
     * phases unioned with durable outbox entries).
     */
    readonly localPendingUploadCount: number;
}

/**
 * Decide whether the auditor can delete their account now.
 *
 * Device-local queued work is checked before the server's answer: it is both
 * the more current signal (the server cannot know about a submission still
 * sitting on the phone) and the one the auditor can act on themselves by
 * getting back online.
 *
 * @param args Server preview plus the local queue depth.
 * @returns Ready, or blocked with the reason to explain.
 */
export function resolveDeletionGate({ preview, localPendingUploadCount }: ResolveDeletionGateArgs): DeletionGate {
    if (localPendingUploadCount > 0) {
        return { kind: "blocked", reason: "LOCAL_PENDING_UPLOADS", pendingUploadCount: localPendingUploadCount };
    }

    if (preview.pending_submissions > 0) {
        return {
            kind: "blocked",
            reason: "PENDING_SUBMISSION_DELIVERY",
            pendingUploadCount: preview.pending_submissions,
        };
    }

    if (preview.blocker !== null) {
        return { kind: "blocked", reason: toBlockReason(preview.blocker), pendingUploadCount: 0 };
    }

    if (!preview.can_delete) {
        return { kind: "blocked", reason: "UNAVAILABLE", pendingUploadCount: 0 };
    }

    return { kind: "ready" };
}

/**
 * Map a server blocker code onto the reason whose explanation the auditor sees.
 * Unrecognised codes degrade to the generic "ask your administrator" reason
 * rather than surfacing a raw code.
 *
 * @param blocker Blocker code from the server.
 * @returns Reason to explain.
 */
export function toBlockReason(blocker: string): DeletionBlockReason {
    switch (blocker) {
        case "PENDING_SUBMISSION_DELIVERY":
            return "PENDING_SUBMISSION_DELIVERY";
        case "PRIMARY_MANAGER_TRANSFER_REQUIRED":
            return "PRIMARY_MANAGER_TRANSFER_REQUIRED";
        case "PERSONAL_ACCOUNT_HAS_DEPENDENCIES":
            return "PERSONAL_ACCOUNT_HAS_DEPENDENCIES";
        default:
            return "UNAVAILABLE";
    }
}

/**
 * Translation key holding the plain-language explanation for a block reason.
 * Every reason resolves to real copy - there is no fall-through that could
 * leak a code into the interface.
 *
 * @param reason Reason deletion is unavailable.
 * @returns Key under the `settings` namespace.
 */
export function blockReasonCopyKey(reason: DeletionBlockReason): string {
    return `deleteAccount.blocked.${blockReasonCopySuffix(reason)}`;
}

function blockReasonCopySuffix(reason: DeletionBlockReason): string {
    switch (reason) {
        case "LOCAL_PENDING_UPLOADS":
            return "stillSending";
        case "PENDING_SUBMISSION_DELIVERY":
            return "serverStillReceiving";
        case "PRIMARY_MANAGER_TRANSFER_REQUIRED":
            return "mainContact";
        case "PERSONAL_ACCOUNT_HAS_DEPENDENCIES":
            return "handoverNeeded";
        case "UNAVAILABLE":
            return "unavailable";
    }
}

/**
 * Whether the typed confirmation matches the word the backend requires.
 * Surrounding whitespace is forgiven (keyboards add it); letter case is not,
 * because the server compares exactly and a lenient client would only turn a
 * clear inline hint into a confusing rejection after the fact.
 *
 * @param typed Raw text from the confirmation field.
 * @returns True when the request would satisfy the server.
 */
export function isConfirmationWordValid(typed: string): boolean {
    return typed.trim() === DELETION_CONFIRMATION_WORD;
}

/** Storage keys a confirmed deletion removes, grouped by what owns them. */
export interface AccountPurgeKeys {
    /**
     * Keys carrying the deleted account's own field work. Every entry is proven
     * to belong to that account by its embedded account id.
     */
    readonly accountScopedKeys: readonly string[];
    /**
     * Unscoped keys holding only the signed-in account's data. They carry no
     * account id, so they are listed separately and only ever cleared for the
     * account that is signed in at deletion time.
     */
    readonly signedInAccountKeys: readonly string[];
}

/**
 * Unscoped keys that hold data belonging to whoever is signed in.
 *
 * Deliberately excluded: `playspace.preferences.v1` (device display and
 * accessibility settings, not account data - a shared field device should keep
 * its text size and contrast) and the instrument cache (the shared audit
 * definition, identical for every account).
 */
const SIGNED_IN_ACCOUNT_KEYS: readonly string[] = [
    "playspace.bugReport.queue.v1",
    "playspace.bugReport.draft.v1",
    "playspace.submit_failure_notifications",
    "notifications_cache",
];

/**
 * Select every storage key a confirmed account deletion may remove.
 *
 * Account-scoped keys are matched against the deleted account's id, so keys
 * belonging to any other account that has used this device are never selected -
 * including ids where one is a leading substring of another.
 *
 * @param allKeys Every key currently in local storage.
 * @param userId Account being deleted.
 * @returns Keys to remove, grouped by ownership.
 */
export function selectAccountPurgeKeys(allKeys: readonly string[], userId: string): AccountPurgeKeys {
    const outboxPrefix = submitOutboxUserKeyPrefix(userId);
    const accountScopedKeys = allKeys.filter(
        (key) => isAuditStateKeyForUser(key, userId) || key.startsWith(outboxPrefix),
    );
    const signedInAccountKeys = allKeys.filter((key) => SIGNED_IN_ACCOUNT_KEYS.includes(key));

    return { accountScopedKeys, signedInAccountKeys };
}
