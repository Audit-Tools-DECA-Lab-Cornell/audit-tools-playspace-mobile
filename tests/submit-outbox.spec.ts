import { describe, expect, it, vi } from "vitest";

import {
    createSubmitOp,
    isInBackoff,
    isRetryableSubmitError,
    registerAttempt,
    retryDelayMs,
    selectDrainableOps,
} from "lib/audit/outbox/outbox-core";
import { SubmitOutbox } from "lib/audit/outbox/outbox-storage";
import type { OutboxKeyValueStorage, SubmitOutboxOp } from "lib/audit/outbox/types";

// The storage module instantiates a default MMKV-backed outbox at import time;
// the tests inject their own fake storage, so a minimal stub is enough.
vi.mock("react-native-mmkv", () => ({
    createMMKV: () => ({
        getString: () => undefined,
        set: () => undefined,
        remove: () => undefined,
        getAllKeys: () => [],
    }),
}));

/** Minimal stand-in for a PlayspaceAuditApiError (only statusCode is read). */
function apiError(statusCode: number): { statusCode: number } {
    return { statusCode };
}

const BACKOFF = { baseDelayMs: 5_000, capDelayMs: 60_000 };

function op(overrides: Partial<SubmitOutboxOp> = {}): SubmitOutboxOp {
    return {
        audit_id: "audit-1",
        created_at: "2026-06-12T00:00:00.000Z",
        attempts: 0,
        last_attempt_at: null,
        last_error: null,
        ...overrides,
    };
}

describe("outbox core", () => {
    it("creates a fresh op with zero attempts", () => {
        expect(createSubmitOp("audit-9", "2026-06-12T01:00:00.000Z")).toEqual({
            audit_id: "audit-9",
            created_at: "2026-06-12T01:00:00.000Z",
            attempts: 0,
            last_attempt_at: null,
            last_error: null,
        });
    });

    it("records attempts with timestamp and error", () => {
        const next = registerAttempt(op(), "2026-06-12T00:01:00.000Z", "network down");
        expect(next.attempts).toBe(1);
        expect(next.last_attempt_at).toBe("2026-06-12T00:01:00.000Z");
        expect(next.last_error).toBe("network down");
    });

    it("computes capped exponential backoff", () => {
        expect(retryDelayMs(0, BACKOFF)).toBe(0);
        expect(retryDelayMs(1, BACKOFF)).toBe(5_000);
        expect(retryDelayMs(2, BACKOFF)).toBe(10_000);
        expect(retryDelayMs(3, BACKOFF)).toBe(20_000);
        expect(retryDelayMs(10, BACKOFF)).toBe(60_000); // capped
    });

    it("treats never-attempted ops as drainable and respects the backoff window", () => {
        expect(isInBackoff(op(), "2026-06-12T00:00:10.000Z", BACKOFF)).toBe(false);

        const attempted = op({ attempts: 1, last_attempt_at: "2026-06-12T00:00:00.000Z" });
        // 5s window after one attempt: still inside at +3s, eligible at +5s.
        expect(isInBackoff(attempted, "2026-06-12T00:00:03.000Z", BACKOFF)).toBe(true);
        expect(isInBackoff(attempted, "2026-06-12T00:00:05.000Z", BACKOFF)).toBe(false);
    });

    it("selects drainable ops oldest-first, skipping those in backoff", () => {
        const fresh = op({ audit_id: "fresh", created_at: "2026-06-12T00:00:03.000Z" });
        const older = op({ audit_id: "older", created_at: "2026-06-12T00:00:01.000Z" });
        const backedOff = op({
            audit_id: "backed-off",
            created_at: "2026-06-12T00:00:00.000Z",
            attempts: 1,
            last_attempt_at: "2026-06-12T00:00:09.000Z",
        });

        const drainable = selectDrainableOps([fresh, older, backedOff], "2026-06-12T00:00:10.000Z", BACKOFF);
        expect(drainable.map((entry) => entry.audit_id)).toEqual(["older", "fresh"]);
    });

    it("classifies submit errors as retryable or terminal", () => {
        expect(isRetryableSubmitError(apiError(0))).toBe(true);
        expect(isRetryableSubmitError(apiError(503))).toBe(true);
        expect(isRetryableSubmitError(apiError(429))).toBe(true);
        expect(isRetryableSubmitError(apiError(400))).toBe(false);
        expect(isRetryableSubmitError(apiError(403))).toBe(false);
        expect(isRetryableSubmitError(apiError(409))).toBe(false);
        expect(isRetryableSubmitError(new Error("unknown"))).toBe(true);
    });
});

