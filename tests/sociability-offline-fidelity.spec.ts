import { describe, expect, it } from "vitest";

import {
    applyFetchedSessionSnapshot,
    applyLocalQuestionAnswerChange,
    buildDraftPatchSnapshot,
    prepareConflictRecoverySnapshot,
} from "lib/audit/store-sync-core";
import { persistedAuditStateSchema } from "lib/audit/types";

import { buildSociabilitySession } from "./support/sociability-fixtures";

const auditId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sectionKey = "section_a";

describe("Sociability array fidelity across offline sync", () => {
    it("deep-clones local array answers and emits them unchanged in the sparse draft patch", () => {
        const selectedKeys = ["play_alone", "large_group"];
        const result = applyLocalQuestionAnswerChange({
            session: buildSociabilitySession(),
            sectionKey,
            questionKey: "q1",
            answers: { provision: "some", sociability: selectedKeys },
            nextVersion: 7,
            dirtySections: {},
        });
        selectedKeys.push("small_group");

        expect(result.session.sections.section_a?.responses.q1?.sociability).toEqual(["play_alone", "large_group"]);
        expect(result.session.progress.ready_to_submit).toBe(true);

        const snapshot = buildDraftPatchSnapshot({
            auditId,
            session: result.session,
            dirtyMeta: {},
            dirtyPreAudit: {},
            dirtySections: result.dirtySections,
            dirtyStartedAt: {},
        });
        expect(snapshot?.patch.sections.section_a?.responses.q1?.sociability).toEqual(["play_alone", "large_group"]);
        expect(JSON.parse(JSON.stringify(snapshot?.patch)).sections.section_a.responses.q1.sociability).toEqual([
            "play_alone",
            "large_group",
        ]);
    });

    it("round-trips array answers through the persisted MMKV schema", () => {
        const session = buildSociabilitySession({
            provision: "some",
            sociability: ["play_alone", "small_group"],
        });
        const persisted = persistedAuditStateSchema.parse({
            storage_user_id: "auditor-1",
            instrument: session.instrument,
            sessions_by_audit_id: { [auditId]: session },
            sessions_by_pair_key: { pair: session },
            dirty_sections: { [auditId]: { [sectionKey]: 3 } },
            dirty_pre_audit: {},
            dirty_meta: {},
            dirty_started_at: {},
            sync_state_by_audit_id: {},
            local_change_counter: 3,
            last_successful_sync_at: null,
        });

        const restored = persistedAuditStateSchema.parse(JSON.parse(JSON.stringify(persisted)));
        expect(restored.sessions_by_audit_id[auditId]?.sections.section_a?.responses.q1?.sociability).toEqual([
            "play_alone",
            "small_group",
        ]);
    });

    it("rebases a dirty local array over a newer server revision and keeps it in the retry patch", () => {
        const currentSession = buildSociabilitySession(
            { provision: "some", sociability: ["play_alone", "large_group"] },
            "multiple",
            1,
        );
        const fetchedSession = buildSociabilitySession(
            { provision: "some", sociability: ["small_group"] },
            "multiple",
            2,
        );
        const dirtySections = { [auditId]: { [sectionKey]: 9 } };

        const recovery = prepareConflictRecoverySnapshot({
            auditId,
            currentSession,
            fetchedSession,
            dirtyMeta: {},
            dirtyPreAudit: {},
            dirtySections,
            dirtyStartedAt: {},
        });

        expect(recovery.session.revision).toBe(2);
        expect(recovery.session.sections.section_a?.responses.q1?.sociability).toEqual(["play_alone", "large_group"]);
        expect(recovery.retrySnapshot?.patch.sections.section_a?.responses.q1?.sociability).toEqual([
            "play_alone",
            "large_group",
        ]);
    });

    it("accepts the fetched device array when the local section is clean", () => {
        const currentSession = buildSociabilitySession(
            { provision: "some", sociability: ["play_alone"] },
            "multiple",
            1,
        );
        const fetchedSession = buildSociabilitySession(
            { provision: "some", sociability: ["small_group", "large_group"] },
            "multiple",
            2,
        );

        const merged = applyFetchedSessionSnapshot({
            currentSession,
            fetchedSession,
            dirtyMeta: {},
            dirtyPreAudit: {},
            dirtySections: {},
            dirtyStartedAt: {},
        }).session;

        expect(merged.sections.section_a?.responses.q1?.sociability).toEqual(["small_group", "large_group"]);
    });
});
