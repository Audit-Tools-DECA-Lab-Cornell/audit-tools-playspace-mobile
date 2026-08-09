import { mmkvStorage } from "lib/storage/mmkv";

import type { BugReportSeverity } from "lib/bug-report/types";

/**
 * The in-progress report a user has typed but not yet submitted. Persisted
 * device-locally so an offline reporter does not lose their text before they
 * are back online. Only the user-typed fields are stored - never captured
 * context, screenshots, or anything sensitive. There is deliberately NO
 * background sync: the draft is cleared the moment a submit succeeds.
 */
export interface BugReportDraft {
    title: string;
    description: string;
    severity: BugReportSeverity;
    /**
     * Account that typed the draft. The key survives sign-out on a shared field
     * device, so the owner decides whose form it is restored into and whose
     * account deletion may clear it. Absent only on drafts written before
     * account tagging.
     */
    accountId?: string;
}

const DRAFT_STORAGE_KEY = "playspace.bugReport.draft.v1";

/**
 * Read the stored draft, but only when it belongs to the account asking for it.
 *
 * A draft written by a previous auditor on a shared device is never restored
 * into someone else's report form: it holds their typed words.
 *
 * @param accountId Account currently signed in.
 * @returns The draft, or null when there is none or it belongs to someone else.
 */
export function readBugReportDraft(accountId: string): BugReportDraft | null {
    try {
        const raw = mmkvStorage.getString(DRAFT_STORAGE_KEY);
        if (raw === undefined) {
            return null;
        }
        const parsed = JSON.parse(raw) as Partial<BugReportDraft>;
        if (typeof parsed.title !== "string" || typeof parsed.description !== "string") {
            return null;
        }
        if (parsed.accountId !== accountId) {
            return null;
        }
        const severity: BugReportSeverity =
            parsed.severity === "blocking" || parsed.severity === "major" || parsed.severity === "minor"
                ? parsed.severity
                : "major";
        return { title: parsed.title, description: parsed.description, severity, accountId };
    } catch {
        return null;
    }
}

export function saveBugReportDraft(draft: BugReportDraft): void {
    try {
        mmkvStorage.set(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
        /* non-critical: the in-memory form state is the source of truth */
    }
}

export function clearBugReportDraft(): void {
    try {
        mmkvStorage.remove(DRAFT_STORAGE_KEY);
    } catch {
        /* non-critical */
    }
}