function createFakeStorage(initial: Record<string, string> = {}): {
    storage: OutboxKeyValueStorage;
    entries: Map<string, string>;
} {
    const entries = new Map(Object.entries(initial));
    return {
        storage: {
            getString: (key) => entries.get(key),
            set: (key, value) => {
                entries.set(key, value);
            },
            remove: (key) => {
                entries.delete(key);
            },
            getAllKeys: () => [...entries.keys()],
        },
        entries,
    };
}

describe("SubmitOutbox storage", () => {
    it("round-trips ops and scopes them by user", () => {
        const { storage } = createFakeStorage();
        const outbox = new SubmitOutbox(storage);

        outbox.put("user-a", createSubmitOp("audit-1", "2026-06-12T00:00:00.000Z"));
        outbox.put("user-a", createSubmitOp("audit-2", "2026-06-12T00:00:01.000Z"));
        outbox.put("user-b", createSubmitOp("audit-3", "2026-06-12T00:00:02.000Z"));

        expect(
            outbox
                .list("user-a")
                .map((entry) => entry.audit_id)
                .sort(),
        ).toEqual(["audit-1", "audit-2"]);
        expect(outbox.list("user-b").map((entry) => entry.audit_id)).toEqual(["audit-3"]);
        expect(outbox.get("user-a", "audit-1")?.audit_id).toBe("audit-1");

        outbox.remove("user-a", "audit-1");
        expect(outbox.get("user-a", "audit-1")).toBeNull();
        expect(outbox.list("user-a").map((entry) => entry.audit_id)).toEqual(["audit-2"]);
    });

    it("enqueue is idempotent per audit (op id is the audit id)", () => {
        const { storage } = createFakeStorage();
        const outbox = new SubmitOutbox(storage);

        outbox.put("user-a", createSubmitOp("audit-1", "2026-06-12T00:00:00.000Z"));
        outbox.put("user-a", createSubmitOp("audit-1", "2026-06-12T00:05:00.000Z"));

        expect(outbox.list("user-a")).toHaveLength(1);
    });

    it("quarantines an unreadable op and keeps the rest of the queue", () => {
        const { storage, entries } = createFakeStorage();
        const outbox = new SubmitOutbox(storage);
        outbox.put("user-a", createSubmitOp("audit-good", "2026-06-12T00:00:00.000Z"));
        // Corrupt a second op directly in storage.
        storage.set("audit.outbox.v1.user-a.submit.audit-bad", "{not valid json");

        const ops = outbox.list("user-a");
        expect(ops.map((entry) => entry.audit_id)).toEqual(["audit-good"]);
        // The corrupt primary key is gone, preserved under a corrupt.* key.
        expect(entries.has("audit.outbox.v1.user-a.submit.audit-bad")).toBe(false);
        const quarantined = [...entries.keys()].filter((key) => key.includes(".corrupt."));
        expect(quarantined).toHaveLength(1);
        expect(entries.get(quarantined[0] as string)).toBe("{not valid json");
    });

    it("does not collide with the editing-store key namespace", () => {
        const editingBlob = JSON.stringify({
            sessions_by_audit_id: {
                "audit-1": {
                    sections: {
                        section_a: {
                            responses: {
                                q1: { sociability: ["play_alone", "large_group"] },
                            },
                        },
                    },
                },
            },
        });
        const { storage, entries } = createFakeStorage({
            "audit.state.v4.user-a": editingBlob,
        });
        const outbox = new SubmitOutbox(storage);
        outbox.put("user-a", createSubmitOp("audit-1", "2026-06-12T00:00:00.000Z"));

        // The editing blob is untouched; outbox keys live under their own prefix.
        expect(entries.get("audit.state.v4.user-a")).toBe(editingBlob);
        expect(
            JSON.parse(entries.get("audit.state.v4.user-a") ?? "{}").sessions_by_audit_id["audit-1"].sections.section_a
                .responses.q1.sociability,
        ).toEqual(["play_alone", "large_group"]);
        expect([...entries.keys()].some((key) => key.startsWith("audit.outbox.v1."))).toBe(true);
    });
});
