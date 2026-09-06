import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    blockReasonCopyKey,
    isConfirmationWordValid,
    partitionEntriesByOwner,
    resolveDeletionGate,
    selectAccountPurgeKeys,
    type DeletionBlockReason,
} from "lib/account/deletion-plan";
import { DELETION_CONFIRMATION_WORD, type AccountDeletionPreview } from "lib/account/deletion-types";
import { auditStateStorageKey } from "lib/audit/storage-keys";
import { submitOutboxOpKey, submitOutboxQuarantineKey } from "lib/audit/outbox/outbox-keys";
import { reportFilterUserKey } from "lib/audit/report-filter-keys";

/**
 * Account deletion is irreversible and runs on a shared field device, so the two
 * properties worth guarding hardest are: it never reaches another auditor's
 * on-device data, and it never shows an auditor a raw server code.
 */

const ACCOUNT = "auditor-1";
/** Account id having ACCOUNT as a leading substring - the classic prefix trap. */
const NEIGHBOUR = "auditor-12";

function previewFixture(overrides: Partial<AccountDeletionPreview> = {}): AccountDeletionPreview {
    return {
        role: "AUDITOR",
        submitted_audits_preserved: 4,
        draft_audits_to_delete: 0,
        active_assignments_to_delete: 0,
        pending_submissions: 0,
        is_primary_manager: false,
        can_delete: true,
        blocker: null,
        ...overrides,
    };
}

describe("selectAccountPurgeKeys", () => {
    it("removes the deleted account's audit snapshot and outbox entries", () => {
        const keys = [
            auditStateStorageKey(ACCOUNT),
            submitOutboxOpKey(ACCOUNT, "audit-a"),
            submitOutboxQuarantineKey(submitOutboxOpKey(ACCOUNT, "audit-b")),
        ];

        const selected = selectAccountPurgeKeys(keys, ACCOUNT);

        expect([...selected.accountScopedKeys].sort()).toEqual([...keys].sort());
    });

    it("removes the deleted account's stored report filters", () => {
        const selected = selectAccountPurgeKeys([reportFilterUserKey(ACCOUNT)], ACCOUNT);

        expect(selected.accountScopedKeys).toEqual([reportFilterUserKey(ACCOUNT)]);
    });

    it("leaves another auditor's report filters untouched", () => {
        const selected = selectAccountPurgeKeys(
            [reportFilterUserKey(ACCOUNT), reportFilterUserKey(NEIGHBOUR)],
            ACCOUNT,
        );

        expect(selected.accountScopedKeys).toEqual([reportFilterUserKey(ACCOUNT)]);
    });

    it("never selects a different account whose id starts with the same characters", () => {
        const ownKeys = [auditStateStorageKey(ACCOUNT), submitOutboxOpKey(ACCOUNT, "audit-a")];
        const neighbourKeys = [auditStateStorageKey(NEIGHBOUR), submitOutboxOpKey(NEIGHBOUR, "audit-a")];

        const selected = selectAccountPurgeKeys([...ownKeys, ...neighbourKeys], ACCOUNT);

        expect([...selected.accountScopedKeys].sort()).toEqual([...ownKeys].sort());
        for (const neighbourKey of neighbourKeys) {
            expect(selected.accountScopedKeys).not.toContain(neighbourKey);
        }
    });

    it("clears the signed-in account's own queues but keeps device-level settings", () => {
        const keys = [
            "playspace.bugReport.queue.v1",
            "playspace.bugReport.draft.v1",
            "playspace.submit_failure_notifications",
            "notifications_cache",
            "playspace.preferences.v1",
            "playspace.instrument.cache.v1",
        ];

        const selected = selectAccountPurgeKeys(keys, ACCOUNT);

        // Sign-out empties this one, so it can only hold the account being deleted.
        expect(selected.sessionCacheKeys).toContain("notifications_cache");
        // Display and accessibility settings belong to the shared device, not the person.
        expect(selected.sessionCacheKeys).not.toContain("playspace.preferences.v1");
        expect(selected.sessionCacheKeys).not.toContain("playspace.instrument.cache.v1");
    });

    it("never removes a device-shared queue outright", () => {
        const keys = [
            "playspace.bugReport.queue.v1",
            "playspace.bugReport.draft.v1",
            "playspace.submit_failure_notifications",
        ];

        const selected = selectAccountPurgeKeys(keys, ACCOUNT);

        // These survive sign-out and can hold another auditor's unsent work, so
        // they are pruned entry-by-entry rather than deleted.
        for (const key of keys) {
            expect(selected.accountScopedKeys).not.toContain(key);
            expect(selected.sessionCacheKeys).not.toContain(key);
        }
    });

    it("selects nothing when the device holds only other accounts' data", () => {
        const selected = selectAccountPurgeKeys(
            [auditStateStorageKey(NEIGHBOUR), submitOutboxOpKey(NEIGHBOUR, "audit-a")],
            ACCOUNT,
        );

        expect(selected.accountScopedKeys).toEqual([]);
        expect(selected.sessionCacheKeys).toEqual([]);
    });
});

