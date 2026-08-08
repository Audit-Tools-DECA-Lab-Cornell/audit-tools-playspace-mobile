import { z } from "zod";

/**
 * Reasons the backend can give for refusing to delete an account.
 *
 * The wire field is validated as a plain string rather than an enum so a
 * blocker added by a newer backend still parses; unrecognised values fall
 * through to the generic "ask your administrator" guidance instead of failing
 * the whole preview request.
 */
export const KNOWN_DELETION_BLOCKERS = [
    "PRIMARY_MANAGER_TRANSFER_REQUIRED",
    "PENDING_SUBMISSION_DELIVERY",
    "PERSONAL_ACCOUNT_HAS_DEPENDENCIES",
] as const;

export type KnownDeletionBlocker = (typeof KNOWN_DELETION_BLOCKERS)[number];

/** Shape of `GET /playspace/me/account-deletion`. */
export const accountDeletionPreviewSchema = z.object({
    role: z.string(),
    submitted_audits_preserved: z.number(),
    draft_audits_to_delete: z.number(),
    active_assignments_to_delete: z.number(),
    pending_submissions: z.number(),
    is_primary_manager: z.boolean(),
    can_delete: z.boolean(),
    blocker: z.string().nullable(),
});

export type AccountDeletionPreview = z.infer<typeof accountDeletionPreviewSchema>;

/**
 * The exact word the backend requires in the deletion request body. It is a
 * fixed protocol token, not display copy - the same string is typed and sent
 * in every language, and the UI shows it verbatim so the two always agree.
 */
export const DELETION_CONFIRMATION_WORD = "DELETE";
