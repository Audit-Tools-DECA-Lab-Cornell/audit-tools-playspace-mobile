import { parsePayload, requestJson, requestNoContent } from "lib/audit/api";
import {
    accountDeletionPreviewSchema,
    DELETION_CONFIRMATION_WORD,
    type AccountDeletionPreview,
} from "lib/account/deletion-types";

import type { AuthSession } from "lib/auth/types";

const ACCOUNT_DELETION_PATH = "/playspace/me/account-deletion";

/**
 * Fetch what deleting this account would do: how much submitted work stays with
 * the organisation, what is removed, and whether anything is blocking.
 *
 * @param session Authenticated mobile session.
 * @returns Validated deletion preview.
 */
export async function fetchAccountDeletionPreview(session: AuthSession): Promise<AccountDeletionPreview> {
    const payload = await requestJson(session, ACCOUNT_DELETION_PATH, { method: "GET" });
    return parsePayload(payload, accountDeletionPreviewSchema, "Account deletion preview response shape is invalid.");
}

/**
 * Delete the signed-in account.
 *
 * Resolves only on the server's `204`; every other outcome throws a
 * `PlayspaceAuditApiError` carrying the status code, so callers can leave the
 * device untouched when deletion did not happen. Nothing local may be removed
 * before this resolves.
 *
 * @param session Authenticated mobile session.
 * @param currentPassword The account's current password, re-entered to confirm.
 */
export async function requestAccountDeletion(session: AuthSession, currentPassword: string): Promise<void> {
    await requestNoContent(session, ACCOUNT_DELETION_PATH, {
        method: "POST",
        body: JSON.stringify({
            current_password: currentPassword,
            confirmation: DELETION_CONFIRMATION_WORD,
        }),
    });
}