describe("partitionEntriesByOwner", () => {
    it("claims only the deleted account's entries", () => {
        const entries = [
            { id: "a", accountId: ACCOUNT },
            { id: "b", accountId: NEIGHBOUR },
            { id: "c", accountId: ACCOUNT },
        ];

        const { owned, retained } = partitionEntriesByOwner(entries, ACCOUNT);

        expect(owned.map((entry) => entry.id)).toEqual(["a", "c"]);
        expect(retained.map((entry) => entry.id)).toEqual(["b"]);
    });

    it("keeps another auditor's unsent bug report on a shared device", () => {
        const entries = [{ id: "theirs", accountId: NEIGHBOUR }];

        const { owned, retained } = partitionEntriesByOwner(entries, ACCOUNT);

        expect(owned).toEqual([]);
        expect(retained).toEqual(entries);
    });

    it("retains untagged legacy entries rather than guessing an owner", () => {
        // Written before account tagging: ownership cannot be proven, and
        // wrongly deleting someone else's unsent report is irreversible.
        const entries = [{ id: "legacy" }, { id: "mine", accountId: ACCOUNT }];

        const { owned, retained } = partitionEntriesByOwner(entries, ACCOUNT);

        expect(owned.map((entry) => entry.id)).toEqual(["mine"]);
        expect(retained.map((entry) => entry.id)).toEqual(["legacy"]);
    });

    it("treats an empty queue as nothing to do", () => {
        expect(partitionEntriesByOwner([], ACCOUNT)).toEqual({ owned: [], retained: [] });
    });
});

describe("resolveDeletionGate", () => {
    it("allows deletion when nothing is outstanding", () => {
        expect(resolveDeletionGate({ preview: previewFixture(), localPendingUploadCount: 0 })).toEqual({
            kind: "ready",
        });
    });

    it("blocks on work still queued on this device before consulting the server", () => {
        const gate = resolveDeletionGate({ preview: previewFixture(), localPendingUploadCount: 2 });

        expect(gate).toEqual({ kind: "blocked", reason: "LOCAL_PENDING_UPLOADS", pendingUploadCount: 2 });
    });

    it("blocks while the server is still receiving a submission", () => {
        const gate = resolveDeletionGate({
            preview: previewFixture({ pending_submissions: 1, can_delete: false }),
            localPendingUploadCount: 0,
        });

        expect(gate).toEqual({ kind: "blocked", reason: "PENDING_SUBMISSION_DELIVERY", pendingUploadCount: 1 });
    });

    it("blocks a primary manager until ownership moves", () => {
        const gate = resolveDeletionGate({
            preview: previewFixture({
                role: "MANAGER",
                is_primary_manager: true,
                can_delete: false,
                blocker: "PRIMARY_MANAGER_TRANSFER_REQUIRED",
            }),
            localPendingUploadCount: 0,
        });

        expect(gate).toEqual({
            kind: "blocked",
            reason: "PRIMARY_MANAGER_TRANSFER_REQUIRED",
            pendingUploadCount: 0,
        });
    });

    it("degrades an unrecognised server blocker to generic guidance", () => {
        const gate = resolveDeletionGate({
            preview: previewFixture({ can_delete: false, blocker: "SOME_FUTURE_BACKEND_RULE" }),
            localPendingUploadCount: 0,
        });

        expect(gate).toEqual({ kind: "blocked", reason: "UNAVAILABLE", pendingUploadCount: 0 });
    });

    it("blocks when the server refuses without naming a reason", () => {
        const gate = resolveDeletionGate({
            preview: previewFixture({ can_delete: false }),
            localPendingUploadCount: 0,
        });

        expect(gate).toEqual({ kind: "blocked", reason: "UNAVAILABLE", pendingUploadCount: 0 });
    });

    it("does not treat unsent drafts as a reason to block", () => {
        const gate = resolveDeletionGate({
            preview: previewFixture({ draft_audits_to_delete: 5 }),
            localPendingUploadCount: 0,
        });

        expect(gate).toEqual({ kind: "ready" });
    });
});

describe("isConfirmationWordValid", () => {
    it("accepts the exact word, with forgiving whitespace", () => {
        expect(isConfirmationWordValid(DELETION_CONFIRMATION_WORD)).toBe(true);
        expect(isConfirmationWordValid("  DELETE  ")).toBe(true);
    });

    it("rejects anything the server would refuse", () => {
        for (const typed of ["delete", "Delete", "DELET", "DELETE ACCOUNT", ""]) {
            expect(isConfirmationWordValid(typed)).toBe(false);
        }
    });
});

describe("deletion copy", () => {
    const LOCALES = ["en", "de", "fr", "hi", "ja"] as const;
    const REASONS: readonly DeletionBlockReason[] = [
        "LOCAL_PENDING_UPLOADS",
        "PENDING_SUBMISSION_DELIVERY",
        "PRIMARY_MANAGER_TRANSFER_REQUIRED",
        "PERSONAL_ACCOUNT_HAS_DEPENDENCIES",
        "UNAVAILABLE",
    ];

    function loadSettings(locale: string): Record<string, unknown> {
        const path = join(process.cwd(), "lib/i18n/locales", locale, "settings.json");
        return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    }

    function lookup(messages: Record<string, unknown>, dottedPath: string): unknown {
        let node: unknown = messages;
        for (const part of dottedPath.split(".")) {
            if (node === null || typeof node !== "object" || !(part in (node as Record<string, unknown>))) {
                return undefined;
            }
            node = (node as Record<string, unknown>)[part];
        }
        return node;
    }

    it.each(LOCALES)("explains every block reason in %s without leaking a code", (locale) => {
        const messages = loadSettings(locale);

        for (const reason of REASONS) {
            const base = blockReasonCopyKey(reason);
            const title = lookup(messages, `${base}.title`);
            const message = lookup(messages, `${base}.message`);

            expect(typeof title, `${locale} ${base}.title`).toBe("string");
            expect(typeof message, `${locale} ${base}.message`).toBe("string");
            // The raw server code must never be the thing the auditor reads.
            expect(title).not.toContain(reason);
            expect(message).not.toContain(reason);
        }
    });

    it.each(LOCALES)("carries the same deletion keys in %s as English", (locale) => {
        function flatten(value: unknown, prefix: string, out: Set<string>): Set<string> {
            if (value !== null && typeof value === "object" && !Array.isArray(value)) {
                for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
                    flatten(nested, prefix ? `${prefix}.${key}` : key, out);
                }
            } else if (prefix.startsWith("deleteAccount.")) {
                out.add(prefix);
            }
            return out;
        }

        const english = flatten(loadSettings("en"), "", new Set());
        const translated = flatten(loadSettings(locale), "", new Set());

        expect(english.size).toBeGreaterThan(0);
        expect([...english].filter((key) => !translated.has(key))).toEqual([]);
    });
});
